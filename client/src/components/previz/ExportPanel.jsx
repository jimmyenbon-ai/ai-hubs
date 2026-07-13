import { useState, useRef, useCallback, useEffect } from 'react'

const RECORDING_FPS = 60
const RECORDING_BITRATE = 12_000_000

/**
 * Export utilities for AI video generation:
 * screenshot, processed stills, keyframe images, and high quality camera recording.
 */
export function usePrevizExport({ onRecordingComplete } = {}) {
  const [exportStatus, setExportStatus] = useState('')
  const [lastRecording, setLastRecording] = useState(null)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const streamRef = useRef(null)
  const framePumpRef = useRef(null)
  const onRecordingCompleteRef = useRef(onRecordingComplete)
  const recordingUrlRef = useRef(null)

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete
  }, [onRecordingComplete])

  useEffect(() => () => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
  }, [])

  const stopFramePump = useCallback(() => {
    if (framePumpRef.current) {
      clearInterval(framePumpRef.current)
      framePumpRef.current = null
    }
  }, [])

  const getCanvas = useCallback((selector = '.previz-canvas-wrap canvas') => {
    return document.querySelector(selector)
  }, [])

  const exportScreenshot = useCallback((width = 1920, height = 1080) => {
    const canvas = getCanvas()
    if (!canvas) {
      setExportStatus('没有找到可截图的画布')
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

  const startRecording = useCallback((selector = '.previz-preview-window canvas', options = {}) => {
    try {
      const canvas = getCanvas(selector)
      if (!canvas) {
        setExportStatus('没有找到预览画布，无法录制')
        return null
      }
      if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
        setExportStatus('当前浏览器不支持画布视频录制')
        return null
      }

      const actualWidth = canvas.width
      const actualHeight = canvas.height
      // Supported export ratios are 16:9, 9:16, 1:1 and 2.35:1. The rendered
      // canvas is authoritative because an AI command may change aspect ratio
      // immediately before its deferred recording command runs.
      if (actualWidth < 1000 || actualHeight < 800) {
        setExportStatus(`录制画布分辨率过低：${actualWidth}×${actualHeight}，请重新录制`)
        return null
      }

      const recordingFps = Math.max(24, Math.min(60, Number(options.fps) || RECORDING_FPS))
      const recordingBitrate = Math.max(4_000_000, Number(options.videoBitsPerSecond) || RECORDING_BITRATE)

      stopFramePump()
      const stream = canvas.captureStream(recordingFps)
      const [videoTrack] = stream.getVideoTracks()
      videoTrack?.applyConstraints?.({
        width: actualWidth,
        height: actualHeight,
        frameRate: recordingFps,
      }).catch(() => {})
      if (videoTrack?.requestFrame) {
        videoTrack.requestFrame()
        framePumpRef.current = window.setInterval(() => {
          if (mediaRecorderRef.current?.state === 'recording') videoTrack.requestFrame()
        }, 1000 / recordingFps)
      }

      const candidates = [
        { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
        { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
        { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
        { mimeType: 'video/mp4', ext: 'mp4' },
      ]
      const selectedFormat = candidates.find((item) => MediaRecorder.isTypeSupported(item.mimeType)) || candidates[candidates.length - 1]

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedFormat.mimeType,
        videoBitsPerSecond: recordingBitrate,
      })

      streamRef.current = stream
      recordingChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setExportStatus('录制失败，请重试')
      }
      recorder.onstop = async () => {
        stopFramePump()
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        const blob = new Blob(recordingChunksRef.current, { type: selectedFormat.mimeType })
        if (!blob.size) {
          setExportStatus('录制结束，但没有捕获到视频帧')
          return
        }

        const url = URL.createObjectURL(blob)
        if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
        recordingUrlRef.current = url
        const filename = `previz-video-${actualWidth}x${actualHeight}-${recordingFps}fps-${Date.now()}.${selectedFormat.ext}`
        setLastRecording({
          url,
          filename,
          size: blob.size,
          width: actualWidth,
          height: actualHeight,
          fps: recordingFps,
          ext: selectedFormat.ext,
          mimeType: selectedFormat.mimeType,
          converting: true,
        })
        setExportStatus(`${actualWidth}×${actualHeight} 已录制，正在转换为标准 H.264 MP4…`)
        try {
          const normalized = await onRecordingCompleteRef.current?.({
            blob,
            ext: selectedFormat.ext,
            mimeType: selectedFormat.mimeType,
            durationHint: null,
            width: actualWidth,
            height: actualHeight,
            fps: recordingFps,
            filename,
          })
          if (normalized?.url) {
            if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
            recordingUrlRef.current = null
            setLastRecording({
              ...normalized,
              filename: normalized.filename || filename.replace(/\.webm$/i, '.mp4'),
              width: normalized.width || actualWidth,
              height: normalized.height || actualHeight,
              fps: normalized.fps || recordingFps,
              size: normalized.size || blob.size,
              ext: normalized.ext || 'mp4',
              mimeType: normalized.mimeType || 'video/mp4',
              converting: false,
            })
            setExportStatus(`${normalized.width || actualWidth}×${normalized.height || actualHeight} H.264 MP4 转换完成，可预览或下载`)
            return
          }
          setLastRecording((current) => current ? { ...current, converting: false } : current)
          setExportStatus('MP4转换未返回文件，已保留WebM备用视频')
        } catch (error) {
          setLastRecording((current) => current ? { ...current, converting: false } : current)
          setExportStatus(`MP4转换失败，已保留WebM备用：${error.message || '未知错误'}`)
        }
      }

      recorder.start(100)
      mediaRecorderRef.current = recorder
      setExportStatus(`${actualWidth}×${actualHeight} / ${recordingFps}fps / ${Math.round(recordingBitrate / 1_000_000)}Mbps 录制中…`)
      return recorder
    } catch (err) {
      setExportStatus(`录制失败：${err.message || '未知错误'}`)
      return null
    }
  }, [getCanvas, stopFramePump])

  const downloadLastRecording = useCallback(() => {
    if (!lastRecording?.url || lastRecording.converting) return false
    const link = document.createElement('a')
    link.href = lastRecording.url
    link.download = lastRecording.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setExportStatus(`已请求下载 ${lastRecording.filename}`)
    return true
  }, [lastRecording])

  const clearLastRecording = useCallback(() => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    recordingUrlRef.current = null
    setLastRecording(null)
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.requestData?.()
      } catch {
        // Some MediaRecorder implementations throw if no chunk is ready yet.
      }
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
      return true
    }
    stopFramePump()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    return false
  }, [stopFramePump])

  const exportWithOverride = useCallback((mode) => {
    const canvas = getCanvas()
    if (!canvas) {
      setExportStatus('没有找到可导出的画布')
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
      setExportStatus('没有找到可导出的画布')
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
    lastRecording,
    setExportStatus,
    exportScreenshot,
    startRecording,
    stopRecording,
    downloadLastRecording,
    clearLastRecording,
    exportWithOverride,
    exportKeyframePack,
  }
}
