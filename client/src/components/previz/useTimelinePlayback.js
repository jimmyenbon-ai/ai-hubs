import { useCallback, useEffect, useRef } from 'react'
import { POSE_PARTS } from './PrevizCanvas'
import {
  DEFAULT_CAMERA_EASING,
  DEFAULT_OBJECT_EASING,
  getCinematicPose,
  getCinematicValue,
} from './CinematicMotion'

export default function useTimelinePlayback({ actors, setActors, props = [], setProps, cameras, setCameras, tracks, currentTime, isPlaying }) {
  const prevTimeRef = useRef(currentTime)

  useEffect(() => {
    if (!isPlaying) {
      prevTimeRef.current = currentTime
      return
    }
    if (currentTime === prevTimeRef.current) return
    prevTimeRef.current = currentTime

    let actorsChanged = false
    let propsChanged = false
    let camerasChanged = false
    const nextActors = actors.map((actor) => ({
      ...actor,
      position: [...actor.position],
      rotation: [...actor.rotation],
      scale: [...(actor.scale || [1, 1, 1])],
      pose: actor.pose ? { ...actor.pose } : {},
    }))
    const nextCameras = cameras.map((camera) => ({ ...camera, position: [...(camera.position || [0, 2.2, 8])], rotation: [...(camera.rotation || [0, 0, 0])] }))
    const nextProps = props.map((prop) => ({
      ...prop,
      position: [...(prop.position || [0, 0, 0])],
      rotation: [...(prop.rotation || [0, 0, 0])],
      scale: [...(prop.scale || [1, 1, 1])],
    }))

    for (const track of tracks) {
      if (!track.keyframes?.length) continue
      if (track.targetType === 'actor') {
        const index = nextActors.findIndex((actor) => actor.id === track.targetId)
        if (index < 0) continue
        const position = getCinematicValue(track.keyframes, currentTime, 'position', { curve: true, defaultEasing: DEFAULT_OBJECT_EASING })
        const rotation = getCinematicValue(track.keyframes, currentTime, 'rotation', { rotation: true, defaultEasing: DEFAULT_OBJECT_EASING })
        const scale = getCinematicValue(track.keyframes, currentTime, 'scale', { defaultEasing: DEFAULT_OBJECT_EASING })
        const pose = getCinematicPose(track.keyframes, currentTime, POSE_PARTS)
        if (position) { nextActors[index].position = position; actorsChanged = true }
        if (rotation) { nextActors[index].rotation = rotation; actorsChanged = true }
        if (scale) { nextActors[index].scale = scale; actorsChanged = true }
        if (pose) { nextActors[index].pose = pose; actorsChanged = true }
      }
      if (track.targetType === 'camera') {
        const index = nextCameras.findIndex((camera) => camera.id === track.targetId)
        if (index < 0) continue
        const position = getCinematicValue(track.keyframes, currentTime, 'position', { curve: true, defaultEasing: DEFAULT_CAMERA_EASING })
        const rotation = getCinematicValue(track.keyframes, currentTime, 'rotation', { rotation: true, defaultEasing: DEFAULT_CAMERA_EASING })
        const lookAt = getCinematicValue(track.keyframes, currentTime, 'lookAt', { curve: true, defaultEasing: DEFAULT_CAMERA_EASING })
        const fov = getCinematicValue(track.keyframes, currentTime, 'fov', { defaultEasing: DEFAULT_CAMERA_EASING })
        if (position) { nextCameras[index].position = position; camerasChanged = true }
        if (rotation) { nextCameras[index].rotation = rotation; camerasChanged = true }
        if (lookAt) { nextCameras[index].lookAt = lookAt; camerasChanged = true }
        if (fov != null) { nextCameras[index].fov = fov; camerasChanged = true }
      }
      if (track.targetType === 'prop') {
        const index = nextProps.findIndex((prop) => prop.id === track.targetId)
        if (index < 0) continue
        const position = getCinematicValue(track.keyframes, currentTime, 'position', { curve: true, defaultEasing: DEFAULT_OBJECT_EASING })
        const rotation = getCinematicValue(track.keyframes, currentTime, 'rotation', { rotation: true, defaultEasing: DEFAULT_OBJECT_EASING })
        const scale = getCinematicValue(track.keyframes, currentTime, 'scale', { defaultEasing: DEFAULT_OBJECT_EASING })
        if (position) { nextProps[index].position = position; propsChanged = true }
        if (rotation) { nextProps[index].rotation = rotation; propsChanged = true }
        if (scale) { nextProps[index].scale = scale; propsChanged = true }
      }
    }

    if (actorsChanged) setActors(nextActors)
    if (propsChanged && setProps) setProps(nextProps)
    if (camerasChanged) setCameras(nextCameras)
  }, [actors, cameras, currentTime, isPlaying, props, setActors, setCameras, setProps, tracks])

  const resetToStart = useCallback(() => {
    let actorsChanged = false
    let propsChanged = false
    let camerasChanged = false
    const nextActors = actors.map((actor) => ({ ...actor, position: [...actor.position], rotation: [...actor.rotation], scale: [...(actor.scale || [1, 1, 1])], pose: actor.pose ? { ...actor.pose } : {} }))
    const nextCameras = cameras.map((camera) => ({ ...camera, position: [...(camera.position || [0, 2.2, 8])], rotation: [...(camera.rotation || [0, 0, 0])] }))
    const nextProps = props.map((prop) => ({ ...prop, position: [...(prop.position || [0, 0, 0])], rotation: [...(prop.rotation || [0, 0, 0])], scale: [...(prop.scale || [1, 1, 1])] }))

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
      if (track.targetType === 'prop') {
        const index = nextProps.findIndex((prop) => prop.id === track.targetId)
        if (index >= 0) {
          if (keyframe.position) nextProps[index].position = keyframe.position
          if (keyframe.rotation) nextProps[index].rotation = keyframe.rotation
          if (keyframe.scale) nextProps[index].scale = keyframe.scale
          propsChanged = true
        }
      }
    }

    if (actorsChanged) setActors(nextActors)
    if (propsChanged && setProps) setProps(nextProps)
    if (camerasChanged) setCameras(nextCameras)
  }, [actors, cameras, props, setActors, setCameras, setProps, tracks])

  return { resetToStart }
}
