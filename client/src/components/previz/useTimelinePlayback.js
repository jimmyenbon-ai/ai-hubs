import { useCallback, useEffect, useRef } from 'react'
import { POSE_PARTS } from './PrevizCanvas'

function lerp3(a, b, t) {
  if (!a || !b) return a || b || [0, 0, 0]
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

function lerp1(a, b, t) {
  if (a == null && b == null) return null
  if (a == null) return b
  if (b == null) return a
  return a + (b - a) * t
}

function getSpan(keyframes, time) {
  if (!keyframes?.length) return null
  if (time <= keyframes[0].time) return { a: keyframes[0], b: keyframes[0], t: 0 }
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) return { a: last, b: last, t: 0 }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const a = keyframes[index]
    const b = keyframes[index + 1]
    if (time >= a.time && time <= b.time) {
      const range = b.time - a.time
      return { a, b, t: range > 0 ? (time - a.time) / range : 0 }
    }
  }
  return { a: last, b: last, t: 0 }
}

function getValueAtTime(keyframes, time, prop) {
  const span = getSpan(keyframes, time)
  if (!span) return null
  const { a, b, t } = span
  const av = a[prop]
  const bv = b[prop]
  if (av == null && bv == null) return null
  if (Array.isArray(av) || Array.isArray(bv)) return lerp3(av, bv, t)
  return lerp1(av, bv, t)
}

function getPoseAtTime(keyframes, time) {
  const span = getSpan(keyframes, time)
  if (!span) return null
  const result = {}
  const poseKeys = new Set([
    'rootPosition',
    'rootRotation',
    ...POSE_PARTS,
    ...Object.keys(span.a.pose || {}),
    ...Object.keys(span.b.pose || {}),
  ])
  for (const part of poseKeys) {
    const av = span.a.pose?.[part]
    const bv = span.b.pose?.[part]
    result[part] = av && bv ? lerp3(av, bv, span.t) : (av || bv || [0, 0, 0])
  }
  return result
}

export default function useTimelinePlayback({ actors, setActors, cameras, setCameras, tracks, currentTime, isPlaying }) {
  const prevTimeRef = useRef(currentTime)

  useEffect(() => {
    if (!isPlaying) {
      prevTimeRef.current = currentTime
      return
    }
    if (currentTime === prevTimeRef.current) return
    prevTimeRef.current = currentTime

    let actorsChanged = false
    let camerasChanged = false
    const nextActors = actors.map((actor) => ({
      ...actor,
      position: [...actor.position],
      rotation: [...actor.rotation],
      scale: [...(actor.scale || [1, 1, 1])],
      pose: actor.pose ? { ...actor.pose } : {},
    }))
    const nextCameras = cameras.map((camera) => ({ ...camera, position: [...(camera.position || [0, 2.2, 8])], rotation: [...(camera.rotation || [0, 0, 0])] }))

    for (const track of tracks) {
      if (!track.keyframes?.length) continue
      if (track.targetType === 'actor') {
        const index = nextActors.findIndex((actor) => actor.id === track.targetId)
        if (index < 0) continue
        const position = getValueAtTime(track.keyframes, currentTime, 'position')
        const rotation = getValueAtTime(track.keyframes, currentTime, 'rotation')
        const scale = getValueAtTime(track.keyframes, currentTime, 'scale')
        const pose = getPoseAtTime(track.keyframes, currentTime)
        if (position) { nextActors[index].position = position; actorsChanged = true }
        if (rotation) { nextActors[index].rotation = rotation; actorsChanged = true }
        if (scale) { nextActors[index].scale = scale; actorsChanged = true }
        if (pose) { nextActors[index].pose = pose; actorsChanged = true }
      }
      if (track.targetType === 'camera') {
        const index = nextCameras.findIndex((camera) => camera.id === track.targetId)
        if (index < 0) continue
        const position = getValueAtTime(track.keyframes, currentTime, 'position')
        const rotation = getValueAtTime(track.keyframes, currentTime, 'rotation')
        const lookAt = getValueAtTime(track.keyframes, currentTime, 'lookAt')
        const fov = getValueAtTime(track.keyframes, currentTime, 'fov')
        if (position) { nextCameras[index].position = position; camerasChanged = true }
        if (rotation) { nextCameras[index].rotation = rotation; camerasChanged = true }
        if (lookAt) { nextCameras[index].lookAt = lookAt; camerasChanged = true }
        if (fov != null) { nextCameras[index].fov = fov; camerasChanged = true }
      }
    }

    if (actorsChanged) setActors(nextActors)
    if (camerasChanged) setCameras(nextCameras)
  }, [actors, cameras, currentTime, isPlaying, setActors, setCameras, tracks])

  const resetToStart = useCallback(() => {
    let actorsChanged = false
    let camerasChanged = false
    const nextActors = actors.map((actor) => ({ ...actor, position: [...actor.position], rotation: [...actor.rotation], scale: [...(actor.scale || [1, 1, 1])], pose: actor.pose ? { ...actor.pose } : {} }))
    const nextCameras = cameras.map((camera) => ({ ...camera, position: [...(camera.position || [0, 2.2, 8])], rotation: [...(camera.rotation || [0, 0, 0])] }))

    for (const track of tracks) {
      if (!track.keyframes?.length) continue
      const keyframe = track.keyframes[0]
      if (track.targetType === 'actor') {
        const index = nextActors.findIndex((actor) => actor.id === track.targetId)
        if (index >= 0) {
          if (keyframe.position) nextActors[index].position = keyframe.position
          if (keyframe.rotation) nextActors[index].rotation = keyframe.rotation
          if (keyframe.scale) nextActors[index].scale = keyframe.scale
          if (keyframe.pose) nextActors[index].pose = { ...keyframe.pose }
          actorsChanged = true
        }
      }
      if (track.targetType === 'camera') {
        const index = nextCameras.findIndex((camera) => camera.id === track.targetId)
        if (index >= 0) {
          if (keyframe.position) nextCameras[index].position = keyframe.position
          if (keyframe.rotation) nextCameras[index].rotation = keyframe.rotation
          if (keyframe.lookAt) nextCameras[index].lookAt = keyframe.lookAt
          if (keyframe.fov != null) nextCameras[index].fov = keyframe.fov
          camerasChanged = true
        }
      }
    }

    if (actorsChanged) setActors(nextActors)
    if (camerasChanged) setCameras(nextCameras)
  }, [actors, cameras, setActors, setCameras, tracks])

  return { resetToStart }
}
