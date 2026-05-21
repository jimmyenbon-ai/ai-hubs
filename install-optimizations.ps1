# AI Hub 性能优化依赖安装脚本
# 使用方法: .\install-optimizations.ps1

Write-Host "开始安装性能优化依赖..." -ForegroundColor Green

# 进入server目录
Set-Location server

# 安装依赖
Write-Host "正在安装 express-rate-limit..." -ForegroundColor Yellow
npm install express-rate-limit

Write-Host "正在安装 compression..." -ForegroundColor Yellow
npm install compression

Write-Host "正在安装 helmet..." -ForegroundColor Yellow
npm install helmet

Write-Host "`n依赖安装完成！" -ForegroundColor Green
Write-Host "现在可以启动服务了：" -ForegroundColor Cyan
Write-Host "  cd server" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host "`n或使用PM2启动生产环境：" -ForegroundColor Cyan
Write-Host "  pm2 start ecosystem.config.js --env production" -ForegroundColor Cyan

Set-Location ..
