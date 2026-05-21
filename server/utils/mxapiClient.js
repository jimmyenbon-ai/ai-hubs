const axios = require('axios');
const logger = require('./logger');
const { appConfig } = require('./appConfig');

const API_URL =
  process.env.MX_API_URL ||
  'https://open.mxapi.org/api/v1/images/gemini3pro/v2';
const MXAPI_TIMEOUT_MS = Number(process.env.MXAPI_TIMEOUT_MS || 30 * 60 * 1000);

function getApiKey() { return appConfig.mx_api_key || process.env.API_KEY || '' }

async function generateImage({
  prompt,
  imageSize,
  aspectRatio,
  referenceImages,
}) {
  const apiKey = getApiKey()
  if (!apiKey) {
    const err = new Error('未配置 MXAPI 密钥（请在设置面板中配置）');
    err.status = 500;
    throw err;
  }

  const payload = {
    prompt,
    image_size: imageSize,
    aspect_ratio: aspectRatio,
    // MXAPI 要求的必填字段，用于控制是否流式返回，这里统一用非流式
    stream: false,
  };

  if (referenceImages && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'X-Channel': 'premium',
  };

  let data;

  logger.info('正在请求 MXAPI 生成图片', { url: API_URL, timeoutMs: MXAPI_TIMEOUT_MS });

  try {
    const resp = await axios.post(API_URL, payload, {
      headers,
      timeout: MXAPI_TIMEOUT_MS,
    });
    data = resp.data;
    logger.info('MXAPI 请求成功', { hasData: !!data });
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') {
      console.log('MXAPI response structure:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    logger.error('MXAPI 请求异常', {
      code: err.code,
      status: err.response?.status,
      message: err.message,
    });
    // eslint-disable-next-line no-console
    console.error(
      'MXAPI request error:',
      err.response?.status,
      err.response?.data || err.message,
      err.code || '',
    );

    // 处理超时（axios 超时时为 ECONNABORTED）
    if (err.code === 'ECONNABORTED') {
      const wrapped = new Error(
        `第三方 API 响应超时（${Math.round(MXAPI_TIMEOUT_MS / 60000)} 分钟内未返回），请稍后重试。可在 .env 中设置 MXAPI_TIMEOUT_MS 调整超时时间`,
      );
      wrapped.status = 504;
      throw wrapped;
    }

    // 处理网络连接错误
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      const wrapped = new Error(
        `第三方API连接失败：${err.code === 'ECONNRESET' ? '连接被重置' : err.code === 'ETIMEDOUT' ? '连接超时' : '连接被拒绝'}，请检查网络或 MXAPI 服务状态后重试`,
      );
      wrapped.status = 502;
      throw wrapped;
    }

    // 处理HTTP响应错误
    const apiData = err.response?.data;
    const apiMessage =
      (apiData && (apiData.message || apiData.msg)) || err.message;

    const wrapped = new Error(
      `MXAPI 调用失败：${apiMessage}${
        apiData ? ` | 详细信息：${JSON.stringify(apiData)}` : ''
      }`,
    );
    wrapped.status = err.response?.status || 502;
    throw wrapped;
  }
  let imageUrl;

  // 解析响应

  // 如果返回的是纯字符串URL（直接是图片地址）
  if (typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))) {
    imageUrl = data;
  } else if (data && typeof data === 'object') {
    // 优先检查 data.data.url（实际API返回的结构：{ code: 200, message: "success", data: { url: "..." } }）
    if (data.data && typeof data.data === 'object' && data.data.url) {
      const urlValue = typeof data.data.url === 'string' ? data.data.url : String(data.data.url);
      if (urlValue.startsWith('http://') || urlValue.startsWith('https://')) {
        imageUrl = urlValue;
      }
    }
    // 检查根级别的 url 字段（备用结构：{ code: 200, message: "success", url: "..." }）
    if (!imageUrl && data.url) {
      const urlValue = typeof data.url === 'string' ? data.url : String(data.url);
      if (urlValue.startsWith('http://') || urlValue.startsWith('https://')) {
        imageUrl = urlValue;
      }
    }
    // 结构1: data.data[0].images[0].url
    if (!imageUrl && Array.isArray(data.data) && data.data[0]) {
      const first = data.data[0];
      if (Array.isArray(first.images) && first.images[0]) {
        const img = first.images[0];
        if (img.url && typeof img.url === 'string') {
          imageUrl = img.url;
        } else if (img.image_url && typeof img.image_url === 'string') {
          imageUrl = img.image_url;
        }
      }
      // 结构2: data.data[0].url (直接是url)
      if (!imageUrl && first.url && typeof first.url === 'string') {
        imageUrl = first.url;
      }
    }
    // 结构3: data.images[0].url
    if (!imageUrl && Array.isArray(data.images) && data.images[0]) {
      const img = data.images[0];
      if (img.url && typeof img.url === 'string') {
        imageUrl = img.url;
      } else if (img.image_url && typeof img.image_url === 'string') {
        imageUrl = img.image_url;
      }
    }
    // 结构4: data.image_url
    if (!imageUrl && data.image_url && typeof data.image_url === 'string' && (data.image_url.startsWith('http://') || data.image_url.startsWith('https://'))) {
      imageUrl = data.image_url;
    }
    // 结构5: data.data 可能是字符串URL
    if (!imageUrl && typeof data.data === 'string' && (data.data.startsWith('http://') || data.data.startsWith('https://'))) {
      imageUrl = data.data;
    }
  }

  if (!imageUrl) {
    const responseStr = JSON.stringify(data, null, 2)
    const err = new Error('MXAPI 未能解析出图片地址，请检查接口响应格式');
    err.status = 502;
    throw err;
  }

  // 确保返回的是有效的URL字符串
  if (typeof imageUrl !== 'string' || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
    const err = new Error('MXAPI 返回的图片地址格式不正确');
    err.status = 502;
    throw err;
  }

  // 可选：尝试下载图片验证（如果需要代理或验证）
  // 如果下载超时或失败，降级返回上游 URL
  const shouldDownloadImage = process.env.MXAPI_DOWNLOAD_IMAGE === 'true';

  if (shouldDownloadImage) {
    try {
      await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: (status) => status === 200,
      });
      logger.debug('MXAPI 图片下载验证成功', { imageUrl });
    } catch (downloadErr) {
      const errorDetails = downloadErr.message ||
        (downloadErr.code ? `${downloadErr.code}` : '') ||
        (downloadErr.type ? `${downloadErr.type}` : '') ||
        String(downloadErr);
      logger.warn('MXAPI 图片下载验证失败，降级返回上游 URL', { imageUrl, error: errorDetails });
    }
  }

  return imageUrl;
}

module.exports = {
  generateImage,
};

