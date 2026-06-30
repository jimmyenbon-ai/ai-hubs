---
name: ai-video-automation
description: AI 视频自动化(Storyboard)模块 — 当前状态、结构化摄影参数、场景连续性规则
metadata:
  type: project
---

# AI 视频自动化 (Storyboard Panel)

## 入口: 侧边栏 "AI 视频自动化"

## 核心流程
```
剧本输入(上传txt/手动) → LLM分镜分析 → 可选:资产提取 → 编辑分镜 → 配置参数 → 生成关键帧 → 结果画廊
```

## 文件清单
```
client/src/
├── StoryboardPanel.jsx              # 6步状态机: INPUT→ASSETS→STORYBOARD→CONFIG→RUNNING→DONE
│                                     # ShotCard: 编辑模式(下拉框结构化参数) + 展示模式(徽章行)

server/
├── controllers/storyboardController.js  # 8个handler: analyze/start/status/abort/retry/uploadRef/list/download
├── services/storyboardService.js       # LLM导演分析+智能参考图匹配+逐帧生成+降级提取
│                                        # 🆕 buildDirectorSystemPromptV2: 11条场景连续性铁律
│                                        # 🆕 normalizeShotForKeyframe: 结构化camera(9字段)+lighting(5字段)
│                                        # 🆕 composePromptV2: 用结构化参数替代自由文本
├── models/storyboardModel.js           # StoryboardJob JSON持久化
│                                        # 🆕 normalizeShot: camera扩展4字段, lighting升级为嵌套对象
└── routes/storyboardRoutes.js          # /api/storyboard/* 路由
```

## 🆕 结构化电影摄影参数

### camera 对象(9个字段 — 从2个自由文本升级)
| 字段 | 类型 | 可选值 |
|------|------|--------|
| shotSize | string | 大远景/远景/全景/中景/中近景/近景/特写/大特写 |
| angle | string | 平视/俯拍(45°)/俯拍(90°)/仰拍/荷兰角/过肩 |
| focalLength | string | 14/18/24/28/35/50/85/105/135/200 mm |
| aperture | string | f/1.4 ~ f/16 |
| composition | string | 三分法/中心对称/引导线/框架构图/对角线/负空间/黄金分割/前景遮挡/镜面反射 |
| position | string | 正面/正侧/前侧45°/后侧45°/背后/过肩/POV主观/俯视/低角度仰拍/远景俯拍 |
| movement | string | 静止/推镜/拉镜/摇镜/移镜/跟拍/升降/旋转 |
| depthOfField | string | 浅景深/中等景深/深景深 |
| lens | string | 广角变焦/标准定焦/长焦远摄(保留兼容) |

### lighting 对象(5个字段 — 从自由字符串升级为结构化对象)
| 字段 | 类型 | 可选值 |
|------|------|--------|
| style | string | 高调光/低调光/自然光/戏剧光/逆光剪影/霓虹/金色时刻/蓝色时刻/阴天柔光 |
| keyDirection | string | 正面光/前侧45°(左/右)/正侧光(左/右)/侧逆光/正逆光/顶光/底光/伦勃朗光/蝴蝶光/环形光 |
| fillRatio | string | 1:1(平光)/2:1(柔和立体)/4:1(戏剧性)/8:1(强烈对比)/仅主光 |
| quality | string | 硬光(清晰阴影)/柔光(柔和阴影)/漫反射(几乎无影)/混合 |
| colorTemp | string | 暖调3200K/中性白4300K/中性5600K/冷调7000K/极冷9000K/金色暖调2800K/荧光绿偏/霓虹混色 |

## 🆕 场景连续性铁律(11条 — 系统提示词内置)

### 光影连续性
1. 同一场景 = 同一光影体系(style/colorTemp/quality必须完全一致)
2. 同一场景 = 同一色彩方案(colorPalette不可突变)
3. 光变必须有叙事动机(记录在continuityNotes)

### 人物衣着连续性
4. 同一场景 = 同一着装(服装颜色/款式/面料跨镜锁定)
5. 跨场换装要有交代(continuityNotes注明)
6. 角色外观特征锁定(第一次出场写清，后续复用)

### 环境/道具连续性
7. 同一场景sceneDescription完全复用(尾部追加视角说明)
8. 道具跨镜锁定(颜色/尺寸/材质一致)
9. 天气/时间在同一场景内锁定

### 跨场景
10. 不同场景主动切换光影体系
11. 跨场切回时恢复原光影

### 生成后自检清单(6项)
光影style/colorTemp/quality → 服装描述 → 道具颜色/材质 → sceneDescription复用 → 不一致立即修正

## 关键功能
- LLM导演系统提示词(专业级, 含风格指导+分镜铁律+视觉描述规范+摄影参数枚举+连续性自检)
- 参考图智能匹配(matchRefImagesToShot: 双向模糊匹配, 最多3张/镜)
- 参考图base64直传(无需ImgBB公网图床)
- 降级提取(extractShotsFromText: LLM返回非JSON时正则提取)
- 超长剧本自动截断(30000字)
- JSON解析多次尝试(tryParseJson→修复逗号/控制字符→降级)
- 前端ShotCard编辑模式: 摄影参数(9个select下拉框) + 灯光参数(5个select下拉框)
- 前端ShotCard展示模式: 摄影参数青色徽章行 + 灯光参数金色徽章行
- 向前兼容: 旧版字符串lighting自动升级为对象, 旧版camera缺少新字段默认空

## 已知待完善
- [ ] StoryboardPanel 中文UI仍有乱码需修复
- [ ] 分镜编辑增强: 一键复制prompt、预览大图、查看生成prompt
- [ ] 任务历史入口: 调用 /api/storyboard/list
- [ ] 与VideoGenerate打通(分镜图→视频片段)
- [ ] 与3D预演打通: 分镜结构化摄影参数→3D预演AI导演自动构图
- [ ] LLM分镜需输出更多字段: narrativeBeat, visualGoal, location, props, colorPalette, continuityNotes, imagePrompt, negativePrompt (model已支持)
- [ ] 资产库(assets): 角色/场景/道具的LLM提取+结构化存储 (model已支持)

## 与3D预演打通方案
Storyboard每个shot可以关联3D预演项目:
```
shot.previz = { projectId, firstFrameUrl, lastFrameUrl, cameraPath, actors, props, exportedAt }
```
链路: 剧本→AI分镜(含结构化摄影参数)→3D预演AI导演自动构图→首尾帧→AI关键帧生成

## 桥接参数映射
```
Storyboard camera.focalLength=50mm  → 3D预演 camera fov=40, position=[0,1.8,-5]
Storyboard camera.composition="三分法" → 3D预演 showGuides=true
Storyboard lighting.keyDirection="右前45°" → 3D预演 主光位置 [5,8,5]
Storyboard camera.shotSize="中景" → 3D预演 演员距离镜头 ~5m
Storyboard camera.aperture="f/2.8" → 3D预演 景深提示(浅景深)
```
