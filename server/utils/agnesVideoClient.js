const axios = require('axios');
const logger = require('./logger');
const { appConfig } = require('./appConfig');

function getApiUrl() {
  return appConfig.agnes_api_url || 'https://apihub.agnes-ai.com/v1/videos';
}

function getApiKey() {
  return appConfig.agnes_api_key || '';
}

async function createAgnesVideoTask(params) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 AGNES_API_KEY，请在设置中填写');
    err.status = 500;
    throw err;
  }

  const { model, prompt, image, mode, height, width, num_frames, frame_rate, num_inference_steps, seed, negative_prompt, extra_body } = params;

  const payload = { model: model || 'agnes-video-v2.0', prompt };
  if (image) payload.image = image;
  if (mode) payload.mode = mode;
  if (height) payload.height = height;
  if (width) payload.width = width;
  if (num_frames) payload.num_frames = num_frames;
  if (frame_rate) payload.frame_rate = frame_rate;
  if (num_inference_steps) payload.num_inference_steps = num_inference_steps;
  if (seed !== undefined && seed != null) payload.seed = seed;
  if (negative_prompt && negative_prompt.trim()) payload.negative_prompt = negative_prompt;
  if (extra_body) payload.extra_body = extra_body;

  const headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };

  try {
    logger.info('Agnes API create task request', { model: payload.model, promptLength: payload.prompt?.length, hasImage: !!payload.image, api_url: getApiUrl() });
    const resp = await axios.post(getApiUrl(), payload, { headers, timeout: 60000 });
    const data = resp.data;
    logger.info('Agnes API create task response', { status: resp.status, taskId: data.id, taskStatus: data.status });
    if (data && data.id) {
      return { taskId: data.id, model: data.model, status: data.status || 'queued', created_at: data.created_at };
    }
    const e = new Error('Agnes Video API未返回任务ID');
    e.status = 502;
    throw e;
  } catch (err) {
    logger.error('Agnes API create task error', { status: err.response?.status, data: err.response?.data || err.message, code: err.code || '', model: params.model });
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      const wrapped = new Error('Agnes API连接失败：' + (err.code === 'ECONNRESET' ? '连接被重置' : err.code === 'ETIMEDOUT' ? '连接超时' : '连接被拒绝') + '，请稍后重试');
      wrapped.status = 502;
      throw wrapped;
    }
    const apiData = err.response?.data;
    let errorMessage = err.message;
    if (apiData) {
      if (apiData.message) errorMessage = apiData.message;
      else if (apiData.error) errorMessage = typeof apiData.error === 'string' ? apiData.error : apiData.error.message || JSON.stringify(apiData.error);
    }
    const wrapped = new Error('Agnes视频生成API调用失败：' + errorMessage);
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

async function queryAgnesVideoTask(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 AGNES_API_KEY，请在设置中填写');
    err.status = 500;
    throw err;
  }
  const queryUrl = getApiUrl() + '/' + taskId;
  const headers = { 'Authorization': 'Bearer ' + apiKey };
  try {
    logger.info('Agnes API query task request', { taskId });
    const resp = await axios.get(queryUrl, { headers, timeout: 30000 });
    const data = resp.data;
    // 调试：记录完整响应
    logger.info('Agnes API query full response', { taskId, fullData: JSON.stringify(data) });
    logger.info('Agnes API query task response', { taskId, status: data.status, hasVideoUrl: !!data.video_url, videoUrl: data.video_url || data.url || data.output || 'none' });
    
    // 尝试多种可能的字段名
    const videoUrl = data.video_url || data.url || data.output || data.result_url || data.download_url || data.remixed_from_video_id || null;
    
    return {
      id: data.id, model: data.model, status: data.status, error: data.error,
      progress: data.progress, video_url: videoUrl,
      size: data.size || data.resolution, seconds: data.seconds || data.duration,
      created_at: data.created_at, completed_at: data.completed_at, usage: data.usage,
    };
  } catch (err) {
    logger.error('Agnes API query task error', { taskId, status: err.response?.status, data: err.response?.data || err.message, code: err.code || '' });
    if (err.response?.status === 404) {
      const wrapped = new Error('任务不存在或已过期');
      wrapped.status = 404;
      throw wrapped;
    }
    const wrapped = new Error('Agnes查询视频任务失败：' + (err.response?.data?.message || err.message));
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

module.exports = { createAgnesVideoTask, queryAgnesVideoTask };
