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
  'set_timeline_duration', 'record_camera_video', 'set_environment',
];

const VALID_PROP_TYPES = [
  'box', 'cylinder', 'platform', 'wall',
  'bed', 'table', 'desk', 'chair', 'sofa', 'cabinet', 'bookshelf', 'shelf', 'door', 'window', 'screen', 'carpet',
  'corridor', 'elevator', 'console', 'cockpit', 'hatch', 'med_bed', 'lab_table',
  'building', 'street', 'lamp', 'billboard', 'bridge',
  'led_screen', 'product_box', 'product_panel', 'hologram',
  'airplane', 'spacecraft', 'planet', 'asteroid', 'starfield',
];

const VALID_POSES = ['stand', 'sit', 'lie', 'wave', 'point', 'bow', 'crouch'];
const VALID_CAMERA_MODES = ['fixed', 'follow', 'orbit', 'drone', 'handheld'];
const VALID_ASPECT_RATIOS = ['16:9', '2.35:1', '9:16', '1:1'];
const VALID_ENVIRONMENT_MODES = ['ground', 'air', 'space', 'studio'];

const DIRECTOR_PROFILE_PROMPTS = {
  film_director: '你现在以资深电影导演身份工作，优先判断戏剧冲突、场面调度、节奏、镜头动机和一镜到底/分镜结构。',
  cinematographer: '你现在以专业电影摄影师身份工作，优先设计焦段、机位高度、构图、景别、推拉摇移跟、变焦和空间压缩关系。',
  '3d_animator': '你现在以专业3D动画设计师身份工作，优先设计灰模资产、动作弧线、关键帧节奏、运动缓入缓出和空间可读性。',
  product_animator: '你现在以专业产品动画师身份工作，优先突出产品结构、材质层级、旋转展示、展开/升起/点亮等产品动作和清晰参考画面。',
  commercial_director: '你现在以商业广告导演身份工作，优先设计高识别度产品卖点、节奏强的镜头段落、干净背景和可交付参考视频。',
};

const MATERIAL_TYPE_PROMPTS = {
  prompt: '输入是手动需求，请直接转成可执行3D灰模预演。',
  script: '输入包含剧本/脚本，请先理解场次、人物、动作、情绪和对白，再抽取1个最适合当前3D预演的镜头段落执行。',
  novel: '输入包含小说段落，请先把叙事转成可视动作、空间关系和镜头语言，再生成灰模预演。',
  product: '输入是产品动画需求，请优先创建产品灰模和产品动作，道具本身可以成为动画主体，摄影机可以固定或配合运镜。',
  space_air: '输入是空中/太空/飞行需求，请允许物体悬空，不要默认依赖地面，使用 airplane/spacecraft/planet/asteroid/starfield 等灰模道具。',
};

function buildShotPlanPrompt() {
  return `你是一位专业电影分镜导演、3D预演导演和虚拟摄影指导。你的任务不是直接生成3D命令，而是把用户文本拆成可人工审核的分镜计划。

## 核心要求
- 输入可能是小说、剧本、广告脚本或产品动画需求。
- 你必须把它拆成 6-12 个连续分镜，除非用户明确要求其他数量。
- 每个分镜是一段独立3D预演视频，通常 3-8 秒，除非特别需要，不要超过12秒。
- 所有分镜加起来要能衔接成完整视频，像正常电影电视一样切镜头、切机位。
- 不要输出一个60秒大镜头。长文本必须拆镜。
- 每个分镜都要让人能审核：景别、机位角度、焦段/FOV、运镜、时长、主体动作、场景道具、衔接方式。
- 每个分镜必须是可单独生成的3D预演任务，previz_prompt 要写清楚是否保留上传背景、是否需要地面、相机 lookAt 对准哪里、关键帧时间点。
- 地面/室内/城市场景必须给出地面参照物或地面纹理/网格/道路/地毯，避免摄影机里看不出运动距离。
- 人物镜头必须说明摄影机对准脸部/头胸区域；双人镜头必须说明两人脸部中点或过肩关系。
- 必须保留用户文本中的核心名词和设定，不得新增用户没有要求的核心叙事物件或场景，例如星门、未来实验室、驾驶舱、科学家、全息地球等。
- 输出仅限 JSON，不要输出解释性散文。

## 输出JSON格式
\`\`\`json
{
  "title": "分镜计划标题",
  "total_duration": 45,
  "continuity": "整体衔接说明",
  "shots": [
    {
      "id": "S01",
      "title": "镜头标题",
      "duration": 5,
      "scene": "场景空间",
      "visual_goal": "这个镜头要让观众看懂什么",
      "characters": ["角色A"],
      "props": ["床", "全息投影"],
      "action": "主体动作",
      "shot_size": "特写/近景/中景/全景/远景",
      "camera_angle": "正面/侧面/俯拍/仰拍/过肩/低机位等",
      "focal": "24mm广角 / 35mm / 50mm / 85mm长焦",
      "fov": 40,
      "camera_movement": "固定/推镜/拉镜/侧移/环绕/摇镜/希区柯克变焦等",
      "transition_in": "从上一个镜头如何衔接",
      "transition_out": "如何切到下一个镜头",
      "review_notes": "给人工审核看的风险点或可调项",
      "previz_prompt": "用于生成这一条3D预演的完整自然语言提示词，必须包含时长、人物、道具、场景、摄影机、焦段、运镜、关键帧和录制要求"
    }
  ]
}
\`\`\`

请根据用户文本生成分镜计划：`;
}

function normalizeShotPlan(parsed) {
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  const shots = Array.isArray(data.shots) ? data.shots : [];
  const normalizedShots = shots.slice(0, 20).map((shot, index) => {
    const duration = Math.max(1, Math.min(12, Number(shot.duration) || 5));
    const id = shot.id || `S${String(index + 1).padStart(2, '0')}`;
    const characters = Array.isArray(shot.characters) ? shot.characters : [];
    const aimLine = characters.length
      ? '摄影机 lookAt 必须对准人物脸部/头胸区域，双人镜头对准两人脸部中点。'
      : '摄影机 lookAt 必须对准产品、飞船、道具或当前画面主体中心。';
    const previzPrompt = shot.previz_prompt || '';
    return {
      id,
      title: shot.title || `分镜 ${index + 1}`,
      duration,
      scene: shot.scene || '',
      visual_goal: shot.visual_goal || '',
      characters,
      props: Array.isArray(shot.props) ? shot.props : [],
      action: shot.action || '',
      shot_size: shot.shot_size || '',
      camera_angle: shot.camera_angle || '',
      focal: shot.focal || '',
      fov: typeof shot.fov === 'number' ? Math.max(15, Math.min(90, shot.fov)) : undefined,
      camera_movement: shot.camera_movement || '',
      transition_in: shot.transition_in || '',
      transition_out: shot.transition_out || '',
      review_notes: shot.review_notes || '',
      previz_prompt: /lookAt|对准|脸|头胸|面部|中点|主体中心/.test(previzPrompt)
        ? previzPrompt
        : `${previzPrompt}\n${aimLine}`.trim(),
      status: 'pending',
    };
  });

  return {
    title: data.title || 'AI分镜计划',
    total_duration: normalizedShots.reduce((sum, shot) => sum + shot.duration, 0),
    continuity: data.continuity || '',
    shots: normalizedShots,
  };
}

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
4. **时间线与录制**：添加关键帧、设置时间线时长，并在用户明确要求“录制/导出/生成参考片”时触发摄影机录制

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

**自动一镜到底预演 / 自动录制参考片**：
- 当用户说“自动、只需等待结果、查看回放、录制、导出、下载、参考片、生成素材”时，必须输出完整自动执行链：set_timeline_duration → 场景搭建 → 起点 add_keyframe → 中段 move_actor/move_camera/configure_camera/add_keyframe → 终点 move_actor/move_camera/configure_camera/add_keyframe → record_camera_video。
- 用户指定时长（如10秒运镜）时，必须 set_timeline_duration duration=10，并让 record_camera_video duration=10。
- 一镜到底不要只输出起点和终点，至少输出 3 个关键帧：time=0、time=duration*0.45~0.6、time=duration。复杂运镜可输出4个关键帧。
- “从后到侧面再到前方”参考：人物并排行走沿 X 轴或 Z 轴移动；摄影机 time=0 在人物后方，time=中段移动到侧面，time=终点移动到人物前方；lookAt 始终对准两人脸部/头部中间。
- “不要平淡、有变焦”必须让 fov 随关键帧变化，例如 54 → 40 → 28，形成从环境到更紧张中近景/近景的压缩感。
- “两个人并列走动聊天”必须创建两个演员、给他们并排行走的起点和终点，并在每个关键帧前移动演员位置；可用 wave/point/stand 姿势体现交谈。
- 当用户说“对准人脸、看脸、脸部、表情、聊天、说话、对话”时，摄影机 lookAt 必须瞄准演员脸部高度：单人用 [actor.x, 1.75, actor.z]；双人用两人 x/z 中点且 y=1.7~1.9。不要瞄脚、地面或胸口。
- 如果场景上下文提示已有用户上传背景图，必须保留这些背景图，把它们当作锁定资产；不要用 reset_scene、clear_props、clear_actors 来清空它们，也不要假设需要重新上传。运镜、人物和道具应围绕已有背景图继续构图。

## 道具类型完整列表
**基础**：box(方块)、cylinder(圆柱)、platform(圆台)、wall(墙体)
**室内**：bed(床)、table(桌子)、desk(书桌)、chair(椅子)、sofa(沙发)、cabinet(柜子)、bookshelf(书架)、shelf(置物架)、door(门)、window(窗户)、screen(屏幕)、carpet(地毯)
**科幻**：corridor(走廊)、elevator(电梯)、console(控制台)、cockpit(驾驶舱)、hatch(舱门)、med_bed(医疗床)、lab_table(实验台)
**城市**：building(建筑)、street(街道)、lamp(路灯)、billboard(广告牌)、bridge(天桥)
**产品/空天**：led_screen(LED显示屏)、product_box(产品盒体)、product_panel(产品面板)、hologram(全息透明板)、airplane(飞机)、spacecraft(飞船)、planet(星球)、asteroid(小行星)、starfield(星空)

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

## 剧本/小说/产品自动化工作流
- 如果用户上传或粘贴剧本、小说、脚本，你必须先在内部完成“场次理解 → 主体/道具抽取 → 镜头目标 → 灰模资产 → 摄影机/焦段 → 关键帧 → 录制”的规划，但输出仍然只能是 commands JSON。
- 不要试图完整还原长篇文本。选择最适合做3D预演参考片的一个段落或一个连续镜头，优先做成可读、可录制、能给AI视频平台参考的灰模动画。
- 对电影/剧情镜头：必须明确人物站位、动作方向、镜头景别、lookAt、FOV变化和关键帧时间。
- 对产品动画：可以没有演员。把产品道具作为动画主体，使用 create_prop + move_prop + add_keyframe 形成升起、旋转、展开、点亮、悬浮、定格等动作。LED显示屏优先使用 led_screen，并可用 product_panel/hologram 做屏幕内容层、像素层或发光参考层。
- 对空中、飞机、太空场景：道具和摄影机允许 Y>0 悬空；使用 airplane/spacecraft/planet/asteroid/starfield；不要把飞机、飞船、小行星强行贴地。
- 空中场景必须先输出 set_environment mode="air"；太空场景必须先输出 set_environment mode="space"；普通地面/室内/城市使用 mode="ground"。
- 如果用户要求“摄影机不动，产品自己动”，必须让 camera 保持 fixed，给产品 prop 在不同时间 move_prop 并 add_keyframe。
- 自动化请求默认至少输出：set_timeline_duration、必要灰模资产、活动摄影机、time=0关键帧、中段关键帧、结束关键帧、record_camera_video。

## 常用运镜语言映射
- 一镜到底：同一活动摄影机贯穿全段，至少3个关键帧。
- 推镜/拉镜：move_camera 沿目标方向靠近/远离，并保持 lookAt。
- 摇镜/移镜/侧移/轨道：camera 横向或弧线移动，lookAt 跟随主体。
- 希区柯克变焦/滑动变焦：camera 与目标距离变化，同时 FOV 反向变化，形成空间压缩或拉伸。
- 芬奇式：稳定、精准、低抖动、构图居中或对称，FOV多用35mm/50mm。
- 迈克尔贝式：低机位广角、强透视、环绕主体、前景/背景运动层次明显。

## 摄影机和构图硬性要求
- 人物镜头必须让 camera lookAt 对准脸部或头胸区域，常用高度 y=1.45~1.75；不要默认看脚下或地面中心。
- 双人对话/并排行走时，lookAt 应取两人位置中点且 y=1.55，镜头距离按景别控制：近景 2-3m，中景 3-5m，全景 6-9m。
- 侧拍、后拍、前方倒退拍都必须体现主体朝向、摄影机方位和运动路径，不能只创建静态机位。
- 如果要求变焦或推拉，必须在不同关键帧使用不同 fov，并同时移动 camera 或改变距离。
- 地面/室内/城市场景必须保留地面可见性，可创建 carpet/street/platform/table/chair 等参照物，避免人物漂浮在黑场。
- 每个需要录制的镜头必须输出 set_timeline_duration、time=0 关键帧、中段关键帧、结束关键帧、record_camera_video。
- 逐镜生成时，如果用户要求“只生成当前分镜”，先 reset_scene 清理上一镜演员和道具，但不要删除上传背景图。

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

**set_environment** — 设置预演环境
参数：mode("ground"/"air"/"space"/"studio")。air/space 会隐藏地面参照，允许悬空飞行或太空构图。

**focus_camera_on_actor** — 将活动摄影机对准某个演员
参数：target(演员ID或名称)

**add_keyframe** — 在时间线上记录当前演员、道具/产品和活动摄影机状态，用于形成可播放/可录制的运动预演
参数：time(秒)。典型运动镜头至少输出两次：time=0 记录起点，移动演员/道具/摄影机后 time=4~6 记录终点。产品动画必须通过 move_prop 后 add_keyframe 来记录产品动作。

**set_timeline_duration** — 设置预演时间线总时长
参数：duration(秒，1-120)。如果用户要求录制 6 秒参考片，应先设置 duration=6。

**record_camera_video** — 从活动摄影机视图开始录制参考视频
参数：duration(秒，可选，默认使用时间线时长), delay(秒，可选，默认0.5)。仅当用户明确要求录制、导出视频、生成参考片时输出。必须放在所有 create/move/add_keyframe 命令之后。

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
    if (cmd.type === 'set_environment' && (!cmd.mode || !VALID_ENVIRONMENT_MODES.includes(cmd.mode))) {
      errors.push(`命令${i}(set_environment): mode 必须是 ground/air/space/studio`);
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
    if (cmd.type === 'set_timeline_duration') {
      if (cmd.duration === undefined || typeof cmd.duration !== 'number' || cmd.duration <= 0 || cmd.duration > 120) {
        errors.push(`命令${i}(set_timeline_duration): duration 必须是 1-120 秒的数字`);
      }
    }
    if (cmd.type === 'record_camera_video') {
      if (cmd.duration !== undefined && (typeof cmd.duration !== 'number' || cmd.duration <= 0 || cmd.duration > 120)) {
        errors.push(`命令${i}(record_camera_video): duration 必须是 1-120 秒的数字`);
      }
      if (cmd.delay !== undefined && (typeof cmd.delay !== 'number' || cmd.delay < 0 || cmd.delay > 10)) {
        errors.push(`命令${i}(record_camera_video): delay 必须是 0-10 秒的数字`);
      }
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
const PLAN_GENERIC_NGRAMS = new Set([
  '一个', '一种', '这个', '那个', '要求', '镜头', '摄影', '相机', '生成', '场景', '分镜', '可以',
  '整体', '参考', '预演', '视频', '动作', '焦段', '运镜', '地面', '人物', '角色', '道具',
  '画面', '用户', '文本', '输出', '需要', '进行', '通过', '最后', '开始',
]);

const PLAN_REQUIRED_TERMS = [
  '刑警', '雨夜', '天桥', '路灯', '照片', '争论',
  'LED', '显示屏', '像素', '边框', '厚度',
  '展厅', '访客', '大屏', '讲解员', '玻璃', '展台',
  '飞船', '小行星', '行星', '星空', '太空',
  '飞机', '机场', '宇宙', '屏幕',
];

const PLAN_SUSPICIOUS_INSERTIONS = [
  '未知场景', '示例', '样例', '未来实验室', '科学家', '全息地球', '星门', '驾驶舱', '另一个维度',
];

function collectCjkBigrams(text) {
  const result = new Set();
  const chunks = String(text || '').match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length - 1; index += 1) {
      const gram = chunk.slice(index, index + 2);
      if (!PLAN_GENERIC_NGRAMS.has(gram)) result.add(gram);
    }
  }
  return result;
}

function assessShotPlanAlignment(sourceText, plan) {
  const title = plan?.title || '';
  if (/未知|示例|样例|模板/.test(title)) {
    return { ok: false, reason: '分镜标题像模板或示例，可能跑题' };
  }
  const planText = JSON.stringify(plan || {});
  const suspicious = PLAN_SUSPICIOUS_INSERTIONS.filter((term) => planText.includes(term) && !String(sourceText).includes(term));
  if (suspicious.length) {
    return { ok: false, reason: `分镜新增了原文没有的核心设定：${suspicious.join('、')}` };
  }
  const required = PLAN_REQUIRED_TERMS.filter((term) => String(sourceText).includes(term));
  const missing = required.filter((term) => !planText.includes(term));
  if (missing.length) {
    return { ok: false, reason: `分镜遗漏原文核心名词：${missing.join('、')}` };
  }
  const sourceTerms = collectCjkBigrams(sourceText);
  if (sourceTerms.size < 8) return { ok: true, reason: 'source too short' };
  let hits = 0;
  for (const term of sourceTerms) {
    if (planText.includes(term)) hits += 1;
  }
  const denominator = Math.min(sourceTerms.size, 80);
  const ratio = hits / denominator;
  if (hits < 4 || ratio < 0.08) {
    return { ok: false, reason: `分镜与原文关键词重合过低 hits=${hits}, ratio=${ratio.toFixed(2)}` };
  }
  return { ok: true, reason: `hits=${hits}, ratio=${ratio.toFixed(2)}` };
}

function clampCameraPosition(position, freeY = false) {
  if (!Array.isArray(position)) return position;
  return [
    Math.max(-20, Math.min(20, Number(position[0]) || 0)),
    freeY ? Math.max(-40, Math.min(40, Number(position[1]) || 0)) : Math.max(0.2, Math.min(20, Number(position[1]) || 0.2)),
    Math.max(-40, Math.min(40, Number(position[2]) || 0)),
  ];
}

function postProcessPrevizCommands(commands) {
  if (!Array.isArray(commands)) return commands;
  const cameraLookAts = new Map();
  let activeCamera = null;
  let lastLookAt = [0, 1.55, 0];
  let environmentMode = 'ground';

  const processed = commands.map((command) => {
    if (!command || typeof command !== 'object') return command;
    const next = { ...command };
    if (next.type === 'set_environment' && next.mode) {
      environmentMode = next.mode;
    }
    const freeCameraY = environmentMode === 'space' || environmentMode === 'air';
    if (next.type === 'create_camera') {
      next.position = clampCameraPosition(next.position, freeCameraY);
      if (!Array.isArray(next.lookAt)) next.lookAt = lastLookAt;
      lastLookAt = next.lookAt;
      if (next.name) cameraLookAts.set(next.name, next.lookAt);
      if (next.set_active || !activeCamera) activeCamera = next.name || activeCamera;
    }
    if (next.type === 'move_camera') {
      next.position = clampCameraPosition(next.position, freeCameraY);
      if (!Array.isArray(next.lookAt)) {
        next.lookAt = cameraLookAts.get(next.target) || cameraLookAts.get(activeCamera) || lastLookAt;
      }
      lastLookAt = next.lookAt;
      if (next.target) cameraLookAts.set(next.target, next.lookAt);
    }
    if (next.type === 'configure_camera') {
      if (!Array.isArray(next.lookAt)) next.lookAt = cameraLookAts.get(next.target) || lastLookAt;
      lastLookAt = next.lookAt;
      if (next.target) cameraLookAts.set(next.target, next.lookAt);
    }
    return next;
  });

  if (!processed.some((command) => command?.type === 'set_timeline_duration')) {
    const record = processed.find((command) => command?.type === 'record_camera_video');
    const lastKeyframe = processed
      .filter((command) => command?.type === 'add_keyframe')
      .map((command) => Number(command.time) || 0)
      .sort((a, b) => b - a)[0];
    const duration = Math.max(1, Math.min(120, Number(record?.duration || lastKeyframe || 5)));
    const insertAt = Math.max(
      0,
      processed.findIndex((command) => !['reset_scene', 'set_environment', 'set_aspect_ratio'].includes(command?.type))
    );
    processed.splice(insertAt < 0 ? 0 : insertAt, 0, { type: 'set_timeline_duration', duration });
  }

  return processed;
}

async function processDirective({ sceneContext, prompt, directorProfile, materialType, sourceTitle } = {}) {
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
  const profilePrompt = DIRECTOR_PROFILE_PROMPTS[directorProfile] || DIRECTOR_PROFILE_PROMPTS.film_director;
  const materialPrompt = MATERIAL_TYPE_PROMPTS[materialType] || MATERIAL_TYPE_PROMPTS.prompt;
  userMessage = `[导演身份] ${profilePrompt}\n[素材类型] ${materialPrompt}${sourceTitle ? `\n[素材标题] ${sourceTitle}` : ''}\n\n${userMessage}`;
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
    if (sceneContext.backgroundImageCount > 0) {
      const names = Array.isArray(sceneContext.backgroundImageNames) && sceneContext.backgroundImageNames.length > 0
        ? sceneContext.backgroundImageNames.join('、')
        : '未命名背景图';
      ctxParts.push(`已有 ${sceneContext.backgroundImageCount} 张用户上传背景图：${names}。这些背景图必须保留，AI 只调整人物、道具、摄影机和关键帧来配合它们`);
    }

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

    commands = postProcessPrevizCommands(commands);
    if (materialType === 'product' && !/太空|宇宙|飞船|星球|行星/.test(prompt)) {
      commands = commands.map((command) => (
        command?.type === 'set_environment' && command.mode === 'space'
          ? { ...command, mode: 'studio' }
          : command
      ));
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

async function generateShotPlan({ prompt, directorProfile, materialType, sourceTitle, preferredShotCount } = {}) {
  if (!prompt || !prompt.trim()) {
    return { success: false, message: '请输入需要拆分镜的文本。' };
  }

  const config = await getLLMConfig();
  if (!config) {
    return {
      success: false,
      needConfig: true,
      message: '未配置 LLM API Key。请先配置 DeepSeek API 密钥。',
    };
  }

  const profilePrompt = DIRECTOR_PROFILE_PROMPTS[directorProfile] || DIRECTOR_PROFILE_PROMPTS.film_director;
  const materialPrompt = MATERIAL_TYPE_PROMPTS[materialType] || MATERIAL_TYPE_PROMPTS.script;
  const shotCountLine = preferredShotCount
    ? `\n[期望分镜数量] ${Math.max(1, Math.min(20, Number(preferredShotCount) || 10))} 个`
    : '\n[期望分镜数量] 由AI判断，通常 6-12 个';
  const buildUserMessage = (retryReason) => `[导演身份] ${profilePrompt}
[素材类型] ${materialPrompt}${sourceTitle ? `\n[素材标题] ${sourceTitle}` : ''}${shotCountLine}

[强制锚定规则]
- 必须使用下面用户文本中的原始地点、人物/主体、动作、情绪、产品或空间关系。
- 不允许改写成无关示例，不允许出现“未知场景”“示例”“未来实验室”等用户没有提供的设定。
- title、continuity、shots 必须能明显看出来自用户文本。
- 每个 previz_prompt 都必须写明 camera lookAt 对准哪里。
${retryReason ? `\n[上次失败原因] ${retryReason}\n请纠偏后重新输出严格 JSON。` : ''}

[用户文本]
${prompt.trim()}`;

  try {
    let lastRaw = '';
    let lastReason = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await llmService.complete(config, buildShotPlanPrompt(), buildUserMessage(lastReason));
      lastRaw = result?.content || '';
      if (!result || !result.content || !result.content.trim()) {
        lastReason = 'AI 未返回分镜内容';
        continue;
      }

      const parsed = extractJsonFromLLMResponse(result.content);
      if (!parsed) {
        lastReason = 'AI 返回的分镜格式无法解析';
        continue;
      }

      const plan = normalizeShotPlan(parsed);
      if (!plan.shots.length) {
        lastReason = 'AI 没有生成有效分镜';
        continue;
      }

      const alignment = assessShotPlanAlignment(`${sourceTitle || ''}\n${prompt}`, plan);
      if (!alignment.ok) {
        lastReason = alignment.reason;
        logger.warn('[previzDirector] shot plan alignment retry:', alignment.reason);
        continue;
      }

      return {
        success: true,
        data: {
          plan,
          model: result.model,
          alignment,
        },
      };
    }

    return {
      success: false,
      message: `AI 分镜未通过质量检查：${lastReason || '未知原因'}，请重试或补充更具体的文本。`,
      rawResponse: lastRaw.slice(0, 1000),
    };
  } catch (err) {
    logger.error('[previzDirector] generateShotPlan error:', err.message);
    return {
      success: false,
      message: `AI 分镜生成失败：${err.message || '未知错误'}`,
    };
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  processDirective,
  generateShotPlan,
  buildSystemPrompt,
  validateCommands,
  getLLMConfig,
  VALID_COMMAND_TYPES,
  VALID_PROP_TYPES,
  VALID_POSES,
  VALID_CAMERA_MODES,
};
