import * as THREE from 'three'

const CURVE_SAMPLES = 18
const curveCache = new WeakMap()
const quaternionA = new THREE.Quaternion()
const quaternionB = new THREE.Quaternion()
const quaternionResult = new THREE.Quaternion()
const eulerA = new THREE.Euler()
const eulerB = new THREE.Euler()
const eulerResult = new THREE.Euler()

export const DEFAULT_CAMERA_EASING = 'easeInOutCubic'
export const DEFAULT_OBJECT_EASING = 'easeInOutSine'

const EASINGS = {
  linear: (t) => t,
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - ((1 - t) ** 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
  easeInOutQuint: (t) => (t < 0.5 ? 16 * (t ** 5) : 1 - ((-2 * t + 2) ** 5) / 2),
  hold: () => 0,
}

export function applyEasing(t, easing = DEFAULT_OBJECT_EASING) {
  const safeT = Math.max(0, Math.min(1, Number(t) || 0))
  return (EASINGS[easing] || EASINGS[DEFAULT_OBJECT_EASING])(safeT)
}

function lerp1(a, b, t) {
  if (a == null && b == null) return null
  if (a == null) return b
  if (b == null) return a
  return a + (b - a) * t
}

function lerp3(a, b, t) {
  if (!a || !b) return a || b || [0, 0, 0]
  return [lerp1(a[0], b[0], t), lerp1(a[1], b[1], t), lerp1(a[2], b[2], t)]
}

function slerpEuler(a, b, t) {
  if (!a || !b) return a || b || [0, 0, 0]
  eulerA.set(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0, 'YXZ')
  eulerB.set(Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0, 'YXZ')
  quaternionA.setFromEuler(eulerA)
  quaternionB.setFromEuler(eulerB)
  quaternionResult.copy(quaternionA).slerp(quaternionB, t)
  eulerResult.setFromQuaternion(quaternionResult, 'YXZ')
  return [eulerResult.x, eulerResult.y, eulerResult.z]
}

function catmullRom1(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  )
}

function catmullRom3(p0, p1, p2, p3, t) {
  return [0, 1, 2].map((axis) => catmullRom1(
    Number(p0?.[axis]) || 0,
    Number(p1?.[axis]) || 0,
    Number(p2?.[axis]) || 0,
    Number(p3?.[axis]) || 0,
    t,
  ))
}

function distance3(a, b) {
  if (!a || !b) return 0
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function getCurvePoint(keyframes, segmentIndex, prop, t) {
  const a = keyframes[segmentIndex]
  const b = keyframes[segmentIndex + 1]
  const p0 = keyframes[Math.max(0, segmentIndex - 1)]?.[prop] || a?.[prop]
  const p1 = a?.[prop]
  const p2 = b?.[prop]
  const p3 = keyframes[Math.min(keyframes.length - 1, segmentIndex + 2)]?.[prop] || b?.[prop]
  if (!p1 || !p2) return p1 || p2 || null
  return catmullRom3(p0, p1, p2, p3, t)
}

function getArcTable(keyframes, segmentIndex, prop) {
  let cache = curveCache.get(keyframes)
  if (!cache) {
    cache = new Map()
    curveCache.set(keyframes, cache)
  }
  const key = `${segmentIndex}:${prop}`
  if (cache.has(key)) return cache.get(key)

  const samples = [{ t: 0, length: 0 }]
  let total = 0
  let previous = getCurvePoint(keyframes, segmentIndex, prop, 0)
  for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
    const t = index / CURVE_SAMPLES
    const point = getCurvePoint(keyframes, segmentIndex, prop, t)
    total += distance3(previous, point)
    samples.push({ t, length: total })
    previous = point
  }
  const table = { samples, total }
  cache.set(key, table)
  return table
}

function remapToConstantSpeed(keyframes, segmentIndex, prop, progress) {
  const table = getArcTable(keyframes, segmentIndex, prop)
  if (!table.total) return progress
  const targetLength = progress * table.total
  for (let index = 1; index < table.samples.length; index += 1) {
    const before = table.samples[index - 1]
    const after = table.samples[index]
    if (targetLength <= after.length) {
      const span = after.length - before.length
      const local = span > 0 ? (targetLength - before.length) / span : 0
      return before.t + (after.t - before.t) * local
    }
  }
  return 1
}

export function getKeyframeSpan(keyframes, time) {
  if (!keyframes?.length) return null
  if (time <= keyframes[0].time) return { a: keyframes[0], b: keyframes[0], t: 0, index: 0 }
  const lastIndex = keyframes.length - 1
  if (time >= keyframes[lastIndex].time) return { a: keyframes[lastIndex], b: keyframes[lastIndex], t: 0, index: lastIndex }
  for (let index = 0; index < lastIndex; index += 1) {
    const a = keyframes[index]
    const b = keyframes[index + 1]
    if (time >= a.time && time <= b.time) {
      const range = b.time - a.time
      return { a, b, t: range > 0 ? (time - a.time) / range : 0, index }
    }
  }
  return { a: keyframes[lastIndex], b: keyframes[lastIndex], t: 0, index: lastIndex }
}

export function getCinematicValue(keyframes, time, prop, options = {}) {
  const span = getKeyframeSpan(keyframes, time)
  if (!span) return null
  const av = span.a[prop]
  const bv = span.b[prop]
  if (av == null && bv == null) return null
  if (span.a === span.b) return Array.isArray(av) ? [...av] : av

  const easing = span.a.easing || options.defaultEasing || DEFAULT_OBJECT_EASING
  const easedT = applyEasing(span.t, easing)
  if (options.rotation) return slerpEuler(av, bv, easedT)
  if (Array.isArray(av) || Array.isArray(bv)) {
    if (options.curve && keyframes.length > 2) {
      const curveT = remapToConstantSpeed(keyframes, span.index, prop, easedT)
      return getCurvePoint(keyframes, span.index, prop, curveT)
    }
    return lerp3(av, bv, easedT)
  }
  return lerp1(av, bv, easedT)
}

export function getCinematicPose(keyframes, time, poseParts) {
  const span = getKeyframeSpan(keyframes, time)
  if (!span) return null
  const easing = span.a.easing || DEFAULT_OBJECT_EASING
  const easedT = applyEasing(span.t, easing)
  const result = {}
  const poseKeys = new Set([
    'rootPosition',
    'rootRotation',
    ...poseParts,
    ...Object.keys(span.a.pose || {}),
    ...Object.keys(span.b.pose || {}),
  ])
  for (const part of poseKeys) {
    const av = span.a.pose?.[part]
    const bv = span.b.pose?.[part]
    result[part] = av && bv
      ? (part === 'rootPosition' ? lerp3(av, bv, easedT) : slerpEuler(av, bv, easedT))
      : (av || bv || [0, 0, 0])
  }
  return result
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function sanitizeVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(Number(item)))) return [...fallback]
  return value.map(Number)
}

export function optimizeCinematicTracks(tracks, duration = 30) {
  const warnings = []
  const optimized = (tracks || []).map((track) => {
    const keyframeMap = new Map()
    for (const keyframe of track.keyframes || []) {
      const time = clamp(keyframe.time, 0, duration)
      keyframeMap.set(time.toFixed(4), { ...keyframe, time })
    }
    const keyframes = [...keyframeMap.values()].sort((a, b) => a.time - b.time)
    const defaultEasing = track.targetType === 'camera' ? DEFAULT_CAMERA_EASING : DEFAULT_OBJECT_EASING
    const next = keyframes.map((keyframe, index) => {
      const result = { ...keyframe, easing: keyframe.easing || defaultEasing }
      if (track.targetType === 'camera') {
        result.position = sanitizeVector(result.position, [0, 1.6, 7])
        result.lookAt = sanitizeVector(result.lookAt, [0, 1.55, 0])
        result.fov = clamp(result.fov == null ? 45 : result.fov, 15, 90)
        const distance = distance3(result.position, result.lookAt)
        if (distance < 0.8) {
          result.position = [result.lookAt[0], result.lookAt[1] + 0.25, result.lookAt[2] + 2.5]
          warnings.push(`摄影机 ${track.targetId} 在 ${result.time.toFixed(1)}s 距主体过近，已自动拉开`)
        }
        if (index > 0) {
          const previous = keyframes[index - 1]
          const seconds = Math.max(0.1, result.time - previous.time)
          const speed = distance3(previous.position, result.position) / seconds
          if (speed > 18) warnings.push(`摄影机 ${track.targetId} 在 ${previous.time.toFixed(1)}-${result.time.toFixed(1)}s 速度过快（${speed.toFixed(1)}m/s）`)
          const fovSpeed = Math.abs((Number(previous.fov) || 45) - result.fov) / seconds
          if (fovSpeed > 18) warnings.push(`摄影机 ${track.targetId} 的焦段变化过快，建议增加过渡时间`)
        }
      }
      return result
    })
    return { ...track, interpolation: track.interpolation || 'cinematic', keyframes: next }
  })

  const cameraWarnings = warnings.length
  return {
    tracks: optimized,
    report: {
      score: Math.max(0, 100 - cameraWarnings * 8),
      warnings,
      grade: cameraWarnings === 0 ? 'A' : cameraWarnings <= 2 ? 'B' : 'C',
    },
  }
}

export function assessExecutableTimeline(tracks, { cameraIds = [], duration = 30 } = {}) {
  const warnings = []
  const cameraIdSet = new Set(cameraIds)
  const cameraTracks = (tracks || []).filter((track) => track.targetType === 'camera')
  const validTracks = cameraTracks.filter((track) => cameraIdSet.has(track.targetId) && track.keyframes?.length >= 2)

  for (const track of cameraTracks) {
    if (!cameraIdSet.has(track.targetId)) warnings.push(`摄影机轨道绑定了不存在的机位：${track.targetId}`)
  }
  if (!validTracks.length) warnings.push('没有可执行的摄影机轨道')

  let hasMotion = false
  let coversDuration = false
  for (const track of validTracks) {
    const keyframes = track.keyframes || []
    let travel = 0
    let fovChange = 0
    let lookAtTravel = 0
    for (let index = 1; index < keyframes.length; index += 1) {
      travel += distance3(keyframes[index - 1].position, keyframes[index].position)
      lookAtTravel += distance3(keyframes[index - 1].lookAt, keyframes[index].lookAt)
      fovChange += Math.abs((Number(keyframes[index].fov) || 45) - (Number(keyframes[index - 1].fov) || 45))
    }
    if (travel > 0.3 || lookAtTravel > 0.2 || fovChange > 1) hasMotion = true
    const firstTime = Number(keyframes[0]?.time) || 0
    const lastTime = Number(keyframes.at(-1)?.time) || 0
    const trackCoversDuration = firstTime <= 0.1 && lastTime >= Number(duration) - 0.2
    coversDuration ||= trackCoversDuration
    if (!trackCoversDuration) warnings.push(`摄影机轨道没有覆盖完整时长（${firstTime.toFixed(1)}-${lastTime.toFixed(1)}s）`)
  }
  const sceneMotion = (tracks || []).some((track) => {
    if (track.targetType === 'camera' || !track.keyframes?.length || track.keyframes.length < 2) return false
    const first = track.keyframes[0]
    const last = track.keyframes.at(-1)
    return distance3(first.position, last.position) > 0.15
      || distance3(first.rotation, last.rotation) > 0.08
      || JSON.stringify(first.pose || {}) !== JSON.stringify(last.pose || {})
  })
  if (validTracks.length && !hasMotion && !sceneMotion) warnings.push('摄影机和场景轨道都没有实际运动')

  const score = Math.max(0, 100 - warnings.length * 30)
  return {
    valid: validTracks.length > 0 && coversDuration && (hasMotion || sceneMotion),
    score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
    warnings,
  }
}
