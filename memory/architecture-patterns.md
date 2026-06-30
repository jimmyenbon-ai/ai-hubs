---
name: architecture-patterns
description: 项目代码模式 — 导航、状态管理、后端API、组件模式的约定
metadata:
  type: reference
---

# 项目代码模式和约定

## 前端

### 导航
- 无路由库, 纯 state 驱动: `showWorkflow`, `showStoryboard`, `showPreviz` 等 boolean
- Sidebar 通过 `onOpen*` props 回调触发
- App.jsx 中条件渲染, 优先级: showPreviz > showStoryboard > showWorkflow > 其它

### 状态管理
- 无 Redux/Zustand, 所有状态在 App.jsx 顶层 useState
- 通过 props 向下传递
- 组件内部状态用本地 useState + useRef

### 组件模式
- 面板组件: config-panel(固定宽) + results-panel(flex:1) 横向布局
- 全页组件: 占满 workspace, 有自己的内部布局
- 步骤状态机: step state + switch/case 渲染不同步骤

### CSS
- 单一 App.css, ~5000行
- CSS 变量主题: data-theme="dark/light/gray/blue"
- 组件样式用前缀命名: .previz-*, .storyboard-*, .aidp-*

## 后端

### 路由模式
- app.js 集中挂载所有路由: app.use('/api/xxx', xxxRoutes)
- 每个模块独立 routes + controllers + services + models

### Controller 模式
- async (req, res, next) 签名
- 响应: { success: boolean, data?: any, message?: string }
- 错误: next(err) 交给 errorHandler 中间件

### Model 模式 (JSON 文件持久化)
- 内存数组 memoryStore + 延迟加载 loadFromDisk + 原子写入 tmp+rename
- API: create/findByPk/findAll/updateById/destroy
- 文件位置: server/cache/*.json

### Service 模式
- 纯业务逻辑, 不处理 HTTP
- 可被 controller 和 workflow 复用

## 3D 预演

### 组件拆分
- DirectorPreviz.jsx: 编排器, 管理所有状态
- ControlPanel.jsx: Tab式面板
- PrevizCanvas.jsx: 3D 场景组件(forwardRef 暴露 ref)
- TimelinePanel.jsx: 时间线, 通过 onMoveKeyframe 回写父组件
- TransformGizmo.jsx: drei TransformControls 封装

### 关键模式
- ActorModel: forwardRef + userData.joint 标记
- 录制: useRef 避免闭包旧值
- 播放: useTimelinePlayback hook 做插值
- 放置: GroundClickHandler 用 Raycaster 检测地面
