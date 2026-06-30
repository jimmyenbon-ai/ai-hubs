# 🚀 AI Hub 快速启动指南

## 📦 安装依赖

### 1. 安装服务器依赖

```bash
cd server
npm install express-rate-limit compression helmet
```

### 2. 验证安装

```bash
# 检查依赖是否安装成功
npm list express-rate-limit compression helmet
```

## ⚙️ 配置环境变量

创建或更新 `server/.env` 文件：

```env
NODE_ENV=production
PORT=5000
MX_API_KEY=your_api_key_here
```

## 🎯 启动服务

### 开发环境

```bash
cd server
npm run dev
```

### 生产环境（使用PM2）

```bash
# 安装PM2（如果未安装）
npm install -g pm2

# 启动服务
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs ai-hub-server
```

## ✅ 验证优化

### 1. 检查健康状态

访问: `http://localhost:5000/api/health`

应该返回：
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-...",
  "uptime": 123.45,
  "memory": {
    "used": 50,
    "total": 100,
    "rss": 150
  },
  "env": "production"
}
```

### 2. 测试缓存

多次访问积分查询接口，第二次应该返回 `"cached": true`

### 3. 测试限流

快速连续请求图像生成接口，超过5次/分钟应该返回限流错误

## 📊 性能监控

### PM2监控

```bash
# 实时监控
pm2 monit

# 查看详细信息
pm2 show ai-hub-server
```

### 日志查看

```bash
# 应用日志
tail -f server/logs/app.log

# 错误日志
tail -f server/logs/error.log

# PM2日志
pm2 logs ai-hub-server
```

## 🔧 常见问题

### 1. 端口被占用

```bash
# 检查端口占用
lsof -i :5000  # Linux/Mac
netstat -ano | findstr :5000  # Windows

# 修改端口（在.env文件中）
PORT=5001
```

### 2. 依赖安装失败

```bash
# 清除缓存重新安装
rm -rf node_modules package-lock.json
npm install
```

### 3. PM2启动失败

```bash
# 检查PM2配置
pm2 list
pm2 delete ai-hub-server  # 删除旧实例
pm2 start ecosystem.config.js --env production
```

## 📚 下一步

- 查看 [PRODUCTION.md](./PRODUCTION.md) 了解完整部署指南
- 查看 [OPTIMIZATION_SUMMARY.md](./OPTIMIZATION_SUMMARY.md) 了解优化详情
