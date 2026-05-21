const axios = require('axios')
const logger = require('./logger')
const { appConfig } = require('./appConfig')

const GRSAI_TIMEOUT_MS = Number(process.env.GRSAI_TIMEOUT_MS || 10 * 60 * 1000)

function getApiHost() { return appConfig.grsai_api_host || 'https://grsai.dakka.com.cn' }
function getApiKey() { return appConfig.grsai_api_key || '' }

// 支持的 Nano Banana 模型列表
const SUPPORTED_NANO_MODELS = [
  'nano-banana',
  'nano-banana-fast',
  'nano-banana-2',
  'nano-banana-2-cl',
  'nano-banana-2-4k-cl',
  'nano-banana-pro',
  'nano-banana-pro-cl',
  'nano-banana-pro-vip',
  'nano-banana-pro-4k-vip',
]

// GPT-Image2 模型
const GPT_IMAGE_2_MODEL = 'gpt-image-2'
const GPT_IMAGE_2_VIP_MODEL = 'gpt-image-2-vip'

// GPT-Image2 VIP 分辨率像素映射（1K / 2K / 4K）
// 来源：grsai 最新 API 文档
const VIP_SIZE_MAP = {
  '1K': {
    '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280',
    '4:3': '1152x864', '3:4': '864x1152', '3:2': '1536x1024',
    '2:3': '1024x1536', '5:4': '1120x896', '4:5': '896x1120',
    '21:9': '1456x624', '9:21': '624x1456', '1:3': '688x2048',
    '3:1': '2048x688', '2:1': '1536x768', '1:2': '768x1536',
  },
  '2K': {
    '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '1152x2048',
    '4:3': '2304x1728', '3:4': '1728x2304', '3:2': '2048x1360',
    '2:3': '1360x2048', '5:4': '2240x1792', '4:5': '1792x2240',
    '21:9': '2912x1248', '9:21': '1248x2912', '1:3': '1280x3840',
    '3:1': '3840x1280', '2:1': '3072x1536', '1:2': '1536x3072',
  },
  '4K': {
    '1:1': '2880x2880', '16:9': '3840x2160', '9:16': '2160x3840',
    '4:3': '3264x2448', '3:4': '2448x3264', '3:2': '3504x2336',
    '2:3': '2336x3504', '5:4': '3200x2560', '4:5': '2560x3200',
    '21:9': '3840x1648', '9:21': '1648x3840', '1:3': '1280x3840',
    '3:1': '3840x1280', '2:1': '3840x1920', '1:2': '1920x3840',
  },
}

// Nano Banana 部分模型限定分辨率
const NANO_2K_ONLY = ['nano-banana-2-cl', 'nano-banana-pro-vip']
const NANO_4K_ONLY = ['nano-banana-2-4k-cl', 'nano-banana-pro-4k-vip']

async function generateImage({
  prompt,
  model = 'gpt-image-2',
  imageSize = '1K',
  aspectRatio = '1:1',
  referenceImages,
}) {
  const apiKey = getApiKey()
  if (!apiKey) {
    const err = new Error('未配置 GRSai API 密钥（请在设置面板中配置）')
    err.status = 500
    throw err
  }

  const isGptImage2 = model === GPT_IMAGE_2_MODEL || model === GPT_IMAGE_2_VIP_MODEL
  const isNanoBanana = SUPPORTED_NANO_MODELS.includes(model)
  const isGptImage2Vip = model === GPT_IMAGE_2_VIP_MODEL

  if (!isGptImage2 && !isNanoBanana) {
    const err = new Error(`不支持的模型: ${model}`)
    err.status = 400
    throw err
  }

  // 构造请求体（v1/api/generate 格式）
  const payload = {
    model,
    prompt,
    replyType: 'json',
  }

  // aspectRatio 处理
  if (isGptImage2Vip) {
    // gpt-image-2-vip：只接受像素值，不支持比例字符串
    const sizeMap = VIP_SIZE_MAP[imageSize] || VIP_SIZE_MAP['1K']
    payload.aspectRatio = sizeMap[aspectRatio] || sizeMap['1:1']
  } else if (isGptImage2) {
    // gpt-image-2：支持比例字符串或像素值，直接传即可
    payload.aspectRatio = aspectRatio || '1:1'
  }

  // Nano Banana 分辨率
  if (isNanoBanana) {
    let size = imageSize || '1K'
    if (NANO_2K_ONLY.includes(model) && size !== '2K') size = '2K'
    if (NANO_4K_ONLY.includes(model)) size = '4K'
    payload.imageSize = size
  }

  // 参考图（新字段名 images）
  if (referenceImages && referenceImages.length > 0) {
    payload.images = referenceImages
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  logger.info('请求 GRSai API 生成图片', { url: `${getApiHost()}/v1/api/generate`, model, payload })

  try {
    const resp = await axios.post(`${getApiHost()}/v1/api/generate`, payload, {
      headers,
      timeout: GRSAI_TIMEOUT_MS,
    })

    const result = resp.data
    logger.info('GRSai API 响应', {
      id: result.id,
      status: result.status,
      hasResults: !!result.results,
    })

    // 任务失败处理
    if (result.status === 'failed') {
      const errorMsg = result.error || '未知错误'
      const friendlyMsg = errorMsg.includes('moderation')
        ? '图片内容未通过审核，请尝试修改提示词后重试'
        : `生成失败：${errorMsg}`
      const err = new Error(friendlyMsg)
      err.status = 422
      throw err
    }

    // 提取图片 URL：results[0].url
    let imageUrl = null
    if (result.results && Array.isArray(result.results) && result.results[0]?.url) {
      imageUrl = result.results[0].url
    }

    if (!imageUrl) {
      logger.error('GRSai API 未返回图片地址', { responsePreview: JSON.stringify(result).slice(0, 500) })
      const err = new Error('GRSai API 未返回图片地址')
      err.status = 502
      throw err
    }

    return imageUrl
  } catch (err) {
    // 不二次包装已处理过的错误
    if (err.status === 422 || err.status === 502) throw err

    logger.error('GRSai API 请求异常', {
      code: err.code,
      status: err.response?.status,
      message: err.message,
    })

    if (err.code === 'ECONNABORTED') {
      const wrapped = new Error(`GRSai API 响应超时（${Math.round(GRSAI_TIMEOUT_MS / 60000)} 分钟），请稍后重试`)
      wrapped.status = 504
      throw wrapped
    }

    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      const label = err.code === 'ECONNRESET' ? '连接被重置' : err.code === 'ETIMEDOUT' ? '连接超时' : '连接被拒绝'
      const wrapped = new Error(`第三方API连接失败：${label}`)
      wrapped.status = 502
      throw wrapped
    }

    const apiData = err.response?.data
    const apiMessage = (apiData && (apiData.message || apiData.msg || apiData.error)) || err.message
    const wrapped = new Error(`GRSai API 调用失败：${apiMessage}`)
    wrapped.status = err.response?.status || 502
    throw wrapped
  }
}

// 查询异步任务结果
async function queryResult(taskId) {
  const apiKey2 = getApiKey()
  if (!apiKey2) {
    const err = new Error('未配置 GRSai API 密钥')
    err.status = 500
    throw err
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey2}`,
  }

  try {
    const resp = await axios.post(`${getApiHost()}/v1/draw/result`, { id: taskId }, { headers, timeout: 30000 })
    const data = resp.data
    if (data.code !== 0) {
      const err = new Error(data.msg || '查询失败')
      err.status = 400
      throw err
    }
    return data.data
  } catch (err) {
    if (err.response?.status === 404) {
      const wrapped = new Error('任务不存在或已过期')
      wrapped.status = 404
      throw wrapped
    }
    throw err
  }
}

// GPT-Image2 支持的 aspectRatio 选项
const GPT_ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '21:9', label: '21:9 宽屏' },
  { value: '9:21', label: '9:21 超竖' },
  { value: '2:1', label: '2:1 横超宽' },
  { value: '1:2', label: '1:2 竖超窄' },
  { value: '3:1', label: '3:1 全景' },
  { value: '1:3', label: '1:3 超竖' },
]

// 支持的模型列表（供前端展示）
const ALL_MODELS = [
  { value: 'gpt-image-2', label: 'GPT-Image 2', category: 'gpt' },
  { value: 'gpt-image-2-vip', label: 'GPT-Image 2 VIP', category: 'gpt' },
  { value: 'nano-banana', label: 'Nano Banana', category: 'nano' },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast', category: 'nano' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', category: 'nano' },
  { value: 'nano-banana-2-cl', label: 'Nano Banana 2 CL (2K)', category: 'nano' },
  { value: 'nano-banana-2-4k-cl', label: 'Nano Banana 2 4K CL', category: 'nano' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', category: 'nano' },
  { value: 'nano-banana-pro-cl', label: 'Nano Banana Pro CL (2K)', category: 'nano' },
  { value: 'nano-banana-pro-vip', label: 'Nano Banana Pro VIP (2K)', category: 'nano' },
  { value: 'nano-banana-pro-4k-vip', label: 'Nano Banana Pro 4K VIP', category: 'nano' },
]

module.exports = {
  generateImage,
  queryResult,
  SUPPORTED_NANO_MODELS,
  GPT_IMAGE_2_MODEL,
  GPT_IMAGE_2_VIP_MODEL,
  GPT_ASPECT_RATIOS,
  ALL_MODELS,
}
