# AI Hub 生产环境部署指南

## 📋 目录
1. [服务器要求](#服务器要求)
2. [环境配置](#环境配置)
3. [依赖安装](#依赖安装)
4. [性能优化配置](#性能优化配置)
5. [部署步骤](#部署步骤)
6. [监控和维护](#监控和维护)
7. [安全建议](#安全建议)
8. [扩展性建议](#扩展性建议)

## 🖥️ 服务器要求

### 最低配置
- **CPU**: 2核心
- **内存**: 4GB RAM
- **存储**: 50GB SSD
- **带宽**: 10Mbps

### 推荐配置（支持1000+并发用户）
- **CPU**: 4核心+
- **内存**: 8GB+ RAM
- **存储**: 100GB+ SSD
- **带宽**: 100Mbps+

### 操作系统
- Ubuntu 20.04+ / CentOS 7+ / Debian 10+
- Node.js 18+ LTS
- Nginx（反向代理）

## ⚙️ 环境配置

### 1. 创建 `.env` 文件

```bash
# 服务器配置
NODE_ENV=production
PORT=5000

# MXAPI配置
MX_API_KEY=your_api_key_here
MX_API_URL=https://open.mxapi.org/api/v1/images/gemini3pro/v2

# 文件上传配置
UPLOAD_DIR=uploads
MAX_FILE_SIZE=10485760  # 10MB

# 缓存配置（可选，如果使用Redis）
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# 日志级别
LOG_LEVEL=info
```

### 2. 安装系统依赖

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y nodejs npm nginx redis-server

# CentOS/RHEL
sudo yum install -y nodejs npm nginx redis
```

## 📦 依赖安装

### 1. 安装项目依赖

```bash
# 安装服务器依赖
cd server
npm install --production

# 安装客户端依赖并构建
cd ../client
npm install
npm run build
```

### 2. 安装PM2（进程管理）

```bash
npm install -g pm2
```

### 3. 安装必要的npm包

确保以下包已安装：
- `express-rate-limit` - API限流
- `compression` - 请求压缩
- `helmet` - 安全头设置

```bash
cd server
npm install express-rate-limit compression helmet
```

## 🚀 性能优化配置

### 1. 启用PM2集群模式

```bash
# 启动应用（自动使用所有CPU核心）
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs ai-hub-server

# 保存PM2配置（开机自启）
pm2 save
pm2 startup
```

### 2. Nginx反向代理配置

创建 `/etc/nginx/sites-available/ai-hub`:

```nginx
upstream ai_hub_backend {
    least_conn;  # 使用最少连接负载均衡
    server localhost:5000;
    server localhost:5001;  # 如果有多个实例
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    # 重定向到HTTPS（推荐）
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL证书配置（使用Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 客户端最大上传大小
    client_max_body_size 10M;

    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 静态文件缓存
    location / {
        proxy_pass http://ai_hub_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 1800s;  # 图像生成可能需要30分钟
    }

    # 静态资源直接服务（如果前端构建后放在nginx）
    location /static {
        alias /path/to/client/dist;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 上传文件直接服务
    location /uploads {
        alias /path/to/server/uploads;
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/ai-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Redis缓存（可选，推荐）

如果用户量大，建议使用Redis替代内存缓存：

```bash
# 安装Redis
sudo apt-get install redis-server

# 启动Redis
sudo systemctl start redis
sudo systemctl enable redis

# 修改 server/utils/cache.js 使用Redis客户端
```

### 4. 数据库优化

当前使用JSON文件存储，如果数据量大，建议迁移到PostgreSQL或MySQL：

```bash
# PostgreSQL示例
npm install pg pg-hstore
```

## 📝 部署步骤

### 1. 克隆代码并安装依赖

```bash
git clone <your-repo-url>
cd ai-hub
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入实际配置
```

### 3. 构建前端

```bash
cd client
npm run build
```

### 4. 启动服务

```bash
# 使用PM2启动
pm2 start ecosystem.config.js --env production

# 或直接启动（不推荐生产环境）
cd server
NODE_ENV=production node server.js
```

### 5. 配置防火墙

```bash
# 只开放必要端口
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

## 📊 监控和维护

### 1. PM2监控

```bash
# 实时监控
pm2 monit

# 查看详细信息
pm2 show ai-hub-server

# 重启应用
pm2 restart ai-hub-server

# 查看日志
pm2 logs ai-hub-server --lines 100
```

### 2. 系统监控

```bash
# 安装监控工具（可选）
npm install -g pm2-logrotate
pm2 install pm2-logrotate

# 配置日志轮转
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 3. 健康检查

访问 `https://your-domain.com/api/health` 查看服务状态

### 4. 日志管理

- 应用日志: `server/logs/app.log`
- 错误日志: `server/logs/error.log`
- PM2日志: `logs/pm2-*.log`

定期清理旧日志：
```bash
# 使用logrotate（推荐）
sudo nano /etc/logrotate.d/ai-hub
```

## 🔒 安全建议

### 1. SSL/TLS证书

使用Let's Encrypt免费证书：
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 2. API密钥安全

- 永远不要将API密钥提交到Git
- 使用环境变量存储敏感信息
- 定期轮换API密钥

### 3. 限流保护

已实现API限流：
- 通用API: 100次/分钟
- 图像生成: 5次/分钟
- 积分查询: 20次/分钟
- 文件上传: 10次/分钟

可根据实际情况调整 `server/middleware/rateLimiter.js`

### 4. 防火墙规则

```bash
# 限制SSH访问（可选）
sudo ufw limit 22/tcp
```

### 5. 定期更新

```bash
# 更新系统包
sudo apt-get update && sudo apt-get upgrade

# 更新Node.js依赖
npm audit fix
```

## 📈 扩展性建议

### 1. 水平扩展

- 使用负载均衡器（Nginx/HAProxy）
- 多服务器部署
- 使用CDN加速静态资源

### 2. 数据库扩展

- 从JSON文件迁移到PostgreSQL/MySQL
- 使用数据库连接池
- 添加读写分离（如果使用关系数据库）

### 3. 缓存优化

- 使用Redis集群
- CDN缓存图片资源
- 浏览器缓存优化

### 4. 图片存储优化

- 使用对象存储（OSS/S3）
- 图片压缩和格式优化（WebP）
- CDN加速图片访问

### 5. 监控和告警

- 集成监控系统（Prometheus + Grafana）
- 设置告警规则（CPU、内存、错误率）
- 日志聚合（ELK Stack）

## 🎯 性能指标

### 目标指标
- **响应时间**: API响应 < 200ms（缓存命中）
- **并发能力**: 支持1000+并发用户
- **可用性**: 99.9%+ 正常运行时间
- **错误率**: < 0.1%

### 监控指标
- CPU使用率 < 70%
- 内存使用率 < 80%
- 磁盘I/O正常
- 网络带宽充足

## 📞 故障排查

### 常见问题

1. **服务无法启动**
   ```bash
   # 检查端口占用
   sudo lsof -i :5000
   
   # 查看PM2日志
   pm2 logs ai-hub-server --err
   ```

2. **内存泄漏**
   ```bash
   # 查看内存使用
   pm2 monit
   
   # 重启服务
   pm2 restart ai-hub-server
   ```

3. **API限流触发**
   - 检查 `server/middleware/rateLimiter.js` 配置
   - 根据实际需求调整限流阈值

4. **图片生成超时**
   - 检查MXAPI服务状态
   - 查看网络连接
   - 调整超时时间（当前30分钟）

## 📚 相关资源

- [PM2文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx配置指南](https://nginx.org/en/docs/)
- [Node.js生产环境最佳实践](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)

---

**注意**: 这是基础的生产环境配置。根据实际业务需求，可能需要进一步优化和调整。
