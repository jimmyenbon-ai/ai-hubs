/**
 * PrevizDirectorService — 3D预演AI导演服务
 * 将自然语言指令转换为结构化3D场景操作命令
 *
 * 数据流:
 *   用户输入 → buildSystemPrompt() + processDirective()
 *   → llmService.complete() → extractJsonFromLLMResponse()
 *   → validateCommands() → 返回 { commands, explanation }
 */

const llmService = require('./llmService');
const { extractJsonFromLLMResponse } = require('./storyboardService');
const { LLMConfig } = require('../models');
const { appConfig } = require('../utils/appConfig');
const logger = require('../utils/logger');

// ============================================================
// 命令白名单
// ============================================================

const VALID_COMMAND_TYPES = [
  'create_actor', 'create_prop', 'create_camera',
  'move_actor', 'move_prop', 'move_camera',
  'apply_pose', 'delete_actor', 'delete_prop', 'delete_camera',
  'configure_camera', 'set_aspect_ratio', 'set_focal_length',
  'set_lighting', 'reset_scene', 'clear_props', 'clear_actors',
  'focus_camera_on_actor', 'add_keyframe',
];

const VALID_PROP_TYPES = [
  'box', 'cylinder', 'platform', 'wall',
  'bed', 'table', 'desk', 'chair', 'sofa', 'cabinet', 'bookshelf', 'shelf', 'door', 'window', 'screen', 'carpet',
  'corridor', 'elevator', 'console', 'cockpit', 'hatch', 'med_bed', 'lab_table',
  'building', 'street', 'lamp', 'billboard', 'bridge',
];

const VALID_POSES = ['stand', 'sit', 'lie', 'wave', 'point', 'bow', 'crouch'];
const VALID_CAMERA_MODES = ['fixed', 'follow', 'orbit', 'drone', 'handheld'];
const VALID_ASPECT_RATIOS = ['16:9', '2.35:1', '9:16', '1:1'];

// 道具中文名→英文key映射
const PROP_CN_TO_EN = {
  '方块': 'box', '圆柱': 'cylinder', '圆台': 'platform', '墙体': 'wall',
  '床': 'bed', '桌子': 'table', '书桌': 'desk', '办公桌': 'desk', '椅子': 'chair', '沙发': 'sofa',
  '柜子': 'cabinet', '书架': 'bookshelf', '置物架': 'shelf', '货架': 'shelf', '门': 'door', '窗户': 'window', '屏幕': 'screen', '地毯': 'carpet',
  '走廊': 'corridor', '电梯': 'elevator', '控制台': 'console',
  '驾驶舱': 'cockpit', '舱门': 'hatch', '医疗床': 'med_bed', '实验台': 'lab_table',
  '建筑': 'building', '街道': 'street', '路灯': 'lamp', '广告牌': 'billboard', '天桥': 'bridge',
};

// 姿势中文名→英文key映射
const POSE_CN_TO_EN = {
  '站立': 'stand', '站': 'stand',
  '坐下': 'sit', '坐': 'sit',
  '躺下': 'lie', '躺': 'lie',
  '挥手': 'wave',
  '指向': 'point', '指': 'point',
  '低头': 'bow', '鞠躬': 'bow',
  '蹲下': 'crouch', '蹲': 'crouch',
};

// ============================================================
// LLM 配置获取（复用三层优先级: DB → appConfig → env）
// ============================================================

async function getLLMConfig() {
  try {
    const dbConfig = await LLMConfig.findDefault();
    if (dbConfig && dbConfig.api_key) {
      return {
        provider: dbConfig.provider || 'deepseek',
        api_url: dbConfig.api_url || 'https://api.deepseek.com',
        api_key: dbConfig.api_key,
        model: dbConfig.model || 'deepseek-chat',
      };
    }
  } catch (_) { /* DB 不可用时回退 */ }

  const dsKey = appConfig.deepseek_api_key;
  if (dsKey) {
    return {
      provider: 'deepseek',
      api_url: appConfig.deepseek_api_url || 'https://api.deepseek.com',
      api_key: dsKey,
      model: appConfig.deepseek_model || 'deepseek-chat',
    };
  }
  return null;
}

// ============================================================
// 系统提示词
// ============================================================

function buildSystemPrompt() {
  return `你是一位资深的3D预演导演和虚拟摄影指导。你的任务是将用户的自然语言场景描述转换为精确的3D场景操作命令。

## 你的能力范围
你可以控制3D场景中的以下所有元素：
1. **演员（Actors）**：创建、删除、移动、旋转、缩放、应用姿势
2. **道具（Props）**：可创建、删除、移动、旋转、缩放，包含桌椅、书架、墙体、走廊、城市建筑等预演常用模块
3. **摄影机（Cameras）**：创建、删除、移动、配置焦距和FOV、设置运镜模式

## 空间坐标系（重要！）
- X轴：左右方向，正值=右侧，负值=左侧
- Y轴：上下方向，正值=上方，地面Y=0（演员/道具始终在地面）
- Z轴：前后方向，正值=前方（远离摄影机），负值=后方（靠近摄影机）
- 所有位置用 [x, y, z] 三元素数组表示，单位：米
- 旋转用 [rx, ry, rz] 三元素数组表示，单位：弧度

## 演员朝向规则
- 默认朝向：rotation Y=0 时演员面向 +Z 方向（前方）
- rotation Y=Math.PI（约3.14）：面向 -Z 方向（后方，即转身180度）
- rotation Y=Math.PI/2（约1.57）：面向 +X 方向（右侧）
- rotation Y=-Math.PI/2（约-1.57）：面向 -X 方向（左侧）
- 两个演员"面对面"：一个Y=0、另一个Y=Math.PI（差值约3.14）
- 两个演员"看向同方向"：rotation Y相同
- 演员坐在椅子上应该面向桌子方向

## 典型场景的空间布局参考
以下是可以直接参考的标准布局：

**客厅对话场景**：
- 桌子在中心 [0, 0, 0]，椅子在桌子Z轴两侧 [0, 0, 1.5] 和 [0, 0, -1.5]
- 两个演员面对面坐在椅子上：位置分别在 [0, 0, 1.5] 和 [0, 0, -1.5]
- 中景双人镜头：camera位置 [0, 1.8, -5]，fov=40，lookAt=[0, 1.2, 0]

**舞台演出场景**：
- 圆台/舞台在中心 [0, 0, 0]，演员站在圆台上 [0, 0, 0]
- 多个演员可在舞台上散布：[-1,0,0]、[1,0,0]、[0,0,-1]、[0,0,1]
- 正面观众视角：[0, 2.5, -7]，fov=45，lookAt=[0, 1, 0]

**办公会议场景**：
- 桌子在中心 [0, 0, 0]，尺寸可缩小 scale=[1.2, 1, 0.8]
- 椅子围绕桌子周边摆放
- 演员坐在各自椅子上
- 会议全景镜头：[0, 3.5, -6]，fov=54，lookAt=[0, 0.8, 0]

**产品展示场景**：
- 展示台/平台在中心 [0, 0, 0]
- 演员站在展示台旁边 [1.5, 0, 0]，pose=point（指向产品）
- 产品特写镜头：[0.5, 1.5, -3]，fov=24，lookAt=[0, 0.5, 0]

**科幻走廊场景**：
- corridor 道具从Z=-4到Z=4排列
- 演员在走廊中行走姿态：[0, 0, -2]
- 紧张感镜头：[0, 1.5, 4]，fov=24（长焦压扁空间感），lookAt=[0, 1, -2]

**侧面跟拍对话 + 前景遮挡场景**：
- 两个演员并排行走时，通常沿 X 轴移动：演员A [-2,0,0] 到 [2,0,0]，演员B [-2,0,0.9] 到 [2,0,0.9]
- 摄影机放在人物侧面，例如 [0,1.55,-4]，lookAt=[0,1.1,0.45]，fov=40 或 54，mode=follow
- 如果用户要求“摄影机和人物中间是书架/桌子”，把 bookshelf/table/desk 放在 camera 和 actors 之间，例如 Z=-1.6 到 -2.4，形成前景遮挡；不要把遮挡物直接压到人物身上
- 同一运动需要创建起点与终点关系：先用 move_actor / move_camera 摆出最终构图；如果需要动作录制，则保持 actors/camera 的路径方向一致，方便用户一键打关键帧

## 道具类型完整列表
**基础**：box(方块)、cylinder(圆柱)、platform(圆台)、wall(墙体)
**室内**：bed(床)、table(桌子)、desk(书桌)、chair(椅子)、sofa(沙发)、cabinet(柜子)、bookshelf(书架)、shelf(置物架)、door(门)、window(窗户)、screen(屏幕)、carpet(地毯)
**科幻**：corridor(走廊)、elevator(电梯)、console(控制台)、cockpit(驾驶舱)、hatch(舱门)、med_bed(医疗床)、lab_table(实验台)
**城市**：building(建筑)、street(街道)、lamp(路灯)、billboard(广告牌)、bridge(天桥)

**道具摆放规则**：
- 椅子紧挨桌子：如果table在[0,0,0]，椅子应放在桌子边缘Z=±(1.3~1.8)或X=±(0.8~1.2)的位置
- 沙发靠墙：如果wall在Z=3，sofa应在Z=2.5处，面朝Z负方向（Y rotation=0）
- 床靠角落：bed放在场景边缘，如[-3, 0, 3]
- 书架可用作前景遮挡：bookshelf通常放在摄影机和演员之间，缩放可设为[1,1.2,0.6]，边缘进入画面，不要完全挡住演员脸
- 桌子/书桌可用作空间层次：table/desk放在前景低位，camera lookAt保持对准演员胸口或脸部高度

## 摄影机镜头参考
| 焦段 | FOV | 位置参考 | 用途 |
|------|-----|---------|------|
| 18mm超广角 | 90 | 距离目标1-2m | 狭窄空间、夸张透视 |
| 24mm广角 | 74 | 距离目标2-3m | 全景、室内大局 |
| 35mm人文 | 54 | 距离目标3-4m | 全景、环境人像 |
| 50mm标准 | 40 | 距离目标4-5m | 中景、双人对话 |
| 85mm长焦 | 24 | 距离目标5-8m | 特写、空间压缩 |

**摄影机命名建议**：用中文描述镜头类型，如"中景双人镜头"、"特写镜头"、"全景镜头"、"过肩镜头"

## 姿势预设
| 预设名 | 说明 |
|--------|------|
| stand | 标准站立姿势（默认） |
| sit | 坐姿——用于椅子/沙发场景 |
| lie | 平躺姿势——用于床/地面场景 |
| wave | 右手举起挥手 |
| point | 右手向前方指出 |
| bow | 上半身前倾低头 |
| crouch | 膝盖弯曲蹲下 |

## 运镜模式
- fixed：固定机位，位置不变——适合对话、采访
- follow：跟随目标移动——适合行走跟踪
- orbit：围绕目标旋转——适合展示产品/人物
- drone：无人机自由视角——适合大场景俯拍
- handheld：模拟手持晃动——适合纪实/紧张感

## 输出规则（严格遵守！）
1. **只输出纯JSON**，不要有任何解释、说明、markdown标记以外的文字
2. 用 \`\`\`json ... \`\`\` 代码块包裹你的JSON输出
3. 所有命令放在 "commands" 数组中，按执行顺序排列
4. 先创建场景结构（道具），再放置人物，最后设置镜头
5. 坐标必须是精确数字，不要用省略号或占位符
6. type字段只用英文key（如create_actor、apply_pose）
7. prop_type字段只用英文key（如table、chair、sofa）
8. pose字段只用英文key（如sit、stand、wave）
9. 演员名称保持用户使用的名称（中文也可）

## 输出JSON格式
{
  "commands": [
    {
      "type": "命令类型",
      // ... 根据命令类型的参数
    }
  ],
  "explanation": "简短的中文说明，总结你做了什么（1-2句话）"
}

## 完整命令参考

**create_actor** — 创建演员
参数：name(名称), position[x,y,z], rotation[rx,ry,rz], scale[sx,sy,sz], pose(姿势预设名), select(是否选中,布尔值)

**create_prop** — 创建道具
参数：prop_type(道具类型), position[x,y,z], rotation[rx,ry,rz], scale[sx,sy,sz]

**create_camera** — 创建摄影机
参数：name(名称), position[x,y,z], rotation[rx,ry,rz], lookAt[x,y,z], fov(15-90), mode(运镜模式), set_active(设为活动摄影机), select(是否选中)

**move_actor** — 移动演员
参数：target(演员ID或名称), position[x,y,z](可选), rotation[rx,ry,rz](可选)

**move_camera** — 移动摄影机
参数：target(摄影机ID或名称), position[x,y,z](可选), rotation[rx,ry,rz](可选), lookAt[x,y,z](可选), fov(可选)

**move_prop** — 移动道具
参数：target(道具ID或名称), position[x,y,z](可选), rotation[rx,ry,rz](可选), scale[sx,sy,sz](可选)

**apply_pose** — 应用姿势
参数：target(演员ID或名称), pose(姿势预设名)

**delete_actor** — 删除演员
参数：target(演员ID或名称)

**delete_prop** — 删除道具
参数：target(道具ID或名称)

**delete_camera** — 删除摄影机
参数：target(摄影机ID或名称)

**configure_camera** — 配置摄影机（不移动位置）
参数：target(摄影机ID或名称), fov(可选), mode(可选), lookAt[x,y,z](可选)

**set_aspect_ratio** — 设置宽高比
参数：value("16:9"/"2.35:1"/"9:16"/"1:1")

**set_focal_length** — 调整活动摄影机焦距
参数：fov(15-90)

**focus_camera_on_actor** — 将活动摄影机对准某个演员
参数：target(演员ID或名称)

**add_keyframe** — 在时间线上记录当前演员和活动摄影机状态，用于形成可播放/可录制的运动预演
参数：time(秒)。典型运动镜头至少输出两次：time=0 记录起点，移动演员/摄影机后 time=4~6 记录终点。

**reset_scene** — 清空整个场景（保留默认摄影机）
无额外参数

**clear_props** — 移除所有道具
无额外参数

**clear_actors** — 移除所有演员
无额外参数

现在请根据用户输入生成场景命令：`;
}

// ============================================================
// 命令验证
// ============================================================

function validateCommands(commands) {
  if (!Array.isArray(commands)) {
    return { valid: false, errors: ['"commands" 必须是数组'] };
  }

  const errors = [];
  const warnings = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd || typeof cmd !== 'object') {
      errors.push(`命令${i}: 无效的命令对象`);
      continue;
    }
    if (!cmd.type) {
      errors.push(`命令${i}: 缺少 type 字段`);
      continue;
    }
    if (!VALID_COMMAND_TYPES.includes(cmd.type)) {
      errors.push(`命令${i}: 未知的命令类型 "${cmd.type}"`);
      continue;
    }

    // 按类型校验必填参数
    switch (cmd.type) {
      case 'create_actor':
        if (!cmd.name) errors.push(`命令${i}(create_actor): 缺少 name`);
        break;
      case 'create_prop':
        if (!cmd.prop_type) {
          errors.push(`命令${i}(create_prop): 缺少 prop_type`);
        } else if (!VALID_PROP_TYPES.includes(cmd.prop_type)) {
          // 尝试中文名转换
          if (PROP_CN_TO_EN[cmd.prop_type]) {
            cmd.prop_type = PROP_CN_TO_EN[cmd.prop_type];
          } else {
            errors.push(`命令${i}(create_prop): 无效的道具类型 "${cmd.prop_type}"`);
          }
        }
        break;
      case 'create_camera':
        if (!cmd.name) errors.push(`命令${i}(create_camera): 缺少 name`);
        break;
      case 'apply_pose':
        if (!cmd.target) errors.push(`命令${i}(apply_pose): 缺少 target`);
        if (cmd.pose && !VALID_POSES.includes(cmd.pose)) {
          // 尝试中文名转换
          if (POSE_CN_TO_EN[cmd.pose]) {
            cmd.pose = POSE_CN_TO_EN[cmd.pose];
          } else {
            errors.push(`命令${i}(apply_pose): 无效的姿势 "${cmd.pose}"`);
          }
        }
        break;
      case 'move_actor':
      case 'move_camera':
      case 'move_prop':
      case 'delete_actor':
      case 'delete_prop':
      case 'delete_camera':
      case 'configure_camera':
      case 'focus_camera_on_actor':
        if (!cmd.target) errors.push(`命令${i}(${cmd.type}): 缺少 target`);
        break;
    }

    // 校验可选参数
    if (cmd.mode && !VALID_CAMERA_MODES.includes(cmd.mode)) {
      warnings.push(`命令${i}: 未知运镜模式 "${cmd.mode}"，将忽略`);
    }
    if (cmd.value && cmd.type === 'set_aspect_ratio' && !VALID_ASPECT_RATIOS.includes(cmd.value)) {
      errors.push(`命令${i}(set_aspect_ratio): 无效的宽高比 "${cmd.value}"`);
    }
    if (cmd.fov !== undefined && (typeof cmd.fov !== 'number' || cmd.fov < 15 || cmd.fov > 90)) {
      warnings.push(`命令${i}: fov=${cmd.fov} 超出合理范围(15-90)，将钳制`);
    }
    if (cmd.position && (!Array.isArray(cmd.position) || cmd.position.length !== 3)) {
      errors.push(`命令${i}: position 必须是 [x, y, z] 三元素数组`);
    }
    if (cmd.rotation && (!Array.isArray(cmd.rotation) || cmd.rotation.length !== 3)) {
      errors.push(`命令${i}: rotation 必须是 [rx, ry, rz] 三元素数组`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// 主处理函数
// ============================================================

/**
 * 处理用户的自然语言场景指令
 * @param {Object} options
 * @param {Object} options.sceneContext - 当前场景上下文（可选）
 * @param {string} options.sceneContext.actorCount - 演员数量
 * @param {string[]} options.sceneContext.actorNames - 演员名称列表
 * @param {number} options.sceneContext.propCount - 道具数量
 * @param {number} options.sceneContext.cameraCount - 摄影机数量
 * @param {number} options.sceneContext.currentFov - 当前活动摄影机FOV
 * @param {string} options.sceneContext.currentAspect - 当前宽高比
 * @param {string} options.prompt - 用户自然语言指令
 * @returns {Object} { success, data?, message?, needConfig? }
 */
async function processDirective({ sceneContext, prompt } = {}) {
  if (!prompt || !prompt.trim()) {
    return { success: false, message: '请输入场景指令。' };
  }

  // 1. 获取 LLM 配置
  const config = await getLLMConfig();
  if (!config) {
    return {
      success: false,
      needConfig: true,
      message: '未配置 LLM API Key。请在「系统设置」→「AI 模型配置」中配置 DeepSeek API 密钥。',
    };
  }

  // 2. 构建系统提示词
  const systemPrompt = buildSystemPrompt();

  // 3. 构建用户消息（含场景上下文）
  let userMessage = prompt.trim();
  if (sceneContext) {
    const ctxParts = [];
    const ac = sceneContext.actorCount;
    const pc = sceneContext.propCount;
    const cc = sceneContext.cameraCount;

    if (ac !== undefined) ctxParts.push(`当前场景有 ${ac} 个演员`);
    if (sceneContext.actorNames && sceneContext.actorNames.length > 0) {
      ctxParts.push(`演员列表：${sceneContext.actorNames.join('、')}`);
    }
    if (pc !== undefined && pc > 0) ctxParts.push(`${pc} 个道具`);
    if (cc !== undefined) ctxParts.push(`${cc} 个摄影机`);

    if (ctxParts.length > 0) {
      userMessage = `[场景上下文] ${ctxParts.join('；')}。\n\n用户指令：${userMessage}`;
    }
  }

  logger.info('[previzDirector] 处理指令:', userMessage.slice(0, 120));

  // 4. 调用 LLM
  try {
    const result = await llmService.complete(config, systemPrompt, userMessage);

    if (!result || !result.content || !result.content.trim()) {
      logger.error('[previzDirector] LLM 返回空内容');
      return {
        success: false,
        message: 'AI 返回了空内容。请检查 API Key 是否正确配置，或稍后重试。',
      };
    }

    logger.info('[previzDirector] LLM 响应长度:', result.content.length);

    // 5. 提取 JSON
    const parsed = extractJsonFromLLMResponse(result.content);

    if (!parsed) {
      logger.error('[previzDirector] JSON 提取失败，原始响应前500字符:', result.content.slice(0, 500));
      return {
        success: false,
        message: 'AI 返回的格式无法解析。请尝试用更具体的描述重试。',
        rawResponse: result.content.slice(0, 1000),
      };
    }

    // 支持两种输出格式: { commands: [...] } 或直接的数组 [...]
    let commands;
    if (Array.isArray(parsed)) {
      commands = parsed;
    } else if (parsed.commands && Array.isArray(parsed.commands)) {
      commands = parsed.commands;
    } else {
      logger.error('[previzDirector] 解析结果无 commands 数组:', JSON.stringify(parsed).slice(0, 300));
      return {
        success: false,
        message: 'AI 返回的数据缺少 commands 数组。请重试。',
        rawResponse: result.content.slice(0, 1000),
      };
    }

    // 6. 验证命令
    const validation = validateCommands(commands);
    if (!validation.valid) {
      logger.warn('[previzDirector] 命令验证失败:', validation.errors.join('; '));
      // 不直接返回失败——尝试执行验证通过的命令（过滤掉无效的）
      // 但如果全部无效则返回错误
      if (commands.length === validation.errors.length) {
        return {
          success: false,
          message: `所有命令验证失败：${validation.errors.join('；')}`,
          validation,
        };
      }
    }

    const explanation = parsed.explanation || `已生成 ${commands.length} 条场景操作命令。`;

    return {
      success: true,
      data: {
        commands,
        explanation,
        validation: validation.errors.length > 0 ? validation : undefined,
        model: result.model,
      },
    };

  } catch (err) {
    logger.error('[previzDirector] LLM 调用异常:', err.message);
    return {
      success: false,
      message: `AI 场景生成失败：${err.message || '未知错误'}`,
    };
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  processDirective,
  buildSystemPrompt,
  validateCommands,
  getLLMConfig,
  VALID_COMMAND_TYPES,
  VALID_PROP_TYPES,
  VALID_POSES,
  VALID_CAMERA_MODES,
};
