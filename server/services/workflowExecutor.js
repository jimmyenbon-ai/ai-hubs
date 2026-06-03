const { WorkflowTemplate, WorkflowRun, LLMConfig, KnowledgeBase } = require('../models/workflowModel');
const llmService = require('./llmService');
const { notifyWorkflowStep } = require('../utils/websocket');
const { intelligentSearch, isMultimedia, isImageContent, isVideoContent, isAudioContent, getTextContent, getImageUrl, getVideoUrl, getAudioUrl } = require('./knowledgeSearch');
const { ensurePublicImageUrl } = require('../utils/imageUtils');
const { saveImage: saveImageLocal, saveVideo: saveVideoLocal, saveText: saveTextLocal } = require('../utils/localStorage');
const { appConfig } = require('../utils/appConfig');

// 获取节点实际使用的 LLM 配置：优先读数据库中的默认配置，fallback 到硬编码默认值
async function getNodeLLMConfig(node) {
  const raw = node.data?.llmConfig;
  if (raw && typeof raw === 'object' && raw.provider) {
    return raw;
  }
  // 无论节点配置是 'default' / 'custom' / undefined，都尝试读数据库默认
  try {
    const dbConfig = await LLMConfig.findDefault();
    if (dbConfig && dbConfig.api_key) {
      console.log('[getNodeLLMConfig] 使用数据库默认配置:', dbConfig.model);
      return {
        provider: dbConfig.provider,
        api_url: dbConfig.api_url,
        api_key: dbConfig.api_key,
        model: dbConfig.model,
      };
    }
    if (dbConfig && !dbConfig.api_key) {
      console.log('[getNodeLLMConfig] 数据库配置缺少 api_key，尝试从设置面板获取');
    }
  } catch (e) {
    console.warn('[getNodeLLMConfig] 读取数据库配置失败:', e.message);
  }

  // Fallback: 从设置面板（appConfig）读取 DeepSeek API Key
  const dsKey = appConfig.deepseek_api_key;
  if (dsKey) {
    console.log('[getNodeLLMConfig] 使用设置面板的 DeepSeek 配置');
    return {
      provider: 'deepseek',
      api_url: appConfig.deepseek_api_url || 'https://api.deepseek.com',
      api_key: dsKey,
      model: appConfig.deepseek_model || 'deepseek-chat',
    };
  }

  console.warn('[getNodeLLMConfig] 未找到任何 LLM API Key，LLM 调用将失败！请在设置面板填写 DeepSeek API Key');
  return llmService.getDefaultConfig();
}

// 参考图最大上限
const MAX_REFERENCE_IMAGES = 8;
// 默认推荐数量：1张背面产品图 + 1张logo/品牌图
const DEFAULT_REFERENCE_COUNT = 3;

// 优先级筛选：背面产品图 > logo/品牌图 > 正面产品图 > 其他
// 不排除任何类型，只按优先级排序
// limit 由 LLM 分析节点的 maxReferenceImages 决定，默认 DEFAULT_REFERENCE_COUNT
function pickReferenceImages(candidates, directives = {}) {
  if (!candidates || candidates.length === 0) return [];

  // LLM 指定的上限优先，否则用默认值
  const limit = (typeof directives.maxReferenceImages === 'number' && directives.maxReferenceImages >= 0)
    ? Math.min(directives.maxReferenceImages, MAX_REFERENCE_IMAGES)
    : DEFAULT_REFERENCE_COUNT;

  // LLM 说不需要参考图
  if (limit === 0) {
    console.log('[参考图选取] LLM指定maxReferenceImages=0，跳过所有参考图');
    return [];
  }

  const priority = directives.referencePriority || 'back_view_first';

  const BACK_KEYWORDS = ['背面', '背侧', '背右侧', '背左侧', 'back', 'rear'];
  const FRONT_KEYWORDS = ['正面', '正侧', '正视图', 'front'];
  const LOGO_KEYWORDS = ['logo', '标志', '标识', 'brand'];

  function score(img) {
    const name = ((img.originalName || '') + (img.title || '') + (img.folder || '')).toLowerCase();
    let s = 0;

    if (priority === 'back_view_first') {
      for (const kw of BACK_KEYWORDS) {
        if (name.includes(kw.toLowerCase())) { s += 100; break; }
      }
      for (const kw of LOGO_KEYWORDS) {
        if (name.includes(kw.toLowerCase())) { s += 50; break; }
      }
      for (const kw of FRONT_KEYWORDS) {
        if (name.includes(kw.toLowerCase())) { s += 30; break; }
      }
    } else if (priority === 'all') {
      // 不区分优先级，只看相关性
      s += 50;
    }

    // 相关性分数加成（来自搜索结果）
    if (typeof img.relevanceScore === 'number') s += img.relevanceScore * 10;
    return s;
  }

  const sorted = candidates
    .map(img => ({ img, score: score(img) }))
    .sort((a, b) => b.score - a.score);

  const selected = sorted.slice(0, limit)
    .map(s => {
      const url = s.img.url || s.img;
      return typeof url === 'string' && url.trim() ? url.trim() : null;
    }).filter(Boolean);

  console.log(`[参考图选取] 候选${candidates.length}张 → 选中${selected.length}张 (LLM指定limit=${directives.maxReferenceImages ?? '默认'}, 实际limit=${limit}, priority=${priority})`);
  for (let i = 0; i < selected.length; i++) {
    const item = sorted[i];
    console.log(`  [${i + 1}] 优先级:${item.score} | ${item.img.title || item.img.originalName}`);
  }
  return selected;
}

// 节点类型处理器映射
const nodeHandlers = {
  input: handleInput,
  llmAnalyze: handleLLMAnalyze,
  llmGenerate: handleLLMGenerate,
  textGenerate: handleTextGenerate,
  knowledgeQuery: handleKnowledgeQuery,
  imageGenerate: handleImageGenerate,
  videoGenerate: handleVideoGenerate,
  musicGenerate: handleMusicGenerate,
  condition: handleCondition,
  loop: handleLoop,
  output: handleOutput,
};

// API 基础 URL（支持环境变量配置）
const getApiBase = () => process.env.API_BASE_URL || 'http://localhost:3007';

class WorkflowExecutor {
  constructor() {
    this.context = {};
    this.steps = [];
  }

  // ========== 执行工作流（支持条件分支 + 循环迭代）==========
  async execute(templateId, userInputs) {
    const template = await WorkflowTemplate.findByPk(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const nodes = template.nodes || [];
    const edges = template.edges || [];
    const variables = template.variables || [];

    const parsedInputs = this.parseInputs(userInputs, variables);

    this.context = {
      inputs: parsedInputs,
      outputs: {},
      nodeOutputs: {},
      loopState: {},       // { nodeId: { iteration, maxIterations, loopBodyResults } }
      conditionResults: {}, // { nodeId: boolean }
    };

    const runRecord = await WorkflowRun.create({
      template_id: templateId,
      template_name: template.name,
      status: 'running',
      inputs: parsedInputs,
      steps: [],
    });

    // 建立节点索引
    const nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    // 建立出度邻接表（用于遍历后继节点）和入度（指向该节点的边数，用于判断是否就绪）
    const outEdges = {};
    const inDegree = {};
    nodes.forEach(n => {
      inDegree[n.id] = 0;
      outEdges[n.id] = [];
    });
    edges.forEach(e => {
      // outEdges[e.source] = 从 e.source 发出的所有边
      if (outEdges[e.source]) {
        outEdges[e.source].push(e);
      }
      // inDegree[e.target] = 指向 e.target 的边数（真正的入度）
      inDegree[e.target]++;
    });

    // 初始化：所有入度为 0 的节点进入就绪队列
    const readyQueue = nodes.filter(n => inDegree[n.id] === 0).map(n => ({ node: n, triggeredBy: null }));

    // 拓扑环检测
    const sorted = this._topologicalSortWithCycleDetect(nodes, edges, nodeMap, outEdges);
    if (sorted === null) {
      await WorkflowRun.update(runRecord.id, { status: 'failed', steps: [] });
      return { success: false, runId: runRecord.id, error: '工作流存在循环依赖，请检查条件分支和循环节点的连接', steps: [] };
    }

    // 预计算每个节点的前置依赖节点集合
    const nodeDeps = {};
    nodes.forEach(n => {
      nodeDeps[n.id] = edges.filter(e => e.target === n.id).map(e => e.source);
    });

    // 初始化：所有入度为 0 的节点进入就绪队列
    const completed = new Set();
    const running = new Set();
    const MAX_STEPS = 1000;
    let stepCount = 0;

    try {
      while (readyQueue.length > 0 && stepCount < MAX_STEPS) {
        stepCount++;
        const { node, triggeredBy } = readyQueue.shift();

        // 跳过已完成的节点
        if (completed.has(node.id)) continue;
        if (running.has(node.id)) continue;

        running.add(node.id);

        // 获取该节点的输入（从上游节点获取）
        const nodeInputs = this.getNodeInputs(node, edges);

        const stepStart = Date.now();
        const result = await this._executeNode(node, nodeInputs, triggeredBy);
        const stepDuration = Date.now() - stepStart;

        running.delete(node.id);
        completed.add(node.id);

        this.context.nodeOutputs[node.id] = result;

        const step = {
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data?.label || node.type,
          inputs: nodeInputs,
          output: result,
          duration: stepDuration,
        };
        this.steps.push(step);

        // WebSocket 推送步骤完成（不阻塞）
        notifyWorkflowStep({
          runId: runRecord.id,
          nodeId: node.id,
          nodeName: node.data?.label || node.type,
          nodeType: node.type,
          status: result.error ? 'failed' : 'completed',
          step: this.steps.length,
          totalSteps: nodes.length,
          output: result,
          error: result.error || null,
          duration: stepDuration,
        });

        // 更新执行记录
        await WorkflowRun.update(runRecord.id, { steps: this.steps });

        // 处理节点执行完成后的后续逻辑
        const successors = this._getSuccessors(node, edges);

        for (const edge of successors) {
          const sourceNode = nodeMap[edge.source];
          const targetNode = nodeMap[edge.target];
          if (!targetNode) continue;

          // 更新入度
          inDegree[edge.target]--;

          // === 特殊节点处理 ===
          if (targetNode.type === 'condition') {
            // 条件节点：只有当前驱节点的输出满足条件时才加入队列
            const condResult = this.context.conditionResults[targetNode.id];
            if (condResult === true || condResult === false) {
              if (inDegree[edge.target] === 0) {
                readyQueue.push({ node: targetNode, triggeredBy: edge });
              }
            } else if (inDegree[edge.target] === 0) {
              readyQueue.push({ node: targetNode, triggeredBy: edge });
            }
          } else if (targetNode.type === 'loop') {
            // 循环节点：维护迭代状态
            if (!this.context.loopState[targetNode.id]) {
              this.context.loopState[targetNode.id] = { iteration: 0, maxIterations: targetNode.data?.maxIterations || 5, loopBodyResults: [] };
            }
            const loopState = this.context.loopState[targetNode.id];
            const loopResult = result;

            if (loopResult?.loopBodyOutput) {
              loopState.loopBodyResults.push(loopResult.loopBodyOutput);
            }

            // 检查是否继续循环
            const shouldContinue = loopState.iteration < loopState.maxIterations - 1;
            if (shouldContinue) {
              // 找到循环体节点，重新加入就绪队列（用 loop edge）
              const loopBodyEdges = edges.filter(e => e.source === targetNode.id && e.sourceHandle === 'loop');
              for (const lbEdge of loopBodyEdges) {
                if (nodeMap[lbEdge.target]) {
                  readyQueue.push({ node: nodeMap[lbEdge.target], triggeredBy: lbEdge });
                }
              }
              loopState.iteration++;
            } else {
              // 循环结束，将结束节点加入队列
              const doneEdges = edges.filter(e => e.source === targetNode.id && e.sourceHandle === 'done');
              for (const dEdge of doneEdges) {
                if (nodeMap[dEdge.target]) {
                  readyQueue.push({ node: nodeMap[dEdge.target], triggeredBy: dEdge });
                }
              }
            }
          } else if (sourceNode && sourceNode.type === 'condition') {
            // 条件节点已执行完，按 sourceHandle 匹配路由
            const condResult = this.context.conditionResults[edge.source];
            const expectedHandle = condResult === true ? 'true' : 'false';
            if (edge.sourceHandle === expectedHandle && inDegree[edge.target] === 0) {
              readyQueue.push({ node: targetNode, triggeredBy: edge });
            }
          } else {
            // 普通节点：所有前置依赖都完成才加入
            if (inDegree[edge.target] === 0) {
              readyQueue.push({ node: targetNode, triggeredBy: edge });
            }
          }
        }
      }

      // 收集最终输出
      const finalOutputs = this._collectFinalOutputs(nodes, completed, nodeMap);
      this.context.outputs = finalOutputs;

      await WorkflowRun.update(runRecord.id, {
        status: 'completed',
        outputs: finalOutputs,
        steps: this.steps,
      });

      return {
        success: true,
        runId: runRecord.id,
        outputs: finalOutputs,
        steps: this.steps,
      };
    } catch (err) {
      await WorkflowRun.update(runRecord.id, {
        status: 'failed',
        steps: this.steps,
      });

      return {
        success: false,
        runId: runRecord.id,
        error: err.message,
        steps: this.steps,
      };
    }
  }

  // ========== 拓扑排序 + 环检测（基于出度邻接表）==========
  _topologicalSortWithCycleDetect(nodes, edges, nodeMap, outEdges) {
    const sorted = [];
    const visited = {};
    const stack = {};

    const dfs = (nodeId) => {
      if (stack[nodeId]) return false; // 环
      if (visited[nodeId]) return true;
      visited[nodeId] = true;
      stack[nodeId] = true;

      for (const edge of outEdges[nodeId] || []) {
        if (!dfs(edge.target)) return false;
      }

      stack[nodeId] = false;
      sorted.push(nodeId);
      return true;
    };

    for (const node of nodes) {
      if (!visited[node.id]) {
        if (!dfs(node.id)) return null; // 有环
      }
    }

    return sorted.reverse().map(id => nodeMap[id]);
  }

  // ========== 获取后继边（从 edges 直接过滤，效率略低但更清晰可靠）==========
  _getSuccessors(node, edges) {
    return edges.filter(e => e.source === node.id);
  }

  // ========== 执行单个节点 ==========
  async _executeNode(node, nodeInputs, triggeredBy) {
    const handler = nodeHandlers[node.type];
    if (!handler) {
      throw new Error(`Unknown node type: ${node.type}`);
    }
    console.log(`[_executeNode] 开始执行节点 ${node.type} (${node.id}), inputs:`, JSON.stringify(nodeInputs).substring(0, 200));

    const result = await handler(node, nodeInputs, this.context);
    console.log(`[_executeNode] 节点 ${node.type} 执行完成, result keys:`, Object.keys(result), 'result:', JSON.stringify(result).substring(0, 200));

    // 条件节点：记录条件结果
    if (node.type === 'condition') {
      this.context.conditionResults[node.id] = result.conditionResult;
    }

    return result;
  }

  // ========== 解析用户输入 ==========
  parseInputs(userInputs, variables) {
    const parsed = {};
    variables.forEach(v => {
      if (userInputs[v.name] !== undefined) {
        parsed[v.name] = userInputs[v.name];
      } else if (v.default !== undefined) {
        parsed[v.name] = v.default;
      } else {
        parsed[v.name] = '';
      }
    });
    return parsed;
  }

  // ========== 获取节点的输入 ==========
  getNodeInputs(node, edges) {
    const incomingEdges = edges.filter(e => e.target === node.id);
    const inputs = {};

    // 始终把 workflow 全局输入透传（覆盖空值），确保首个节点和断线节点都能拿到用户输入
    if (this.context.inputs) {
      inputs.user = { ...this.context.inputs };
    }

    // 再用上游节点的输出覆盖（真正通过连线传递的动态数据）
    if (incomingEdges.length > 0) {
      const upstreams = incomingEdges.map(e => this.context.nodeOutputs[e.source]).filter(Boolean);
      upstreams.forEach(src => {
        if (src.text) inputs.text = src.text;
        if (src.prompt) inputs.prompt = src.prompt;
        if (src.copy) inputs.copy = src.copy;
        if (src.analysis) inputs.analysis = src.analysis;
        if (src.knowledge) inputs.knowledge = src.knowledge;
        if (src.imageUrl) inputs.imageUrl = src.imageUrl;
        if (src.videoUrl) inputs.videoUrl = src.videoUrl;
        if (src.audioUrl) inputs.audioUrl = src.audioUrl;
        if (src.loopBodyOutput) inputs.loopBodyOutput = src.loopBodyOutput;
        if (src.images) inputs.images = src.images;
        if (src.videos) inputs.videos = src.videos;
        if (src.audios) inputs.audios = src.audios;
        if (src.referenceImages) inputs.referenceImages = src.referenceImages;
        if (src.styleAnalysis) inputs.styleAnalysis = src.styleAnalysis;
        if (src.searchDirectives) inputs.searchDirectives = src.searchDirectives;
      });
    }

    // 【关键修复】analysis 可能来自非直接前驱节点（如「爷爷节点」）
    // 如果当前 inputs 中没有 analysis，从所有已完成节点的输出中查找
    if (!inputs.analysis) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.analysis) {
          inputs.analysis = output.analysis;
          break;
        }
      }
    }

    // 【关键修复】knowledge / images / videos / audios 可能来自非直接前驱节点
    // 当工作流链路较长时（如 LLM分析→知识查询→LLM生成→图片生成），
    // LLM 生成节点的输出不包含 knowledge/images，导致图片生成节点丢失参考图信息
    if (!inputs.knowledge || inputs.knowledge.length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.knowledge && output.knowledge.length > 0) {
          inputs.knowledge = output.knowledge;
          break;
        }
      }
    }
    if (!inputs.images || inputs.images.length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.images && output.images.length > 0) {
          inputs.images = output.images;
          break;
        }
      }
    }
    if (!inputs.videos || inputs.videos.length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.videos && output.videos.length > 0) {
          inputs.videos = output.videos;
          break;
        }
      }
    }
    if (!inputs.audios || inputs.audios.length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.audios && output.audios.length > 0) {
          inputs.audios = output.audios;
          break;
        }
      }
    }
    if (!inputs.referenceImages || inputs.referenceImages.length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.referenceImages && output.referenceImages.length > 0) {
          inputs.referenceImages = output.referenceImages;
          break;
        }
      }
      // 从用户输入中获取参考图（用户在输入区上传的）
      if ((!inputs.referenceImages || inputs.referenceImages.length === 0) && inputs.user?.referenceImages?.length > 0) {
        inputs.referenceImages = inputs.user.referenceImages;
      }
    }
    if (!inputs.styleAnalysis) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.styleAnalysis) {
          inputs.styleAnalysis = output.styleAnalysis;
          break;
        }
      }
    }
    // LLM 参考图策略（maxReferenceImages / referencePriority）可能来自分析节点
    if (!inputs.searchDirectives || Object.keys(inputs.searchDirectives).length === 0) {
      for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
        if (output?.searchDirectives && Object.keys(output.searchDirectives).length > 0) {
          inputs.searchDirectives = output.searchDirectives;
          break;
        }
      }
    }

    // 节点自身配置的 inputs 优先级最高
    if (node.data?.inputs) {
      inputs.user = { ...inputs.user, ...node.data.inputs };
    }

    console.log(`[getNodeInputs] 节点 ${node.id} (${node.type}), inputs:`, JSON.stringify(inputs));
    return inputs;
  }

  // ========== 收集最终输出 ==========
  _collectFinalOutputs(nodes, completed, nodeMap) {
    const outputs = {};
    console.log('[_collectFinalOutputs] 开始收集, completed 节点数:', completed.size, 'completed:', [...completed]);
    for (const nodeId of completed) {
      const out = this.context.nodeOutputs[nodeId];
      console.log('[_collectFinalOutputs] 节点', nodeId, '的输出:', JSON.stringify(out));
      if (!out) continue;
      // 只收集字符串/数字类型字段，跳过对象和数组（避免 React 渲染崩溃）
      if (out.text && typeof out.text === 'string') outputs.text = out.text;
      if (out.prompt && typeof out.prompt === 'string') outputs.prompt = out.prompt;
      if (out.copy && typeof out.copy === 'string') outputs.copy = out.copy;
      // analysis 可能是对象或字符串，统一转字符串
      if (out.analysis) {
        outputs.analysis = typeof out.analysis === 'string' ? out.analysis : JSON.stringify(out.analysis, null, 2);
      }
      if (out.imageUrl && typeof out.imageUrl === 'string') outputs.imageUrl = out.imageUrl;
      if (out.videoUrl && typeof out.videoUrl === 'string') outputs.videoUrl = out.videoUrl;
      if (out.audioUrl && typeof out.audioUrl === 'string') outputs.audioUrl = out.audioUrl;
      // referenceImages 只接受字符串数组（URL列表）
      if (out.referenceImages && Array.isArray(out.referenceImages)) {
        outputs.referenceImages = out.referenceImages.filter(u => typeof u === 'string');
        if (outputs.referenceImages.length === 0) delete outputs.referenceImages;
      }
      if (out.styleAnalysis && typeof out.styleAnalysis === 'string') outputs.styleAnalysis = out.styleAnalysis;
    }
    console.log('[_collectFinalOutputs] 最终 outputs:', JSON.stringify(outputs));
    return outputs;
  }

  // ========== 同步执行（同步返回结果，供 handleRun 使用）==========
  async executeSync(templateId, userInputs) {
    return this.execute(templateId, userInputs);
  }
}

// ============ 用户输入节点 ============
async function handleInput(node, inputs, context) {
  const text = node.data?.text || '';
  const referenceImages = node.data?.referenceImages || [];
  console.log(`[输入节点] ${node.data?.label || node.id}: text=${text.slice(0, 80)}, refs=${referenceImages.length}`);
  return {
    text,
    referenceImages: referenceImages.length > 0 ? referenceImages : null,
  };
}

// ============ 条件分支处理器 ============
async function handleCondition(node, inputs, context) {
  const condition = node.data?.condition || '';
  const useFastMatch = node.data?.useFastMatch !== false; // 默认开启快速匹配
  const inputText = inputs.text || inputs.prompt || JSON.stringify(inputs);

  if (!condition || !inputText) {
    return { conditionResult: false, condition, input: inputText };
  }

  // === 快速关键词匹配（不调 LLM） ===
  const fastResult = tryFastConditionMatch(condition, inputText);
  if (fastResult !== null) {
    console.log('[条件分支] 快速匹配:', condition, '→', fastResult);
    return { conditionResult: fastResult, condition, input: inputText, matchMode: 'fast' };
  }

  // === LLM 复杂判断 ===
  if (!useFastMatch) {
    console.log('[条件分支] 快速匹配未命中，降级到 LLM 判断');
  }
  try {
    const config = await getNodeLLMConfig(node);
    const result = await llmService.complete(
      config,
      `你是一个条件判断助手。判断用户输入是否满足给定的条件。只需要回答 "true" 或 "false"。`,
      `条件: ${condition}\n\n用户输入: ${inputText}`
    );

    const content = result.content.toLowerCase();
    const isTrue = content.includes('true') && !content.includes('false');
    return { conditionResult: isTrue, condition, input: inputText, matchMode: 'llm' };
  } catch (err) {
    console.error('[条件分支] LLM 调用失败:', err.message);
    return { conditionResult: false, error: `条件判断失败: ${err.message}` };
  }
}

// 快速条件匹配（纯字符串判断，不调 LLM）
// 支持模式: 包含"xxx" / contains "xxx" / 不包含"xxx" / 以"xxx"开头/结尾
function tryFastConditionMatch(condition, inputText) {
  const lowerCondition = condition.toLowerCase();
  const lowerInput = inputText.toLowerCase();

  // 1. 提取引号中的关键词：支持中文引号「」""'' 和英文引号
  const quotePatterns = [
    /["“](.+?)["”]/g,   // 中文双引号
    /['‘](.+?)['’]/g,   // 中文单引号
    /「(.+?)」/g,          // 日式引号「」
    /"(.+?)"/g,                     // 英文双引号
    /'(.+?)'/g,                     // 英文单引号
  ];
  const keywords = [];
  for (const pattern of quotePatterns) {
    let m;
    while ((m = pattern.exec(condition)) !== null) {
      keywords.push(m[1]);
    }
  }

  if (keywords.length === 0) {
    // 没有引号关键词 → 无法快速匹配，交给 LLM
    return null;
  }

  // 2. 判断条件类型
  const isNegated = /(不包含|不含|没有|不含有|not\s*contain|doesn't\s*contain|does\s*not\s*contain|excludes?)/i.test(condition);
  const isStartsWith = /(以|开头|start\s*with|begin\s*with|prefix)/i.test(condition);
  const isEndsWith = /(结尾|末尾|结束|end\s*with|suffix)/i.test(condition);

  // 3. 执行匹配
  for (const kw of keywords) {
    const lowerKw = kw.toLowerCase();
    let matched = false;

    if (isStartsWith) {
      matched = lowerInput.startsWith(lowerKw);
    } else if (isEndsWith) {
      matched = lowerInput.endsWith(lowerKw);
    } else {
      // 默认：包含匹配
      matched = lowerInput.includes(lowerKw);
    }

    const result = isNegated ? !matched : matched;
    return result; // 找到第一个关键词就返回
  }

  return null;
}

// ============ 循环迭代处理器 ============
async function handleLoop(node, inputs, context) {
  const maxIterations = node.data?.maxIterations || 5;
  const items = inputs.items || [inputs.text || ''];

  const loopState = context.loopState[node.id] || { iteration: 0, maxIterations, loopBodyResults: [] };

  // 如果还没有开始，记录起始状态
  if (!context.loopState[node.id]) {
    context.loopState[node.id] = loopState;
  }

  // 返回当前迭代信息
  return {
    loopBodyOutput: inputs.loopBodyOutput || inputs.text || '',
    iterations: loopState.iteration + 1,
    maxIterations,
    itemsCount: items.length,
  };
}

// ============ LLM 分析节点 ============
async function handleLLMAnalyze(node, inputs, context) {
  const config = await getNodeLLMConfig(node);
  const systemPrompt = node.data?.systemPrompt || `你是一个专业的创意分析助手。请分析用户输入的想法，提取以下信息：

1. **核心主题/概念** — 用户想要创建什么
2. **目标受众** — 面向谁
3. **情感基调/风格** — 什么风格感觉
4. **关键元素** — 需要包含什么元素
5. **潜在应用场景** — 用在什么地方

此外，请根据用户的请求，**指定需要查询的知识库文件夹**：
- 可用文件夹：product（产品图片/参数）、design（设计/海报）、brand（品牌/logo）、company（公司信息）
- 重要：根据用户指定的产品型号精确搜索。如用户说R5，searchQuery中必须包含"R5"，不要混入BPro等其他产品线
- 根据任务类型，标记需要优先获取图片还是文本
- 图片/视频生成任务通常需要 preferImages: true

此外，**根据任务类型决定参考图策略**：
- 社媒海报/宣传图：通常只需 maxReferenceImages: 2~3, referencePriority: "back_view_first"（背面产品图优先+logo）
- 如果用户明确说"只要一张背面图+logo"等具体要求，严格按用户说的数量来
- 产品多角度展示/详情图：可以 maxReferenceImages: 5~8
- 纯文案任务：maxReferenceImages: 0

请以JSON格式输出：
{
  "核心主题": "...",
  "目标受众": "...",
  "风格基调": "...",
  "关键元素": "...",
  "应用场景": "...",
  "searchFolders": ["brand/logo", "design/海报"],
  "preferImages": true,
  "searchQuery": "优化的搜索关键词",
  "maxReferenceImages": 3,
  "referencePriority": "back_view_first"
}`;

  const userInput = inputs.user?.idea || inputs.user?.text || inputs.text || '';
  const userRefImages = inputs.user?.referenceImages || inputs.referenceImages || [];

  if (!userInput) {
    return { analysis: null, error: '没有输入内容，请在上方输入你的想法' };
  }

  // 附带用户上传的参考图信息
  let enrichedInput = userInput;
  if (userRefImages.length > 0) {
    enrichedInput += `\n\n[用户上传了 ${userRefImages.length} 张参考图，请在分析中考虑这些图片的内容]`;
    console.log(`[LLM分析] 附带 ${userRefImages.length} 张用户参考图`);
  }

  try {
    const result = await llmService.complete(config, systemPrompt, enrichedInput);
    let analysis = result.content;
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch {}

    // 提取搜索指令供知识查询节点使用
    const searchDirectives = {};
    if (typeof analysis === 'object') {
      if (Array.isArray(analysis.searchFolders)) searchDirectives.folders = analysis.searchFolders;
      if (typeof analysis.preferImages === 'boolean') searchDirectives.preferImages = analysis.preferImages;
      if (typeof analysis.searchQuery === 'string') searchDirectives.searchQuery = analysis.searchQuery;
      // LLM 决定的参考图策略
      if (typeof analysis.maxReferenceImages === 'number') searchDirectives.maxReferenceImages = analysis.maxReferenceImages;
      if (typeof analysis.referencePriority === 'string') searchDirectives.referencePriority = analysis.referencePriority;
    }

    return { analysis, searchDirectives, referenceImages: userRefImages.length > 0 ? userRefImages : null };
  } catch (err) {
    console.error('[LLM分析] LLM 调用失败:', err.message, '模型:', config.model, 'provider:', config.provider);
    return { analysis: null, error: `LLM 调用失败: ${err.message}` };
  }
}

// ============ 文案生成节点 ============
async function handleTextGenerate(node, inputs, context) {
  const config = await getNodeLLMConfig(node);
  const textStyle = node.data?.textStyle || 'marketing';
  const exampleText = node.data?.exampleText || '';

  const styleMap = {
    marketing: '营销推广风格：吸引眼球、有号召力、突出卖点',
    social: '社媒风格：轻松活泼、适合微博/小红书/抖音',
    product: '产品介绍风格：专业清晰、突出产品优势和差异化',
    story: '故事叙述风格：引人入胜、有情感共鸣、叙事性强',
  };

  const systemPrompt = `你是一个专业的营销文案撰写师。请根据用户的需求和内容，生成高质量的文案。
要求：${styleMap[textStyle] || '营销推广风格'}`;

  // 构建知识库内容文本（包含 Vision 分析结果 + 区分 style/content 角色）
  let knowledgeText = '';
  if (inputs.knowledge?.length > 0) {
    const knowledgeLines = inputs.knowledge.map(k => {
      if (k.type === 'image') {
        const role = k.referenceRole || 'content';
        const roleNote = role === 'style'
          ? '[风格分析-仅参考设计语言，不作为视觉参考图]'
          : '[内容参考-将作为参考图传给生图节点]';
        const desc = k.visionDescription || k.description || k.title || '';
        return `${roleNote} [图片] ${k.title || '图片'}${desc ? ': ' + desc : ''}`;
      } else if (k.type === 'video') {
        return `[视频] ${k.title || '视频'}${k.description ? ': ' + k.description : ''}`;
      } else if (k.type === 'audio') {
        return `[音频] ${k.title || '音频'}${k.description ? ': ' + k.description : ''}`;
      } else {
        return k.content || k.title || '';
      }
    }).filter(Boolean);

    if (knowledgeLines.length > 0) {
      knowledgeText = `参考知识库内容（必须严格使用以下信息）：\n`;
      if (inputs.styleAnalysis) {
        knowledgeText += `【设计风格分析 — 来自历史设计海报/模板的Vision分析】\n${inputs.styleAnalysis}\n\n`;
      }
      knowledgeText += `${knowledgeLines.join('\n')}\n`;
    }
  }

  const userInput = `请根据以下信息生成文案：
${inputs.analysis ? `分析结果：\n${typeof inputs.analysis === 'object' ? JSON.stringify(inputs.analysis, null, 2) : inputs.analysis}\n` : ''}
${knowledgeText}
${(inputs.text && typeof inputs.text === 'string' && inputs.text.trim()) ? `补充内容：\n${inputs.text}\n` : ''}
${exampleText ? `参考文案风格：\n${exampleText}\n` : ''}`;

  // 判断是否有有效内容：analysis/knowledge/text 至少一个有非空内容
  const hasAnalysis = inputs.analysis && (typeof inputs.analysis !== 'object' || Object.keys(inputs.analysis).length > 0);
  const hasKnowledge = inputs.knowledge?.length > 0;
  const hasText = inputs.text && typeof inputs.text === 'string' && inputs.text.trim().length > 0;
  if (!hasAnalysis && !hasKnowledge && !hasText) {
    return { text: null, copy: null, error: '没有足够的输入内容，请确保上游节点产生了分析结果或文本内容' };
  }

  try {
    const result = await llmService.complete(config, systemPrompt, userInput);

    // 本地存档文案（不阻塞流程）
    saveTextLocal(result.content, {
      source: 'workflow',
      type: textStyle,
      title: (typeof inputs.analysis === 'object' ? JSON.stringify(inputs.analysis).slice(0, 80) : (typeof inputs.analysis === 'string' ? inputs.analysis.slice(0, 80) : '')) || 'workflow_text',
    });

    // 透传参考图 URL（只传 content-role：产品/logo）
    let referenceImages = [];
    if (inputs.images && inputs.images.length > 0) {
      referenceImages = inputs.images
        .filter(img => (img.referenceRole || 'content') === 'content')
        .map(img => img.url || img);
    } else if (Array.isArray(inputs.knowledge)) {
      referenceImages = inputs.knowledge
        .filter(k => k.type === 'image' && (k.referenceRole || 'content') === 'content' && k.url)
        .map(k => k.url);
    }

    return {
      text: result.content,
      copy: result.content,
      referenceImages: referenceImages.length > 0 ? referenceImages : null,
      styleAnalysis: inputs.styleAnalysis || null,
    };
  } catch (err) {
    console.error('[文案生成] LLM 调用失败:', err.message, '模型:', config.model, 'provider:', config.provider);
    return { text: null, copy: null, error: `LLM 调用失败: ${err.message}` };
  }
}

// ============ LLM 生成节点 ============
async function handleLLMGenerate(node, inputs, context) {
  const config = await getNodeLLMConfig(node);
  const outputType = node.data?.outputType || 'prompt';

  // 从知识库提取参考图 URL 并分类（在函数顶部声明，所有分支共用）
  let referenceImages = [];
  let allStyleInfos = [];

  let systemPrompt, userInput;

  // 从知识库/输入中提取参考图（上限8张，由LLM自行判断相关性）
  referenceImages = [];
  allStyleInfos = [];
  const imageSource = inputs.images || [];
  if (Array.isArray(inputs.knowledge)) {
    const kImages = inputs.knowledge.filter(k => k.type === 'image' && k.url);
    for (const ki of kImages) {
      if (!imageSource.find(im => im.url === ki.url || im.id === ki.id)) {
        imageSource.push(ki);
      }
    }
  }

  // 分离 style 和 content 图片
  const styleImages = [];
  const contentCandidates = [];
  for (const img of imageSource) {
    const role = img.referenceRole || 'content';
    if (role === 'style') {
      styleImages.push(img);
    } else {
      contentCandidates.push(img);
    }
  }

  for (const img of styleImages) {
    allStyleInfos.push({
      title: img.title || '',
      description: img.description || img.visionDescription || '',
      folder: img.folder || '',
      note: '风格参考图片（已提取设计特征到文字描述中）',
    });
  }

  // LLM 分析节点决定参考图数量和优先级，代码遵照执行
  referenceImages = pickReferenceImages(contentCandidates, inputs.searchDirectives || {});

  if (referenceImages.length === 0 && inputs.referenceImages && inputs.referenceImages.length > 0) {
    referenceImages = inputs.referenceImages.filter(u => typeof u === 'string' && u.trim()).slice(0, MAX_REFERENCE_IMAGES);
  }

  if (outputType === 'template') {
    const template = node.data?.promptTemplate || '请根据以下信息完成任务：\n{{input}}\n{{knowledge}}';
    userInput = template
      .replace(/\{\{input\}\}/g, inputs.text || context.inputs?.idea || '')
      .replace(/\{\{knowledge\}\}/g, inputs.knowledge ? JSON.stringify(inputs.knowledge) : '')
      .replace(/\{\{prev_output\}\}/g, inputs.prevOutput || '')
      .replace(/\{\{analysis\}\}/g, inputs.analysis ? JSON.stringify(inputs.analysis) : '');
    systemPrompt = '你是一个专业的AI助手，请按照用户的要求完成任务。';

    try {
      const result = await llmService.complete(config, systemPrompt, userInput);

      // 透传参考图 URL（上限8张，LLM自行判断相关性）

      return {
        text: result.content,
        prompt: result.content,
        copy: result.content,
        referenceImages: referenceImages.length > 0 ? referenceImages : null,
        styleAnalysis: inputs.styleAnalysis || null,
      };
    } catch (err) {
      console.error('[LLM生成] 调用失败:', err.message, '模型:', config.model);
      return { text: null, prompt: null, copy: null, referenceImages: null, styleAnalysis: null, error: `LLM 调用失败: ${err.message}` };
    }
  }

  if (outputType === 'prompt') {
    systemPrompt = node.data?.systemPrompt || node.data?.customPrompt || `你是一个专业的AI提示词工程师。根据用户的需求和分析结果，生成高质量的AI绘图提示词。

提示词应该包含：
1. 主体描述（subject）
2. 场景/环境（setting）
3. 风格（style）—— 务必参考提供的设计风格分析
4. 光线/氛围（lighting/mood）
5. 构图/布局（composition）
6. 色彩方案（color scheme）
7. 技术参数（可选）

请用英文输出，格式简洁专业。如果提供了参考图分析，请确保生成的提示词与参考图的品牌风格保持一致。`;

    const analysis = inputs.analysis || {};
    const knowledge = inputs.knowledge || [];
    const styleAnalysis = inputs.styleAnalysis || '';

    // 构建知识库内容文本（优先用 Vision 分析结果）
    const knowledgeLines = [];
    if (styleAnalysis) {
      knowledgeLines.push(`【设计风格分析 — 来自知识库中的设计海报/模板图片的Vision分析】\n${styleAnalysis}`);
    }
    // 添加 style 图片的文字描述（不传URL，但让LLM了解设计语言）
    if (allStyleInfos.length > 0) {
      knowledgeLines.push(`【风格参考图片描述 — 仅用于理解设计语言，不作为生图参考图】\n${allStyleInfos.map(s => `- ${s.title} (${s.folder}): ${s.description?.substring(0, 200) || '已通过Vision分析提取风格特征'}`).join('\n')}`);
    }
    if (knowledge.length > 0) {
      const textItems = knowledge.filter(k => k.type === 'text' && k.content);
      if (textItems.length > 0) {
        knowledgeLines.push(`【产品/公司信息】\n${textItems.map(k => k.content || k.title).join('\n')}`);
      }
    }
    if (referenceImages.length > 0) {
      knowledgeLines.push(`【参考图说明】以下 ${referenceImages.length} 张产品/logo 图片将作为视觉参考传给生图节点，请在prompt中提及需要包含这些元素。`);
    }

    userInput = `请根据以下分析结果，生成AI生图提示词：

${typeof analysis === 'object' ? JSON.stringify(analysis, null, 2) : analysis}
${knowledgeLines.length > 0 ? `\n\n${knowledgeLines.join('\n\n')}` : ''}
${context.inputs?.style ? `\n额外风格要求: ${context.inputs.style}` : ''}`;
  } else if (outputType === 'copy') {
    systemPrompt = node.data?.systemPrompt || node.data?.customPrompt || `你是一个专业的营销文案撰写师。请根据分析结果，生成吸引人的营销文案。`;
    const analysis = inputs.analysis || {};
    const knowledge = inputs.knowledge || [];
    const styleAnalysis = inputs.styleAnalysis || '';
    const knowledgeLines = [];
    if (styleAnalysis) {
      knowledgeLines.push(`【设计风格分析】\n${styleAnalysis}`);
    }
    if (knowledge.length > 0) {
      knowledgeLines.push(knowledge.map(k => k.content || k.title || JSON.stringify(k)).join('\n'));
    }
    userInput = `请根据以下分析结果，生成营销文案：

${typeof analysis === 'object' ? JSON.stringify(analysis, null, 2) : analysis}
${knowledgeLines.length > 0 ? `\n\n参考知识库内容：\n${knowledgeLines.join('\n\n')}` : ''}`;
  } else if (outputType === 'analyze') {
    systemPrompt = node.data?.systemPrompt || node.data?.customPrompt || `你是一个专业的分析助手。请分析用户输入的内容，提取关键信息。`;
    userInput = inputs.text || context.inputs?.idea || JSON.stringify(inputs);
  } else {
    systemPrompt = node.data?.systemPrompt || node.data?.customPrompt || '请完成以下任务：';
    userInput = inputs.text || JSON.stringify(inputs);
  }

  if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
    return { text: null, error: '没有输入内容，请确保上游节点有输出' };
  }

  try {
    const result = await llmService.complete(config, systemPrompt, userInput);

    console.log(`[LLM生成] 参考图分离: content(传URL)=${referenceImages.length}张, style(仅文本)=${allStyleInfos.length}张`);

    return {
      text: (outputType !== 'prompt' && outputType !== 'copy') ? result.content : null,
      prompt: outputType === 'prompt' ? result.content : null,
      copy: outputType === 'copy' ? result.content : null,
      referenceImages: referenceImages.length > 0 ? referenceImages : null,
      styleAnalysis: inputs.styleAnalysis || null,
    };
  } catch (err) {
    console.error('[LLM生成] 调用失败:', err.message, '模型:', config.model);
    return { text: null, prompt: null, copy: null, referenceImages: null, styleAnalysis: null, error: `LLM 调用失败: ${err.message}` };
  }
}

// ============ 知识查询节点 ============
async function handleKnowledgeQuery(node, inputs, context) {
  const category = node.data?.category || null;
  const searchType = node.data?.searchType || 'all';
  const limit = node.data?.limit || 10;

  // 读取 LLM 分析节点的搜索指令
  const searchDirectives = inputs.searchDirectives || {};
  const llmFolders = searchDirectives.folders || null;
  const preferImages = searchDirectives.preferImages || (searchType === 'image');
  const llmSearchQuery = searchDirectives.searchQuery || '';

  // 从多个来源提取搜索关键词
  const userIdea = inputs.user?.idea || context.inputs?.idea || '';
  const rawAnalysis = inputs.analysis || {};

  const queryParts = [];

  // LLM 优化后的搜索关键词优先
  if (llmSearchQuery) {
    queryParts.push(llmSearchQuery);
  }

  // 用户原始输入
  if (userIdea) {
    queryParts.push(userIdea);
  }

  // 分析结果中的各项
  if (typeof rawAnalysis === 'string' && rawAnalysis) {
    queryParts.push(rawAnalysis);
  } else if (typeof rawAnalysis === 'object') {
    const analysisValues = [
      rawAnalysis['核心主题/概念'], rawAnalysis['core_theme'],
      rawAnalysis['主题'], rawAnalysis['title'], rawAnalysis['subject'],
      rawAnalysis['目标受众'], rawAnalysis['target_audience'], rawAnalysis['audience'],
      rawAnalysis['key_elements'], rawAnalysis['关键元素'],
      rawAnalysis['情感基调'], rawAnalysis['emotional_tone'],
      rawAnalysis['潜在应用'], rawAnalysis['potential_applications'],
      rawAnalysis['应用场景'], rawAnalysis['scenarios'],
    ].filter(Boolean);
    queryParts.push(...analysisValues);
  }

  const stringParts = queryParts.filter(q => typeof q === 'string' && q.trim());
  const uniqueQueries = [...new Set(stringParts)];
  const combinedQuery = uniqueQueries.join(' ');

  console.log(`[知识查询] 搜索: "${combinedQuery}", LLM文件夹: ${JSON.stringify(llmFolders || [])}, preferImages: ${preferImages}`);

  if (!combinedQuery || !combinedQuery.trim()) {
    try {
      const allKnowledge = await KnowledgeBase.findAll({ limit: 100 });
      const results = intelligentSearch(allKnowledge, {
        query: '',
        folders: llmFolders,
        type: searchType,
        preferImages,
        limit,
      });
      return buildKnowledgeResult(results);
    } catch {
      return { knowledge: [] };
    }
  }

  try {
    const allKnowledge = await KnowledgeBase.findAll({ limit: 1000 });

    const results = intelligentSearch(allKnowledge, {
      query: combinedQuery,
      category: category,
      folders: llmFolders,
      type: searchType,
      preferImages,
      limit: limit,
      minScore: 0.1,
    });

    console.log(`[知识查询] 找到 ${results.length} 条相关结果`);

    const knowledgeResult = buildKnowledgeResult(results);

    // 如果有图片，先用 Vision LLM 分析图片内容，补充到结果中
    if (knowledgeResult.images && knowledgeResult.images.length > 0) {
      try {
        const imageUrls = knowledgeResult.images.map(img => img.url);
        const visionConfig = await getNodeLLMConfig(node);

        console.log(`[知识查询] 检测到 ${imageUrls.length} 张图片，使用 Vision 综合分析...`);

        // 一次传入所有图片，让 Vision 模型综合分析设计风格和每张图的内容
        const visionResult = await llmService.completeWithImages(
          visionConfig,
          `你是一个资深的设计分析与品牌顾问。请综合分析这些图片，提取以下信息用于后续的AI生图和文案生成：

## 设计风格分析
- 整体设计风格（如：科技感、简约、商务、活力、高端等）
- 色彩方案（主色调、辅助色、对比色）
- 排版布局规律（标题位置、图文比例、留白风格）
- 字体风格倾向（如果有文字）
- 品牌视觉语言特征

## 每张图片的具体内容
- 图片中出现的产品、logo、文字
- 构图方式和视觉重心
- 可复用的设计元素

请用中文详细输出，确保分析结果可以直接指导AI生图提示词的编写。`,
          imageUrls,
          `请综合分析这些设计素材的共同风格特征、品牌调性和设计语言，并逐一描述每张图片的具体内容和可用元素。`,
        );

        if (visionResult.content) {
          // 存储整体风格分析
          knowledgeResult.styleAnalysis = visionResult.content;

          // 将 Vision 分析结果分发到所有匹配的图片
          for (const img of knowledgeResult.images) {
            img.visionDescription = visionResult.content;
          }
          // 同步到 knowledge 数组（供文案生成和 LLM 节点使用）
          for (const k of knowledgeResult.knowledge) {
            if (k.type === 'image') {
              k.content = `[Vision分析] ${visionResult.content}\n\n图片来源: ${k.url}`;
              k.visionDescription = visionResult.content;
            }
          }
          console.log(`[知识查询] Vision 分析完成 (${visionResult.content.length} 字符): ${visionResult.content.substring(0, 120)}...`);
        }
      } catch (visionErr) {
        console.warn(`[知识查询] Vision 分析失败（图片可能需要公网URL，不影响搜索结果）: ${visionErr.message}`);
      }
    }

    return knowledgeResult;
  } catch (err) {
    console.error('[知识查询] 搜索失败:', err.message);
    return { knowledge: [] };
  }
}

/**
 * 构建标准知识库结果
 * 同时返回：文本内容、图片URL、视频URL、音频URL（分类整理）
 */
function buildKnowledgeResult(results) {
  if (!results || results.length === 0) {
    return { knowledge: [] };
  }

  // 根据文件夹语义判断图片的角色：style（仅作文本分析）还是 content（传给生图节点作参考图）
  const STYLE_FOLDERS = ['design', 'template', '设计', '模板', '海报'];
  const CONTENT_FOLDERS = ['product', 'brand', 'logo', '产品', '品牌', 'company', '公司'];

  function getReferenceRole(item) {
    const folder = ((item.folder || item.category || '')).toLowerCase();
    const folderParts = folder.split('/').filter(Boolean);
    // 检查是否匹配风格类文件夹
    for (const part of folderParts) {
      for (const sf of STYLE_FOLDERS) {
        if (part.includes(sf.toLowerCase()) || sf.toLowerCase().includes(part)) {
          return 'style';
        }
      }
    }
    // 检查是否匹配内容类文件夹
    for (const part of folderParts) {
      for (const cf of CONTENT_FOLDERS) {
        if (part.includes(cf.toLowerCase()) || cf.toLowerCase().includes(part)) {
          return 'content';
        }
      }
    }
    // 默认为 content（安全策略：不传未知来源的图；改为传，但后续节点可过滤）
    return 'content';
  }

  // 分类整理
  const textItems = [];
  const imageUrls = [];
  const videoUrls = [];
  const audioUrls = [];

  for (const item of results) {
    // 文本内容
    const textContent = getTextContent(item);
    if (textContent && !isMultimedia(item)) {
      textItems.push({
        id: item.id,
        title: item.title,
        content: item.content,
        category: item.category,
        folder: item.folder || item.category || '',
        relevanceScore: item._relevanceScore,
      });
    }

    // 图片（标记 referenceRole）
    const imgUrl = getImageUrl(item);
    if (imgUrl) {
      imageUrls.push({
        id: item.id,
        title: item.title,
        url: imgUrl,
        category: item.category,
        folder: item.folder || item.category || '',
        description: item.metadata?.description || item.metadata?.alt || '',
        relevanceScore: item._relevanceScore,
        referenceRole: getReferenceRole(item),
        originalName: item.originalName || item.title || '',
      });
    }

    // 视频
    const vidUrl = getVideoUrl(item);
    if (vidUrl) {
      videoUrls.push({
        id: item.id,
        title: item.title,
        url: vidUrl,
        category: item.category,
        folder: item.folder || item.category || '',
        description: item.metadata?.description || '',
        relevanceScore: item._relevanceScore,
      });
    }

    // 音频
    const audUrl = getAudioUrl(item);
    if (audUrl) {
      audioUrls.push({
        id: item.id,
        title: item.title,
        url: audUrl,
        category: item.category,
        folder: item.folder || item.category || '',
        description: item.metadata?.description || '',
        relevanceScore: item._relevanceScore,
      });
    }
  }

  // 合并所有内容到一个数组（供文案生成使用）
  const allContents = [];

  // 文本内容
  for (const item of textItems) {
    allContents.push({
      id: item.id,
      type: 'text',
      title: item.title,
      content: item.content,
      category: item.category,
      relevanceScore: item.relevanceScore,
    });
  }

  // 图片（添加描述性文本 + referenceRole）
  for (const img of imageUrls) {
    const roleTag = img.referenceRole === 'style' ? '[风格参考-仅文本分析]' : '[内容参考-可作参考图]';
    const imgText = `${roleTag}[图片]${img.title}${img.description ? ': ' + img.description : ''}`;
    allContents.push({
      id: img.id,
      type: 'image',
      title: img.title,
      url: img.url,
      description: img.description,
      text: imgText,
      category: img.category,
      folder: img.folder,
      referenceRole: img.referenceRole,
      relevanceScore: img.relevanceScore,
    });
  }

  // 视频
  for (const vid of videoUrls) {
    const vidText = `[视频]${vid.title}${vid.description ? ': ' + vid.description : ''}`;
    allContents.push({
      id: vid.id,
      type: 'video',
      title: vid.title,
      url: vid.url,
      description: vid.description,
      text: vidText,
      category: vid.category,
      relevanceScore: vid.relevanceScore,
    });
  }

  // 音频
  for (const aud of audioUrls) {
    const audText = `[音频]${aud.title}${aud.description ? ': ' + aud.description : ''}`;
    allContents.push({
      id: aud.id,
      type: 'audio',
      title: aud.title,
      url: aud.url,
      description: aud.description,
      text: audText,
      category: aud.category,
      relevanceScore: aud.relevanceScore,
    });
  }

  return {
    knowledge: allContents,
    images: imageUrls,
    videos: videoUrls,
    audios: audioUrls,
  };
}

// ============ 图片生成节点 ============
async function handleImageGenerate(node, inputs, context) {
  const userPrompt = inputs.prompt || inputs.text || '';

  // 从多个来源智能提取参考图 URL
  // 关键：只取 content-role 图片（产品/logo），排除 style-role（设计海报/模板）
  let referenceImageUrls = [];

  // 1. 优先使用 LLM 节点透传的 referenceImages（LLM 已按 referenceRole 筛选）
  if (inputs.referenceImages && inputs.referenceImages.length > 0) {
    referenceImageUrls = inputs.referenceImages.filter(u => typeof u === 'string' && u.trim());
    console.log(`[图片生成] 从 LLM 透传获取 ${referenceImageUrls.length} 张参考图（已筛选：仅产品/logo）`);
  }

  // 2. 其次从知识库 images 数组获取（过滤掉 style-role）
  if (referenceImageUrls.length === 0 && inputs.images && inputs.images.length > 0) {
    const contentImages = inputs.images.filter(img => (img.referenceRole || 'content') === 'content');
    const styleImages = inputs.images.filter(img => img.referenceRole === 'style');
    referenceImageUrls = contentImages.map(img => img.url || img).filter(u => typeof u === 'string' && u.trim());
    console.log(`[图片生成] 从知识库 images 获取: ${referenceImageUrls.length} content + ${styleImages.length} style(已过滤)`);
  }

  // 3. 最后从 knowledge 扁平数组提取（过滤掉 style-role）
  if (referenceImageUrls.length === 0 && Array.isArray(inputs.knowledge)) {
    referenceImageUrls = inputs.knowledge
      .filter(k => k.type === 'image' && (k.referenceRole || 'content') === 'content' && k.url)
      .map(k => k.url);
    const skipped = inputs.knowledge.filter(k => k.type === 'image' && k.referenceRole === 'style').length;
    console.log(`[图片生成] 从 knowledge 提取: ${referenceImageUrls.length} content + ${skipped} style(已过滤)`);
  }

  // 限制参考图数量（最多 8 张，由 LLM 决定哪些有用）
  referenceImageUrls = referenceImageUrls.slice(0, MAX_REFERENCE_IMAGES);

  // 将本地图片 URL 上传到公网图床
  const publicRefs = [];
  if (referenceImageUrls.length > 0) {
    console.log(`[图片生成] 开始处理 ${referenceImageUrls.length} 张参考图 URL...`);
    for (const url of referenceImageUrls) {
      try {
        const publicUrl = await ensurePublicImageUrl(url);
        if (publicUrl) {
          publicRefs.push(publicUrl);
          console.log(`[图片生成] 参考图公网化成功: ${url.substring(0, 50)}... → ${publicUrl.substring(0, 50)}...`);
        }
      } catch (e) {
        console.warn(`[图片生成] 参考图上传失败，跳过: ${url.substring(0, 80)}`, e.message);
      }
    }
    console.log(`[图片生成] 公网化完成: ${publicRefs.length}/${referenceImageUrls.length} 张`);
  }

  // 构建 prompt（融合风格分析）
  let prompt = userPrompt;
  const extraParts = [];
  if (inputs.styleAnalysis) {
    extraParts.push(`设计风格参考：\n${inputs.styleAnalysis}`);
  }
  if (publicRefs.length > 0) {
    extraParts.push(`参考图已作为视觉参考提供（共${publicRefs.length}张）`);
  }
  if (extraParts.length > 0) {
    prompt = `${extraParts.join('\n\n')}\n\n生成要求：${userPrompt}`;
  }

  if (!prompt) return { imageUrl: null, error: 'No prompt provided' };

  const model = node.data?.model || 'gpt-image-2';
  const aspectRatio = node.data?.aspectRatio || '1:1';
  const resolution = node.data?.resolution || '1K';
  const isNanoBanana = model.startsWith('nano-banana');
  const isGptImage2Vip = model === 'gpt-image-2-vip';

  const requestBody = {
    prompt,
    aspectRatio,
    model,
    replyType: 'json',
    images: publicRefs.length > 0 ? publicRefs : undefined,
  };

  if (isNanoBanana) requestBody.imageSize = resolution;

  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (data.success) {
      // generateController 已自动保存到本地并返回本地 URL
      return { imageUrl: data.data?.imageUrl, model, resolution };
    } else {
      return { imageUrl: null, error: data.message };
    }
  } catch (err) {
    return { imageUrl: null, error: err.message };
  }
}

// ============ 视频生成节点 ============
async function handleVideoGenerate(node, inputs, context) {
  const userPrompt = inputs.prompt || inputs.text || '';

  // 提取参考图 URL（只取 content-role：产品/logo，排除 style-role：设计海报）
  // 优先级：1. 用户指定的参考图 2. 知识库图片 3. 上游图片生成节点的输出
  let referenceImageUrls = [];
  if (inputs.referenceImages && inputs.referenceImages.length > 0) {
    referenceImageUrls = inputs.referenceImages.filter(u => typeof u === 'string' && u.trim());
  } else if (inputs.images && inputs.images.length > 0) {
    referenceImageUrls = inputs.images
      .filter(img => (img.referenceRole || 'content') === 'content')
      .map(img => img.url || img)
      .filter(u => typeof u === 'string' && u.trim());
  } else if (Array.isArray(inputs.knowledge)) {
    referenceImageUrls = inputs.knowledge
      .filter(k => k.type === 'image' && (k.referenceRole || 'content') === 'content' && k.url)
      .map(k => k.url);
  }
  // 【关键修复】支持接收图片生成节点的输出作为首帧
  // 如果上游有 imageGenerate 节点，它的输出会传到 inputs.imageUrl
  if (referenceImageUrls.length === 0 && inputs.imageUrl && typeof inputs.imageUrl === 'string' && inputs.imageUrl.trim()) {
    referenceImageUrls = [inputs.imageUrl.trim()];
    console.log(`[视频生成] 接收上游图片生成节点的输出作为首帧: ${inputs.imageUrl.substring(0, 80)}...`);
  }
  referenceImageUrls = referenceImageUrls.slice(0, MAX_REFERENCE_IMAGES);

  // 【关键修复】首帧图片：优先使用图片生成节点的输出
  let firstFrameImage = null;
  if (inputs.imageUrl && typeof inputs.imageUrl === 'string' && inputs.imageUrl.trim()) {
    firstFrameImage = inputs.imageUrl.trim();
  } else if (referenceImageUrls.length > 0) {
    firstFrameImage = referenceImageUrls[0];
  }

  // 公网化参考图
  const publicRefs = [];
  for (const url of referenceImageUrls) {
    try {
      const publicUrl = await ensurePublicImageUrl(url);
      if (publicUrl) publicRefs.push(publicUrl);
    } catch (e) {
      console.warn(`[视频生成] 参考图上传失败: ${url.substring(0, 80)}`, e.message);
    }
  }

  // 公网化首帧图片
  let publicFirstFrame = null;
  if (firstFrameImage) {
    try {
      publicFirstFrame = await ensurePublicImageUrl(firstFrameImage);
      console.log(`[视频生成] 首帧图片公网化: ${firstFrameImage.substring(0, 80)}... → ${publicFirstFrame}`);
    } catch (e) {
      console.warn(`[视频生成] 首帧图片上传失败: ${firstFrameImage.substring(0, 80)}`, e.message);
    }
  }

  // 构建 prompt（融合风格分析）
  let prompt = userPrompt;
  const extraParts = [];
  if (inputs.styleAnalysis) {
    extraParts.push(`设计风格参考：\n${inputs.styleAnalysis}`);
  }
  if (publicRefs.length > 0) {
    extraParts.push(`参考图已提供（共${publicRefs.length}张），可作为首帧或风格参考`);
  }
  if (extraParts.length > 0) {
    prompt = `${extraParts.join('\n\n')}\n\n生成要求：${userPrompt}`;
  }

  if (!prompt) return { videoUrl: null, error: 'No prompt provided' };

  // 模型名映射（短名 → Seedance API 实际 ID）
  const SEEDANCE_MODEL_MAP = {
    'seedance2.0': 'doubao-seedance-2-0-260128',
    'seedance2.0-fast': 'doubao-seedance-2-0-fast-260128',
    'seedance1.5-pro': 'doubao-seedance-1-5-pro-251215',
    'seedance1.0-pro': 'doubao-seedance-1-0-pro-250123',
  };
  const rawModel = node.data?.model || 'seedance2.0';
  const model = SEEDANCE_MODEL_MAP[rawModel] || rawModel;
  const ratio = node.data?.ratio || '16:9';
  const duration = node.data?.duration || 5;

  // 自动判断生成模式：有首帧图片 → 图生视频，否则 → 纯文本
  const hasFirstFrame = !!publicFirstFrame;
  const hasRefs = publicRefs.length > 0;
  const mode = hasFirstFrame ? 'image_to_video_first' : (hasRefs ? 'multimodal_reference' : 'text_to_video');

  console.log(`[视频生成] model=${model}, mode=${mode}, hasFirstFrame=${hasFirstFrame}, refs=${publicRefs.length}, ratio=${ratio}, duration=${duration}s`);

  try {
    const apiBase = getApiBase();
    const body = {
      prompt,
      model,
      mode,
      ratio,
      duration,
    };
    // 有首帧图片时传入
    if (hasFirstFrame) {
      body.firstFrameImage = publicFirstFrame;
    }
    // 有参考图时传入
    if (hasRefs) {
      body.referenceImages = publicRefs;
    }

    const response = await fetch(`${apiBase}/api/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (data.success) {
      return { videoUrl: data.data?.videoUrl || null, taskId: data.data?.taskId, status: data.data?.status };
    } else {
      return { videoUrl: null, error: data.message };
    }
  } catch (err) {
    return { videoUrl: null, error: err.message };
  }
}

// ============ 音乐生成节点 ============
async function handleMusicGenerate(node, inputs, context) {
  const userPrompt = inputs.prompt || inputs.text || '';

  // 构建 prompt（融合风格分析和知识库信息）
  let prompt = userPrompt;
  const extraParts = [];
  if (inputs.styleAnalysis) {
    extraParts.push(`风格参考（来自知识库分析）：\n${inputs.styleAnalysis}`);
  }
  // 从知识库提取文本信息（产品信息、品牌调性等）
  if (Array.isArray(inputs.knowledge)) {
    const textItems = inputs.knowledge
      .filter(k => k.type === 'text' && k.content)
      .map(k => k.content)
      .slice(0, 5);
    if (textItems.length > 0) {
      extraParts.push(`品牌/产品信息：\n${textItems.join('\n')}`);
    }
  }
  if (extraParts.length > 0) {
    prompt = `${extraParts.join('\n\n')}\n\n音乐创作要求：${userPrompt}`;
  }

  if (!prompt) return { audioUrl: null, error: 'No prompt provided' };

  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/music/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        title: context.inputs?.title || 'AI Generated Music',
      }),
    });

    const data = await response.json();
    if (data.success) {
      return { audioUrl: data.data?.audioUrl, taskId: data.data?.taskId };
    } else {
      return { audioUrl: null, error: data.message };
    }
  } catch (err) {
    return { audioUrl: null, error: err.message };
  }
}

// ============ 输出节点 ============
async function handleOutput(node, inputs, context) {
  return {
    text: typeof inputs.text === 'string' ? inputs.text : null,
    prompt: typeof inputs.prompt === 'string' ? inputs.prompt : null,
    copy: typeof inputs.copy === 'string' ? inputs.copy : null,
    imageUrl: typeof inputs.imageUrl === 'string' ? inputs.imageUrl : null,
    videoUrl: typeof inputs.videoUrl === 'string' ? inputs.videoUrl : null,
    audioUrl: typeof inputs.audioUrl === 'string' ? inputs.audioUrl : null,
    analysis: typeof inputs.analysis === 'string' ? inputs.analysis : (inputs.analysis ? JSON.stringify(inputs.analysis, null, 2) : null),
    referenceImages: Array.isArray(inputs.referenceImages) ? inputs.referenceImages.filter(u => typeof u === 'string') : null,
    styleAnalysis: typeof inputs.styleAnalysis === 'string' ? inputs.styleAnalysis : null,
  };
}

module.exports = { WorkflowExecutor };
