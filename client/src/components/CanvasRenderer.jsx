/**
 * CanvasRenderer - 前端 Canvas 合成渲染器
 *
 * 用于 renderType='canvas' 的模板，将文字图层精确渲染到底图上。
 * 支持：三阶金色渐变、多层阴影、垂直拉伸、照片裁切（objectFit: cover）。
 *
 * 使用方式：
 *   import { renderCanvas } from './CanvasRenderer'
 *   const dataUrl = await renderCanvas(canvasConfig, variables, imageFiles)
 */

const imageCache = new Map()

/** 从 URL 加载图片，带缓存，返回 HTMLImageElement */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (imageCache.has(src)) {
      const cached = imageCache.get(src)
      if (cached.complete && cached.naturalWidth > 0) {
        resolve(cached)
      } else {
        cached.addEventListener('load', () => resolve(cached), { once: true })
        cached.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), { once: true })
      }
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => {
      imageCache.set(src, img)
      resolve(img)
    }, { once: true })
    img.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), { once: true })
    img.src = src
  })
}

/** 预加载所有需要的图片资源 */
async function preloadAssets(canvasConfig, imageFiles = {}) {
  const assets = {}

  if (canvasConfig.backgroundImage) {
    assets.background = await loadImage(canvasConfig.backgroundImage)
  }

  if (canvasConfig.overlays) {
    for (const overlay of canvasConfig.overlays) {
      if (overlay.key && imageFiles[overlay.key]) {
        const url = URL.createObjectURL(imageFiles[overlay.key])
        assets[`overlay_${overlay.key}`] = await loadImage(url)
      }
    }
  }

  return assets
}

/** 创建多阶线性渐变色（支持任意数量颜色停止点） */
function applyGradient(ctx, gradientCfg, x, y, width, height) {
  let g
  const { colors, stops, direction } = gradientCfg

  switch (direction) {
    case 'to bottom':
      g = ctx.createLinearGradient(x, y, x, y + height)
      break
    case 'to right':
      g = ctx.createLinearGradient(x, y, x + width, y)
      break
    case 'to bottom-right':
      g = ctx.createLinearGradient(x, y, x + width, y + height)
      break
    default:
      g = ctx.createLinearGradient(x, y, x, y + height)
  }

  if (stops && stops.length > 0) {
    stops.forEach((stop) => g.addColorStop(stop.position, stop.color))
  } else {
    colors.forEach((color, i) => {
      g.addColorStop(i / (colors.length - 1), color)
    })
  }

  ctx.fillStyle = g
}

/** 预加载字体（确保 Impact 等字体加载完毕再画图） */
async function preloadFonts(textLayers) {
  const fontsToLoad = new Set()
  for (const layer of textLayers) {
    if (layer.fontFamily) {
      const families = layer.fontFamily.split(',').map((f) => f.trim())
      for (const family of families) {
        const weight = layer.fontWeight || 'normal'
        fontsToLoad.add(`${weight} ${layer.fontSize}px ${family}`)
      }
    }
  }
  await Promise.all(
    Array.from(fontsToLoad).map((f) => document.fonts.load(f).catch(() => null))
  )
}

/** 正确的多层阴影文字绘制
 *
 * 渲染顺序（从底到顶）：
 *   Layer 1 → 最外层深阴影（把字从背景"拔"出来）
 *   Layer 2 → 中层硬描边（模拟字体侧边厚度）
 *   Layer 3 → 核心金属渐变文字
 *
 * Canvas shadow 机制说明：
 *   shadowBlur/shadowOffset 只在 fillText/strokeText 时生效，
 *   用透明色画字不会产生阴影，必须设好 shadow 属性后直接画实色文字。
 */
function drawTextWithShadows(ctx, text, x, y, fontSize, fontFamily, fontWeight, textAlign, options = {}) {
  const {
    gradient,
    color,
    scaleX = 1,
    scaleY = 1,
    shadowLayers = [],
    stroke,
    strokeOnly = false,
    italic = false,
  } = options

  ctx.save()

  // 字体基础设置
  ctx.font = `${italic ? 'italic ' : ''}${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textAlign = textAlign || 'center'
  ctx.textBaseline = 'alphabetic'

  // 移动到文字基准点，应用拉伸变形
  ctx.translate(x, y)
  ctx.scale(scaleX, scaleY)

  const textY = 0
  const textX = 0

  // ─── Layer 1: 最底层阴影（放大+模糊，把字从背景拔出来）──
  if (shadowLayers.length > 0) {
    const baseShadow = shadowLayers[0]
    ctx.shadowColor = baseShadow.color
    ctx.shadowBlur = baseShadow.blur || 20
    ctx.shadowOffsetX = baseShadow.offsetX || 0
    ctx.shadowOffsetY = baseShadow.offsetY || 8

    if (gradient && gradient.stops && gradient.stops.length > 0) {
      const metrics = ctx.measureText(text)
      const gH = fontSize * 1.2
      const gY = -fontSize * 0.85
      applyGradient(ctx, gradient, -metrics.width / 2, gY, metrics.width, gH)
    } else {
      ctx.fillStyle = color || '#FFD700'
    }
    ctx.fillText(text, textX, textY)
  }

  // ─── Layer 2: 深色描边（stroke 先画，在渐变文字下方）──
  if (stroke && !strokeOnly) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width || 4
    ctx.strokeText(text, textX, textY)
  }

  // ─── Layer 3: 核心渐变文字（叠在最上层）──
  if (!strokeOnly) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0

    if (gradient && gradient.stops && gradient.stops.length > 0) {
      const metrics = ctx.measureText(text)
      const gH = fontSize * 1.2
      const gY = -fontSize * 0.85
      applyGradient(ctx, gradient, -metrics.width / 2, gY, metrics.width, gH)
    } else {
      ctx.fillStyle = color || '#FFFFFF'
    }
    ctx.fillText(text, textX, textY)
  }

  ctx.restore()
}

/** 绘制照片叠加层（支持 objectFit: cover） */
function drawOverlayImage(ctx, img, x, y, width, height, objectFit = 'contain', opacity = 1) {
  if (!img) return

  ctx.save()
  ctx.globalAlpha = opacity

  if (objectFit === 'cover') {
    // 计算 cover 裁切区域
    const imgRatio = img.naturalWidth / img.naturalHeight
    const boxRatio = width / height

    let sx, sy, sw, sh

    if (imgRatio > boxRatio) {
      // 图片更宽，以高度为基准裁宽度
      sh = img.naturalHeight
      sw = sh * boxRatio
      sx = (img.naturalWidth - sw) / 2
      sy = 0
    } else {
      // 图片更高，以宽度为基准裁高度
      sw = img.naturalWidth
      sh = sw / boxRatio
      sx = 0
      sy = (img.naturalHeight - sh) / 2
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height)
  } else if (objectFit === 'contain') {
    const imgRatio = img.naturalWidth / img.naturalHeight
    const boxRatio = width / height

    let drawW, drawH
    if (imgRatio > boxRatio) {
      drawW = width
      drawH = width / imgRatio
    } else {
      drawH = height
      drawW = height * imgRatio
    }

    const drawX = x + (width - drawW) / 2
    const drawY = y + (height - drawH) / 2
    ctx.drawImage(img, drawX, drawY, drawW, drawH)
  } else {
    ctx.drawImage(img, x, y, width, height)
  }

  ctx.restore()
}

/**
 * 核心渲染函数
 *
 * @param {Object} canvasConfig - 模板的 canvasConfig
 * @param {Object} variables  - 用户填写的变量值，key 对应 textLayers 中的 key
 * @param {Object} imageFiles - 用户上传的图片文件，key 对应 overlays 中的 key
 * @returns {Promise<string>} - 渲染后的 Canvas DataURL
 */
export async function renderCanvas(canvasConfig, variables = {}, imageFiles = {}) {
  const { width, height, backgroundImage, textLayers = [], overlays = [] } = canvasConfig

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // 0. 预加载字体（确保 Impact 等字体加载完毕再画图）
  await preloadFonts(textLayers)

  // 1. 绘制底图
  if (backgroundImage) {
    const bg = await loadImage(backgroundImage)
    ctx.drawImage(bg, 0, 0, width, height)
  } else {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
  }

  // 2. 预加载用户上传的图片
  const uploadedImages = {}
  for (const overlay of overlays) {
    if (overlay.key && imageFiles[overlay.key]) {
      const url = URL.createObjectURL(imageFiles[overlay.key])
      uploadedImages[overlay.key] = await loadImage(url)
    }
  }

  // 3. 绘制文字图层
  for (const layer of textLayers) {
    const text = variables[layer.key] || ''
    if (!text) continue

    drawTextWithShadows(
      ctx,
      text,
      layer.x,
      layer.y,
      layer.fontSize,
      layer.fontFamily || 'Arial, sans-serif',
      layer.fontWeight || 'normal',
      layer.textAlign || 'center',
      {
        gradient: layer.gradient,
        color: layer.color,
        scaleY: layer.scaleY || 1,
        shadowLayers: layer.shadowLayers || [],
        stroke: layer.stroke,
        italic: layer.italic,
        letterSpacing: layer.letterSpacing || 0,
      },
    )
  }

  // 4. 绘制叠加层（照片等）
  for (const overlay of overlays) {
    if (overlay.type !== 'image') continue
    const img = overlay.key ? uploadedImages[overlay.key] : null
    if (!img) continue

    drawOverlayImage(
      ctx,
      img,
      overlay.x,
      overlay.y,
      overlay.width,
      overlay.height,
      overlay.objectFit || 'contain',
      overlay.opacity ?? 1,
    )
  }

  return canvas.toDataURL('image/png')
}

/**
 * 触发浏览器下载 PNG 文件
 */
export function downloadCanvas(dataUrl, filename = 'poster.png') {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default { renderCanvas, downloadCanvas }
