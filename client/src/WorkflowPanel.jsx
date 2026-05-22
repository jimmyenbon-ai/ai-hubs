import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import LLMConfigPanel from './LLMConfigPanel';
import KnowledgePanel from './KnowledgePanel';
import WorkflowHistoryPanel from './WorkflowHistoryPanel';
import WorkflowListPanel from './WorkflowListPanel';

const NODE_TYPES_CONFIG = {
  llmAnalyze: { label: 'LLM 分析', color: '#6366f1', icon: '🧠' },
  llmGenerate: { label: 'LLM 生成', color: '#8b5cf6', icon: '✍️' },
  textGenerate: { label: '文案生成', color: '#f97316', icon: '📝' },
  knowledgeQuery: { label: '知识查询', color: '#06b6d4', icon: '📚' },
  imageGenerate: { label: '图片生成', color: '#f59e0b', icon: '🖼️' },
  videoGenerate: { label: '视频生成', color: '#ef4444', icon: '🎬' },
  musicGenerate: { label: '音乐生成', color: '#10b981', icon: '🎵' },
  condition: { label: '条件分支', color: '#f97316', icon: '🔀' },
  loop: { label: '循环迭代', color: '#ec4899', icon: '🔄' },
  output: { label: '输出', color: '#64748b', icon: '📤' },
};

// ============ 基础节点组件 ============
function WorkflowNode({ data, type, selected, dragging }) {
  const config = NODE_TYPES_CONFIG[type] || { label: type, color: '#64748b', icon: '❓' };
  return (
    <div style={{
      background: config.color,
      borderRadius: 8,
      padding: '10px 14px',
      minWidth: 140,
      boxShadow: selected
        ? `0 0 0 2px #fff, 0 0 0 4px ${config.color}, 0 4px 16px rgba(0,0,0,0.4)`
        : '0 2px 8px rgba(0,0,0,0.3)',
      color: '#fff',
      fontSize: 13,
      fontWeight: 500,
      transition: 'box-shadow 0.15s',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#fff', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>{config.icon}</span>
        <span>{data.label || config.label}</span>
      </div>
      {data.model && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>{data.model}</div>}
      <Handle type="source" position={Position.Right} style={{ background: '#fff', width: 8, height: 8 }} />
    </div>
  );
}

// ============ 条件分支节点 ============
function ConditionNode({ data, selected }) {
  return (
    <div style={{
      background: '#f97316',
      borderRadius: 8,
      padding: '10px 14px',
      minWidth: 140,
      boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 4px #f97316, 0 4px 16px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.3)',
      color: '#fff',
      fontSize: 13,
      fontWeight: 500,
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#fff', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>🔀</span>
        <span>{data.label || '条件分支'}</span>
      </div>
      {data.condition && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>{data.condition}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10 }}>
        <span style={{ background: '#22c55e', padding: '2px 6px', borderRadius: 4 }}>是</span>
        <span style={{ background: '#ef4444', padding: '2px 6px', borderRadius: 4 }}>否</span>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ background: '#22c55e', width: 8, height: 8, top: '70%' }} />
      <Handle type="source" position={Position.Right} id="false" style={{ background: '#ef4444', width: 8, height: 8, top: '85%' }} />
    </div>
  );
}

// ============ 循环节点 ============
function LoopNode({ data, selected }) {
  return (
    <div style={{
      background: '#ec4899',
      borderRadius: 8,
      padding: '10px 14px',
      minWidth: 140,
      boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 4px #ec4899, 0 4px 16px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.3)',
      color: '#fff',
      fontSize: 13,
      fontWeight: 500,
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#fff', width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>🔄</span>
        <span>{data.label || '循环迭代'}</span>
      </div>
      {data.maxIterations && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>最多 {data.maxIterations} 次</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10 }}>
        <span style={{ background: '#fff', color: '#ec4899', padding: '2px 6px', borderRadius: 4 }}>循环体</span>
        <span style={{ background: '#22c55e', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>结束</span>
      </div>
      <Handle type="source" position={Position.Right} id="loop" style={{ background: '#fff', width: 8, height: 8, top: '70%' }} />
      <Handle type="source" position={Position.Right} id="done" style={{ background: '#22c55e', width: 8, height: 8, top: '85%' }} />
    </div>
  );
}

const nodeTypes = {
  llmAnalyze: WorkflowNode,
  llmGenerate: WorkflowNode,
  textGenerate: WorkflowNode,
  knowledgeQuery: WorkflowNode,
  imageGenerate: WorkflowNode,
  videoGenerate: WorkflowNode,
  musicGenerate: WorkflowNode,
  condition: ConditionNode,
  loop: LoopNode,
  output: WorkflowNode,
};

// ============ 节点类型按钮（带悬停预览）===========
const NODE_TYPE_HELP = {
  llmAnalyze: { inputs: '文本输入', outputs: '分析结果 (JSON)', desc: '使用 LLM 分析用户输入，提取结构化信息' },
  llmGenerate: { inputs: '文本/分析结果/知识库', outputs: '提示词/文案 + 参考图URL', desc: '生成提示词或营销文案，智能透传参考图给生图节点' },
  textGenerate: { inputs: '文本/分析结果/知识库', outputs: '营销文案 + 参考图URL', desc: '专注生成吸引人的营销推广文案，透传参考图' },
  knowledgeQuery: { inputs: '查询文本', outputs: '知识条目列表 + 图片Vision风格分析', desc: '从知识库检索内容，自动分析设计图片的风格/色彩/布局' },
  imageGenerate: { inputs: '提示词 + 参考图URL', outputs: '图片 URL', desc: '调用 AI 生图，自动上传知识库图片为公网参考图' },
  videoGenerate: { inputs: '提示词', outputs: '视频 URL', desc: '调用 AI 视频生成模型制作视频' },
  musicGenerate: { inputs: '提示词', outputs: '音频 URL', desc: '调用 AI 音乐生成模型创作音乐' },
  condition: { inputs: '任意输入', outputs: '是/否分支', desc: '根据 LLM 判断条件，走不同的执行分支' },
  loop: { inputs: '列表/文本', outputs: '循环体结果', desc: '重复执行循环体指定次数' },
  output: { inputs: '任意数据', outputs: '透传', desc: '汇总所有上游节点的输出作为最终结果（含参考图）' },
};

function NodeTypeButton({ type, config, onAdd }) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => onAdd(type)}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', marginBottom: 6,
          width: '100%', background: config.color + '22', borderRadius: 8, cursor: 'pointer',
          fontSize: 12, transition: 'all 0.15s', border: '1px solid ' + config.color + '44',
          color: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 15 }}>{config.icon}</span>
        <span>{config.label}</span>
      </button>

      {showTip && (
        <div style={{
          position: 'absolute', left: '100%', top: 0, marginLeft: 8, zIndex: 200,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: 8, padding: '10px 12px', width: 220,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)', pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: config.color }}>{config.icon} {config.label}</div>
          {NODE_TYPE_HELP[type]?.desc && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.4 }}>{NODE_TYPE_HELP[type].desc}</div>
          )}
          <div style={{ fontSize: 11 }}>
            <div style={{ color: 'var(--text-secondary)' }}>📥 输入：<span style={{ color: 'var(--text-primary)' }}>{NODE_TYPE_HELP[type]?.inputs}</span></div>
            <div style={{ color: 'var(--text-secondary)' }}>📤 输出：<span style={{ color: 'var(--text-primary)' }}>{NODE_TYPE_HELP[type]?.outputs}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 撤销/重做历史记录器 ============
class HistoryManager {
  constructor(maxSize = 50) {
    this.past = [];
    this.future = [];
    this.maxSize = maxSize;
  }
  push(nodes, edges) {
    this.past.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    if (this.past.length > this.maxSize) this.past.shift();
    this.future = [];
  }
  undo(nodes, edges) {
    if (this.past.length === 0) return null;
    this.future.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    return this.past.pop();
  }
  redo(nodes, edges) {
    if (this.future.length === 0) return null;
    this.past.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    return this.future.pop();
  }
  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
  getUndoCount() { return this.past.length; }
  getRedoCount() { return this.future.length; }
}

// ============ 结果展示组件 ============
function ResultBlock({ label, content }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
        <button onClick={handleCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: copied ? '#10b981' : 'var(--text-secondary)' }}>
          {copied ? '✅ 已复制' : '📋 复制'}
        </button>
      </div>
      <div style={{ background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  );
}

function ResultMedia({ label, type, url }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      {type === 'image' && (
        <img src={url} alt="Generated" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, cursor: 'pointer' }}
          onClick={() => window.open(url, '_blank')} />
      )}
      {type === 'video' && (
        <video src={url} controls style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, background: '#000', display: 'block' }} />
      )}
      {type === 'audio' && (
        <audio src={url} controls style={{ width: '100%' }} />
      )}
    </div>
  );
}

// ============ 主面板 ============
export default function WorkflowPanel({ onBack }) {
  const [view, setView] = useState('editor');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [userIdea, setUserIdea] = useState('');
  const [refImages, setRefImages] = useState([]); // 用户上传的参考图
  const [refUploading, setRefUploading] = useState(false);
  const refFileInput = useRef(null);
  const [nodePanelCollapsed, setNodePanelCollapsed] = useState(false);
  const [cycleError, setCycleError] = useState('');
  const [runningSteps, setRunningSteps] = useState([]);

  const historyRef = useRef(new HistoryManager());
  const clipboardRef = useRef(null);
  const importInputRef = useRef(null);
  const wsRef = useRef(null);
  const wsConnectedRef = useRef(false);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);

  // ========== WebSocket 实时进度 ==========
  const currentRunIdRef = useRef(null);
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimer = null;

    function connect() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => { wsConnectedRef.current = true; };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'workflow_step' && msg.runId === currentRunIdRef.current) {
              setRunningSteps(prev => {
                const existing = prev.findIndex(s => s.nodeId === msg.nodeId);
                const stepEntry = {
                  nodeId: msg.nodeId,
                  label: msg.nodeName,
                  status: msg.status === 'completed' ? 'done' : msg.status === 'failed' ? 'error' : 'running',
                  duration: msg.duration,
                };
                if (existing >= 0) {
                  const next = [...prev];
                  next[existing] = stepEntry;
                  return next;
                }
                return [...prev, stepEntry];
              });
            }
          } catch (_) {}
        };
        ws.onclose = () => {
          wsConnectedRef.current = false;
          reconnectTimer = setTimeout(connect, 5000);
        };
        ws.onerror = () => { ws.close(); };
      } catch (_) {}
    }

    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ========== 保存历史快照 ==========
  const saveHistory = useCallback(() => {
    historyRef.current.push(nodes, edges);
  }, [nodes, edges]);

  // ========== 节点变化处理 ==========
  const onNodesChange = useCallback(
    (changes) => {
      onNodesChangeBase(changes);
      const hasLayoutChange = changes.some(c => c.type === 'position' || c.type === 'remove' || c.type === 'add');
      if (hasLayoutChange) saveHistory();
    },
    [onNodesChangeBase, saveHistory]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeBase(changes);
      if (changes.some(c => c.type === 'remove' || c.type === 'add')) saveHistory();
    },
    [onEdgesChangeBase, saveHistory]
  );

  // ========== 撤销/重做 ==========
  const handleUndo = useCallback(() => {
    const prev = historyRef.current.undo(nodes, edges);
    if (prev) { setNodes(prev.nodes); setEdges(prev.edges); }
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo(nodes, edges);
    if (next) { setNodes(next.nodes); setEdges(next.edges); }
  }, [nodes, edges, setNodes, setEdges]);

  // ========== 连接边（带环检测）==========
  const onConnect = useCallback(
    (params) => {
      const newEdge = {
        ...params,
        animated: true,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
      };
      setEdges((eds) => {
        const afterAdd = addEdge(newEdge, eds);
        // 环检测：DFS 从 target 能否回到 source
        const visited = new Set();
        const stack = [params.target];
        while (stack.length > 0) {
          const cur = stack.pop();
          if (cur === params.source) {
            setCycleError('检测到循环依赖！已拒绝该连接。');
            setTimeout(() => setCycleError(''), 3000);
            return eds;
          }
          if (!visited.has(cur)) {
            visited.add(cur);
            afterAdd.filter(e => e.source === cur).forEach(e => stack.push(e.target));
          }
        }
        saveHistory();
        return afterAdd;
      });
    },
    [setEdges, saveHistory]
  );

  // ========== 节点点击 ==========
  const handleNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setCycleError('');
  }, []);

  // ========== 加载模板 ==========
  const loadTemplate = useCallback((template) => {
    const loadedNodes = (template.nodes || []).map((n, idx) => ({
      id: n.id || String(idx + 1),
      type: n.type,
      position: n.position || { x: 100 + idx * 250, y: 200 },
      data: n.data || { label: NODE_TYPES_CONFIG[n.type]?.label || n.type },
    }));
    const loadedEdges = (template.edges || []).map((e, idx) => ({
      id: e.id || `e${idx}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    }));
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSelectedTemplate(template);
    setSelectedNode(null);
    setRunResult(null);
    setCycleError('');
    historyRef.current = new HistoryManager();
    setView('editor');
  }, [setNodes, setEdges]);

  // ========== 更新节点数据 ==========
  const updateNodeData = useCallback((nodeId, newData) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n));
    setSelectedNode((s) => s && s.id === nodeId ? { ...s, data: { ...s.data, ...newData } } : s);
  }, [setNodes]);

  // ========== 添加节点 ==========
  const addNode = useCallback((type) => {
    const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const config = NODE_TYPES_CONFIG[type];
    const nodeCount = nodes.length;
    const newNode = {
      id,
      type,
      position: { x: 100 + (nodeCount % 4) * 250, y: 100 + Math.floor(nodeCount / 4) * 150 },
      data: { label: config?.label || type },
    };
    saveHistory();
    setNodes((nds) => [...nds, newNode]);
  }, [nodes, saveHistory, setNodes]);

  // ========== 删除节点 ==========
  const deleteNode = useCallback((nodeId) => {
    saveHistory();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, [saveHistory, setNodes, setEdges]);

  // ========== 复制节点 ==========
  const copyNode = useCallback((node) => {
    const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newNode = {
      ...node,
      id,
      position: { x: node.position.x + 30, y: node.position.y + 30 },
      data: { ...node.data },
      selected: false,
    };
    saveHistory();
    setNodes((nds) => [...nds, newNode]);
  }, [saveHistory, setNodes]);

  // ========== 键盘快捷键 ==========
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 当焦点在输入框中时，不拦截 Ctrl+C/V（允许正常文本复制粘贴）
      const tag = (e.target.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if (isInput) return;

      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key === 'c') {
        const selected = nodes.filter(n => n.selected);
        if (selected.length > 0) {
          clipboardRef.current = selected.map(n => ({ type: n.type, position: n.position, data: { ...n.data } }));
          e.preventDefault();
        }
      }

      if (ctrlKey && e.key === 'v') {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          saveHistory();
          const newNodes = clipboardRef.current.map((n, i) => ({
            id: `node_${Date.now()}_${i}`, type: n.type,
            position: { x: n.position.x + 30, y: n.position.y + 30 },
            data: { ...n.data }, selected: false,
          }));
          setNodes((nds) => [...nds, ...newNodes]);
          e.preventDefault();
        }
      }

      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        handleUndo();
        e.preventDefault();
      }

      if (ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        handleRedo();
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, handleUndo, handleRedo, saveHistory, setNodes]);

  // ========== 自动排列 ==========
  const autoArrange = useCallback(() => {
    if (nodes.length === 0) return;
    saveHistory();

    const adjList = {};
    const inDegree = {};
    nodes.forEach(n => { adjList[n.id] = []; inDegree[n.id] = 0; });
    edges.forEach(e => {
      if (adjList[e.source]) adjList[e.source].push(e.target);
      if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    });

    const layers = [];
    const visited = new Set();
    let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);

    while (queue.length > 0) {
      const layer = [];
      const nextQueue = [];
      for (const id of queue) {
        if (visited.has(id)) continue;
        visited.add(id);
        layer.push(id);
      }
      layers.push(layer);
      for (const id of layer) {
        for (const target of adjList[id]) {
          if (!visited.has(target)) {
            inDegree[target]--;
            if (inDegree[target] <= 0) nextQueue.push(target);
          }
        }
      }
      queue = nextQueue;
    }

    const remaining = nodes.filter(n => !visited.has(n.id));
    if (remaining.length > 0) layers.push(remaining.map(n => n.id));

    const newPositions = {};
    layers.forEach((layer, li) => {
      layer.forEach((id, ni) => {
        newPositions[id] = { x: 80 + ni * 260, y: 80 + li * 130 };
      });
    });

    setNodes((nds) => nds.map(n => ({
      ...n, position: newPositions[n.id] || n.position,
    })));
  }, [nodes, edges, saveHistory, setNodes]);

  // ========== 导出 ==========
  const handleExport = useCallback(() => {
    if (nodes.length === 0) { alert('当前画布为空，请先添加节点'); return; }
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      name: selectedTemplate?.name || '导出工作流',
      description: selectedTemplate?.description || '',
      nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTemplate?.name || 'workflow'}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, selectedTemplate]);

  // ========== 导入 ==========
  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.nodes || !Array.isArray(data.nodes)) {
          alert('无效的工作流文件'); return;
        }
        const loadedNodes = data.nodes.map((n, idx) => ({
          id: n.id || `node_${Date.now()}_${idx}`,
          type: n.type,
          position: n.position || { x: 100 + idx * 250, y: 200 },
          data: n.data || {},
        }));
        const loadedEdges = (data.edges || []).map((ed, idx) => ({
          id: ed.id || `e${idx}`, source: ed.source, target: ed.target,
          sourceHandle: ed.sourceHandle, animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
        }));
        saveHistory();
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setSelectedTemplate({ name: data.name, description: data.description });
        setSelectedNode(null);
        setRunResult(null);
        alert(`成功导入 ${loadedNodes.length} 个节点！`);
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [saveHistory, setNodes, setEdges]);

  // ========== 保存 ==========
  const handleSave = useCallback(async () => {
    const name = prompt('请输入工作流名称：', selectedTemplate?.name || '新工作流');
    if (!name) return;
    const description = prompt('请输入描述（可选）：', selectedTemplate?.description || '');
    try {
      const body = {
        name,
        description: description || '',
        category: selectedTemplate?.category || 'general',
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
        variables: [{ name: 'idea', label: '想法', type: 'text', required: true }],
      };
      const url = selectedTemplate?.id ? `/api/workflow/templates/${selectedTemplate.id}` : '/api/workflow/templates';
      const method = selectedTemplate?.id ? 'PUT' : 'POST';
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (data.success) {
        setSelectedTemplate(data.data);
        alert('保存成功！');
      } else {
        alert('保存失败: ' + data.message);
      }
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  }, [selectedTemplate, nodes, edges]);

  // ========== 参考图上传 ==========
  const handleRefUpload = useCallback(async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setRefUploading(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('images', f));
      const resp = await fetch('/api/knowledge/temp-upload', { method: 'POST', body: fd });
      const data = await resp.json();
      if (data.success) {
        setRefImages(prev => [...prev, ...data.data]);
      }
    } catch (err) {
      console.error('参考图上传失败:', err);
    } finally {
      setRefUploading(false);
      e.target.value = '';
    }
  }, []);

  const removeRefImage = useCallback((index) => {
    setRefImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ========== 执行 ==========
  const handleRun = useCallback(async () => {
    if (nodes.length === 0) { alert('请先添加节点'); return; }
    if (!userIdea.trim()) { alert('请在上方输入你的想法'); return; }

    setRunning(true);
    setRunResult(null);
    setRunningSteps([]);
    currentRunIdRef.current = null; // 重置

    try {
      const saveResp = await fetch('/api/workflow/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedTemplate?.name || '临时工作流',
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target })),
          variables: [
            { name: 'idea', label: '想法', type: 'text', required: true },
            { name: 'context', label: '上下文', type: 'text' },
            { name: 'result', label: '结果', type: 'text' },
          ],
        }),
      });
      const saveData = await saveResp.json();
      if (!saveData.success) throw new Error(saveData.message);

      // 记录当前 runId，WS 推送会过滤只显示本次的
      currentRunIdRef.current = saveData.data.id;

      const runResp = await fetch('/api/workflow/run/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: saveData.data.id, inputs: { idea: userIdea, context: '', result: '', referenceImages: refImages.map(r => r.url) } }),
      });
      const runData = await runResp.json();
      // 后端返回结构: { success: true/false, data: { success, runId, outputs, steps, error } }
      const execResult = runData.success
        ? {
            success: runData.data?.success ?? true,
            runId: runData.data?.runId,
            outputs: runData.data?.outputs || {},
            steps: runData.data?.steps || [],
            error: runData.data?.error || null,
          }
        : {
            success: false,
            runId: runData.data?.runId,
            outputs: {},
            steps: runData.data?.steps || [],
            error: runData.data?.error || runData.message || '未知错误',
          };
      setRunResult(execResult);

      // 最终同步：WS 可能漏收，用 steps 兜底显示
      const stepsData = runData.data?.steps || [];
      if (runData.success && stepsData.length > 0) {
        setRunningSteps(stepsData.map(s => ({
          nodeId: s.nodeId,
          label: s.nodeName,
          status: s.output?.error ? 'error' : 'done',
          duration: s.duration,
        })));
      } else if (!runData.success) {
        setRunningSteps(prev => [...prev, { label: '执行失败', status: 'error' }]);
        console.error('[Workflow 执行失败]', execResult.error);
      }
    } catch (err) {
      setRunningSteps(prev => [...prev, { label: '出错', status: 'error' }]);
      alert('执行出错: ' + err.message);
    } finally {
      setRunning(false);
    }
  }, [nodes, edges, selectedTemplate, userIdea]);

  // ========== 新建 ==========
  const handleNewWorkflow = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedTemplate(null);
    setSelectedNode(null);
    setRunResult(null);
    setRunningSteps([]);
    setCycleError('');
    historyRef.current = new HistoryManager();
    setView('editor');
  }, [setNodes, setEdges]);

  // ========== 进度展示 ==========
  const getNodeStepLabel = (nodeName, nodeType) => {
    const map = {
      llmAnalyze: `🔍 ${nodeName}`,
      llmGenerate: `✍️ ${nodeName}`,
      textGenerate: `📝 ${nodeName}`,
      knowledgeQuery: `📚 ${nodeName}`,
      imageGenerate: `🎨 ${nodeName}`,
      videoGenerate: `🎬 ${nodeName}`,
      musicGenerate: `🎵 ${nodeName}`,
      condition: `🔀 ${nodeName}`,
      loop: `🔄 ${nodeName}`,
      output: `📤 ${nodeName}`,
    };
    return map[nodeType] || nodeName;
  };

  const renderStepProgress = useCallback(() => {
    if (!running && runResult && runResult.steps?.length > 0) {
      return (
        <div style={{ marginTop: 8 }}>
          {runResult.steps.map((step, i) => {
            const icon = step.output?.error ? '❌' : '✅';
            const detail = step.output?.error
              ? step.output.error
              : step.output?.imageUrl ? `图片生成成功 ${step.output.resolution || ''}`
              : step.output?.videoUrl ? '视频生成成功'
              : step.output?.audioUrl ? '音频生成成功'
              : step.output?.referenceImages?.length > 0 ? `输出提示词 + ${step.output.referenceImages.length}张参考图`
              : step.output?.text ? step.output.text.slice(0, 60) + (step.output.text.length > 60 ? '...' : '')
              : step.output?.styleAnalysis ? '设计风格分析完成'
              : step.output?.analysis ? '分析完成'
              : step.output?.knowledge?.length > 0 ? `检索到 ${step.output.knowledge.length} 条知识`
              : '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: step.output?.error ? '#ef4444' : '#10b981' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{icon} {getNodeStepLabel(step.nodeName, step.nodeType)}</div>
                  {detail && <div style={{ color: 'var(--text-secondary)', marginTop: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>}
                </div>
                <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{step.duration}ms</span>
              </div>
            );
          })}
        </div>
      );
    }
    if (runningSteps.length === 0) return null;
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {runningSteps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: s.status === 'done' ? '#10b981' : s.status === 'error' ? '#ef4444' : '#3b82f6',
              animation: s.status === 'running' ? 'pulse 1s infinite' : 'none',
            }} />
            <span style={{ color: s.status === 'error' ? '#ef4444' : 'var(--text-secondary)' }}>{s.label}</span>
            {s.duration && <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 10 }}>{s.duration}ms</span>}
          </div>
        ))}
      </div>
    );
  }, [running, runResult, runningSteps]);

  // ========== 视图分发 ==========
  if (view === 'list') {
    return (
      <WorkflowListPanel
        onBack={onBack}
        onSelectWorkflow={loadTemplate}
        onCreateWorkflow={handleNewWorkflow}
      />
    );
  }
  if (view === 'history') return <WorkflowHistoryPanel onBack={() => setView('editor')} />;
  if (view === 'llm') return <LLMConfigPanel onBack={() => setView('editor')} />;
  if (view === 'knowledge') return <KnowledgePanel onBack={() => setView('editor')} />;

  // ========== 编辑器视图 ==========
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左侧工具栏 */}
      <div style={{
        width: 56,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 4px',
        gap: 2,
        flexShrink: 0,
      }}>
        <button onClick={onBack} title="返回主页" style={toolBtnStyle}><span style={toolBtnEmoji}>←</span><span style={toolBtnLabel}>主页</span></button>
        <button onClick={() => setView('list')} title="工作流列表" style={toolBtnStyle}><span style={toolBtnEmoji}>📋</span><span style={toolBtnLabel}>列表</span></button>
        <button onClick={handleNewWorkflow} title="新建工作流" style={toolBtnStyle}><span style={toolBtnEmoji}>➕</span><span style={toolBtnLabel}>新建</span></button>
        <div style={{ flex: 1 }} />
        <button onClick={handleUndo} title={`撤销 (${historyRef.current.getUndoCount()})`}
          disabled={!historyRef.current.canUndo()}
          style={{ ...toolBtnStyle, opacity: historyRef.current.canUndo() ? 1 : 0.3 }}><span style={toolBtnEmoji}>↩️</span><span style={toolBtnLabel}>撤销</span></button>
        <button onClick={handleRedo} title={`重做 (${historyRef.current.getRedoCount()})`}
          disabled={!historyRef.current.canRedo()}
          style={{ ...toolBtnStyle, opacity: historyRef.current.canRedo() ? 1 : 0.3 }}><span style={toolBtnEmoji}>↪️</span><span style={toolBtnLabel}>重做</span></button>
        <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
        <button onClick={() => setView('llm')} title="LLM 配置" style={toolBtnStyle}><span style={toolBtnEmoji}>🤖</span><span style={toolBtnLabel}>LLM</span></button>
        <button onClick={() => setView('knowledge')} title="知识库" style={toolBtnStyle}><span style={toolBtnEmoji}>📚</span><span style={toolBtnLabel}>知识库</span></button>
        <button onClick={() => setView('history')} title="执行历史" style={toolBtnStyle}><span style={toolBtnEmoji}>📜</span><span style={toolBtnLabel}>历史</span></button>
      </div>

      {/* 节点库面板 */}
      <div style={{
        width: nodePanelCollapsed ? 0 : 180,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        padding: nodePanelCollapsed ? 0 : '12px',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 0.2s, padding 0.2s',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          {!nodePanelCollapsed && <div style={{ fontWeight: 600, fontSize: 13 }}>添加节点</div>}
          <button
            onClick={() => setNodePanelCollapsed(!nodePanelCollapsed)}
            title={nodePanelCollapsed ? '展开' : '折叠'}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', padding: '2px 4px' }}
          >
            {nodePanelCollapsed ? '▶' : '◀'}
          </button>
        </div>
        {!nodePanelCollapsed && Object.entries(NODE_TYPES_CONFIG).map(([type, config]) => (
          <NodeTypeButton key={type} type={type} config={config} onAdd={addNode} />
        ))}
      </div>

      {/* 画布区域 */}
      <div style={{ width: '1100px', minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        {/* 想法输入区 */}
        <div style={{
          position: 'absolute', top: 12, left: 12, right: selectedNode ? 276 : 12,
          zIndex: 10, background: 'var(--bg-secondary)', borderRadius: 10, padding: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)', transition: 'right 0.2s',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>💡 输入你的想法</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {refImages.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🖼️ {refImages.length}张参考图</span>}
              {running && <div style={{ fontSize: 11, color: '#3b82f6' }}>⏳ 执行中...</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={userIdea}
                onChange={(e) => setUserIdea(e.target.value)}
                placeholder="例如：生成一张科技感的海报，突出产品特点..."
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                  borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13,
                  resize: 'none', minHeight: 60, maxHeight: 100, width: '100%',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleRun(); }}
              />
              {/* 参考图缩略图 */}
              {refImages.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {refImages.map((img, i) => (
                    <div key={i} style={{
                      position: 'relative', width: 48, height: 48, borderRadius: 6,
                      overflow: 'hidden', border: '1px solid var(--border-color)', flexShrink: 0,
                    }}>
                      <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.style.display = 'none'; }} />
                      <span
                        onClick={() => removeRefImage(i)}
                        style={{
                          position: 'absolute', top: 0, right: 0, width: 16, height: 16,
                          background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', lineHeight: 1, borderRadius: '0 0 0 4',
                        }}
                      >×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <button className="generate-btn" onClick={handleRun} disabled={running}
                style={{ padding: '10px 16px', width: 'auto' }}>
                {running ? '⏳' : '▶'} {running ? '执行中' : '执行'}
              </button>
              <label style={{
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11,
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4,
                whiteSpace: 'nowrap',
              }}>
                {refUploading ? '⏳' : '🖼️'} 参考图
                <input type="file" ref={refFileInput} accept="image/*" multiple
                  style={{ display: 'none' }} onChange={handleRefUpload} disabled={refUploading} />
              </label>
            </div>
          </div>
          {renderStepProgress()}
        </div>

        {/* 环检测警告 */}
        {cycleError && (
          <div style={{
            position: 'absolute', top: 140, left: 12, right: selectedNode ? 276 : 12,
            zIndex: 20, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: '8px 14px', color: '#dc2626', fontSize: 13,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            ⚠️ {cycleError}
            <button onClick={() => setCycleError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }}>×</button>
          </div>
        )}

        {/* 模板名称 */}
        {selectedTemplate && (
          <div style={{
            position: 'absolute', top: 12, right: selectedNode ? 276 : 12, zIndex: 10,
            background: 'var(--bg-secondary)', padding: '6px 12px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            {selectedTemplate.name}
          </div>
        )}

        {/* 执行结果 */}
        {runResult && (
          <>
            {/* 背景遮罩 */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 5, background: 'rgba(0,0,0,0.3)', borderRadius: 8,
            }} onClick={() => setRunResult(null)} />
            <div style={{
              position: 'absolute', bottom: 12, left: 12, right: selectedNode ? 276 : 12,
              zIndex: 10, background: '#1e1e1e', borderRadius: 10, padding: 14,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)', maxHeight: 300, overflowY: 'auto',
              transition: 'right 0.2s',
              color: '#e0e0e0',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {runResult.success ? '✅ 执行成功' : '❌ 执行失败'}
              </span>
              <button onClick={() => setRunResult(null)} style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
            </div>
              {runResult.success ? (
              <div>
                {/* 调试：显示原始数据结构
                <pre style={{fontSize:10,color:'#aaa',whiteSpace:'pre-wrap'}}>{JSON.stringify(runResult, null, 2)}</pre>
                */}
                {runResult.steps?.some(s => s.output?.error) && (
                  <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid #fecaca', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#ef4444', marginBottom: 4 }}>⚠️ 部分步骤出错</div>
                    {runResult.steps.filter(s => s.output?.error).map((s, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#dc2626', marginBottom: 2 }}>
                        · {s.nodeName || s.nodeType}: {s.output?.error}
                      </div>
                    ))}
                  </div>
                )}
                {runResult.outputs?.styleAnalysis && (
                  <ResultBlock label="🎨 风格分析" content={runResult.outputs.styleAnalysis.slice(0, 500) + (runResult.outputs.styleAnalysis.length > 500 ? '...' : '')} />
                )}
                {runResult.outputs?.prompt && <ResultBlock label="📝 提示词" content={runResult.outputs.prompt} />}
                {(runResult.outputs?.copy || runResult.outputs?.text) && (
                  <ResultBlock label="📄 文案" content={runResult.outputs.copy || runResult.outputs.text} />
                )}
                {runResult.outputs?.referenceImages?.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    🖼️ 参考图: {runResult.outputs.referenceImages.length} 张
                  </div>
                )}
                {runResult.outputs?.imageUrl && <ResultMedia label="🖼️ 图片" type="image" url={runResult.outputs.imageUrl} />}
                {runResult.outputs?.videoUrl && <ResultMedia label="🎬 视频" type="video" url={runResult.outputs.videoUrl} />}
                {runResult.outputs?.audioUrl && <ResultMedia label="🎵 音频" type="audio" url={runResult.outputs.audioUrl} />}
                {!runResult.outputs?.prompt && !runResult.outputs?.copy && !runResult.outputs?.text && !runResult.outputs?.imageUrl && !runResult.outputs?.videoUrl && !runResult.outputs?.audioUrl && (
                  <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 4 }}>
                    ⚠️ 执行完成但未捕获到输出（请检查上方错误信息，或检查 LLM 调用配置是否正确）
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: '#ef4444', fontSize: 13 }}>{runResult.error || runResult.message}</div>
            )}
          </div>
          </>
        )}

        {/* ReactFlow 画布 */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          deleteKeyCode={['Backspace', 'Delete']}
          style={{ width: '100%', height: '100%', minWidth: 0 }}
          className="workflow-canvas"
        >
          <Background color="var(--border-color)" gap={15} size={1} />
          <Controls showInteractive={false} style={{ background: 'var(--bg-secondary)', borderRadius: 6, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
          <MiniMap
            nodeColor={(n) => NODE_TYPES_CONFIG[n.type]?.color || '#64748b'}
            maskColor="rgba(0,0,0,0.4)"
            style={{ background: 'var(--bg-secondary)' }}
          />
          {/* 右下角工具栏 */}
          <Panel position="bottom-left" style={{ left: '50%', transform: 'translateX(-50%)' }}>
            <div style={{ display: 'flex', gap: 8, background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              <button className="btn-outline" onClick={handleSave} style={{ fontSize: 12, padding: '5px 12px' }}>💾 保存</button>
              <button className="btn-outline" onClick={autoArrange} style={{ fontSize: 12, padding: '5px 12px', borderColor: '#10b981', color: '#10b981' }}>📐 排列</button>
              <button className="btn-outline" onClick={handleExport} style={{ fontSize: 12, padding: '5px 12px', borderColor: '#6366f1', color: '#6366f1' }}>📤 导出</button>
              <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
              <button className="btn-outline" onClick={() => importInputRef.current?.click()} style={{ fontSize: 12, padding: '5px 12px', borderColor: '#6366f1', color: '#6366f1' }}>📥 导入</button>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* 右侧属性面板 */}
      {selectedNode && (
        <div style={{
          width: 260,
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          padding: 14,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          <NodeProperties
            selectedNode={selectedNode}
            updateNodeData={updateNodeData}
            deleteNode={deleteNode}
            copyNode={copyNode}
          />
        </div>
      )}
    </div>
  );
}

// ============ 工具栏按钮样式 ============
const toolBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: '5px 2px',
  cursor: 'pointer',
  fontSize: 14,
  color: 'var(--text-secondary)',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 1,
};
const toolBtnEmoji = { fontSize: 14, lineHeight: 1 };
const toolBtnLabel = { fontSize: 10, lineHeight: 1 };

// ============ 节点属性面板 ============
function NodeProperties({ selectedNode, updateNodeData, deleteNode, copyNode }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>节点属性</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => copyNode(selectedNode)} title="复制节点" style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>📋</button>
          <button onClick={() => deleteNode(selectedNode.id)} title="删除节点" style={{ background: '#ef4444', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🗑️</button>
        </div>
      </div>

      <div className="section-label">节点名称</div>
      <input
        className="input-field"
        value={selectedNode.data.label || ''}
        onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
        placeholder="输入名称"
      />

      <div className="section-label" style={{ marginTop: 12 }}>类型</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{NODE_TYPES_CONFIG[selectedNode.type]?.icon}</span>
        <span>{NODE_TYPES_CONFIG[selectedNode.type]?.label}</span>
      </div>

      {selectedNode.type === 'llmGenerate' && <LLMGenerateFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'textGenerate' && <TextGenerateFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'imageGenerate' && <ImageGenerateFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'videoGenerate' && <VideoGenerateFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'knowledgeQuery' && <KnowledgeQueryFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'condition' && <ConditionFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
      {selectedNode.type === 'loop' && <LoopFields selectedNode={selectedNode} updateNodeData={updateNodeData} />}
    </div>
  );
}

function LLMGenerateFields({ selectedNode, updateNodeData }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>输出类型</div>
      <select className="input-field" value={selectedNode.data.outputType || 'prompt'}
        onChange={(e) => updateNodeData(selectedNode.id, { outputType: e.target.value })}>
        <option value="prompt">生成提示词</option>
        <option value="copy">生成文案</option>
        <option value="template">自定义模板</option>
        <option value="analyze">分析理解</option>
      </select>

      {selectedNode.data.outputType === 'template' && (
        <>
          <div className="section-label" style={{ marginTop: 12 }}>提示词模板</div>
          <textarea className="input-field" style={{ minHeight: 100, resize: 'vertical' }}
            value={selectedNode.data.promptTemplate || ''}
            onChange={(e) => updateNodeData(selectedNode.id, { promptTemplate: e.target.value })}
            placeholder={'支持变量：\n{{input}} {{knowledge}}\n{{prev_output}} {{analysis}}'}
          />
        </>
      )}

      {selectedNode.data.outputType !== 'template' && (
        <>
          <div className="section-label" style={{ marginTop: 12 }}>提示词（可选）</div>
          <textarea className="input-field" style={{ minHeight: 70, resize: 'vertical' }}
            value={selectedNode.data.customPrompt || ''}
            onChange={(e) => updateNodeData(selectedNode.id, { customPrompt: e.target.value })}
            placeholder="额外指导..."
          />
        </>
      )}

      <div className="section-label" style={{ marginTop: 12 }}>LLM 配置</div>
      <select className="input-field" value={selectedNode.data.llmConfig || 'default'}
        onChange={(e) => updateNodeData(selectedNode.id, { llmConfig: e.target.value })}>
        <option value="default">默认配置</option>
        <option value="custom">自定义 LLM</option>
      </select>
    </>
  );
}

function TextGenerateFields({ selectedNode, updateNodeData }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>文案风格</div>
      <select className="input-field" value={selectedNode.data.textStyle || 'marketing'}
        onChange={(e) => updateNodeData(selectedNode.id, { textStyle: e.target.value })}>
        <option value="marketing">营销推广</option>
        <option value="social">社媒文案</option>
        <option value="product">产品介绍</option>
        <option value="story">故事叙述</option>
      </select>

      <div className="section-label" style={{ marginTop: 12 }}>参考示例（可选）</div>
      <textarea className="input-field" style={{ minHeight: 60, resize: 'vertical' }}
        value={selectedNode.data.exampleText || ''}
        onChange={(e) => updateNodeData(selectedNode.id, { exampleText: e.target.value })}
        placeholder="输入参考文案，AI 将学习风格..."
      />

      <div className="section-label" style={{ marginTop: 12 }}>LLM 配置</div>
      <select className="input-field" value={selectedNode.data.llmConfig || 'default'}
        onChange={(e) => updateNodeData(selectedNode.id, { llmConfig: e.target.value })}>
        <option value="default">默认配置</option>
        <option value="custom">自定义 LLM</option>
      </select>
    </>
  );
}

function ImageGenerateFields({ selectedNode, updateNodeData }) {
  const model = selectedNode.data.model || 'gpt-image-2-vip';
  const isGptVip = model === 'gpt-image-2-vip';
  const isNanoBanana = model.startsWith('nano-banana');
  const supports4K = isGptVip || model === 'nano-banana-2-4k-cl' || model === 'nano-banana-pro-4k-vip';
  const supports2K = supports4K || model === 'nano-banana-2-cl' || model === 'nano-banana-pro-cl' ||
    model === 'nano-banana-pro-vip' || model === 'nano-banana-2' || model === 'nano-banana-pro';

  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>模型</div>
      <select className="input-field" value={model}
        onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}>
        <option value="gpt-image-2">GPT-Image 2</option>
        <option value="gpt-image-2-vip">GPT-Image 2 VIP</option>
        <option value="nano-banana">Nano Banana</option>
        <option value="nano-banana-fast">Nano Banana Fast</option>
        <option value="nano-banana-2">Nano Banana 2</option>
        <option value="nano-banana-2-cl">Nano Banana 2 CL (2K)</option>
        <option value="nano-banana-2-4k-cl">Nano Banana 2 4K CL</option>
        <option value="nano-banana-pro">Nano Banana Pro</option>
        <option value="nano-banana-pro-cl">Nano Banana Pro CL (2K)</option>
        <option value="nano-banana-pro-vip">Nano Banana Pro VIP (2K)</option>
        <option value="nano-banana-pro-4k-vip">Nano Banana Pro 4K VIP</option>
      </select>

      <div className="section-label" style={{ marginTop: 12 }}>分辨率</div>
      <select className="input-field" value={selectedNode.data.resolution || '1K'}
        onChange={(e) => updateNodeData(selectedNode.id, { resolution: e.target.value })}>
        <option value="1K">1K</option>
        {supports2K && <option value="2K">2K</option>}
        {supports4K && <option value="4K">4K</option>}
      </select>

      <div className="section-label" style={{ marginTop: 12 }}>比例</div>
      <select className="input-field" value={selectedNode.data.aspectRatio || '1:1'}
        onChange={(e) => updateNodeData(selectedNode.id, { aspectRatio: e.target.value })}>
        <option value="1:1">1:1 方形</option>
        <option value="16:9">16:9 横版</option>
        <option value="9:16">9:16 竖版</option>
        <option value="4:3">4:3</option>
        <option value="3:4">3:4</option>
      </select>
    </>
  );
}

function VideoGenerateFields({ selectedNode, updateNodeData }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>模型</div>
      <select className="input-field" value={selectedNode.data.model || 'seedance2.0'}
        onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}>
        <option value="seedance2.0">Seedance 2.0（旗舰）</option>
        <option value="seedance2.0-fast">Seedance 2.0 Fast（快速）</option>
        <option value="seedance1.5-pro">Seedance 1.5 Pro</option>
        <option value="seedance1.0-pro">Seedance 1.0 Pro</option>
      </select>
      <div className="section-label" style={{ marginTop: 12 }}>比例</div>
      <select className="input-field" value={selectedNode.data.ratio || '16:9'}
        onChange={(e) => updateNodeData(selectedNode.id, { ratio: e.target.value })}>
        <option value="16:9">16:9 横版</option>
        <option value="9:16">9:16 竖版</option>
        <option value="1:1">1:1 方形</option>
      </select>
      <div className="section-label" style={{ marginTop: 12 }}>时长（秒）</div>
      <input className="input-field" type="number" min="3" max="10" value={selectedNode.data.duration || 5}
        onChange={(e) => updateNodeData(selectedNode.id, { duration: parseInt(e.target.value) || 5 })} />
    </>
  );
}

function KnowledgeQueryFields({ selectedNode, updateNodeData }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>查询分类</div>
      <select className="input-field" value={selectedNode.data.category || 'product'}
        onChange={(e) => updateNodeData(selectedNode.id, { category: e.target.value })}>
        <option value="product">产品</option>
        <option value="company">公司</option>
        <option value="template">模板</option>
      </select>
    </>
  );
}

function ConditionFields({ selectedNode, updateNodeData }) {
  const useFastMatch = selectedNode.data?.useFastMatch !== false;
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>条件判断</div>
      <textarea className="input-field" style={{ minHeight: 70, resize: 'vertical' }}
        value={selectedNode.data.condition || ''}
        onChange={(e) => updateNodeData(selectedNode.id, { condition: e.target.value })}
        placeholder={'快速匹配（不消耗token）：\n包含"海报" / 包含"视频" / 不包含"logo"\n以"Enbon"开头 / 包含"英文"\n\n复杂条件（调用LLM判断）：\n输入内容是否适合海外市场'}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={useFastMatch}
            onChange={(e) => updateNodeData(selectedNode.id, { useFastMatch: e.target.checked })} />
          快速匹配优先（带引号关键词直接判断，无需LLM）
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        用法：用引号包裹关键词 → 快速匹配；无引号 → LLM 智能判断
      </div>
    </>
  );
}

function LoopFields({ selectedNode, updateNodeData }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>最大迭代次数</div>
      <input className="input-field" type="number" min="1" max="100"
        value={selectedNode.data.maxIterations || 5}
        onChange={(e) => updateNodeData(selectedNode.id, { maxIterations: parseInt(e.target.value) || 5 })} />
    </>
  );
}
