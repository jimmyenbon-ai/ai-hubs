const { Generation } = require('../models')
const { generateImage: generateGrsImage } = require('../utils/grsaiClient')
const { generateImage: generateMxImage } = require('../utils/mxapiClient')
const { ensurePublicImageUrl } = require('../utils/imageUtils')
const { deductPoints, confirmDeduct } = require('../utils/pointsService')
const { appConfig } = require('../utils/appConfig')
const logger = require('../utils/logger')
const cache = require('../utils/cache')
const { saveImage: saveImageLocal, localPathToUrl } = require('../utils/localStorage')

// GRSai 支持的模型列表（用于判断是否走 GRSai）
const GRSAI_MODELS = [
  'gpt-image-2',
  'gpt-image-2-vip',
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

// 模型对应积分消耗
const MODEL_POINTS = {
  'gpt-image-2': 2,
  'gpt-image-2-vip': 5,
  'nano-banana': 1,
  'nano-banana-fast': 1,
  'nano-banana-2': 2,
  'nano-banana-2-cl': 2,
  'nano-banana-2-4k-cl': 4,
  'nano-banana-pro': 1,
  'nano-banana-pro-cl': 2,
  'nano-banana-pro-vip': 2,
  'nano-banana-pro-4k-vip': 4,
}

// POST /api/generate
// body: { originalPrompt, apiPrompt, model, aspectRatio, imageSize, quality, referenceImages }
async function handleGenerate(req, res, next) {
  const startMs = Date.now()
  let beforeBalance = null // 用于积分回滚
  let pointsCost = 1

  try {
    let {
      originalPrompt,
      apiPrompt,
      model,
      aspectRatio,
      imageSize,
      referenceImages,
      images,
    } = req.body || {}

    // 兼容旧字段名 referenceImages 和新字段名 images
    const rawRefs = referenceImages || images

    // 兼容工作流节点只传 prompt 的情况
    if ((!originalPrompt || !apiPrompt) && req.body.prompt) {
      originalPrompt = req.body.prompt
      apiPrompt = req.body.prompt
    }

    const selectedModel = model || 'gpt-image-2'
    pointsCost = MODEL_POINTS[selectedModel] || 1
    const isGrsaiModel = GRSAI_MODELS.includes(selectedModel)

    logger.info('收到图片生成请求', {
      originalPromptLength: originalPrompt?.length,
      apiPromptLength: apiPrompt?.length,
      refCount: (rawRefs || []).length,
      model: selectedModel,
      isGrsai: isGrsaiModel,
      aspectRatio,
      imageSize,
      apiPromptPreview: apiPrompt?.slice(0, 100),
    })

    if (!originalPrompt || !apiPrompt) {
      const err = new Error('缺少提示词（originalPrompt 或 apiPrompt）')
      err.status = 400
      throw err
    }

    // 积分扣减
    const deductResult = await deductPoints(pointsCost, `图片自由生成|模型:${selectedModel}`)
    if (!deductResult.success) {
      const err = new Error(deductResult.message)
      err.status = 402
      throw err
    }
    beforeBalance = deductResult.balance

    // 参考图处理：需要公网 URL
    const refs = Array.isArray(rawRefs) ? rawRefs : []
    const refErrors = []
    const validRefs = []

    for (const url of refs) {
      if (typeof url !== 'string' || !url.trim()) continue

      try {
        const publicUrl = await ensurePublicImageUrl(url)
        if (publicUrl) {
          validRefs.push(publicUrl)
        }
      } catch (e) {
        refErrors.push({ url, error: e?.message || String(e) })
      }
    }

    if (refs.length > 0 && refErrors.length > 0) {
      const err = new Error(
        `部分参考图上传失败，为保证效果已中止本次生成。` +
          `请检查网络是否能访问图床，或在 server 环境变量里配置 REF_IMAGE_UPLOAD_METHOD=curl（推荐在 .env 里设置），` +
          `并可通过 REF_IMAGE_UPLOAD_TIMEOUT_MS 调大超时时间（如 300000 = 5 分钟）。` +
          ` 首个失败原因：${refErrors[0]?.error || 'unknown'}`,
      )
      err.status = 400
      err.details = refErrors
      throw err
    }

    let imageUrl
    let apiProvider = 'grsai'

    // 统一使用 GRSai API（GPT-Image2 和 Nano Banana 都走这里）
    if (isGrsaiModel) {
      logger.info('开始调用 GRSai API 生成图片...', { model: selectedModel })
      try {
        imageUrl = await generateGrsImage({
          prompt: apiPrompt,
          model: selectedModel,
          aspectRatio,
          imageSize: imageSize || '1K',
          referenceImages: validRefs,
        })
      } catch (grsErr) {
        logger.warn('GRSai 生成失败，尝试 MXAPI 备用...', { error: grsErr.message })
        // 备用：MXAPI
        if (appConfig.mx_api_key) {
          try {
            imageUrl = await generateMxImage({
              prompt: apiPrompt,
              imageSize: imageSize || '1K',
              aspectRatio,
              referenceImages: validRefs,
            })
            apiProvider = 'mxapi'
            logger.info('MXAPI 备用生成成功')
          } catch (mxErr) {
            logger.error('MXAPI 备用也失败', { error: mxErr.message })
            throw new Error(`GRSai 失败（${grsErr.message}），MXAPI 备用也失败（${mxErr.message}）`)
          }
        } else {
          throw new Error(`GRSai 生成失败：${grsErr.message}`)
        }
      }
    } else {
      const err = new Error(`不支持的模型: ${selectedModel}，支持的模型: ${GRSAI_MODELS.join(', ')}`)
      err.status = 400
      throw err
    }

    // 先下载到本地永久保存（避免远程 URL 过期后图片裂开）
    const localPath = await saveImageLocal(imageUrl, {
      model: selectedModel,
      provider: apiProvider,
      prompt: originalPrompt,
    })
    const displayUrl = localPathToUrl(localPath) || imageUrl

    const record = await Generation.create({
      originalPrompt,
      apiPrompt,
      aspectRatio,
      imageSize: imageSize || null,
      resultImageUrl: displayUrl,
      referenceImages: refs,
      apiProvider,
      modelName: selectedModel,
      userId: null,
      pointsCost,
    })

    // 生成成功：确认积分消耗
    await confirmDeduct(beforeBalance, pointsCost, `图片自由生成|模型:${selectedModel}`)

    // 清除历史记录缓存
    const allKeys = cache.keys ? cache.keys() : []
    allKeys.forEach((k) => { if (k.startsWith('history_list')) cache.delete(k) })

    const elapsed = Date.now() - startMs
    logger.info('图片生成成功', { id: record.id, elapsedMs: elapsed, model: selectedModel, apiProvider, pointsCost })

    res.json({
      success: true,
      message: `生成成功，余额充足`,
      data: {
        id: record.id,
        imageUrl: displayUrl,
        model: selectedModel,
        provider: apiProvider,
        pointsCost,
      },
    })
  } catch (err) {
    // 生成失败：如果之前有预扣减，尝试回滚（实际上 deductPoints 只是预检查，不真正扣减）
    // confirmDeduct 会对比余额差，生成失败不会实际扣减，所以这里不需要额外处理
    const elapsed = Date.now() - startMs
    logger.warn('图片生成失败', { elapsedMs: elapsed, message: err?.message })
    next(err)
  }
}

module.exports = {
  handleGenerate,
}
