@echo off
REM AI Hub 性能优化依赖安装脚本
REM 使用方法: install-optimizations.bat

echo 开始安装性能优化依赖...

REM 进入server目录
cd server

REM 安装依赖
echo 正在安装 express-rate-limit...
call npm install express-rate-limit

echo 正在安装 compression...
call npm install compression

echo 正在安装 helmet...
call npm install helmet

echo.
echo 依赖安装完成！
echo 现在可以启动服务了：
echo   cd server
echo   npm run dev
echo.
echo 或使用PM2启动生产环境：
echo   pm2 start ecosystem.config.js --env production

cd ..

pause
