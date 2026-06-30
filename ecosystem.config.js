// PM2 生产环境配置文件
// 使用方法: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'ai-hub-server',
      script: './server/server.js',
      instances: 'max', // 使用所有CPU核心
      exec_mode: 'cluster', // 集群模式
      env: {
        NODE_ENV: 'development',
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      // 日志配置
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // 自动重启配置
      autorestart: true,
      watch: false, // 生产环境关闭文件监听
      max_memory_restart: '1G', // 内存超过1G自动重启
      
      // 进程管理
      min_uptime: '10s', // 最小运行时间
      max_restarts: 10, // 最大重启次数
      restart_delay: 4000, // 重启延迟
      
      // 优雅关闭
      kill_timeout: 5000, // 等待关闭的时间
      listen_timeout: 10000, // 监听超时
      
      // 监控
      pmx: true,
    },
  ],
};
