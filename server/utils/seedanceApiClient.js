const axios = require('axios');
const logger = require('./logger');
const { appConfig } = require('./appConfig');

function getApiUrl() {
  return appConfig.seedance_api_url || 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
}

function getApiKey() {
  return appConfig.seedance_api_key || '';
}

/**
 * 创建视频生成任务
 * @param {Object} params - 视频生成参数
 * @param {string} params.model - 模型ID，如 doubao-seedance-2-0-260128
 * @param {Array} params.content - 内容数组，支持 text/image_url/video_url/audio_url
 * @param {string} [params.callback_url] - 回调URL（可选）
 * @param {boolean} [params.return_last_frame] - 是否返回尾帧
 * @param {string} [params.service_tier] - 服务等级：default/flex
 * @param {number} [params.execution_expires_after] - 超时时间（秒）
 * @param {boolean} [params.generate_audio] - 是否生成音频
 * @param {string} [params.resolution] - 分辨率：480p/720p/1080p
 * @param {string} [params.ratio] - 宽高比：16:9/4:3/1:1/3:4/9:16/21:9/adaptive
 * @param {number} [params.duration] - 时长（秒）
 * @param {number} [params.seed] - 种子整数
 * @param {boolean} [params.camera_fixed] - 是否固定摄像头
 * @param {boolean} [params.watermark] - 是否带水印
 * @param {Array} [params.tools] - 工具配置，如 [{ type: 'web_search' }]
 * @param {string} [params.safety_identifier] - 用户唯一标识
 */
async function createVideoTask(params) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 SEEDANCE_API_KEY 环境变量');
    err.status = 500;
    throw err;
  }

  const {
    model,
    content,
    callback_url,
    return_last_frame,
    service_tier,
    execution_expires_after,
    generate_audio,
    resolution,
    ratio,
    duration,
    frames,
    seed,
    camera_fixed,
    watermark,
    tools,
    safety_identifier,
  } = params;

  // 构建请求体
  const payload = {
    model,
    content,
  };

  // 可选参数（仅添加有值的参数）
  if (callback_url) payload.callback_url = callback_url;
  if (return_last_frame !== undefined) payload.return_last_frame = return_last_frame;
  if (service_tier) payload.service_tier = service_tier;
  if (execution_expires_after) payload.execution_expires_after = execution_expires_after;
  if (generate_audio !== undefined) payload.generate_audio = generate_audio;
  if (resolution) payload.resolution = resolution;
  if (ratio) payload.ratio = ratio;
  if (duration !== undefined) payload.duration = duration;
  if (frames !== undefined) payload.frames = frames;
  if (seed !== undefined) payload.seed = seed;
  if (camera_fixed !== undefined) payload.camera_fixed = camera_fixed;
  if (watermark !== undefined) payload.watermark = watermark;
  if (tools) payload.tools = tools;
  if (safety_identifier) payload.safety_identifier = safety_identifier;

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const timeout = parseInt(process.env.SEEDANCE_API_TIMEOUT_MS || '600000', 10); // 默认10分钟

  try {
    logger.info('Seedance API create task request', {
      model: payload.model,
      contentTypes: payload.content?.map(c => c.type),
      callback_url: !!payload.callback_url,
      resolution: payload.resolution,
      ratio: payload.ratio,
      duration: payload.duration,
      api_url: getApiUrl(),
    });

    const resp = await axios.post(getApiUrl(), payload, {
      headers,
      timeout,
    });

    const data = resp.data;
    logger.info('Seedance API create task response', {
      status: resp.status,
      taskId: data.id,
    });

    // 返回任务ID
    if (data && data.id) {
      return {
        taskId: data.id,
        model: data.model,
        status: data.status,
        created_at: data.created_at,
      };
    }

    // 非标准响应格式
    const err = new Error('视频生成API未返回任务ID');
    err.status = 502;
    throw err;
  } catch (err) {
    logger.error('Seedance API create task error', {
      status: err.response?.status,
      data: err.response?.data || err.message,
      code: err.code || '',
      model: params.model,
    });

    // 网络错误处理
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      const wrapped = new Error(
        `第三方API连接失败：${err.code === 'ECONNRESET' ? '连接被重置' : err.code === 'ETIMEDOUT' ? '连接超时' : '连接被拒绝'}，请稍后重试`
      );
      wrapped.status = 502;
      throw wrapped;
    }

    // API错误处理
    const apiData = err.response?.data;
    let errorMessage = err.message;
    if (apiData) {
      if (apiData.message) {
        errorMessage = apiData.message;
      } else if (apiData.error) {
        errorMessage = typeof apiData.error === 'string' ? apiData.error : apiData.error.message || JSON.stringify(apiData.error);
      }
    }

    const wrapped = new Error(`视频生成API调用失败：${errorMessage}`);
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

/**
 * 查询视频生成任务状态
 * @param {string} taskId - 任务ID
 */
async function queryVideoTask(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 SEEDANCE_API_KEY 环境变量');
    err.status = 500;
    throw err;
  }

  const queryUrl = `${getApiUrl()}/${taskId}`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
  };

  try {
    logger.info('Seedance API query task request', { taskId, url: queryUrl });

    const resp = await axios.get(queryUrl, {
      headers,
      timeout: 30000,
    });

    const data = resp.data;
    logger.info('Seedance API query task response', {
      taskId,
      status: data.status,
      hasVideoUrl: !!(data.video_url || data.content?.video_url),
    });

    return {
      id: data.id,
      model: data.model,
      status: data.status,
      error: data.error,
      created_at: data.created_at,
      updated_at: data.updated_at,
      content: data.content,
      // 新版 API 在顶层返回 video_url / cover_image_url
      video_url: data.video_url || null,
      cover_image_url: data.cover_image_url || null,
      seed: data.seed,
      resolution: data.resolution,
      ratio: data.ratio,
      duration: data.duration,
      frames: data.frames,
      framespersecond: data.framespersecond,
      generate_audio: data.generate_audio,
      tools: data.tools,
      safety_identifier: data.safety_identifier,
      draft: data.draft,
      draft_task_id: data.draft_task_id,
      service_tier: data.service_tier,
      execution_expires_after: data.execution_expires_after,
      usage: data.usage,
    };
  } catch (err) {
    logger.error('Seedance API query task error', {
      taskId,
      status: err.response?.status,
      data: err.response?.data || err.message,
      code: err.code || '',
    });

    // 404 表示任务不存在或已过期
    if (err.response?.status === 404) {
      const wrapped = new Error('任务不存在或已过期');
      wrapped.status = 404;
      throw wrapped;
    }

    const wrapped = new Error(`查询视频任务失败：${err.response?.data?.message || err.message}`);
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

/**
 * 批量查询视频生成任务
 * @param {Object} filters - 查询过滤条件
 * @param {number} [filters.page_num] - 页码
 * @param {number} [filters.page_size] - 每页数量
 * @param {string} [filters.status] - 任务状态：queued/running/succeeded/failed/cancelled
 * @param {Array<string>} [filters.task_ids] - 任务ID列表
 * @param {string} [filters.model] - 模型ID
 * @param {string} [filters.service_tier] - 服务等级
 */
async function listVideoTasks(filters = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 SEEDANCE_API_KEY 环境变量');
    err.status = 500;
    throw err;
  }

  const { page_num = 1, page_size = 10, status, task_ids, model, service_tier } = filters;

  const params = new URLSearchParams();
  params.append('page_num', String(page_num));
  params.append('page_size', String(page_size));
  if (status) params.append('filter.status', status);
  if (task_ids && task_ids.length) {
    task_ids.forEach(id => params.append('filter.task_ids', id));
  }
  if (model) params.append('filter.model', model);
  if (service_tier) params.append('filter.service_tier', service_tier);

  const listUrl = `${getApiUrl()}?${params.toString()}`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
  };

  try {
    logger.info('Seedance API list tasks request', { filters });

    const resp = await axios.get(listUrl, {
      headers,
      timeout: 30000,
    });

    const data = resp.data;
    logger.info('Seedance API list tasks response', {
      total: data.total,
      itemsCount: data.items?.length || 0,
    });

    return {
      items: data.items || [],
      total: data.total || 0,
    };
  } catch (err) {
    logger.error('Seedance API list tasks error', {
      status: err.response?.status,
      data: err.response?.data || err.message,
      code: err.code || '',
    });

    const wrapped = new Error(`批量查询视频任务失败：${err.response?.data?.message || err.message}`);
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

/**
 * 取消或删除视频生成任务
 * @param {string} taskId - 任务ID
 */
async function deleteVideoTask(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('未配置 SEEDANCE_API_KEY 环境变量');
    err.status = 500;
    throw err;
  }

  const cancelUrl = `${getApiUrl()}/${taskId}/cancel`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    logger.info('Seedance API cancel task request', { taskId });

    await axios.post(cancelUrl, {}, {
      headers,
      timeout: 30000,
    });

    logger.info('Seedance API cancel task success', { taskId });
    return { success: true };
  } catch (err) {
    logger.error('Seedance API cancel task error', {
      taskId,
      status: err.response?.status,
      data: err.response?.data || err.message,
      code: err.code || '',
    });

    const wrapped = new Error(`取消视频任务失败：${err.response?.data?.message || err.message}`);
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
}

/**
 * 将本地图片URL转换为可用于API调用的格式
 * 支持：直接URL、Base64、素材ID(asset://xxx)
 * @param {string} imageUrl - 图片URL
 * @param {string} [role] - 图片角色：first_frame/last_frame/reference_image
 */
function formatImageUrl(imageUrl, role) {
  const result = {
    type: 'image_url',
    image_url: {
      url: imageUrl,
    },
  };
  if (role) {
    result.role = role;
  }
  return result;
}

/**
 * 创建文本内容对象
 * @param {string} text - 文本提示词
 */
function formatTextContent(text) {
  return {
    type: 'text',
    text: text,
  };
}

/**
 * 创建视频参考内容对象
 * @param {string} videoUrl - 视频URL
 * @param {string} [role] - 视频角色，默认 reference_video
 */
function formatVideoUrl(videoUrl, role = 'reference_video') {
  return {
    type: 'video_url',
    video_url: {
      url: videoUrl,
    },
    role,
  };
}

/**
 * 创建音频参考内容对象
 * @param {string} audioUrl - 音频URL
 * @param {string} [role] - 音频角色，默认 reference_audio
 */
function formatAudioUrl(audioUrl, role = 'reference_audio') {
  return {
    type: 'audio_url',
    audio_url: {
      url: audioUrl,
    },
    role,
  };
}

module.exports = {
  createVideoTask,
  queryVideoTask,
  listVideoTasks,
  deleteVideoTask,
  formatImageUrl,
  formatTextContent,
  formatVideoUrl,
  formatAudioUrl,
};
