---
name: project-overview
description: Enbon AI 设计工作台 — 完整的项目架构、技术栈、服务端口和模块清单
metadata:
  type: project
---

# Enbon AI 设计工作台

## 技术栈
- **前端**: React 19 + Vite 7, 纯 CSS (App.css ~5000行), 无路由库, 状态驱动导航
- **后端**: Express.js (端口3007), JSON 文件持久化 (server/cache/), Sequelize 适配层
- **3D**: Three.js 0.184 + @react-three/fiber 9 + @react-three/drei 10
- **AI**: GRSai API (生图), DeepSeek API (LLM), Seedance/Agnes (视频)

## 启动方式
```bash
# 后端 (端口3007)
cd server && node server.js

# 前端 (端口3005)
cd client && npx vite --host --port 3005
```

## 模块清单
| 模块 | 入口 | 状态 |
|------|------|------|
| AI 图片生成 | ImageFreePanel.jsx | 稳定 |
| AI 视频生成 | VideoGenerate.jsx | 可用但未与 Storyboard 打通 |
| Suno AI音乐 | MusicGenerate.jsx | 稳定 |
| AI 智能对话 | AIDialogPanel.jsx | 稳定 |
| AI 工作流 | WorkflowPanel.jsx | 视频节点需等完善 |
| AI 视频自动化 | StoryboardPanel.jsx | 基础功能完成, 需完善 |
| 3D 预演导演 | DirectorPreviz.jsx | v0.3: 分段假人+姿势+录制+时间线 |
| 系统设置 | SettingsPanel.jsx | 密码 enbon123 |

## 关键配置
- GRSai API Key: 已配置 (sk-bd37...)
- DeepSeek API Key: 已配置
- ImgBB API Key: 未配置 (参考图用 base64 直传)
- 设置面板密码: enbon123
