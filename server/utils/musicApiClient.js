const axios = require('axios');
const logger = require('./logger');
const { appConfig } = require('./appConfig');

const API_URL = process.env.MUSIC_API_URL || 'https://open.mxapi.org/api/v1/music/generate';

function getApiKey() {
  return appConfig.music_api_key || appConfig.mx_api_key || process.env.MUSIC_API_KEY || process.env.API_KEY || '';
}

async function generateMusic({
  model,
  mv,
  title,
  make_instrumental,
  gpt_description_prompt,
  prompt,
  tags,
  negative_tags,
  task,
  continue_clip_id,
  continue_at,
  cover_clip_id,
  metadata,
}) {
  const apiKey = getApiKey()
  if (!apiKey) {
    const err = new Error('未配置音乐API密钥（MUSIC_API_KEY 或 MX_API_KEY 或 API_KEY）');
    err.status = 500;
    throw err;
  }

  const resolvedMv = mv || model;
  const payload = {
    // 上游接口可能要求字段名为 mv（model version），这里同时发送 mv/model 做兼容
    mv: resolvedMv,
    model: resolvedMv,
    title,
    make_instrumental: make_instrumental || false,
    metadata: metadata || {},
  };

  if (gpt_description_prompt) {
    payload.gpt_description_prompt = gpt_description_prompt;
  }
  if (prompt) {
    payload.prompt = prompt;
  }
  if (tags) {
    payload.tags = tags;
  }
  if (negative_tags) {
    payload.negative_tags = negative_tags;
  }
  if (task) {
    payload.task = task;
  }
  if (continue_clip_id) {
    payload.continue_clip_id = continue_clip_id;
  }
  if (continue_at !== undefined && continue_at !== null) {
    payload.continue_at = Number(continue_at);
  }
  if (cover_clip_id) {
    payload.cover_clip_id = cover_clip_id;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let data;

  try {
    logger.info('Music API request payload (sanitized)', {
      mv: payload.mv,
      model: payload.model,
      title: payload.title,
      make_instrumental: payload.make_instrumental,
      has_prompt: Boolean(payload.prompt),
      has_gpt_description_prompt: Boolean(payload.gpt_description_prompt),
      has_tags: Boolean(payload.tags),
      has_negative_tags: Boolean(payload.negative_tags),
      task: payload.task,
      api_url: API_URL,
    });
    const resp = await axios.post(API_URL, payload, {
      headers,
      timeout: 30 * 60 * 1000, // 30分钟超时
    });
    data = resp.data;
    logger.info('Music API response', { status: resp.status, data });
  } catch (err) {
    logger.error('Music API request error', {
      status: err.response?.status,
      data: err.response?.data || err.message,
      code: err.code || '',
      mv: payload.mv,
      model: payload.model,
      title: payload.title,
    });

    // 兼容：部分上游（常见为 PHP）只解析表单 POST，不解析 JSON，会报 “Undefined array key 'mv'”
    // 这里检测到该类错误后，自动改用 x-www-form-urlencoded 重试一次。
    const apiDataMaybe = err.response?.data;
    const apiDataText =
      typeof apiDataMaybe === 'string'
        ? apiDataMaybe
        : apiDataMaybe
          ? JSON.stringify(apiDataMaybe)
          : '';

    const shouldRetryAsForm =
      (err.response?.status === 500 || err.response?.status === 400) &&
      /Undefined array key\s+["']mv["']/.test(apiDataText);

    if (shouldRetryAsForm) {
      try {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(payload)) {
          if (v === undefined || v === null) continue;
          if (k === 'metadata' && typeof v === 'object') {
            form.append(k, JSON.stringify(v));
          } else {
            form.append(k, String(v));
          }
        }

        const resp2 = await axios.post(API_URL, form.toString(), {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30 * 60 * 1000, // 30分钟超时
        });
        data = resp2.data;
        logger.info('Music API response (form retry)', { status: resp2.status, data });
      } catch (err2) {
        logger.error('Music API form retry error', {
          status: err2.response?.status,
          data: err2.response?.data || err2.message,
          code: err2.code || '',
          mv: payload.mv,
          model: payload.model,
          title: payload.title,
        });
        err = err2;
      }
    }

    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      const wrapped = new Error(
        `第三方API连接失败：${err.code === 'ECONNRESET' ? '连接被重置' : err.code === 'ETIMEDOUT' ? '连接超时' : '连接被拒绝'}，请稍后重试`,
      );
      wrapped.status = 502;
      throw wrapped;
    }

    const apiData = err.response?.data;
    const apiMessage =
      (apiData && (apiData.message || apiData.msg)) || err.message;

    const wrapped = new Error(
      `音乐API调用失败：${apiMessage}${
        apiData ? ` | 详细信息：${JSON.stringify(apiData)}` : ''
      }`,
    );
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }

  // 根据API文档，返回格式为 { code: 200, success: true, message: "请求成功", data: ["123456", "123457"] }
  if (data && data.success && Array.isArray(data.data)) {
    return data.data;
  }

  // 兼容其他可能的返回格式
  if (data && Array.isArray(data.data)) {
    return data.data;
  }

  if (data && Array.isArray(data)) {
    return data;
  }

  console.error('Music API response data:', JSON.stringify(data, null, 2));
  const err = new Error('第三方接口未返回任务ID，请检查API响应格式');
  err.status = 502;
  throw err;
}

async function queryMusicTask(taskId) {
  const apiKey = getApiKey()
  if (!apiKey) {
    const err = new Error('未配置音乐API密钥');
    err.status = 500;
    throw err;
  }

  const baseQueryUrl = process.env.MUSIC_QUERY_API_URL || 'https://open.mxapi.org/api/v1/music/query-task';
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const requestConfig = { headers, timeout: 30000 };

  // 很多音乐查询接口使用 GET + 路径中的 task_id，先尝试 GET
  const getUrl = `${baseQueryUrl.replace(/\/$/, '')}/${taskId}`;

  const tryRequest = async (method, url, body) => {
    if (method === 'GET') {
      return axios.get(url, requestConfig);
    }
    return axios.post(url, body || { task_id: taskId }, requestConfig);
  };

  let lastErr;
  for (const [method, url, body] of [
    ['GET', getUrl, null],
    ['POST', baseQueryUrl, { task_id: taskId }],
  ]) {
    try {
      const resp = await tryRequest(method, url, body);
      const data = resp.data;
      logger.info('Music query API response', {
        taskId,
        method,
        status: resp.status,
        hasData: !!data,
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        dataDataType: data && data.data !== undefined ? typeof data.data : 'n/a',
      });
      return data;
    } catch (err) {
      lastErr = err;
      // 404 = 任务未就绪，返回 pending 让前端继续轮询
      if (err?.response?.status === 404) {
        return {
          success: true,
          pending: true,
          message: '任务处理中',
          data: null,
          _upstreamStatus: 404,
        };
      }
      // 405 Method Not Allowed 则尝试下一种方式（404 已在上面 return）
      if (err?.response?.status === 405) {
        continue;
      }
      logger.warn('Music query attempt failed', {
        taskId,
        method,
        status: err?.response?.status,
        message: err?.message,
      });
    }
  }

  console.error('Query music task error:', lastErr?.response?.data || lastErr?.message);
  const apiData = lastErr?.response?.data;
  const apiMessage = (apiData && (apiData.message || apiData.msg)) || lastErr?.message;
  const wrapped = new Error(`查询音乐任务失败：${apiMessage}`);
  wrapped.status = lastErr?.response?.status || 502;
  throw wrapped;
}

module.exports = {
  generateMusic,
  queryMusicTask,
};
