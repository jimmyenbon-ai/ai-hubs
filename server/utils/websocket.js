// WebSocket 实时推送模块
// 任务完成时主动推送到前端，减少轮询
let wss = null;
const clients = new Set();

function initWebSocket(server) {
  try {
    const { WebSocketServer } = require('ws');
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
      clients.add(ws);
      console.log('[ws] Client connected, total:', clients.size);

      ws.on('close', () => {
        clients.delete(ws);
        console.log('[ws] Client disconnected, total:', clients.size);
      });

      ws.on('error', () => {
        clients.delete(ws);
      });

      // 发送连接成功消息
      ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
    });

    console.log('[ws] WebSocket server initialized at /ws');
  } catch (err) {
    console.warn('[ws] WebSocket not available:', err.message);
  }
}

/**
 * 广播消息到所有连接的客户端
 * @param {object} payload - 推送数据 { type, taskId, ... }
 */
function broadcast(payload) {
  if (!wss || clients.size === 0) return;
  const msg = JSON.stringify(payload);
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // OPEN
      try { ws.send(msg); } catch (_) {}
    }
  });
}

/**
 * 推送任务完成事件
 */
function notifyTaskComplete({ category, taskId, recordId, status, resultUrl, error }) {
  broadcast({
    type: 'task_complete',
    category, // 'image' | 'music' | 'video'
    taskId: String(taskId),
    recordId,
    status,
    resultUrl,
    error,
    ts: Date.now(),
  });
}

/**
 * 推送任务状态更新
 */
function notifyTaskUpdate({ category, taskId, status, progress }) {
  broadcast({
    type: 'task_update',
    category,
    taskId: String(taskId),
    status,
    progress,
    ts: Date.now(),
  });
}

/**
 * 推送工作流执行步骤更新
 */
function notifyWorkflowStep({ runId, nodeId, nodeName, nodeType, status, step, totalSteps, output, error, duration }) {
  broadcast({
    type: 'workflow_step',
    runId,
    nodeId,
    nodeName,
    nodeType,
    status,       // 'running' | 'completed' | 'failed'
    step,         // 当前第几步（从1开始）
    totalSteps,   // 总步骤数
    output,
    error,
    duration,
    ts: Date.now(),
  });
}

module.exports = {
  initWebSocket,
  broadcast,
  notifyTaskComplete,
  notifyTaskUpdate,
  notifyWorkflowStep,
};
