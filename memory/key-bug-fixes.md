---
name: key-bug-fixes
description: 已修复的关键 Bug — 根因和修复方式
metadata:
  type: reference
---

# 关键 Bug 修复记录

## 1. GRSai 生图全部失败 — Parameter data type error
- **根因**: images 参数传了 `[{url, name}]` 对象数组，GRSai 需要 `array[string]` (纯URL字符串)
- **修复**: 在 storyboardService.processJob 中转为 `refUrlsForApi: ["url1", "url2"]`
- **文件**: storyboardService.js

## 2. 参考图本地路径 GRSai 无法访问
- **根因**: 参考图存为 `/uploads/...`，GRSai 无法访问 localhost
- **修复**: 本地路径自动转 base64 data URI 传给 GRSai
- **文件**: storyboardService.js, storyboardController.js

## 3. uploadLocalImageToPublicUrl is not a function
- **根因**: imageUtils.js 中函数存在但未在 module.exports 中导出
- **修复**: 添加到 exports
- **文件**: imageUtils.js

## 4. 录制闭包旧值 (P0)
- **根因**: setInterval 里的 addKeyframeNow 捕获的是旧闭包中的 currentTime/actors/cameras
- **修复**: 用 useRef 保存最新值，addKeyframeNow 从 refs 读取
- **文件**: DirectorPreviz.jsx

## 5. 肢体关节选不中 (P0)
- **根因**: JointBox 没有设置 userData.joint，children.find 找不到
- **修复**: 给每个关节 group 设置 userData.joint，用 findJointRef 递归查找
- **文件**: PrevizCanvas.jsx, DirectorPreviz.jsx

## 6. 时间线拖动不回写父组件 (P0)
- **根因**: TimelinePanel 内部 tracksInner 状态，拖动后未通知父组件
- **修复**: 添加 onMoveKeyframe 回调，拖动结束后回写父组件 tracks
- **文件**: TimelinePanel.jsx, DirectorPreviz.jsx

## 7. CSS 布局时间线跑到右侧 (P0)
- **根因**: previz-panel 使用 display:flex，三个子元素横向排列
- **修复**: 改为 display:grid, grid-template-rows: 1fr 180px, 时间线固定底部
- **文件**: App.css

## 8. 摄影机 FOV 被全局覆盖 (P0)
- **根因**: PrevizScene 总是用 cameraFov 覆盖每台 camera 的 fov
- **修复**: 优先使用 cam.fov (可被时间线关键帧更新)，fallback 到 cameraFov
- **文件**: DirectorPreviz.jsx

## 9. allRefUrls 未定义 (storyboardController)
- **根因**: handleRetry 中引用了不存在的 allRefUrls 变量
- **修复**: DeepSeek/linter 已修复为 refsForGeneration 和 refUrlsForApi
- **文件**: storyboardController.js
