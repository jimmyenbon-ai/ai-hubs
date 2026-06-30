#!/bin/bash
# AI Hub 性能优化依赖安装脚本
# 使用方法: chmod +x install-optimizations.sh && ./install-optimizations.sh

echo "开始安装性能优化依赖..."

# 进入server目录
cd server

# 安装依赖
echo "正在安装 express-rate-limit..."
npm install express-rate-limit

echo "正在安装 compression..."
npm install compression

echo "正在安装 helmet..."
npm install helmet

echo ""
echo "依赖安装完成！"
echo "现在可以启动服务了："
echo "  cd server"
echo "  npm run dev"
echo ""
echo "或使用PM2启动生产环境："
echo "  pm2 start ecosystem.config.js --env production"

cd ..
