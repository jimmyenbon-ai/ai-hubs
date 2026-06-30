---
name: 3d-previz-director
description: 3D 预演导演模块 — v0.4 完整状态，含 AI 自然语言驱动功能
metadata:
  type: project
---

# 3D 预演导演 (AI Short Film Previz Director)

## 当前版本: v0.4

## 文件结构
```
client/src/
├── DirectorPreviz.jsx                    # 主编排器(状态管理+录制+播放+AI导演)
└── components/previz/
    ├── PrevizCanvas.jsx                  # 3D场景: ActorModel(11关节分段假人)+PropModel+MovieCameraRig+SceneSetup
    ├── ControlPanel.jsx                  # 导演控制台: 录制栏+变换模式W/E/R+角色/道具/摄影机/AI/导出Tab+姿势预设
    ├── TimelinePanel.jsx                 # 时间线: 轨道+关键帧拖动+播放头
    ├── TransformGizmo.jsx                # drei TransformControls 封装(移动W/旋转E/缩放R)
    ├── useTimelinePlayback.js            # 关键帧插值播放hook(位置+旋转+姿势+摄影机FOV)
    ├── CameraPathTools.js                # CatmullRomCurve3 运镜曲线+5种模式+手持抖动
    ├── ExportPanel.jsx                   # 导出: 截图+WebM录制+深度图/骨骼线/遮罩(像素处理)
    ├── ExportRenderers.js                # ShaderMaterial: 深度图/骨骼线/遮罩 正确实现
    ├── ProjectManager.jsx                # 项目存取弹窗(连接 /api/previz/projects)
    └── PrevizCommandExecutor.js          # 🆕 AI命令执行器: 18种命令类型→现有handler映射

server/
├── models/previzModel.js                # PrevizProject JSON持久化
├── routes/previzRoutes.js               # CRUD API (已存在)
├── routes/previzDirectorRoutes.js       # 🆕 AI导演路由: POST /api/previz/direct, /direct-stream
├── controllers/previzDirectorController.js  # 🆕 AI导演请求处理器
└── services/previzDirectorService.js    # 🆕 核心AI服务: 系统提示词+LLM调用+命令验证
```

## 核心功能状态
- ✅ 分段假人(头/脊柱/左右上下臂/左右上下腿, 11个独立关节)
- ✅ 姿势预设(站立/坐下/躺下/挥手/指向/低头/蹲下)
- ✅ 关节选择+旋转(Tab切换, userData.joint 标记, findJointRef 递归查找)
- ✅ 动作录制(⏺ 自动每0.5s抓取pose/position/rotation, 用refs避免闭包旧值)
- ✅ 关键帧插值播放(pose lerp3 + position lerp3 + rotation lerp3)
- ✅ 时间线关键帧拖动(onMoveKeyframe 回写父组件)
- ✅ 踩地(Y=0强制) + 道具默认高度表
- ✅ 电影摄影机(rotation/lookAt/FOV, 预览窗右下角360x202)
- ✅ CSS Grid布局(左侧300px / 中间画布 / 底部180px时间线)
- ✅ 道具库25种(box/cylinder/platform/wall + indoor/scifi/city)
- ✅ 变换模式W/E/R
- ✅ 点击地面放置道具(Raycaster)
- ✅ 项目保存/加载 JSON
- ✅ ControlPanel 5个Tab: 角色/道具/摄影机/AI/导出

### 🆕 AI 自然语言导演 (v0.4)
- ✅ ControlPanel 新增 "AI" Tab
- ✅ 文本输入框 + 6个快速模板(客厅对话/舞台演出/办公室/科幻走廊/卧室/产品展示)
- ✅ 发送指令 → POST /api/previz/direct → DeepSeek LLM → 结构化命令 → 自动执行
- ✅ 18种命令类型: create_actor/prop/camera, move_*, apply_pose, delete_*, configure_camera, set_aspect_ratio, focus_camera_on_actor, reset_scene, clear_*
- ✅ 指令历史(最近20条，可点击重放)
- ✅ 撤销AI操作(操作前自动保存快照)
- ✅ 后端命令白名单校验(防止LLM幻觉数据污染状态)
- ✅ 前端命令执行器(纯函数，通过回调间接调用，不直接操作React state)

### AI导演数据流
```
用户中文指令 → POST /api/previz/direct
→ previzDirectorService.buildSystemPrompt() → llmService.complete() → DeepSeek
→ extractJsonFromLLMResponse() → validateCommands()
→ { commands: [...], explanation }
→ PrevizCommandExecutor.applyCommands(commands, callbacks)
→ 现有 handler 函数 → React setState → 场景更新
```

## 已修复的 P0 问题(来自2.txt审查)
1. CSS布局: flex→grid, 时间线固定在底部
2. 电影机预览: 不再用全局cameraFov覆盖, 优先用cam.fov
3. 肢体关节: userData.joint + findJointRef递归查找
4. 录制闭包: useRef保存最新actors/cameras/currentTime
5. 时间线拖动: onMoveKeyframe回写父组件tracks
6. 摄影机rotation/lookAt: MovieCameraRig应用rotation+lookAt
7. 道具几何体: 补全25种道具boxGeometry尺寸
8. 摄影机FOV播放: 关键帧fov更新的cam.fov被用而非全局cameraFov

## 待完善
- [ ] 摄影机路径编辑器UI(控制点拖拽)
- [ ] 运镜模式实时渲染(跟拍/环绕/无人机)
- [ ] 灯光面板UI+预设
- [ ] 场景模板(一键房间/飞船走廊)
- [ ] glTF/GLB 骨骼模型加载
- [ ] 动作库保存/加载
- [ ] shader导出接入Canvas渲染管线(当前ExportRenderers已写但未接入)
- [ ] 与AI视频自动化打通: 分镜摄影参数→3D预演自动构图
- [ ] AI Tab: 多轮对话支持(LLM记住之前的操作)
- [ ] AI Tab: SSE流式响应(实时显示AI思考进度)
