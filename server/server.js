const http = require('http');
const { app, initDatabase } = require('./app');
const logger = require('./utils/logger');
const { initWebSocket } = require('./utils/websocket');

const PORT = process.env.PORT || 3007;

let server = null;

// 优雅关闭
function gracefulShutdown(signal) {
  logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

  if (server) {
    server.close(() => {
      logger.info('HTTP服务器已关闭');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('强制关闭服务器（超时）');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

// 监听关闭信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  logger.error('未捕获的异常', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝', { reason: String(reason) });
});

async function start() {
  try {
    await initDatabase();

    server = http.createServer(app);

    // 初始化 WebSocket
    initWebSocket(server);

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    server.listen(PORT, () => {
      logger.info(`AIHub服务器启动成功，监听端口: ${PORT}`, {
        env: process.env.NODE_ENV || 'development',
        pid: process.pid,
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`端口 ${PORT} 已被占用`);
      } else {
        logger.error('服务器错误', { error: err.message });
      }
      process.exit(1);
    });
  } catch (err) {
    logger.error('服务器启动失败', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();
