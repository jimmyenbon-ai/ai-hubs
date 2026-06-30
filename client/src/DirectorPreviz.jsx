import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import ControlPanel from './components/previz/ControlPanel'
import {
  ActorModel,
  DEFAULT_POSE,
  MovieCameraRig,
  PropModel,
  SceneSetup,
  findJointRef,
  getAspectValue,
  getPropGroundY,
  snapToGround,
} from './components/previz/PrevizCanvas'
import TimelinePanel from './components/previz/TimelinePanel'
import ProjectManager from './components/previz/ProjectManager'
import TransformGizmo from './components/previz/TransformGizmo'
import useTimelinePlayback from './components/previz/useTimelinePlayback'
import { usePrevizExport } from './components/previz/ExportPanel'
import { downloadDataURL, renderExportFrame } from './components/previz/ExportRenderers'
import { applyCommands } from './components/previz/PrevizCommandExecutor'

const RECORD_INTERVAL = 500
const FPS = 24
const MOVE_STEP = 0.18
const FAST_MOVE_STEP = 0.55
const ROTATE_STEP = 0.08

const POSE_PRESETS = {
  stand: () => ({ ...DEFAULT_POSE }),
  sit: () => ({
    ...DEFAULT_POSE,
    rootPosition: [0, 0.55, 0],
    spine: [-0.12, 0, 0],
    leftUpperLeg: [1.45, 0, 0],
    leftLowerLeg: [-1.35, 0, 0],
    rightUpperLeg: [1.45, 0, 0],
    rightLowerLeg: [-1.35, 0, 0],
    leftUpperArm: [0.25, 0, -0.2],
    rightUpperArm: [0.25, 0, 0.2],
  }),
  lie: () => ({
    ...DEFAULT_POSE,
    rootPosition: [0, 0.34, 0],
    rootRotation: [Math.PI / 2, 0, 0],
    spine: [0, 0, 0],
    head: [-0.12, 0, 0],
    leftUpperArm: [0, 0, -0.35],
    leftLowerArm: [0.15, 0, 0],
    rightUpperArm: [0, 0, 0.35],
    rightLowerArm: [0.15, 0, 0],
    leftUpperLeg: [0.08, 0, 0.05],
    leftLowerLeg: [0.05, 0, 0],
    rightUpperLeg: [0.08, 0, -0.05],
    rightLowerLeg: [0.05, 0, 0],
  }),
  wave: () => ({ ...DEFAULT_POSE, rightUpperArm: [0, 0, 1.8], rightLowerArm: [0, 0, 0.45] }),
  point: () => ({ ...DEFAULT_POSE, rightUpperArm: [1.45, 0, 0], rightLowerArm: [0.1, 0, 0] }),
  bow: () => ({ ...DEFAULT_POSE, spine: [0.45, 0, 0], head: [0.35, 0, 0] }),
  crouch: () => ({
    ...DEFAULT_POSE,
    rootPosition: [0, 0.58, 0],
    spine: [0.28, 0, 0],
    leftUpperLeg: [1.12, 0, 0],
    leftLowerLeg: [-1.22, 0, 0],
    rightUpperLeg: [1.12, 0, 0],
    rightLowerLeg: [-1.22, 0, 0],
    leftUpperArm: [0.55, 0, -0.25],
    rightUpperArm: [0.55, 0, 0.25],
  }),
}

function GroundClickHandler({ placementMode, onPlace, enabled }) {
  const { camera, gl, mouse, raycaster } = useThree()

  useEffect(() => {
    if (!enabled || !placementMode) return undefined
    const handleClick = (event) => {
      if (event.target !== gl.domElement) return
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const point = new THREE.Vector3()
      raycaster.setFromCamera(mouse, camera)
      if (raycaster.ray.intersectPlane(ground, point)) {
        onPlace([Math.round(point.x * 2) / 2, getPropGroundY(placementMode), Math.round(point.z * 2) / 2])
      }
    }
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [camera, enabled, gl, mouse, onPlace, placementMode, raycaster])

  return null
}

function MoviePreviewCamera({ cameraConfig, aspectRatio, fallbackFov }) {
  const { camera, size } = useThree()
  const aspect = getAspectValue(aspectRatio)

  useFrame(() => {
    /* eslint-disable react-hooks/immutability */
    const config = cameraConfig || {}
    camera.position.fromArray(config.position || [0, 2.2, 8])
    camera.fov = config.fov || fallbackFov || 45
    camera.aspect = aspect || (size.width / Math.max(1, size.height))
    if (config.lookAt) {
      camera.lookAt(new THREE.Vector3(...config.lookAt))
    } else if (config.rotation) {
      camera.rotation.fromArray(config.rotation)
    } else {
      camera.lookAt(0, 1.2, 0)
    }
    camera.updateProjectionMatrix()
    /* eslint-enable react-hooks/immutability */
  })

  return null
}

function PrevizScene({
  actors,
  props,
  cameras,
  activeCameraId,
  cameraFov,
  aspectRatio,
  showGrid,
  showGuides,
  selectedActor,
  selectedProp,
  selectedCamera,
  selectedJoint,
  onSelectActor,
  onSelectProp,
  onSelectCamera,
  onSelectJoint,
  actorRefs,
  propRefs,
  cameraRefs,
  onRegisterObject,
  placementMode,
  onPlaceProp,
  showCameraRigs = true,
  backgroundImage,
}) {
  const aspect = getAspectValue(aspectRatio)
  return (
    <>
      <SceneSetup showGrid={showGrid} showGuides={showGuides} fogColor="#1e1e1e" backgroundImage={backgroundImage} />
      <GroundClickHandler placementMode={placementMode} onPlace={onPlaceProp} enabled={!!placementMode} />
      {actors.map((actor) => (
        <ActorModel
          key={actor.id}
          actor={actor}
          selected={selectedActor === actor.id}
          selectedJoint={selectedActor === actor.id ? selectedJoint : null}
          onSelect={onSelectActor}
          onSelectJoint={onSelectJoint}
          ref={(element) => {
            if (element) {
              actorRefs.current[actor.id] = element
              onRegisterObject?.('actors', actor.id, element)
            }
          }}
        />
      ))}
      {props.map((prop) => (
        <PropModel
          key={prop.id}
          prop={prop}
          selected={selectedProp === prop.id}
          onSelect={onSelectProp}
          ref={(element) => {
            if (element) {
              propRefs.current[prop.id] = element
              onRegisterObject?.('props', prop.id, element)
            }
          }}
        />
      ))}
      {showCameraRigs && cameras.map((cam) => (
        <MovieCameraRig
          key={cam.id}
          camera={{ ...cam, fov: cam.fov || cameraFov, aspect }}
          active={cam.id === activeCameraId}
          selected={selectedCamera === cam.id}
          onSelect={onSelectCamera}
          ref={(element) => {
            if (element) {
              cameraRefs.current[cam.id] = element
              onRegisterObject?.('cameras', cam.id, element)
            }
          }}
        />
      ))}
    </>
  )
}

export default function DirectorPreviz({ onBack }) {
  const [actors, setActors] = useState([
    { id: 'actor_1', name: '演员 A', color: '#3366ff', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pose: { ...DEFAULT_POSE }, footLock: true },
  ])
  const [props, setProps] = useState([])
  const [cameras, setCameras] = useState([
    { id: 'cam1', name: '主机位', fov: 45, position: [0, 2.2, 8], rotation: [0, 0, 0], lookAt: [0, 1.2, 0] },
  ])

  const [selectedActor, setSelectedActor] = useState('actor_1')
  const [selectedProp, setSelectedProp] = useState(null)
  const [selectedCamera, setSelectedCamera] = useState(null)
  const [selectedJoint, setSelectedJoint] = useState(null)
  const [cameraFov, setCameraFov] = useState(45)
  const [cameraMode, setCameraMode] = useState('fixed')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [activeCameraId, setActiveCameraId] = useState('cam1')
  const [transformMode, setTransformMode] = useState('translate')
  const [isTransforming, setIsTransforming] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showGuides, setShowGuides] = useState(true)
  const [backgroundImage, setBackgroundImage] = useState(null)
  const [placementMode, setPlacementMode] = useState(null)
  const [duration] = useState(30)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [loopMode, setLoopMode] = useState(false)
  const [tracks, setTracks] = useState([])
  const [showProject, setShowProject] = useState(false)
  const [isVideoRecording, setIsVideoRecording] = useState(false)
  const [sceneTargets, setSceneTargets] = useState({ actors: {}, props: {}, cameras: {} })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState(null)
  const [aiError, setAiError] = useState(null)
  const [commandHistory, setCommandHistory] = useState([])

  const playbackRef = useRef(null)
  const aiSnapshotRef = useRef(null)
  const recordTimerRef = useRef(null)
  const recordTimeRef = useRef(0)
  const actorRefs = useRef({})
  const propRefs = useRef({})
  const cameraRefs = useRef({})
  const actorCounter = useRef(1)
  const propCounter = useRef(0)
  const actorsRef = useRef(actors)
  const camerasRef = useRef(cameras)
  const cameraFovRef = useRef(cameraFov)
  const activeCameraIdRef = useRef(activeCameraId)
  const backgroundUrlRef = useRef(null)

  useEffect(() => { actorsRef.current = actors }, [actors])
  useEffect(() => { camerasRef.current = cameras }, [cameras])
  useEffect(() => { cameraFovRef.current = cameraFov }, [cameraFov])
  useEffect(() => { activeCameraIdRef.current = activeCameraId }, [activeCameraId])
  useEffect(() => () => {
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current)
  }, [])

  const { exportStatus, exportScreenshot, startRecording, stopRecording } = usePrevizExport()
  const { resetToStart } = useTimelinePlayback({ actors, setActors, cameras, setCameras, tracks, currentTime, isPlaying })

  const activeCamera = cameras.find((camera) => camera.id === activeCameraId)
  const selectedActorRoot = selectedActor ? sceneTargets.actors[selectedActor] : null
  const selectedPropRoot = selectedProp ? sceneTargets.props[selectedProp] : null
  const selectedCameraRoot = selectedCamera ? sceneTargets.cameras[selectedCamera] : null
  const selectedActorTarget = selectedActorRoot ? (selectedJoint ? findJointRef(selectedActorRoot, selectedJoint) || selectedActorRoot : selectedActorRoot) : null

  const registerSceneObject = useCallback((type, id, element) => {
    setSceneTargets((prev) => {
      if (prev[type]?.[id] === element) return prev
      return { ...prev, [type]: { ...prev[type], [id]: element } }
    })
  }, [])

  const clearSelection = () => {
    setSelectedActor(null)
    setSelectedProp(null)
    setSelectedCamera(null)
    setSelectedJoint(null)
    setPlacementMode(null)
  }

  const handlePointerMissed = () => {
    if (!placementMode) clearSelection()
  }

  const addActor = () => {
    actorCounter.current += 1
    const id = `actor_${actorCounter.current}`
    const colors = ['#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff', '#ffff44']
    setActors((prev) => [
      ...prev,
      {
        id,
        name: `演员 ${String.fromCharCode(65 + ((actorCounter.current - 1) % 26))}`,
        color: colors[(actorCounter.current - 1) % colors.length],
        position: [actorCounter.current * 1.5 - 2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        pose: { ...DEFAULT_POSE },
        footLock: true,
      },
    ])
    setSelectedActor(id)
    setSelectedProp(null)
    setSelectedCamera(null)
    setSelectedJoint(null)
  }

  const deleteActor = (id) => {
    setActors((prev) => prev.filter((actor) => actor.id !== id))
    if (selectedActor === id) setSelectedActor(null)
  }

  const renameActor = (id, name) => {
    setActors((prev) => prev.map((actor) => actor.id === id ? { ...actor, name } : actor))
  }

  const applyPose = (preset) => {
    if (!selectedActor || !POSE_PRESETS[preset]) return
    setActors((prev) => prev.map((actor) => actor.id === selectedActor ? { ...actor, pose: POSE_PRESETS[preset]() } : actor))
  }

  const updateJoint = (actorId, joint, rotation) => {
    setActors((prev) => prev.map((actor) => actor.id === actorId ? { ...actor, pose: { ...actor.pose, [joint]: rotation } } : actor))
  }

  const handleActorTransform = (id, position, rotation, scale) => {
    setActors((prev) => prev.map((actor) => actor.id === id ? { ...actor, position: snapToGround(position), rotation, scale: scale || actor.scale } : actor))
  }

  const handlePropTransform = (id, position, rotation, scale) => {
    const current = props.find((prop) => prop.id === id)
    const y = current ? getPropGroundY(current.type) : 0.5
    setProps((prev) => prev.map((prop) => prop.id === id ? { ...prop, position: [position[0], y, position[2]], rotation, scale: scale || prop.scale } : prop))
  }

  const handleCameraTransform = (id, position, rotation, mode = transformMode) => {
    setCameras((prev) => prev.map((camera) => {
      if (camera.id !== id) return camera
      const patch = { ...camera, position, rotation }
      if (mode === 'rotate') patch.lookAt = null
      return patch
    }))
  }

  const updateActiveCameraFov = useCallback((fov) => {
    setCameraFov(fov)
    setCameras((prev) => prev.map((camera) => camera.id === activeCameraId ? { ...camera, fov } : camera))
  }, [activeCameraId])

  const focusActiveCameraOnActor = useCallback(() => {
    const targetActor = actorsRef.current.find((actor) => actor.id === selectedActor) || actorsRef.current[0]
    const target = targetActor
      ? [targetActor.position[0], 1.2, targetActor.position[2]]
      : [0, 1.2, 0]
    const cameraId = selectedCamera || activeCameraId
    setCameras((prev) => prev.map((camera) => (
      camera.id === cameraId
        ? { ...camera, lookAt: target }
        : camera
    )))
  }, [activeCameraId, selectedActor, selectedCamera])

  const resetActiveCameraView = useCallback(() => {
    const targetActor = actorsRef.current.find((actor) => actor.id === selectedActor) || actorsRef.current[0]
    const target = targetActor
      ? [targetActor.position[0], 1.2, targetActor.position[2]]
      : [0, 1.2, 0]
    const cameraId = selectedCamera || activeCameraId
    setCameras((prev) => prev.map((camera) => (
      camera.id === cameraId
        ? { ...camera, position: [target[0], 2.2, target[2] + 8], rotation: [0, 0, 0], lookAt: target }
        : camera
    )))
  }, [activeCameraId, selectedActor, selectedCamera])

  const nudgeSelected = useCallback((key, fast) => {
    const moveStep = fast ? FAST_MOVE_STEP : MOVE_STEP
    const rotateStep = fast ? ROTATE_STEP * 2 : ROTATE_STEP
    const lowerKey = key.toLowerCase()

    if (selectedActor && !selectedJoint) {
      setActors((prev) => prev.map((actor) => {
        if (actor.id !== selectedActor) return actor
        const next = { ...actor, position: [...actor.position], rotation: [...actor.rotation] }
        if (lowerKey === 'w') next.position[2] -= moveStep
        if (lowerKey === 's') next.position[2] += moveStep
        if (lowerKey === 'a') next.position[0] -= moveStep
        if (lowerKey === 'd') next.position[0] += moveStep
        if (lowerKey === 'q') next.rotation[1] += rotateStep
        if (lowerKey === 'e') next.rotation[1] -= rotateStep
        next.position = snapToGround(next.position)
        return next
      }))
      return
    }

    const cameraId = selectedCamera || activeCameraId
    if (cameraId) {
      setCameras((prev) => prev.map((camera) => {
        if (camera.id !== cameraId) return camera
        const position = [...(camera.position || [0, 2.2, 8])]
        const rotation = [...(camera.rotation || [0, 0, 0])]
        const yaw = rotation[1] || 0
        const forward = [Math.sin(yaw), 0, -Math.cos(yaw)]
        const right = [Math.cos(yaw), 0, Math.sin(yaw)]
        if (lowerKey === 'w') { position[0] += forward[0] * moveStep; position[2] += forward[2] * moveStep }
        if (lowerKey === 's') { position[0] -= forward[0] * moveStep; position[2] -= forward[2] * moveStep }
        if (lowerKey === 'a') { position[0] -= right[0] * moveStep; position[2] -= right[2] * moveStep }
        if (lowerKey === 'd') { position[0] += right[0] * moveStep; position[2] += right[2] * moveStep }
        if (lowerKey === 'r') position[1] += moveStep
        if (lowerKey === 'f') position[1] = Math.max(0.25, position[1] - moveStep)
        const isRotating = lowerKey === 'q' || lowerKey === 'e'
        if (lowerKey === 'q') rotation[1] += rotateStep
        if (lowerKey === 'e') rotation[1] -= rotateStep
        return { ...camera, position, rotation, lookAt: isRotating ? null : camera.lookAt }
      }))
    }
  }, [activeCameraId, selectedActor, selectedCamera, selectedJoint])

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      if (isTransforming || isPlaying) return

      if (event.key === 'w' || event.key === 'W') setTransformMode('translate')
      if (event.key === 'e' || event.key === 'E') setTransformMode('rotate')
      if (event.key === 'r' || event.key === 'R') {
        if (selectedCamera) nudgeSelected(event.key, event.shiftKey)
        else setTransformMode('scale')
        event.preventDefault()
        return
      }

      const controlKeys = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f']
      if (controlKeys.includes(event.key.toLowerCase())) {
        nudgeSelected(event.key, event.shiftKey)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, isTransforming, nudgeSelected, selectedCamera])

  const selectActor = (id) => {
    setSelectedActor(id)
    setSelectedProp(null)
    setSelectedCamera(null)
    setSelectedJoint(null)
    setPlacementMode(null)
  }

  const selectProp = (id) => {
    setSelectedProp(id)
    setSelectedActor(null)
    setSelectedCamera(null)
    setSelectedJoint(null)
    setPlacementMode(null)
  }

  const selectCamera = (id) => {
    setSelectedCamera(id)
    setSelectedActor(null)
    setSelectedProp(null)
    setSelectedJoint(null)
    setPlacementMode(null)
  }

  const startPlacement = (type) => {
    setPlacementMode(type)
    setSelectedProp(null)
    setSelectedActor(null)
    setSelectedCamera(null)
    setSelectedJoint(null)
  }

  const placeProp = useCallback((position) => {
    if (!placementMode) return
    propCounter.current += 1
    const id = `prop_${propCounter.current}`
    setProps((prev) => [...prev, { id, type: placementMode, position, rotation: [0, 0, 0], scale: [1, 1, 1], color: '#666666', locked: false, snapToGround: true }])
    setPlacementMode(null)
    setSelectedProp(id)
  }, [placementMode])

  const addKeyframeAt = useCallback((time) => {
    const actorSnapshot = actorsRef.current
    const cameraSnapshot = camerasRef.current
    const activeCamId = activeCameraIdRef.current
    const fov = cameraFovRef.current

    setTracks((prev) => {
      const next = [...prev]
      actorSnapshot.forEach((actor) => {
        const index = next.findIndex((track) => track.targetType === 'actor' && track.targetId === actor.id)
        const keyframe = { time, position: [...actor.position], rotation: [...actor.rotation], scale: [...actor.scale], pose: { ...actor.pose } }
        if (index >= 0) next[index] = { ...next[index], keyframes: [...next[index].keyframes, keyframe].sort((a, b) => a.time - b.time) }
        else next.push({ targetType: 'actor', targetId: actor.id, keyframes: [keyframe] })
      })

      const cam = cameraSnapshot.find((item) => item.id === activeCamId)
      if (cam) {
        const index = next.findIndex((track) => track.targetType === 'camera' && track.targetId === cam.id)
        const keyframe = { time, position: [...cam.position], rotation: [...(cam.rotation || [0, 0, 0])], lookAt: cam.lookAt ? [...cam.lookAt] : null, fov: cam.fov || fov }
        if (index >= 0) next[index] = { ...next[index], keyframes: [...next[index].keyframes, keyframe].sort((a, b) => a.time - b.time) }
        else next.push({ targetType: 'camera', targetId: cam.id, keyframes: [keyframe] })
      }

      return next
    })
  }, [])

  const addKeyframeNow = useCallback(() => {
    addKeyframeAt(currentTime)
    setCurrentTime((time) => Math.min(duration, time + RECORD_INTERVAL / 1000))
  }, [addKeyframeAt, currentTime, duration])

  const startRecord = () => {
    setTracks([])
    setCurrentTime(0)
    recordTimeRef.current = 0
    setIsRecording(true)
    setIsPlaying(false)
    addKeyframeAt(0)
    recordTimerRef.current = setInterval(() => {
      recordTimeRef.current = Math.min(duration, recordTimeRef.current + RECORD_INTERVAL / 1000)
      addKeyframeAt(recordTimeRef.current)
      setCurrentTime(recordTimeRef.current)
      if (recordTimeRef.current >= duration) stopRecord()
    }, RECORD_INTERVAL)
  }

  const stopRecord = () => {
    setIsRecording(false)
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }

  const play = useCallback(() => {
    if (isPlaying || isRecording) return
    setIsPlaying(true)
    const start = performance.now() / 1000 - currentTime
    playbackRef.current = setInterval(() => {
      const elapsed = performance.now() / 1000 - start
      if (elapsed >= duration) {
        if (loopMode) {
          setCurrentTime(0)
        } else {
          setIsPlaying(false)
          clearInterval(playbackRef.current)
          playbackRef.current = null
          resetToStart()
        }
        return
      }
      setCurrentTime(Math.min(elapsed, duration))
    }, 1000 / FPS)
  }, [currentTime, duration, isPlaying, isRecording, loopMode, resetToStart])

  const pause = () => {
    setIsPlaying(false)
    if (playbackRef.current) {
      clearInterval(playbackRef.current)
      playbackRef.current = null
    }
  }

  const stop = () => {
    setIsPlaying(false)
    stopRecord()
    if (playbackRef.current) {
      clearInterval(playbackRef.current)
      playbackRef.current = null
    }
    setCurrentTime(0)
    resetToStart()
  }

  const handleVideoRecord = () => {
    if (isVideoRecording) {
      stopRecording()
      setIsVideoRecording(false)
    } else {
      play()
      startRecording('.previz-preview-window canvas')
      setIsVideoRecording(true)
    }
  }

  const handleExportMode = useCallback((mode) => {
    const canvas = document.querySelector('.previz-canvas-wrap canvas')
    if (!canvas?.__r3f) return
    const { gl, scene, camera } = canvas.__r3f
    const url = renderExportFrame(gl, scene, camera, mode)
    downloadDataURL(url, `previz-${mode}.png`)
  }, [])

  const deleteKeyframe = (type, id, index) => {
    setTracks((prev) => prev
      .map((track) => track.targetType === type && track.targetId === id ? { ...track, keyframes: track.keyframes.filter((_, i) => i !== index) } : track)
      .filter((track) => track.keyframes.length > 0))
  }

  const moveKeyframe = (type, id, keyframes) => {
    setTracks((prev) => prev.map((track) => track.targetType === type && track.targetId === id ? { ...track, keyframes } : track))
  }

  const loadProject = (data) => {
    if (data.actors) setActors(data.actors)
    if (data.props) setProps(data.props)
    if (data.cameras) setCameras(data.cameras)
    if (data.timeline) setTracks(data.timeline)
    if (data.backgroundImage) setBackgroundImage(data.backgroundImage)
    setShowProject(false)
  }

  const handleBackgroundUpload = useCallback((file) => {
    if (!file) return
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current)
    const url = URL.createObjectURL(file)
    backgroundUrlRef.current = url
    setBackgroundImage({ url, name: file.name })
  }, [])

  const clearBackgroundImage = useCallback(() => {
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current)
    backgroundUrlRef.current = null
    setBackgroundImage(null)
  }, [])

  // ==========================================
  // AI 自然语言导演
  // ==========================================
  const handleAIDirect = useCallback(async (prompt) => {
    if (!prompt || !prompt.trim() || aiLoading) return

    // 保存快照以便撤销
    aiSnapshotRef.current = {
      actors: actorsRef.current.map((a) => ({ ...a, pose: { ...a.pose } })),
      props: [...props],
      cameras: camerasRef.current.map((c) => ({ ...c })),
      tracks: [...tracks],
      aspectRatio,
      cameraFov,
      cameraMode,
    }

    setAiLoading(true)
    setAiStatus({ phase: 'sending', message: '正在向 AI 导演发送指令...' })
    setAiError(null)

    try {
      const sceneContext = {
        actorCount: actorsRef.current.length,
        actorNames: actorsRef.current.map((a) => a.name),
        propCount: props.length,
        cameraCount: camerasRef.current.length,
        currentFov: cameraFovRef.current,
        currentAspect: aspectRatio,
        backgroundImageName: backgroundImage?.name || '',
        hasBackgroundImage: !!backgroundImage,
      }

      setAiStatus({ phase: 'analyzing', message: 'AI 正在分析场景指令...' })

      // 注意：直接用 fetch，不通过 /api/previz 避免路径冲突
      const resp = await fetch('/api/previz/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_context: sceneContext, prompt: prompt.trim() }),
      })

      const data = await resp.json()

      if (!data.success) {
        setAiError(data.message || 'AI 指令生成失败')
        setAiStatus(null)
        return
      }

      const { commands, explanation } = data.data
      if (!commands || commands.length === 0) {
        setAiError('AI 未生成有效的场景命令，请尝试更具体的描述。')
        setAiStatus(null)
        return
      }

      setAiStatus({ phase: 'executing', message: `正在执行 ${commands.length} 条场景命令...` })

      // 构建回调函数集合（每个回调内部调用现有 setState）
      const callbacks = {
        createActor: ({ name, position, rotation, scale, pose: posePreset }) => {
          actorCounter.current += 1
          const id = `actor_${actorCounter.current}`
          const colors = ['#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff', '#ffff44', '#ff8844', '#8844ff']
          const color = colors[(actorCounter.current - 1) % colors.length]
          const pose = posePreset && POSE_PRESETS[posePreset]
            ? POSE_PRESETS[posePreset]()
            : { ...DEFAULT_POSE }
          const newActor = {
            id,
            name: name || `演员 ${String.fromCharCode(65 + ((actorCounter.current - 1) % 26))}`,
            color,
            position: position ? snapToGround(position) : [actorCounter.current * 1.5 - 2, 0, 0],
            rotation: rotation || [0, 0, 0],
            scale: scale || [1, 1, 1],
            pose,
            footLock: true,
          }
          setActors((prev) => [...prev, newActor])
          return id
        },
        deleteActor: (id) => {
          setActors((prev) => prev.filter((a) => a.id !== id))
          if (selectedActor === id) setSelectedActor(null)
        },
        renameActor,
        createProp: (type, position, rotation, scale) => {
          propCounter.current += 1
          const id = `prop_${propCounter.current}`
          setProps((prev) => [
            ...prev,
            {
              id,
              type,
              position: position || [0, getPropGroundY(type), 0],
              rotation: rotation || [0, 0, 0],
              scale: scale || [1, 1, 1],
              color: '#666666',
              locked: false,
              snapToGround: true,
            },
          ])
          return id
        },
        deleteProp: (id) => {
          setProps((prev) => prev.filter((p) => p.id !== id))
          if (selectedProp === id) setSelectedProp(null)
        },
        createCamera: ({ name, position, rotation, fov, lookAt }) => {
          const id = `cam${camerasRef.current.length + 1}`
          const newCam = {
            id,
            name: name || id,
            position: position || [0, 2.2, 8],
            rotation: rotation || [0, 0, 0],
            fov: fov || 45,
            lookAt: lookAt || [0, 1.2, 0],
          }
          setCameras((prev) => [...prev, newCam])
          return id
        },
        deleteCamera: (id) => {
          setCameras((prev) => prev.filter((c) => c.id !== id))
          if (selectedCamera === id) setSelectedCamera(null)
          if (activeCameraId === id) setActiveCameraId('cam1')
        },
        selectActor: selectActor,
        selectCamera: selectCamera,
        applyPose: (preset, actorId) => {
          if (!POSE_PRESETS[preset] || !actorId) return
          setActors((prev) =>
            prev.map((a) => (a.id === actorId ? { ...a, pose: POSE_PRESETS[preset]() } : a))
          )
        },
        moveActor: (id, position, rotation) => {
          setActors((prev) =>
            prev.map((a) => {
              if (a.id !== id) return a
              return {
                ...a,
                position: position ? snapToGround(position) : a.position,
                rotation: rotation || a.rotation,
              }
            })
          )
        },
        moveCamera: (id, position, rotation, lookAt, fov) => {
          setCameras((prev) =>
            prev.map((c) => {
              if (c.id !== id) return c
              return {
                ...c,
                position: position || c.position,
                rotation: rotation || c.rotation,
                lookAt: lookAt !== undefined ? lookAt : c.lookAt,
                fov: fov !== undefined ? fov : c.fov,
              }
            })
          )
        },
        moveProp: (id, position, rotation, scale) => {
          setProps((prev) =>
            prev.map((p) => {
              if (p.id !== id) return p
              const type = p.type
              return {
                ...p,
                position: position ? [position[0], getPropGroundY(type), position[2]] : p.position,
                rotation: rotation || p.rotation,
                scale: scale || p.scale,
              }
            })
          )
        },
        configureCamera: (id, { fov, mode, lookAt }) => {
          setCameras((prev) =>
            prev.map((c) => {
              if (c.id !== id) return c
              return {
                ...c,
                fov: fov !== undefined ? fov : c.fov,
                lookAt: lookAt !== undefined ? lookAt : c.lookAt,
              }
            })
          )
          if (mode) setCameraMode(mode)
        },
        setCameraMode,
        setActiveCamera: setActiveCameraId,
        setCameraFov: updateActiveCameraFov,
        setAspectRatio,
        focusCameraOnActor: (actorId) => {
          const target = actorsRef.current.find((a) => a.id === actorId)
          if (!target) return
          const camId = selectedCamera || activeCameraId
          setCameras((prev) =>
            prev.map((c) =>
              c.id === camId
                ? { ...c, lookAt: [target.position[0], 1.2, target.position[2]] }
                : c
            )
          )
        },
        addKeyframe: (time) => addKeyframeAt(time),
        resetScene: () => {
          setActors([])
          setProps([])
          setSelectedActor(null)
          setSelectedProp(null)
          setSelectedJoint(null)
        },
        clearAllProps: () => {
          setProps([])
          setSelectedProp(null)
        },
        clearAllActors: () => {
          setActors([])
          setSelectedActor(null)
          setSelectedJoint(null)
        },
        getAllActors: () => actorsRef.current,
        getAllCameras: () => camerasRef.current,
        getAllProps: () => props,
      }

      // 执行命令
      const result = applyCommands(commands, callbacks)

      setAiStatus(null)
      setCommandHistory((prev) =>
        [
          {
            prompt: prompt.trim(),
            timestamp: Date.now(),
            commands: commands.length,
            applied: result.applied,
            errors: result.errors,
            explanation,
          },
          ...prev,
        ].slice(0, 20)
      )
    } catch (err) {
      setAiError(`网络错误：${err.message || '请检查后端服务是否启动'}`)
      setAiStatus(null)
    } finally {
      setAiLoading(false)
    }
  }, [
    aiLoading, props, tracks, aspectRatio, cameraFov, cameraMode,
    selectedActor, selectedCamera, selectedProp, activeCameraId,
    addKeyframeAt, backgroundImage, updateActiveCameraFov,
  ])

  /** 撤销 AI 操作：恢复到 AI 执行前的快照 */
  const undoAI = useCallback(() => {
    const snap = aiSnapshotRef.current
    if (!snap) return
    setActors(snap.actors)
    setProps(snap.props)
    setCameras(snap.cameras)
    setTracks(snap.tracks)
    setAspectRatio(snap.aspectRatio)
    setCameraFov(snap.cameraFov)
    setCameraMode(snap.cameraMode)
    aiSnapshotRef.current = null
    setAiError(null)
    setAiStatus(null)
  }, [])

  const hasAISnapshot = () => aiSnapshotRef.current !== null

  useEffect(() => () => {
    if (playbackRef.current) clearInterval(playbackRef.current)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
  }, [])

  return (
    <div className={`previz-panel ${isRecording ? 'previz-recording' : ''}`}>
      <ControlPanel
        actors={actors}
        selectedActor={selectedActor}
        selectedJoint={selectedJoint}
        onAddActor={addActor}
        onSelectActor={selectActor}
        onDeleteActor={deleteActor}
        onRenameActor={renameActor}
        onApplyPose={applyPose}
        onStartPlacement={startPlacement}
        placementMode={placementMode}
        onCancelPlacement={() => setPlacementMode(null)}
        cameras={cameras}
        selectedCamera={selectedCamera}
        activeCameraId={activeCameraId}
        onSelectCamera={selectCamera}
        onSetActiveCamera={setActiveCameraId}
        onFocusCamera={focusActiveCameraOnActor}
        onResetCamera={resetActiveCameraView}
        cameraFov={activeCamera?.fov || cameraFov}
        setCameraFov={updateActiveCameraFov}
        cameraMode={cameraMode}
        setCameraMode={setCameraMode}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        transformMode={transformMode}
        setTransformMode={setTransformMode}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showGuides={showGuides}
        setShowGuides={setShowGuides}
        isPlaying={isPlaying}
        isRecording={isRecording}
        loopMode={loopMode}
        onPlay={play}
        onPause={pause}
        onStop={stop}
        onRecord={startRecord}
        onLoop={() => setLoopMode((value) => !value)}
        onAddKeyframe={addKeyframeNow}
        onScreenshot={() => exportScreenshot()}
        onRecordVideo={handleVideoRecord}
        onExportMode={handleExportMode}
        onOpenProject={() => setShowProject(true)}
        isVideoRecording={isVideoRecording}
        aiLoading={aiLoading}
        aiStatus={aiStatus}
        aiError={aiError}
        onAIDirect={handleAIDirect}
        onUndoAI={undoAI}
        hasAISnapshot={hasAISnapshot}
        commandHistory={commandHistory}
        onClearAIError={() => setAiError(null)}
        backgroundImage={backgroundImage}
        onBackgroundUpload={handleBackgroundUpload}
        onClearBackground={clearBackgroundImage}
      />

      <div className="previz-canvas-wrap">
        {onBack && <button className="previz-back-btn" onClick={onBack}>返回</button>}
        {exportStatus && <div className="previz-export-toast">{exportStatus}</div>}
        {isRecording && <div className="previz-rec-indicator"><div className="rec-dot" />录制中 {currentTime.toFixed(1)}s</div>}
        {placementMode && <div className="previz-placement-indicator">点击地面放置道具</div>}
        <Canvas shadows camera={{ position: [0, 6, 12], fov: 55, near: 0.1, far: 500 }} gl={{ antialias: true, preserveDrawingBuffer: true }} onPointerMissed={handlePointerMissed}>
          <color attach="background" args={['#1e1e1e']} />
          <PrevizScene
            actors={actors}
            props={props}
            cameras={cameras}
            activeCameraId={activeCameraId}
            cameraFov={cameraFov}
            aspectRatio={aspectRatio}
            showGrid={showGrid}
            showGuides={showGuides}
            selectedActor={selectedActor}
            selectedProp={selectedProp}
            selectedCamera={selectedCamera}
            selectedJoint={selectedJoint}
            onSelectActor={selectActor}
            onSelectProp={selectProp}
            onSelectCamera={selectCamera}
            onSelectJoint={setSelectedJoint}
            actorRefs={actorRefs}
            propRefs={propRefs}
            cameraRefs={cameraRefs}
            onRegisterObject={registerSceneObject}
            placementMode={placementMode}
            onPlaceProp={placeProp}
            backgroundImage={backgroundImage}
          />
          <OrbitControls makeDefault enabled={!isTransforming} />
          {selectedActor && selectedActorTarget && (
            <TransformGizmo
              target={selectedActorTarget}
              mode={selectedJoint ? 'rotate' : transformMode}
              onChange={(position, rotation, scale) => selectedJoint ? updateJoint(selectedActor, selectedJoint, rotation) : handleActorTransform(selectedActor, position, rotation, scale)}
              onDragStart={() => setIsTransforming(true)}
              onDragEnd={() => setIsTransforming(false)}
            />
          )}
          {selectedProp && selectedPropRoot && (
            <TransformGizmo
              target={selectedPropRoot}
              mode={transformMode}
              onChange={(position, rotation, scale) => handlePropTransform(selectedProp, position, rotation, scale)}
              onDragStart={() => setIsTransforming(true)}
              onDragEnd={() => setIsTransforming(false)}
            />
          )}
          {selectedCamera && selectedCameraRoot && (
            <TransformGizmo
              target={selectedCameraRoot}
              mode={transformMode}
              onChange={(position, rotation) => handleCameraTransform(selectedCamera, position, rotation, transformMode)}
              onDragStart={() => setIsTransforming(true)}
              onDragEnd={() => setIsTransforming(false)}
            />
          )}
        </Canvas>

        <div className="previz-preview-window">
          <div className="previz-preview-label">{activeCamera?.name || 'CAM'} | {activeCamera?.fov || cameraFov} | {aspectRatio}{isVideoRecording ? ' | REC' : ''}</div>
          <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: activeCamera?.position || [0, 2.2, 8], fov: activeCamera?.fov || cameraFov }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
            <color attach="background" args={['#000000']} />
            <MoviePreviewCamera cameraConfig={activeCamera} aspectRatio={aspectRatio} fallbackFov={cameraFov} />
            <PrevizScene
              actors={actors}
              props={props}
              cameras={cameras}
              activeCameraId={activeCameraId}
              cameraFov={cameraFov}
              aspectRatio={aspectRatio}
              showGrid={false}
              showGuides={showGuides}
              selectedActor={null}
              selectedProp={null}
              selectedCamera={null}
              selectedJoint={null}
              onSelectActor={() => {}}
              onSelectProp={() => {}}
              onSelectCamera={() => {}}
              onSelectJoint={() => {}}
              actorRefs={{ current: {} }}
              propRefs={{ current: {} }}
              cameraRefs={{ current: {} }}
              showCameraRigs={false}
              backgroundImage={backgroundImage}
            />
          </Canvas>
        </div>

        <div className="previz-info-tag">
          右键旋转 | 滚轮缩放 | Shift+右键平移
          {isPlaying && <span style={{ color: '#00ffcc', marginLeft: 8 }}>播放 {currentTime.toFixed(1)}s/{duration}s</span>}
          {isRecording && <span style={{ color: '#ff4444', marginLeft: 8 }}>REC</span>}
          {placementMode && <span style={{ color: '#ffaa00', marginLeft: 8 }}>放置模式</span>}
        </div>
      </div>

      <TimelinePanel
        duration={duration}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        tracks={tracks}
        onDeleteKeyframe={deleteKeyframe}
        onMoveKeyframe={moveKeyframe}
        actors={actors}
        cameras={cameras}
        fps={FPS}
      />

      {showProject && (
        <ProjectManager
          actors={actors}
          props={props}
          cameras={cameras}
          timeline={tracks}
          config={{ aspectRatio, fps: FPS, backgroundImage }}
          onClose={() => setShowProject(false)}
          onLoad={loadProject}
        />
      )}
    </div>
  )
}
