import { useState, useRef, useCallback } from 'react'

const RECORDING_FPS = 30
const RECORDING_BITRATE = 16_000_000

/**
 * Export utilities for AI video generation:
 * screenshot, processed stills, keyframe images, and WebM recording.
 */
export function usePrevizExport() {
  const [exportStatus, setExportStatus] = useState('')
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])

  const getCanvas = useCallback((selector = '.previz-canvas-wrap canvas') => {
    return document.querySelector(selector)
  }, [])

  const exportScreenshot = useCallback((width = 1920, height = 1080) => {
    const canvas = getCanvas()
    if (!canvas) {
      setExportStatus('未找到可截图的画布')
      return false
    }

    const offCanvas = document.createElement('canvas')
    offCanvas.width = width
    offCanvas.height = height
    const ctx = offCanvas.getContext('2d')
    ctx.drawImage(canvas, 0, 0, width, height)

    const link = document.createElement('a')
    link.download = `previz-shot-${Date.now()}.png`
    link.href = offCanvas.toDataURL('image/png')
    link.click()
    setExportStatus('截图已保存')
    return true
  }, [getCanvas])

  const startRecording = useCallback((selector = '.previz-preview-window canvas') => {
    try {
      const canvas = getCanvas(selector)
      if (!canvas) {
        setExportStatus('未找到预览画布，无法录制')
        return null
      }
      if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
        setExportStatus('当前浏览器不支持画布视频录制')
        return null
      }

      const stream = canvas.captureStream(RECORDING_FPS)
      const candidates = [
        { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
        { mimeType: 'video/mp4', ext: 'mp4' },
        { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
        { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
      ]
      const selectedFormat = candidates.find((item) => MediaRecorder.isTypeSupported(item.mimeType)) || candidates[candidates.length - 1]

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedFormat.mimeType,
        videoBitsPerSecond: RECORDING_BITRATE,
      })
      recordingChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setExportStatus('录制失败，请重试')
      }
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: selectedFormat.mimeType })
        if (!blob.size) {
          setExportStatus('录制结束，但没有捕获到视频帧')
          return
        }

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.download = `previz-video-${Date.now()}.${selectedFormat.ext}`
        link.href = url
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportStatus(selectedFormat.ext === 'mp4' ? 'MP4录制完成' : '当前浏览器不支持MP4编码，已导出WebM')
      }

      recorder.start(250)
      mediaRecorderRef.current = recorder
      setExportStatus(selectedFormat.ext === 'mp4' ? 'MP4录制中...' : 'WebM录制中（浏览器不支持MP4时自动降级）')
      return recorder
    } catch (err) {
      setExportStatus(`录制失败：${err.message || '未知错误'}`)
      return null
    }
  }, [getCanvas])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
      return true
    }
    return false
  }, [])

  const exportWithOverride = useCallback((mode) => {
    const canvas = getCanvas()
    if (!canvas) {
      setExportStatus('未找到可导出的画布')
      return false
    }

    const offCanvas = document.createElement('canvas')
    offCanvas.width = 1920
    offCanvas.height = 1080
    const ctx = offCanvas.getContext('2d')
    ctx.drawImage(canvas, 0, 0, 1920, 1080)

    let filename = `previz-${mode}-${Date.now()}.png`
    const imageData = ctx.getImageData(0, 0, 1920, 1080)
    const pixels = imageData.data

    if (mode === 'depth') {
      for (let i = 0; i < pixels.length; i += 4) {
        const avg = 255 - Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3)
        pixels[i] = pixels[i + 1] = pixels[i + 2] = avg
      }
      filename = `previz-depth-${Date.now()}.png`
    } else if (mode === 'skeleton') {
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        const val = gray > 80 ? 255 : 0
        pixels[i] = pixels[i + 1] = pixels[i + 2] = val
      }
      filename = `previz-skeleton-${Date.now()}.png`
    } else if (mode === 'mask') {
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        if (r < 50 && g < 50 && b < 50) {
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
        }
      }
      filename = `previz-mask-${Date.now()}.png`
    }

    ctx.putImageData(imageData, 0, 0)

    const link = document.createElement('a')
    link.download = filename
    link.href = offCanvas.toDataURL('image/png')
    link.click()
    setExportStatus(`${mode} 导出完成`)
    return true
  }, [getCanvas])

  const exportKeyframePack = useCallback(async (keyframeTimes) => {
    setExportStatus('正在导出关键帧包...')
    const canvas = getCanvas()
    if (!canvas) {
      setExportStatus('未找到可导出的画布')
      return false
    }

    const offCanvas = document.createElement('canvas')
    offCanvas.width = 1920
    offCanvas.height = 1080
    const ctx = offCanvas.getContext('2d')
    const times = keyframeTimes?.length ? keyframeTimes : [0]

    for (let i = 0; i < Math.min(times.length, 20); i += 1) {
      ctx.drawImage(canvas, 0, 0, 1920, 1080)
      const link = document.createElement('a')
      link.download = `previz-kf-${String(i).padStart(3, '0')}.png`
      link.href = offCanvas.toDataURL('image/png')
      link.click()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    setExportStatus(`已导出 ${Math.min(times.length, 20)} 张关键帧`)
    return true
  }, [getCanvas])

  return {
    exportStatus,
    setExportStatus,
    exportScreenshot,
    startRecording,
    stopRecording,
    exportWithOverride,
    exportKeyframePack,
  }
}
