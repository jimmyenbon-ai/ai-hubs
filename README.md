# AI Hub - AI 创作平台

[English](README_en.md) | 简体中文

<div align="center">

![AI Hub Logo](https://img.shields.io/badge/AI%20Hub-Creator%20Platform-6C5CE7?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)
![Express](https://img.shields.io/badge/Express-5-Gray?style=for-the-badge&logo=express)

**一个功能强大的 AI 创作平台，支持图像生成和音乐创作**

</div>

---

## 功能特性

### Nano Banana Pro 图像生成
- 支持多种 AI 图像生成模型
- 可调节图像尺寸（1K / 2K / 4K）
- 多种画幅比例支持（1:1 / 16:9 / 9:16 / 4:3 / 3:2 / 21:9）
- 参考图上传与 @引用功能
- 实时生成进度显示
- 生成历史记录管理

### Suno AI 音乐生成
- 灵感模式（AI 辅助歌词生成）
- 自定义模式（完全控制歌词内容）
- 多种音乐风格标签
- 高级参数控制（人声音色、风格权重等）
- 支持纯音乐生成
- 延长和翻唱功能
- 实时轮询任务状态
- 内置音频播放器

### 通用功能
- 积分余额查询
- 响应式设计
- 多图床自动上传（0x0.st / Telegraph / Uguu.se / ImgBB）
- API 限流保护
- 内存缓存系统
- 优雅关闭机制
- PM2 进程管理支持

---

## 项目结构

```
ai-hub/
├── client/                    # 前端应用 (React + Vite)
│   ├── src/
│   │   ├── App.jsx           # 主应用组件（图像生成）
│   │   ├── App.css           # 应用样式
│   │   └── MusicGenerate.jsx # 音乐生成组件
│   ├── package.json
│   └── vite.config.js
│
├── server/                    # 后端服务 (Express)
│   ├── app.js                # Express 应用配置
│   ├── server.js             # HTTP 服务器入口
│   ├── controllers/           # 控制器
│   │   ├── generateController.js    # 图像生成
│   │   ├── musicController.js       # 音乐生成
│   │   ├── musicHistoryController.js # 音乐历史
│   │   ├── historyController.js     # 历史记录
│   │   └── pointsController.js     # 积分查询
│   ├── routes/               # 路由
│   │   ├── generateRoutes.js
│   │   ├── musicRoutes.js
│   │   ├── musicHistoryRoutes.js
│   │   ├── historyRoutes.js
│   │   ├── pointsRoutes.js
│   │   └── uploadRoutes.js
│   ├── models/               # 数据模型
│   │   └── index.js          # Generation & MusicGeneration
│   ├── middleware/            # 中间件
│   │   ├── rateLimiter.js    # API 限流
│   │   ├── errorHandler.js    # 错误处理
│   │   └── uploadConfig.js    # 文件上传配置
│   ├── utils/                # 工具函数
│   │   ├── mxapiClient.js    # MXAPI 图像接口
│   │   ├── musicApiClient.js # Suno 音乐接口
│   │   ├── imageUtils.js     # 图片处理（多图床上传）
│   │   ├── cache.js          # 内存缓存
│   │   └── logger.js         # 日志系统
│   ├── uploads/              # 上传文件目录
│   ├── cache/                # 缓存文件目录
│   ├── logs/                 # 日志文件目录
│   ├── package.json
│   └── .env                  # 环境变量（不提交）
│
├── ecosystem.config.js       # PM2 配置文件
├── start-ai-hub.bat          # Windows 快速启动脚本
├── QUICK_START.md            # 快速开始指南
├── PRODUCTION.md             # 生产环境部署指南
└── OPTIMIZATION_SUMMARY.md  # 性能优化总结
```

---

## 技术栈

### 前端
- **React 19** - UI 框架
- **Vite 7** - 构建工具
- **CSS3** - 样式（原生 CSS，无框架）

### 后端
- **Express 5** - Web 框架
- **Sequelize** - ORM（SQLite 数据库）
- **Multer** - 文件上传
- **Axios** - HTTP 客户端

### 第三方 API
- **MXAPI (open.mxapi.org)** - AI 图像生成
- **Suno AI** - AI 音乐生成

### DevOps
- **PM2** - 进程管理器
- **Helmet** - 安全头
- **Compression** - 响应压缩
- **Express Rate Limit** - API 限流

---

## 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd ai-hub
```

### 2. 安装依赖

```bash
# 安装服务器依赖
cd server
npm install

# 安装客户端依赖
cd ../client
npm install

# 返回根目录
cd ..
```

### 3. 配置环境变量

在 `server/` 目录下创建 `.env` 文件：

```env
# 服务器配置
NODE_ENV=development
PORT=3007

# MXAPI 配置（必需）
MX_API_KEY=your_api_key_here
MX_API_URL=https://open.mxapi.org/api/v1/images/gemini3pro/v2

# 音乐 API 配置（使用相同密钥时可选）
# MUSIC_API_KEY=your_music_api_key_here
# MUSIC_API_URL=https://open.mxapi.org/api/v1/music/generate
# MUSIC_QUERY_API_URL=https://open.mxapi.org/api/v1/music/query-task

# 文件上传配置（可选）
UPLOAD_DIR=uploads
MAX_FILE_SIZE=10485760

# 参考图上传配置（可选）
REF_IMAGE_UPLOAD_METHOD=auto
REF_IMAGE_UPLOAD_TIMEOUT_MS=120000

# ImgBB 备用图床（可选）
# IMGBB_API_KEY=your_imgbb_api_key
```

### 4. 启动服务

#### 开发环境（推荐）

使用项目提供的启动脚本（Windows）：

```bash
start-ai-hub.bat
```

或手动启动：

```bash
# 终端 1：启动后端服务
cd server
npm run dev

# 终端 2：启动前端服务
cd client
npm run dev
```

#### 生产环境

```bash
# 安装 PM2（如果未安装）
npm install -g pm2

# 使用 PM2 启动
pm2 start ecosystem.config.js --env production

# 保存 PM2 配置（开机自启）
pm2 save
pm2 startup
```

### 5. 访问应用

- **前端**: http://localhost:3005
- **后端 API**: http://localhost:3007
- **健康检查**: http://localhost:3007/api/health

---

## API 文档

### 图像生成

#### POST /api/generate

生成 AI 图像

**请求体：**
```json
{
  "originalPrompt": "原始提示词",
  "apiPrompt": "处理后的提示词",
  "imageSize": "1K",
  "aspectRatio": "1:1",
  "referenceImages": ["https://example.com/ref.jpg"]
}
```

**响应：**
```json
{
  "success": true,
  "message": "生成成功",
  "data": {
    "id": 1,
    "imageUrl": "https://example.com/generated.png"
  }
}
```

### 音乐生成

#### POST /api/music/generate

生成 AI 音乐

**请求体：**
```json
{
  "mv": "chirp-bluejay",
  "title": "歌曲标题",
  "gpt_description_prompt": "AI 灵感模式描述",
  "prompt": "自定义歌词",
  "tags": "pop, rock",
  "make_instrumental": false,
  "metadata": {
    "vocal_gender": "f",
    "control_sliders": {
      "style_weight": 0.87,
      "weirdness_constraint": 0.75
    }
  }
}
```

**响应：**
```json
{
  "success": true,
  "message": "生成成功",
  "data": ["task_id_1", "task_id_2"]
}
```

#### GET /api/music/query/:taskId

查询音乐生成任务状态

### 积分查询

#### GET /api/points/balance

查询账户积分余额

**响应：**
```json
{
  "success": true,
  "data": 1200,
  "cached": false
}
```

### 历史记录

#### GET /api/history

获取图像生成历史

#### DELETE /api/history/:id

删除指定历史记录

#### GET /api/music/history

获取音乐生成历史

#### DELETE /api/music/history/:id

删除指定音乐历史记录

---

## 配置说明

### 图像尺寸选项

| 值 | 说明 |
|---|---|
| 1K | 1024x1024（默认）|
| 2K | 2048x2048 |
| 4K | 4096x4096 |

### 画幅比例

| 值 | 说明 |
|---|---|
| 1:1 | 正方形 |
| 16:9 | 宽屏 |
| 9:16 | 竖屏 |
| 4:3 | 经典比例 |
| 3:2 | 照片比例 |
| 21:9 | 超宽屏 |

### 音乐模型版本

| 值 | 说明 |
|---|---|
| chirp-v3-0 | Chirp V3.0 |
| chirp-v3-5 | Chirp V3.5 |
| chirp-v4 | Chirp V4 |
| chirp-bluejay | Chirp V5（推荐）|
| chirp-auk | Chirp V5 Auk |
| chirp-auk-turbo | Chirp V5 Auk Turbo |
| chirp-crow | Chirp V5 Crow |

### API 限流配置

| 路由 | 限制 |
|---|---|
| 通用 API | 100 次/分钟 |
| 图像生成 | 5 次/分钟 |
| 音乐生成 | 5 次/分钟 |
| 积分查询 | 20 次/分钟 |
| 文件上传 | 10 次/分钟 |

---

## 部署指南

### Docker 部署

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3007
CMD ["node", "server/server.js"]
```

### Nginx 反向代理配置

```nginx
upstream ai_hub_backend {
    server localhost:3007;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10M;

    gzip on;
    gzip_types text/plain application/json application/javascript;

    location / {
        proxy_pass http://ai_hub_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

详细部署指南请参考 [PRODUCTION.md](./PRODUCTION.md)

---

## 性能优化

项目已实现以下优化：

- ✅ **API 限流** - 防止滥用和 DDoS
- ✅ **内存缓存** - 减少重复请求
- ✅ **响应压缩** - 减少传输大小
- ✅ **安全头** - 生产环境启用 Helmet
- ✅ **优雅关闭** - 处理进程终止信号
- ✅ **健康检查** - 监控服务状态
- ✅ **PM2 集群** - 多核 CPU 利用

详细优化信息请参考 [OPTIMIZATION_SUMMARY.md](./OPTIMIZATION_SUMMARY.md)

---

## 常见问题

### Q: 端口被占用怎么办？

```bash
# Windows
netstat -ano | findstr :3007

# 修改 .env 中的 PORT 值
PORT=3008
```

### Q: 参考图上传失败？

1. 检查网络能否访问图床
2. 尝试设置 `REF_IMAGE_UPLOAD_METHOD=curl`
3. 调大超时：`REF_IMAGE_UPLOAD_TIMEOUT_MS=300000`
4. 配置 ImgBB 作为备用图床

### Q: 音乐生成超时？

1. Suno 音乐生成通常需要 3-5 分钟
2. 检查 API 密钥是否有效
3. 查看服务器日志了解详情

### Q: 如何查看日志？

```bash
# PM2 日志
pm2 logs ai-hub-server

# 应用日志
tail -f server/logs/app.log
tail -f server/logs/error.log
```

---

## 开发指南

### 添加新的 API 接口

1. 在 `controllers/` 创建控制器
2. 在 `routes/` 创建路由
3. 在 `app.js` 中注册路由
4. 添加限流中间件（如需要）

### 添加新的 AI 模型

1. 修改前端模型选择器
2. 更新后端 API 调用逻辑
3. 添加相应的错误处理

---

## 许可证

ISC License

---

## 致谢

- [MXAPI](https://open.mxapi.org) - AI 图像生成服务
- [Suno AI](https://suno.ai) - AI 音乐生成服务
- [Express](https://expressjs.com) - Web 框架
- [React](https://react.dev) - UI 框架
- [Vite](https://vitejs.dev) - 构建工具

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star ⭐**

</div>
