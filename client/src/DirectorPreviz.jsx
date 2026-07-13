import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { applyCommands, ensureCameraTrackForRecording } from './components/previz/PrevizCommandExecutor'
import { assessExecutableTimeline, optimizeCinematicTracks } from './components/previz/CinematicMotion'
import ShotPackagePanel from './components/previz/ShotPackagePanel'
import {
  buildFrameSynthesisPrompt,
  buildVideoHandoffPrompt,
  mergeShotPackage,
} from './components/previz/ShotPackageTools'

const RECORD_INTERVAL = 500
const FPS = 60
const MOVE_STEP = 0.18
const FAST_MOVE_STEP = 0.55
const ROTATE_STEP = 0.08
const FACE_LOOK_AT_Y = 1.75
const AUTO_RECORD_KEYWORDS = ['录制', '导出', '下载', '参考片', '素材', '等待结果', '查看回放', '回放']
const HANDOFF_STORAGE_KEY = 'aihub:previz-handoff:v1'

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

function shouldAutoRecordFromPrompt(prompt = '') {
  return AUTO_RECORD_KEYWORDS.some((keyword) => prompt.includes(keyword))
}

function extractDurationFromPrompt(prompt = '', fallback = 10) {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(秒|s|S)/)
  if (!match) return fallback
  return Math.max(1, Math.min(120, Number(match[1]) || fallback))
}

function loadHandoffState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HANDOFF_STORAGE_KEY) || '{}')
    if (parsed.version !== 1) return { shotPackages: {}, references: [] }
    return {
      shotPackages: parsed.shotPackages && typeof parsed.shotPackages === 'object' ? parsed.shotPackages : {},
      references: Array.isArray(parsed.references) ? parsed.references : [],
    }
  } catch {
    return { shotPackages: {}, references: [] }
  }
}

async function uploadPrevizAsset(file) {
  const formData = new FormData()
  formData.append('files', file)
  const response = await fetch('/api/upload', { method: 'POST', body: formData })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.success || !data.files?.[0]?.url) {
    throw new Error(data.message || '素材上传失败')
  }
  return data.files[0]
}

function waitForCanvasFrame(selector, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    const check = () => {
      const canvas = selector ? document.querySelector(selector) : null
      const hasExpectedSize = !selector || (canvas && canvas.width >= 1000 && canvas.height >= 800)
      if (hasExpectedSize || performance.now() - startedAt >= timeoutMs) {
        requestAnimationFrame(() => resolve(canvas))
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

function canvasToPngBlob(canvas, width, height) {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error('没有找到活动机位画布'))
      return
    }
    const output = document.createElement('canvas')
    output.width = width || canvas.width || 1920
    output.height = height || canvas.height || 1080
    const context = output.getContext('2d')
    context.drawImage(canvas, 0, 0, output.width, output.height)
    output.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('镜头帧编码失败'))
    }, 'image/png')
  })
}

function getRenderDimensions(aspectRatio) {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 }
  if (aspectRatio === '2.35:1') return { width: 1920, height: 816 }
  return { width: 1920, height: 1080 }
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
      camera.lookAt(0, FACE_LOOK_AT_Y, 0)
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
  backgroundImages,
  isPreview = false,
  environmentMode = 'ground',
}) {
  const aspect = getAspectValue(aspectRatio)
  return (
    <>
      <SceneSetup
        showGrid={showGrid}
        showGuides={showGuides}
        fogColor="#1e1e1e"
        backgroundImages={backgroundImages}
        preview={isPreview}
        environmentMode={environmentMode}
      />
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

export default function DirectorPreviz({ onBack, onSendToVideo }) {
  const [actors, setActors] = useState([
    { id: 'actor_1', name: '演员 A', color: '#3366ff', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pose: { ...DEFAULT_POSE }, footLock: true },
  ])
  const [props, setProps] = useState([])
  const [cameras, setCameras] = useState([
    { id: 'cam1', name: '主机位', fov: 45, position: [0, 2.2, 8], rotation: [0, 0, 0], lookAt: [0, FACE_LOOK_AT_Y, 0] },
  ])

  const [selectedActor, setSelectedActor] = useState('actor_1')
  const [selectedProp, setSelectedProp] = useState(null)
  const [selectedCamera, setSelectedCamera] = useState(null)
  const [selectedJoint, setSelectedJoint] = useState(null)
  const [cameraFov, setCameraFov] = useState(45)
  const [cameraMode, setCameraMode] = useState('fixed')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [activeCameraId, setActiveCameraId] = useState('cam1')
  const [viewportMode, setViewportMode] = useState('director')
  const [transformMode, setTransformMode] = useState('translate')
  const [isTransforming, setIsTransforming] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showGuides, setShowGuides] = useState(true)
  const [backgroundImage, setBackgroundImage] = useState(null)
  const [backgroundImages, setBackgroundImages] = useState([])
  const [environmentMode, setEnvironmentMode] = useState('ground')
  const [placementMode, setPlacementMode] = useState(null)
  const [duration, setDuration] = useState(30)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [loopMode, setLoopMode] = useState(false)
  const [tracks, setTracks] = useState([])
  const [showProject, setShowProject] = useState(false)
  const [isVideoRecording, setIsVideoRecording] = useState(false)
  const [recordSurfaceActive, setRecordSurfaceActive] = useState(false)
  const [sceneTargets, setSceneTargets] = useState({ actors: {}, props: {}, cameras: {} })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState(null)
  const [aiError, setAiError] = useState(null)
  const [shotQuality, setShotQuality] = useState(null)
  const [commandHistory, setCommandHistory] = useState([])
  const [shotPlan, setShotPlan] = useState(null)
  const [shotPlanLoading, setShotPlanLoading] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState(null)
  const [shotPackages, setShotPackages] = useState(() => loadHandoffState().shotPackages)
  const [referenceLibrary, setReferenceLibrary] = useState(() => loadHandoffState().references)
  const [packageBusy, setPackageBusy] = useState(null)
  const [packageError, setPackageError] = useState(null)

  const playbackRef = useRef(null)
  const videoRecordTimerRef = useRef(null)
  const aiSnapshotRef = useRef(null)
  const recordTimerRef = useRef(null)
  const recordTimeRef = useRef(0)
  const actorRefs = useRef({})
  const propRefs = useRef({})
  const cameraRefs = useRef({})
  const actorCounter = useRef(1)
  const propCounter = useRef(0)
  const actorsRef = useRef(actors)
  const propsRef = useRef(props)
  const camerasRef = useRef(cameras)
  const tracksRef = useRef(tracks)
  const cameraFovRef = useRef(cameraFov)
  const activeCameraIdRef = useRef(activeCameraId)
  const durationRef = useRef(duration)
  const backgroundUrlRef = useRef(null)
  const backgroundUrlsRef = useRef(new Set())
  const recordingPackageKeyRef = useRef('free')

  useEffect(() => { actorsRef.current = actors }, [actors])
  useEffect(() => { propsRef.current = props }, [props])
  useEffect(() => { camerasRef.current = cameras }, [cameras])
  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { cameraFovRef.current = cameraFov }, [cameraFov])
  useEffect(() => { activeCameraIdRef.current = activeCameraId }, [activeCameraId])
  useEffect(() => { durationRef.current = duration }, [duration])
  useEffect(() => () => {
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current)
    backgroundUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    backgroundUrlsRef.current.clear()
    if (videoRecordTimerRef.current) clearTimeout(videoRecordTimerRef.current)
  }, [])

  const currentShot = useMemo(() => {
    if (!shotPlan?.shots?.length) return null
    return shotPlan.shots.find((shot) => shot.id === selectedShotId) || shotPlan.shots[0]
  }, [selectedShotId, shotPlan])
  const shotPackageKey = currentShot?.id || 'free'
  const currentShotPackage = useMemo(
    () => mergeShotPackage(shotPackages[shotPackageKey], currentShot),
    [currentShot, shotPackageKey, shotPackages],
  )

  const updateShotPackage = useCallback((patch, targetKey = shotPackageKey) => {
    setShotPackages((previous) => {
      const targetShot = shotPlan?.shots?.find((shot) => shot.id === targetKey) || (targetKey === shotPackageKey ? currentShot : null)
      const current = mergeShotPackage(previous[targetKey], targetShot)
      const resolvedPatch = typeof patch === 'function' ? patch(current) : patch
      return {
        ...previous,
        [targetKey]: {
          ...current,
          ...resolvedPatch,
          updatedAt: new Date().toISOString(),
        },
      }
    })
  }, [currentShot, shotPackageKey, shotPlan])

  useEffect(() => {
    const payload = JSON.stringify({ version: 1, shotPackages, references: referenceLibrary })
    localStorage.setItem(HANDOFF_STORAGE_KEY, payload)
  }, [referenceLibrary, shotPackages])

  const handleRecordingComplete = useCallback(async ({ blob, ext, mimeType, width, height, fps }) => {
    const targetKey = recordingPackageKeyRef.current
    setRecordSurfaceActive(false)
    setPackageBusy('upload-video')
    setPackageError(null)
    try {
      const file = new File([blob], `previz-${targetKey}-${Date.now()}.${ext}`, { type: mimeType })
      let videoAsset
      try {
        const formData = new FormData()
        formData.append('video', file)
        formData.append('width', String(width || 1920))
        formData.append('height', String(height || 1080))
        formData.append('fps', String(fps || 60))
        const response = await fetch('/api/previz/normalize-video', { method: 'POST', body: formData })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.success || !data.data?.url) {
          throw new Error(data.message || 'H.264 MP4转换失败')
        }
        videoAsset = data.data
      } catch (normalizeError) {
        const uploaded = await uploadPrevizAsset(file)
        videoAsset = {
          url: uploaded.url,
          filename: uploaded.filename || file.name,
          size: blob.size,
          mimeType,
          ext,
          width,
          height,
          fps,
        }
        setPackageError(`MP4转换失败，已保留${String(ext).toUpperCase()}备用：${normalizeError.message}`)
      }
      updateShotPackage({
        previzVideo: {
          kind: 'video',
          url: videoAsset.url,
          name: videoAsset.filename || file.name,
          size: videoAsset.size || blob.size,
          mimeType: videoAsset.mimeType || mimeType,
        },
      }, targetKey)
      return videoAsset
    } catch (err) {
      setPackageError(`3D预演视频上传失败：${err.message}`)
      throw err
    } finally {
      setPackageBusy(null)
    }
  }, [updateShotPackage])

  const {
    exportStatus,
    lastRecording,
    exportScreenshot,
    startRecording,
    stopRecording,
    downloadLastRecording,
    clearLastRecording,
  } = usePrevizExport({ onRecordingComplete: handleRecordingComplete })
  const { resetToStart } = useTimelinePlayback({ actors, setActors, props, setProps, cameras, setCameras, tracks, currentTime, isPlaying })

  const activeCamera = cameras.find((camera) => camera.id === activeCameraId)
  const packageSceneContext = useMemo(() => ({
    actors,
    props,
    cameras,
    tracks,
    duration,
    activeCameraId,
  }), [activeCameraId, actors, cameras, duration, props, tracks])
  const recordDimensions = useMemo(() => getRenderDimensions(aspectRatio), [aspectRatio])
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
      ? [targetActor.position[0], FACE_LOOK_AT_Y, targetActor.position[2]]
      : [0, FACE_LOOK_AT_Y, 0]
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
      ? [targetActor.position[0], FACE_LOOK_AT_Y, targetActor.position[2]]
      : [0, FACE_LOOK_AT_Y, 0]
    const cameraId = selectedCamera || activeCameraId
    setCameras((prev) => prev.map((camera) => (
      camera.id === cameraId
        ? { ...camera, position: [target[0], 2.2, target[2] + 8], rotation: [0, 0, 0], lookAt: target }
        : camera
    )))
  }, [activeCameraId, selectedActor, selectedCamera])

  const getSceneFocusPoint = useCallback(() => {
    const actorPoints = actorsRef.current.map((actor) => [
      Number(actor.position?.[0]) || 0,
      FACE_LOOK_AT_Y,
      Number(actor.position?.[2]) || 0,
    ])
    const propPoints = propsRef.current
      .filter((prop) => prop.type !== 'starfield')
      .map((prop) => [
        Number(prop.position?.[0]) || 0,
        Math.max(0.8, Number(prop.position?.[1]) || 0.8),
        Number(prop.position?.[2]) || 0,
      ])
    const points = actorPoints.length ? actorPoints : propPoints
    if (!points.length) return [0, FACE_LOOK_AT_Y, 0]

    const focus = points.reduce((sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2],
    ], [0, 0, 0]).map((value) => value / points.length)

    if (actorPoints.length) focus[1] = FACE_LOOK_AT_Y
    return focus
  }, [])

  const sanitizeActiveCameraForRecording = useCallback(() => {
    const focus = getSceneFocusPoint()
    const currentCameras = camerasRef.current.length
      ? camerasRef.current
      : [{ id: 'cam1', name: '主机位', fov: cameraFovRef.current || 45, position: [0, 2.2, 8], rotation: [0, 0, 0], lookAt: focus }]
    const cameraId = currentCameras.some((camera) => camera.id === activeCameraIdRef.current)
      ? activeCameraIdRef.current
      : currentCameras[0].id
    const isFreeSpace = environmentMode === 'space' || environmentMode === 'air'
    let activeFov = cameraFovRef.current || 45

    const nextCameras = currentCameras.map((camera) => {
      if (camera.id !== cameraId) return camera

      const rawPosition = Array.isArray(camera.position) ? camera.position : [focus[0], focus[1] + 1.2, focus[2] + 7]
      const rawLookAt = Array.isArray(camera.lookAt) ? camera.lookAt : focus
      const validPosition = rawPosition.every((value) => Number.isFinite(Number(value)))
      const validLookAt = rawLookAt.every((value) => Number.isFinite(Number(value)))
      let position = validPosition ? rawPosition.map(Number) : [focus[0], focus[1] + 1.2, focus[2] + 7]
      let lookAt = validLookAt ? rawLookAt.map(Number) : focus

      const distanceToFocus = Math.hypot(position[0] - focus[0], position[1] - focus[1], position[2] - focus[2])
      const lookAtDrift = Math.hypot(lookAt[0] - focus[0], lookAt[1] - focus[1], lookAt[2] - focus[2])
      if (!validPosition || distanceToFocus < 1 || distanceToFocus > 80) {
        const distance = isFreeSpace ? 10 : 7
        position = [focus[0], focus[1] + (isFreeSpace ? 2 : 1.25), focus[2] + distance]
      }
      if (!validLookAt || lookAtDrift > 30) lookAt = focus
      if (!isFreeSpace && position[1] < 0.9) position[1] = 1.6

      activeFov = Math.max(18, Math.min(90, Number(camera.fov || cameraFovRef.current || 45)))
      return { ...camera, position, lookAt, rotation: camera.rotation || [0, 0, 0], fov: activeFov }
    })
    const activeCameraAfterSanitize = nextCameras.find((camera) => camera.id === cameraId)
    const repairCameraKeyframe = (keyframe) => {
      const fallbackPosition = activeCameraAfterSanitize?.position || [focus[0], focus[1] + 1.25, focus[2] + 7]
      const rawPosition = Array.isArray(keyframe.position) ? keyframe.position : fallbackPosition
      const rawLookAt = Array.isArray(keyframe.lookAt) ? keyframe.lookAt : focus
      const validPosition = rawPosition.every((value) => Number.isFinite(Number(value)))
      const validLookAt = rawLookAt.every((value) => Number.isFinite(Number(value)))
      let position = validPosition ? rawPosition.map(Number) : fallbackPosition
      let lookAt = validLookAt ? rawLookAt.map(Number) : focus
      const distanceToFocus = Math.hypot(position[0] - focus[0], position[1] - focus[1], position[2] - focus[2])
      const lookAtDrift = Math.hypot(lookAt[0] - focus[0], lookAt[1] - focus[1], lookAt[2] - focus[2])

      if (!validPosition || distanceToFocus < 1 || distanceToFocus > 80) {
        const distance = isFreeSpace ? 10 : 7
        position = [focus[0], focus[1] + (isFreeSpace ? 2 : 1.25), focus[2] + distance]
      }
      if (!validLookAt || lookAtDrift > 30) lookAt = focus
      if (!isFreeSpace && position[1] < 0.9) position[1] = 1.6

      return {
        ...keyframe,
        position,
        lookAt,
        fov: keyframe.fov == null ? activeFov : Math.max(18, Math.min(90, Number(keyframe.fov) || activeFov)),
      }
    }
    const nextTracks = tracksRef.current.map((track) => {
      if (track.targetType !== 'camera' || track.targetId !== cameraId || !track.keyframes?.length) return track
      return { ...track, keyframes: track.keyframes.map(repairCameraKeyframe) }
    })

    camerasRef.current = nextCameras
    tracksRef.current = nextTracks
    activeCameraIdRef.current = cameraId
    cameraFovRef.current = activeFov
    flushSync(() => {
      setCameras(nextCameras)
      setTracks(nextTracks)
      setActiveCameraId(cameraId)
      setCameraFov(activeFov)
    })
    return activeCameraAfterSanitize
  }, [environmentMode, getSceneFocusPoint])

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
    const propSnapshot = propsRef.current
    const cameraSnapshot = camerasRef.current
    const activeCamId = activeCameraIdRef.current
    const fov = cameraFovRef.current

    setTracks((prev) => {
      const next = [...prev]
      actorSnapshot.forEach((actor) => {
        const index = next.findIndex((track) => track.targetType === 'actor' && track.targetId === actor.id)
        const keyframe = { time, position: [...actor.position], rotation: [...actor.rotation], scale: [...actor.scale], pose: { ...actor.pose }, easing: 'easeInOutSine' }
        if (index >= 0) next[index] = { ...next[index], interpolation: 'cinematic', keyframes: [...next[index].keyframes, keyframe].sort((a, b) => a.time - b.time) }
        else next.push({ targetType: 'actor', targetId: actor.id, interpolation: 'cinematic', keyframes: [keyframe] })
      })

      propSnapshot.forEach((prop) => {
        const index = next.findIndex((track) => track.targetType === 'prop' && track.targetId === prop.id)
        const keyframe = {
          time,
          position: [...(prop.position || [0, 0, 0])],
          rotation: [...(prop.rotation || [0, 0, 0])],
          scale: [...(prop.scale || [1, 1, 1])],
          easing: 'easeInOutSine',
        }
        if (index >= 0) next[index] = { ...next[index], interpolation: 'cinematic', keyframes: [...next[index].keyframes, keyframe].sort((a, b) => a.time - b.time) }
        else next.push({ targetType: 'prop', targetId: prop.id, interpolation: 'cinematic', keyframes: [keyframe] })
      })

      const cam = cameraSnapshot.find((item) => item.id === activeCamId)
      if (cam) {
        const index = next.findIndex((track) => track.targetType === 'camera' && track.targetId === cam.id)
        const keyframe = { time, position: [...cam.position], rotation: [...(cam.rotation || [0, 0, 0])], lookAt: cam.lookAt ? [...cam.lookAt] : null, fov: cam.fov || fov, easing: 'easeInOutCubic' }
        if (index >= 0) next[index] = { ...next[index], interpolation: 'cinematic', keyframes: [...next[index].keyframes, keyframe].sort((a, b) => a.time - b.time) }
        else next.push({ targetType: 'camera', targetId: cam.id, interpolation: 'cinematic', keyframes: [keyframe] })
      }

      tracksRef.current = next
      return next
    })
  }, [])

  const resetToTimelineStart = useCallback(() => {
    const currentTracks = tracksRef.current
    if (!currentTracks.length) {
      setCurrentTime(0)
      return
    }

    const nextActors = actorsRef.current.map((actor) => ({ ...actor, pose: actor.pose ? { ...actor.pose } : {} }))
    const nextProps = propsRef.current.map((prop) => ({ ...prop }))
    const nextCameras = camerasRef.current.map((camera) => ({ ...camera }))
    for (const track of currentTracks) {
      const first = track.keyframes?.[0]
      if (!first) continue
      if (track.targetType === 'actor') {
        const index = nextActors.findIndex((actor) => actor.id === track.targetId)
        if (index >= 0) {
          nextActors[index] = {
            ...nextActors[index],
            position: first.position ? [...first.position] : nextActors[index].position,
            rotation: first.rotation ? [...first.rotation] : nextActors[index].rotation,
            scale: first.scale ? [...first.scale] : nextActors[index].scale,
            pose: first.pose ? { ...first.pose } : nextActors[index].pose,
          }
        }
      }
      if (track.targetType === 'camera') {
        const index = nextCameras.findIndex((camera) => camera.id === track.targetId)
        if (index >= 0) {
          nextCameras[index] = {
            ...nextCameras[index],
            position: first.position ? [...first.position] : nextCameras[index].position,
            rotation: first.rotation ? [...first.rotation] : nextCameras[index].rotation,
            lookAt: first.lookAt ? [...first.lookAt] : nextCameras[index].lookAt,
            fov: first.fov ?? nextCameras[index].fov,
          }
        }
      }
      if (track.targetType === 'prop') {
        const index = nextProps.findIndex((prop) => prop.id === track.targetId)
        if (index >= 0) {
          nextProps[index] = {
            ...nextProps[index],
            position: first.position ? [...first.position] : nextProps[index].position,
            rotation: first.rotation ? [...first.rotation] : nextProps[index].rotation,
            scale: first.scale ? [...first.scale] : nextProps[index].scale,
          }
        }
      }
    }
    actorsRef.current = nextActors
    propsRef.current = nextProps
    camerasRef.current = nextCameras
    setActors(nextActors)
    setProps(nextProps)
    setCameras(nextCameras)
    setCurrentTime(0)
  }, [])

  const addKeyframeNow = useCallback(() => {
    addKeyframeAt(currentTime)
    setCurrentTime((time) => Math.min(duration, time + RECORD_INTERVAL / 1000))
  }, [addKeyframeAt, currentTime, duration])

  const startRecord = () => {
    tracksRef.current = []
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

  const startPlaybackAt = useCallback((fromTime = 0, { allowLoop = false, endTime, onComplete } = {}) => {
    if (playbackRef.current) cancelAnimationFrame(playbackRef.current)
    const limit = Math.max(0.1, Number(endTime) || Number(durationRef.current) || 1)
    const safeStart = Math.max(0, Math.min(Number(fromTime) || 0, limit))
    let startedAt = performance.now() / 1000 - safeStart
    setCurrentTime(safeStart)
    setIsPlaying(true)

    const tick = (now) => {
      const elapsed = now / 1000 - startedAt
      if (elapsed >= limit) {
        if (allowLoop) {
          startedAt = now / 1000
          setCurrentTime(0)
          playbackRef.current = requestAnimationFrame(tick)
          return
        }
        setCurrentTime(limit)
        setIsPlaying(false)
        playbackRef.current = null
        onComplete?.()
        return
      }
      setCurrentTime(elapsed)
      playbackRef.current = requestAnimationFrame(tick)
    }
    playbackRef.current = requestAnimationFrame(tick)
    return true
  }, [])

  const play = useCallback(() => {
    if (isPlaying || isRecording || isVideoRecording) return
    const fromTime = currentTime >= duration ? 0 : currentTime
    startPlaybackAt(fromTime, {
      allowLoop: loopMode,
      endTime: duration,
      onComplete: loopMode ? undefined : resetToStart,
    })
  }, [currentTime, duration, isPlaying, isRecording, isVideoRecording, loopMode, resetToStart, startPlaybackAt])

  const pause = () => {
    setIsPlaying(false)
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current)
      playbackRef.current = null
    }
  }

  const stop = () => {
    setIsPlaying(false)
    stopRecord()
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current)
      playbackRef.current = null
    }
    resetToTimelineStart()
  }

  const stopVideoRecord = useCallback(() => {
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current)
      playbackRef.current = null
    }
    setIsPlaying(false)
    stopRecording()
    setIsVideoRecording(false)
    if (videoRecordTimerRef.current) {
      clearTimeout(videoRecordTimerRef.current)
      videoRecordTimerRef.current = null
    }
    window.setTimeout(() => setRecordSurfaceActive(false), 750)
  }, [stopRecording])

  const startVideoRecord = useCallback(async ({ autoStopAfter } = {}) => {
    if (videoRecordTimerRef.current) {
      clearTimeout(videoRecordTimerRef.current)
      videoRecordTimerRef.current = null
    }
    resetToTimelineStart()
    sanitizeActiveCameraForRecording()
    flushSync(() => setRecordSurfaceActive(true))
    const selector = '.previz-record-canvas canvas'
    const recordingCanvas = await waitForCanvasFrame(selector)
    const renderedWidth = recordingCanvas?.width || recordDimensions.width
    const renderedHeight = recordingCanvas?.height || recordDimensions.height
    const recorder = startRecording(selector, {
      width: renderedWidth,
      height: renderedHeight,
      fps: 60,
      videoBitsPerSecond: 12_000_000,
    })
    if (!recorder) {
      setRecordSurfaceActive(false)
      return false
    }
    setIsVideoRecording(true)
    const seconds = Math.max(1, Number(autoStopAfter) || Number(durationRef.current) || 1)
    startPlaybackAt(0, { allowLoop: false, endTime: seconds, onComplete: stopVideoRecord })
    videoRecordTimerRef.current = setTimeout(() => {
      stopVideoRecord()
    }, seconds * 1000 + 1200)
    return true
  }, [recordDimensions.height, recordDimensions.width, resetToTimelineStart, sanitizeActiveCameraForRecording, startPlaybackAt, startRecording, stopVideoRecord])

  const handleVideoRecord = useCallback(() => {
    if (isVideoRecording) {
      stopVideoRecord()
    } else {
      startVideoRecord({ autoStopAfter: Number(durationRef.current) })
    }
  }, [isVideoRecording, startVideoRecord, stopVideoRecord])

  const handleExportMode = useCallback((mode) => {
    const canvas = document.querySelector('.previz-canvas-wrap canvas')
    if (!canvas?.__r3f) return
    const { gl, scene, camera } = canvas.__r3f
    const url = renderExportFrame(gl, scene, camera, mode)
    downloadDataURL(url, `previz-${mode}.png`)
  }, [])

  const deleteKeyframe = (type, id, index) => {
    setTracks((prev) => {
      const next = prev
        .map((track) => track.targetType === type && track.targetId === id ? { ...track, keyframes: track.keyframes.filter((_, i) => i !== index) } : track)
        .filter((track) => track.keyframes.length > 0)
      tracksRef.current = next
      return next
    })
  }

  const moveKeyframe = (type, id, keyframes) => {
    setTracks((prev) => {
      const next = prev.map((track) => track.targetType === type && track.targetId === id ? { ...track, keyframes } : track)
      tracksRef.current = next
      return next
    })
  }

  const loadProject = (data) => {
    if (data.actors) setActors(data.actors)
    if (data.props) setProps(data.props)
    if (data.cameras) setCameras(data.cameras)
    if (data.timeline) {
      tracksRef.current = data.timeline
      setTracks(data.timeline)
    }
    if (data.config?.backgroundImage || data.backgroundImage) setBackgroundImage(data.config?.backgroundImage || data.backgroundImage)
    if (data.config?.backgroundImages || data.backgroundImages) setBackgroundImages(data.config?.backgroundImages || data.backgroundImages)
    if (data.config?.shotPackages) setShotPackages(data.config.shotPackages)
    if (data.config?.referenceLibrary) setReferenceLibrary(data.config.referenceLibrary)
    setShowProject(false)
  }

  const handleBackgroundUpload = useCallback((file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    backgroundUrlsRef.current.add(url)
    const id = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const readerImage = new Image()
    readerImage.onload = () => {
      const ratio = readerImage.width && readerImage.height ? readerImage.width / readerImage.height : 16 / 9
      const height = 7
      const nextImage = {
        id,
        url,
        objectUrl: url,
        name: file.name,
        width: height * ratio,
        height,
        position: [0, height / 2 - 0.15, -9],
        rotation: [0, 0, 0],
        arc: 0,
      }
      backgroundUrlRef.current = url
      setBackgroundImage(nextImage)
      setBackgroundImages((prev) => [...prev, nextImage])
    }
    readerImage.onerror = () => {
      URL.revokeObjectURL(url)
      backgroundUrlsRef.current.delete(url)
    }
    readerImage.src = url
  }, [])

  const clearBackgroundImage = useCallback(() => {
    backgroundImages.forEach((image) => {
      if (image.objectUrl) URL.revokeObjectURL(image.objectUrl)
      if (image.objectUrl) backgroundUrlsRef.current.delete(image.objectUrl)
    })
    backgroundUrlRef.current = null
    setBackgroundImage(null)
    setBackgroundImages([])
  }, [backgroundImages])

  const updateBackgroundImage = useCallback((id, patch) => {
    setBackgroundImages((prev) => {
      const next = prev.map((image) => (image.id === id ? { ...image, ...patch } : image))
      setBackgroundImage(next[next.length - 1] || null)
      return next
    })
  }, [])

  const removeBackgroundImage = useCallback((id) => {
    setBackgroundImages((prev) => {
      const removed = prev.find((image) => image.id === id)
      if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl)
      if (removed?.objectUrl) backgroundUrlsRef.current.delete(removed.objectUrl)
      const next = prev.filter((image) => image.id !== id)
      setBackgroundImage(next[next.length - 1] || null)
      return next
    })
  }, [])

  const fitBackgroundToCamera = useCallback((id) => {
    const cam = camerasRef.current.find((camera) => camera.id === activeCameraIdRef.current) || camerasRef.current[0]
    if (!cam) return
    const lookAt = cam.lookAt || [0, FACE_LOOK_AT_Y, 0]
    const position = [
      lookAt[0],
      3.35,
      lookAt[2] - 8,
    ]
    const rotation = [0, 0, 0]
    updateBackgroundImage(id, { position, rotation })
  }, [updateBackgroundImage])

  const addReferenceAssets = useCallback(async (files, metadata = {}) => {
    setPackageBusy('upload-references')
    setPackageError(null)
    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.success) throw new Error(data.message || '参考图上传失败')
      const additions = (data.files || []).map((uploaded, index) => ({
        id: `ref_${Date.now()}_${index}`,
        url: uploaded.url,
        name: files[index]?.name || uploaded.filename,
        label: metadata.label || files[index]?.name?.replace(/\.[^.]+$/, '') || `参考${index + 1}`,
        category: metadata.category || 'character',
        createdAt: new Date().toISOString(),
      }))
      setReferenceLibrary((previous) => [...previous, ...additions])
    } catch (err) {
      setPackageError(err.message || '参考图上传失败')
    } finally {
      setPackageBusy(null)
    }
  }, [])

  const removeReferenceAsset = useCallback((id) => {
    setReferenceLibrary((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const updateReferenceAsset = useCallback((id, patch) => {
    setReferenceLibrary((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [])

  const capturePackageFrame = useCallback(async (kind) => {
    const targetTime = kind === 'first' ? 0 : Number(durationRef.current)
    setPackageBusy(`capture-${kind}`)
    setPackageError(null)
    try {
      flushSync(() => {
        setIsPlaying(false)
        setCurrentTime(targetTime)
        setRecordSurfaceActive(true)
      })
      await waitForCanvasFrame('.previz-record-canvas canvas')
      const canvas = document.querySelector('.previz-record-canvas canvas') || document.querySelector('.previz-canvas-wrap canvas')
      const blob = await canvasToPngBlob(canvas)
      const file = new File([blob], `${shotPackageKey}-${kind}-${Date.now()}.png`, { type: 'image/png' })
      const uploaded = await uploadPrevizAsset(file)
      updateShotPackage((current) => ({
        previzFrames: {
          ...current.previzFrames,
          [kind]: {
            kind: 'image',
            url: uploaded.url,
            name: uploaded.filename || file.name,
            time: targetTime,
            width: canvas.width || recordDimensions.width,
            height: canvas.height || recordDimensions.height,
          },
        },
        styledFrames: { ...current.styledFrames, [kind]: null },
      }))
    } catch (err) {
      setPackageError(`捕获${kind === 'first' ? '首帧' : '尾帧'}失败：${err.message}`)
    } finally {
      if (!isVideoRecording) setRecordSurfaceActive(false)
      setPackageBusy(null)
    }
  }, [isVideoRecording, recordDimensions.height, recordDimensions.width, shotPackageKey, updateShotPackage])

  const generateStyledPackageFrame = useCallback(async (kind) => {
    const sourceFrame = currentShotPackage.previzFrames?.[kind]
    if (!sourceFrame?.url) return
    setPackageBusy(`style-${kind}`)
    setPackageError(null)
    try {
      const synthesisReferences = referenceLibrary.slice(0, 8)
      const prompt = buildFrameSynthesisPrompt({
        kind,
        shot: currentShot,
        shotPackage: currentShotPackage,
        references: synthesisReferences,
        aspectRatio,
      })
      const ratio = aspectRatio === '2.35:1' ? '21:9' : aspectRatio
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: prompt,
          apiPrompt: prompt,
          model: 'gpt-image-2',
          aspectRatio: ratio,
          imageSize: '1K',
          images: [sourceFrame.url, ...synthesisReferences.map((item) => item.url)],
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.success || !data.data?.imageUrl) {
        throw new Error(data.message || 'GPT-Image 2 生成失败')
      }
      updateShotPackage((current) => ({
        styledFrames: {
          ...current.styledFrames,
          [kind]: {
            kind: 'image',
            url: data.data.imageUrl,
            name: `${current.shotId}-${kind}-cinematic.png`,
            model: data.data.model || 'gpt-image-2',
            sourceFrame: sourceFrame.url,
          },
        },
      }))
    } catch (err) {
      setPackageError(`成片化${kind === 'first' ? '首帧' : '尾帧'}失败：${err.message}`)
    } finally {
      setPackageBusy(null)
    }
  }, [aspectRatio, currentShot, currentShotPackage, referenceLibrary, updateShotPackage])

  const handlePackageRecording = useCallback(() => {
    recordingPackageKeyRef.current = shotPackageKey
    if (isVideoRecording) {
      stopVideoRecord()
    } else {
      startVideoRecord({ autoStopAfter: Number(currentShot?.duration || duration) })
    }
  }, [currentShot?.duration, duration, isVideoRecording, shotPackageKey, startVideoRecord, stopVideoRecord])

  const sendPackageToVideo = useCallback(() => {
    const first = currentShotPackage.styledFrames.first || currentShotPackage.previzFrames.first
    const last = currentShotPackage.styledFrames.last || currentShotPackage.previzFrames.last
    if (!first?.url || !last?.url) {
      setPackageError('请先准备首尾帧')
      return
    }

    const referenceAssets = referenceLibrary.slice(0, currentShotPackage.previzVideo?.url ? 6 : 7)
    const handoffAssets = [
      { id: 1, type: 'image', url: first.url, name: first.name, label: '严格成片首帧' },
      { id: 2, type: 'image', url: last.url, name: last.name, label: '严格成片尾帧' },
      ...referenceAssets.map((asset, index) => ({
        id: index + 3,
        type: 'image',
        url: asset.url,
        name: asset.name,
        label: `${asset.label || asset.name}（${asset.category}）`,
      })),
    ]
    if (currentShotPackage.previzVideo?.url) {
      handoffAssets.push({
        id: handoffAssets.length + 1,
        type: 'video',
        url: currentShotPackage.previzVideo.url,
        name: currentShotPackage.previzVideo.name,
        label: '严格3D运镜与动作时序参考',
      })
    }
    const generatedPrompt = buildVideoHandoffPrompt({ shot: currentShot, shotPackage: currentShotPackage, assets: handoffAssets })
    const handoff = {
      ...currentShotPackage,
      id: `${currentShotPackage.shotId}-${Date.now()}`,
      aspectRatio,
      duration: Number(currentShot?.duration || duration),
      assets: handoffAssets,
      videoPrompt: `${generatedPrompt}\n${currentShotPackage.handoffPrompt || ''}`.trim(),
      sceneManifest: {
        actors,
        props,
        cameras,
        tracks,
        activeCameraId,
        environmentMode,
        shot: currentShot,
      },
    }
    updateShotPackage({ lastHandoffAt: new Date().toISOString() })
    onSendToVideo?.(handoff)
  }, [activeCameraId, actors, aspectRatio, cameras, currentShot, currentShotPackage, duration, environmentMode, onSendToVideo, props, referenceLibrary, tracks, updateShotPackage])

  // ==========================================
  // AI 自然语言导演
  // ==========================================
  const handleAIShotPlan = useCallback(async (input) => {
    const payload = typeof input === 'string' ? { prompt: input } : (input || {})
    const prompt = payload.prompt || ''
    if (!prompt.trim() || shotPlanLoading) return

    setShotPlanLoading(true)
    setAiError(null)
    setAiStatus({ phase: 'planning', message: 'AI 正在拆分镜头，生成可审核分镜表...' })

    try {
      const resp = await fetch('/api/previz/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          director_profile: payload.directorProfile,
          material_type: payload.materialType,
          source_title: payload.sourceTitle,
          replace_scene: payload.replaceScene,
          preferred_shot_count: payload.preferredShotCount,
        }),
      })
      const data = await resp.json()
      if (!data.success) {
        setAiError(data.message || 'AI 分镜计划生成失败')
        return
      }
      const plan = data.data?.plan
      setShotPlan(plan)
      setSelectedShotId(plan?.shots?.[0]?.id || null)
      setAiStatus(null)
    } catch (err) {
      setAiError(`分镜生成失败：${err.message || '请检查后端服务是否启动'}`)
    } finally {
      setShotPlanLoading(false)
    }
  }, [shotPlanLoading])

  const handleAIDirect = useCallback(async (input) => {
    const payload = typeof input === 'string' ? { prompt: input } : (input || {})
    const prompt = payload.prompt || ''
    if (!prompt || !prompt.trim() || aiLoading) return false

    // 保存快照以便撤销
    aiSnapshotRef.current = {
      actors: actorsRef.current.map((a) => ({ ...a, pose: { ...a.pose } })),
      props: [...props],
      cameras: camerasRef.current.map((c) => ({ ...c })),
      tracks: [...tracks],
      aspectRatio,
      cameraFov,
      cameraMode,
      duration,
      environmentMode,
    }

    clearLastRecording()
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
        backgroundImageCount: backgroundImages.length,
        backgroundImageNames: backgroundImages.map((image) => image.name).filter(Boolean),
        backgroundImages: backgroundImages.map((image) => ({
          name: image.name,
          position: image.position,
          width: image.width,
          height: image.height,
          arc: image.arc || 0,
        })),
        hasBackgroundImage: backgroundImages.length > 0,
        environmentMode,
        actors: actorsRef.current.map((actor) => ({
          id: actor.id,
          name: actor.name,
          position: actor.position,
          rotation: actor.rotation,
          scale: actor.scale,
        })),
        props: propsRef.current.map((prop) => ({
          id: prop.id,
          type: prop.type,
          position: prop.position,
          rotation: prop.rotation,
          scale: prop.scale,
        })),
        cameras: camerasRef.current.map((camera) => ({
          id: camera.id,
          name: camera.name,
          position: camera.position,
          lookAt: camera.lookAt,
          fov: camera.fov,
        })),
      }

      setAiStatus({ phase: 'analyzing', message: 'AI 正在分析场景指令...' })

      // 注意：直接用 fetch，不通过 /api/previz 避免路径冲突
      const requestController = new AbortController()
      const requestTimer = window.setTimeout(() => requestController.abort(), 135000)
      let resp
      try {
        resp = await fetch('/api/previz/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: requestController.signal,
          body: JSON.stringify({
            scene_context: sceneContext,
            prompt: prompt.trim(),
            director_profile: payload.directorProfile,
            material_type: payload.materialType,
            source_title: payload.sourceTitle,
            replace_scene: Boolean(payload.replaceScene),
          }),
        })
      } finally {
        window.clearTimeout(requestTimer)
      }

      const data = await resp.json()

      if (!data.success) {
        setAiError(data.message || 'AI 指令生成失败')
        setAiStatus(null)
        return false
      }

      const { commands, explanation, quality } = data.data
      if (!commands || commands.length === 0) {
        setAiError('AI 未生成有效的场景命令，请尝试更具体的描述。')
        setAiStatus(null)
        return false
      }
      if (quality) setShotQuality(quality)

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
          actorsRef.current = [...actorsRef.current, newActor]
          setActors((prev) => [...prev, newActor])
          return id
        },
        deleteActor: (id) => {
          actorsRef.current = actorsRef.current.filter((a) => a.id !== id)
          setActors((prev) => prev.filter((a) => a.id !== id))
          if (selectedActor === id) setSelectedActor(null)
        },
        renameActor,
        createProp: (type, position, rotation, scale) => {
          propCounter.current += 1
          const id = `prop_${propCounter.current}`
          const groundY = getPropGroundY(type)
          const isFreeSpaceAsset = ['airplane', 'spacecraft', 'planet', 'asteroid', 'starfield'].includes(type)
          const requestedY = Array.isArray(position) ? Number(position[1]) || 0 : 0
          const hasFreeY = isFreeSpaceAsset || requestedY > groundY + 0.1 || requestedY < -0.1
          const resolvedPosition = Array.isArray(position)
            ? (hasFreeY ? position : [position[0], groundY, position[2]])
            : [0, groundY, 0]
          const newProp = {
            id,
            type,
            position: resolvedPosition,
            rotation: rotation || [0, 0, 0],
            scale: scale || [1, 1, 1],
            color: type === 'car' || type === 'car_open' ? '#111827' : '#666666',
            locked: false,
            snapToGround: !hasFreeY,
          }
          propsRef.current = [...propsRef.current, newProp]
          setProps((prev) => [...prev, newProp])
          return id
        },
        deleteProp: (id) => {
          propsRef.current = propsRef.current.filter((p) => p.id !== id)
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
            lookAt: lookAt || [0, FACE_LOOK_AT_Y, 0],
          }
          camerasRef.current = [...camerasRef.current, newCam]
          setCameras((prev) => [...prev, newCam])
          return id
        },
        deleteCamera: (id) => {
          camerasRef.current = camerasRef.current.filter((c) => c.id !== id)
          setCameras((prev) => prev.filter((c) => c.id !== id))
          if (selectedCamera === id) setSelectedCamera(null)
          if (activeCameraId === id) setActiveCameraId('cam1')
        },
        selectActor: selectActor,
        selectCamera: selectCamera,
        applyPose: (preset, actorId) => {
          if (!POSE_PRESETS[preset] || !actorId) return
          actorsRef.current = actorsRef.current.map((a) =>
            a.id === actorId ? { ...a, pose: POSE_PRESETS[preset]() } : a
          )
          setActors((prev) =>
            prev.map((a) => (a.id === actorId ? { ...a, pose: POSE_PRESETS[preset]() } : a))
          )
        },
        moveActor: (id, position, rotation) => {
          actorsRef.current = actorsRef.current.map((a) => {
            if (a.id !== id) return a
            return {
              ...a,
              position: position ? snapToGround(position) : a.position,
              rotation: rotation || a.rotation,
            }
          })
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
          camerasRef.current = camerasRef.current.map((c) => {
            if (c.id !== id) return c
            return {
              ...c,
              position: position || c.position,
              rotation: rotation || c.rotation,
              lookAt: lookAt !== undefined ? lookAt : c.lookAt,
              fov: fov !== undefined ? fov : c.fov,
            }
          })
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
          propsRef.current = propsRef.current.map((p) => {
            if (p.id !== id) return p
            const type = p.type
            const groundY = getPropGroundY(type)
            const requestedY = Array.isArray(position) ? Number(position[1]) || 0 : groundY
            const hasFreeY = requestedY > groundY + 0.1 || requestedY < -0.1
            return {
              ...p,
              position: position ? (hasFreeY || p.snapToGround === false ? position : [position[0], groundY, position[2]]) : p.position,
              rotation: rotation || p.rotation,
              scale: scale || p.scale,
              snapToGround: position ? !(hasFreeY || p.snapToGround === false) : p.snapToGround,
            }
          })
          setProps((prev) =>
            prev.map((p) => {
              if (p.id !== id) return p
              const type = p.type
              const groundY = getPropGroundY(type)
              const requestedY = Array.isArray(position) ? Number(position[1]) || 0 : groundY
              const hasFreeY = requestedY > groundY + 0.1 || requestedY < -0.1
              return {
                ...p,
                position: position ? (hasFreeY || p.snapToGround === false ? position : [position[0], groundY, position[2]]) : p.position,
                rotation: rotation || p.rotation,
                scale: scale || p.scale,
                snapToGround: position ? !(hasFreeY || p.snapToGround === false) : p.snapToGround,
              }
            })
          )
        },
        configureCamera: (id, { fov, mode, lookAt }) => {
          camerasRef.current = camerasRef.current.map((c) => {
            if (c.id !== id) return c
            return {
              ...c,
              fov: fov !== undefined ? fov : c.fov,
              lookAt: lookAt !== undefined ? lookAt : c.lookAt,
            }
          })
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
        setActiveCamera: (id) => {
          activeCameraIdRef.current = id
          setActiveCameraId(id)
        },
        setCameraFov: (fov) => {
          cameraFovRef.current = fov
          camerasRef.current = camerasRef.current.map((camera) => (
            camera.id === activeCameraIdRef.current ? { ...camera, fov } : camera
          ))
          updateActiveCameraFov(fov)
        },
        setTimelineDuration: (seconds) => {
          const nextDuration = Math.max(1, Math.min(120, Number(seconds) || 30))
          durationRef.current = nextDuration
          setDuration(nextDuration)
        },
        recordCameraVideo: ({ duration: recordDuration, delay } = {}) => {
          const seconds = recordDuration || durationRef.current
          const waitMs = Math.max(0, delay ?? 0.5) * 1000
          setAiStatus({ phase: 'recording', message: `AI 已完成预演，将自动录制 ${seconds}s 摄影机参考片...` })
          setTimeout(() => {
            const execution = assessExecutableTimeline(tracksRef.current, {
              cameraIds: camerasRef.current.map((camera) => camera.id),
              duration: seconds,
            })
            setShotQuality(execution)
            if (!execution.valid) {
              setAiStatus(null)
              setAiError(`已阻止静态空录制：${execution.warnings.join('；') || '没有有效运动轨道'}`)
              return
            }
            startVideoRecord({ autoStopAfter: seconds })
          }, waitMs)
        },
        setAspectRatio,
        setEnvironment: (mode) => {
          if (['ground', 'air', 'space', 'studio'].includes(mode)) setEnvironmentMode(mode)
        },
        focusCameraOnActor: (actorId) => {
          const target = actorsRef.current.find((a) => a.id === actorId)
          if (!target) return
          const camId = selectedCamera || activeCameraId
          camerasRef.current = camerasRef.current.map((c) =>
            c.id === camId
              ? { ...c, lookAt: [target.position[0], FACE_LOOK_AT_Y, target.position[2]] }
              : c
          )
          setCameras((prev) =>
            prev.map((c) =>
              c.id === camId
                ? { ...c, lookAt: [target.position[0], FACE_LOOK_AT_Y, target.position[2]] }
                : c
            )
          )
        },
        addKeyframe: (time) => addKeyframeAt(time),
        setCameraTrack: (id, keyframes, metadata = {}) => {
          const nextTrack = {
            targetType: 'camera',
            targetId: id,
            interpolation: 'cinematic',
            rigType: metadata.rigType,
            subject: metadata.subject,
            keyframes,
          }
          const nextTracks = [
            ...tracksRef.current.filter((track) => !(track.targetType === 'camera' && track.targetId === id)),
            nextTrack,
          ]
          const optimized = optimizeCinematicTracks(nextTracks, durationRef.current)
          tracksRef.current = optimized.tracks
          setTracks(optimized.tracks)
          setShotQuality(assessExecutableTimeline(optimized.tracks, {
            cameraIds: camerasRef.current.map((camera) => camera.id),
            duration: durationRef.current,
          }))
        },
        resetScene: () => {
          const defaultCamera = { id: 'cam1', name: '主机位', fov: 45, position: [0, 2.2, 8], rotation: [0, 0, 0], lookAt: [0, FACE_LOOK_AT_Y, 0] }
          actorsRef.current = []
          propsRef.current = []
          camerasRef.current = [defaultCamera]
          tracksRef.current = []
          activeCameraIdRef.current = 'cam1'
          cameraFovRef.current = 45
          setActors([])
          setProps([])
          setCameras([defaultCamera])
          setTracks([])
          setActiveCameraId('cam1')
          setCameraFov(45)
          setCameraMode('fixed')
          setEnvironmentMode('ground')
          setCurrentTime(0)
          setShotQuality(null)
          setSelectedActor(null)
          setSelectedProp(null)
          setSelectedCamera(null)
          setSelectedJoint(null)
        },
        clearAllProps: () => {
          propsRef.current = []
          setProps([])
          setSelectedProp(null)
        },
        clearAllActors: () => {
          actorsRef.current = []
          setActors([])
          setSelectedActor(null)
          setSelectedJoint(null)
        },
        getAllActors: () => actorsRef.current,
        getAllCameras: () => camerasRef.current,
        getAllProps: () => propsRef.current,
        getTrack: (targetType, targetId) => tracksRef.current.find((track) => track.targetType === targetType && track.targetId === targetId),
        getActiveCameraId: () => activeCameraIdRef.current,
      }

      // 执行命令
      const hasRecordCommand = commands.some((cmd) => cmd?.type === 'record_camera_video')
      const result = applyCommands(commands, callbacks)
      if (hasRecordCommand) {
        ensureCameraTrackForRecording({ prompt, duration: durationRef.current }, callbacks)
      }
      window.setTimeout(() => {
        const optimized = optimizeCinematicTracks(tracksRef.current, durationRef.current)
        tracksRef.current = optimized.tracks
        setTracks(optimized.tracks)
        setShotQuality(assessExecutableTimeline(optimized.tracks, {
          cameraIds: camerasRef.current.map((camera) => camera.id),
          duration: durationRef.current,
        }))
      }, 0)
      const shouldFallbackRecord = !hasRecordCommand && shouldAutoRecordFromPrompt(prompt)
      if (shouldFallbackRecord) {
        const recordDuration = extractDurationFromPrompt(prompt, durationRef.current)
        durationRef.current = recordDuration
        setDuration(recordDuration)
        setAiStatus({ phase: 'recording', message: `AI 已完成预演，将自动录制 ${recordDuration}s 摄影机参考片...` })
        setTimeout(() => {
          const execution = assessExecutableTimeline(tracksRef.current, {
            cameraIds: camerasRef.current.map((camera) => camera.id),
            duration: recordDuration,
          })
          setShotQuality(execution)
          if (!execution.valid) {
            setAiStatus(null)
            setAiError(`已阻止静态空录制：${execution.warnings.join('；') || '没有有效运动轨道'}`)
            return
          }
          startVideoRecord({ autoStopAfter: recordDuration })
        }, 650)
      }

      if (!hasRecordCommand && !shouldFallbackRecord) setAiStatus(null)
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
      return true
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? 'AI 响应超过135秒，已停止本次生成。请重试或检查 DeepSeek 接口延迟。'
        : `网络错误：${err.message || '请检查后端服务是否启动'}`
      setAiError(message)
      setAiStatus(null)
      return false
    } finally {
      setAiLoading(false)
    }
  }, [
    aiLoading, props, tracks, aspectRatio, cameraFov, cameraMode,
    selectedActor, selectedCamera, selectedProp, activeCameraId,
    addKeyframeAt, backgroundImage, backgroundImages, clearLastRecording, duration, environmentMode, startVideoRecord, updateActiveCameraFov,
  ])

  const updateShotPlanItem = useCallback((shotId, patch) => {
    setShotPlan((prev) => {
      if (!prev?.shots) return prev
      const shots = prev.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot))
      return {
        ...prev,
        shots,
        total_duration: shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0),
      }
    })
  }, [])

  const markShotStatus = useCallback((shotId, status) => {
    updateShotPlanItem(shotId, { status })
  }, [updateShotPlanItem])

  const generateShotPreview = useCallback(async (shot) => {
    if (!shot || aiLoading) return
    setSelectedShotId(shot.id)
    markShotStatus(shot.id, 'generating')
    const shotIndex = shotPlan?.shots?.findIndex((item) => item.id === shot.id) ?? -1
    const previousShot = shotIndex > 0 ? shotPlan.shots[shotIndex - 1] : null
    const nextShot = shotIndex >= 0 ? shotPlan.shots[shotIndex + 1] : null
    const prompt = `
只生成并录制当前分镜，不要生成整段故事。

[整段衔接]
${shotPlan?.continuity || '保持电影化连续剪辑。'}
上一镜：${previousShot ? `${previousShot.id} ${previousShot.title}，出场：${previousShot.transition_out || ''}` : '无'}
下一镜：${nextShot ? `${nextShot.id} ${nextShot.title}，入场：${nextShot.transition_in || ''}` : '无'}

[当前分镜]
编号：${shot.id}
标题：${shot.title}
时长：${shot.duration}秒
场景：${shot.scene}
画面目标：${shot.visual_goal}
角色：${(shot.characters || []).join('、')}
道具：${(shot.props || []).join('、')}
动作：${shot.action}
景别：${shot.shot_size}
机位角度：${shot.camera_angle}
焦段/FOV：${shot.focal}${shot.fov ? ` / FOV ${shot.fov}` : ''}
运镜：${shot.camera_movement}
入场衔接：${shot.transition_in}
出场衔接：${shot.transition_out}

[执行要求]
1. 先 reset_scene 清理上一镜的演员和道具，但必须保留用户上传的背景图、画幅和当前工程。
2. 只搭建这一条分镜需要的灰模资产，地面场景必须 set_environment mode="ground"，并放置清晰地面参照物或地毯/路面/桌椅来体现运动距离。
3. set_timeline_duration 必须等于 ${shot.duration}。
4. 至少建立 time=0、中段、time=${shot.duration} 三个关键帧。
5. 摄影机必须用 lookAt 对准主体脸部/头胸区域，双人镜头 lookAt 对准两人中点的脸部高度；构图要符合景别，不要让人物过小或出画。
6. 摄影机、人物/产品/道具动作必须符合上面的机位、焦段和运镜；如果有变焦，关键帧里必须体现 FOV 变化。
7. 最后 record_camera_video duration=${shot.duration}。

${shot.previz_prompt || ''}
`
    const ok = await handleAIDirect({
      prompt,
      directorProfile: 'cinematographer',
      materialType: 'script',
      sourceTitle: `${shot.id} ${shot.title}`,
    })
    markShotStatus(shot.id, ok ? 'generated' : 'failed')
  }, [aiLoading, handleAIDirect, markShotStatus, shotPlan])

  /** 撤销 AI 操作：恢复到 AI 执行前的快照 */
  const undoAI = useCallback(() => {
    const snap = aiSnapshotRef.current
    if (!snap) return
    setActors(snap.actors)
    setProps(snap.props)
    setCameras(snap.cameras)
    tracksRef.current = snap.tracks
    setTracks(snap.tracks)
    setAspectRatio(snap.aspectRatio)
    setCameraFov(snap.cameraFov)
    setCameraMode(snap.cameraMode)
    setDuration(snap.duration || 30)
    setEnvironmentMode(snap.environmentMode || 'ground')
    durationRef.current = snap.duration || 30
    aiSnapshotRef.current = null
    setAiError(null)
    setAiStatus(null)
  }, [])

  const hasAISnapshot = () => aiSnapshotRef.current !== null

  useEffect(() => () => {
    if (playbackRef.current) cancelAnimationFrame(playbackRef.current)
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
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showGuides={showGuides}
        setShowGuides={setShowGuides}
        onScreenshot={() => exportScreenshot()}
        onRecordVideo={handleVideoRecord}
        onExportMode={handleExportMode}
        onOpenProject={() => setShowProject(true)}
        isVideoRecording={isVideoRecording}
        aiLoading={aiLoading}
        aiStatus={aiStatus}
        aiError={aiError}
        onAIDirect={handleAIDirect}
        onAIShotPlan={handleAIShotPlan}
        shotPlan={shotPlan}
        shotPlanLoading={shotPlanLoading}
        selectedShotId={selectedShotId}
        onSelectShot={setSelectedShotId}
        onUpdateShot={updateShotPlanItem}
        onGenerateShotPreview={generateShotPreview}
        onUndoAI={undoAI}
        hasAISnapshot={hasAISnapshot}
        commandHistory={commandHistory}
        onClearAIError={() => setAiError(null)}
        backgroundImages={backgroundImages}
        onBackgroundUpload={handleBackgroundUpload}
        onClearBackground={clearBackgroundImage}
        onUpdateBackground={updateBackgroundImage}
        onRemoveBackground={removeBackgroundImage}
        onFitBackgroundToCamera={fitBackgroundToCamera}
        shotPackageContent={(
          <ShotPackagePanel
            shot={currentShot}
            shotPackage={currentShotPackage}
            references={referenceLibrary}
            sceneContext={packageSceneContext}
            isRecording={isVideoRecording}
            busy={packageBusy}
            error={packageError}
            onAddReferences={addReferenceAssets}
            onRemoveReference={removeReferenceAsset}
            onUpdateReference={updateReferenceAsset}
            onCaptureFrame={capturePackageFrame}
            onGenerateStyledFrame={generateStyledPackageFrame}
            onRecordPreviz={handlePackageRecording}
            onUpdatePackage={updateShotPackage}
            onSendToVideo={sendPackageToVideo}
          />
        )}
      />

      <div className="previz-canvas-wrap">
        <div className="previz-stage-toolbar" aria-label="导演台工具栏">
          {onBack ? <button type="button" className="previz-tool-back" onClick={onBack}>← 返回</button> : null}
          <div className="previz-tool-group">
            <button type="button" onClick={isPlaying ? pause : play} disabled={isRecording || recordSurfaceActive}>{isPlaying ? '暂停' : '播放'}</button>
            <button type="button" onClick={stop} disabled={recordSurfaceActive}>停止</button>
            <button type="button" className={loopMode ? 'active' : ''} aria-pressed={loopMode} onClick={() => setLoopMode((value) => !value)} disabled={recordSurfaceActive}>循环</button>
          </div>
          <span className="previz-tool-time">{currentTime.toFixed(1)}s <b>/</b> {duration}s</span>
          {shotQuality ? (
            <span className={`previz-quality-badge grade-${shotQuality.grade.toLowerCase()}`} role="status" title={shotQuality.warnings.join('\n') || '镜头路径、速度与焦段检查通过'}>
              镜头 {shotQuality.score}分 · {shotQuality.grade}
            </span>
          ) : null}
          <div className="previz-tool-group">
            <button type="button" onClick={addKeyframeNow} disabled={recordSurfaceActive}>+关键帧</button>
            <button type="button" className={isRecording ? 'danger active' : ''} onClick={isRecording ? stopRecord : startRecord} disabled={recordSurfaceActive}>{isRecording ? '停止采集' : '采集动作'}</button>
            <button type="button" className={isVideoRecording ? 'danger active' : 'primary'} onClick={handleVideoRecord}>{isVideoRecording ? '停止录制' : `录制 ${duration}s`}</button>
          </div>
          <div className="previz-tool-spacer" />
          <div className="previz-tool-group compact" aria-label="变换工具">
            <button type="button" className={transformMode === 'translate' ? 'active' : ''} aria-pressed={transformMode === 'translate'} onClick={() => setTransformMode('translate')}>移动 W</button>
            <button type="button" className={transformMode === 'rotate' ? 'active' : ''} aria-pressed={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}>旋转 E</button>
            <button type="button" className={transformMode === 'scale' ? 'active' : ''} aria-pressed={transformMode === 'scale'} onClick={() => setTransformMode('scale')}>缩放 R</button>
          </div>
          <div className="previz-tool-group compact" aria-label="视口模式">
            <button type="button" className={viewportMode === 'director' ? 'active' : ''} aria-pressed={viewportMode === 'director'} onClick={() => setViewportMode('director')}>导演视图</button>
            <button type="button" className={viewportMode === 'camera' ? 'active' : ''} aria-pressed={viewportMode === 'camera'} onClick={() => setViewportMode('camera')}>机位视图</button>
          </div>
        </div>
        {exportStatus && <div className="previz-export-toast" role="status" aria-live="polite">{exportStatus}</div>}
        {lastRecording ? (
          <aside className="previz-recording-result" aria-label="最近录制的视频">
            <div className="previz-recording-result-head">
              <div>
                <strong>预演视频已生成</strong>
                <small>{lastRecording.width}×{lastRecording.height} · {lastRecording.fps}fps · {(lastRecording.size / 1024 / 1024).toFixed(1)}MB{lastRecording.converting ? ' · 正在转换MP4' : ''}</small>
              </div>
              <button type="button" aria-label="关闭视频结果" onClick={clearLastRecording}>×</button>
            </div>
            <video
              key={lastRecording.url}
              src={lastRecording.url}
              controls
              preload="metadata"
              playsInline
              onEnded={(event) => { event.currentTarget.currentTime = 0 }}
            />
            <button type="button" className="primary" onClick={downloadLastRecording} disabled={lastRecording.converting}>
              {lastRecording.converting ? '正在生成标准MP4…' : `下载${String(lastRecording.ext || 'mp4').toUpperCase()}视频`}
            </button>
          </aside>
        ) : null}
        {isRecording && <div className="previz-rec-indicator" role="status" aria-live="polite"><div className="rec-dot" />录制中 {currentTime.toFixed(1)}s</div>}
        {placementMode && <div className="previz-placement-indicator">点击地面放置道具</div>}
        {recordSurfaceActive ? (
          <div className="previz-rendering-overlay">
            <div className="previz-ai-spinner" />
            <strong>{isVideoRecording ? '正在录制高清预演' : '正在捕获高清构图'}</strong>
            <small>已暂停编辑视口，保证 WebGL 稳定性</small>
          </div>
        ) : (
          <Canvas shadows camera={{ position: [0, 6, 12], fov: 55, near: 0.1, far: 500 }} gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }} onPointerMissed={handlePointerMissed}>
            <color attach="background" args={[viewportMode === 'camera' ? '#000000' : '#1e1e1e']} />
            {viewportMode === 'camera' ? <MoviePreviewCamera cameraConfig={activeCamera} aspectRatio={aspectRatio} fallbackFov={cameraFov} /> : null}
            <PrevizScene
              actors={actors}
              props={props}
              cameras={cameras}
              activeCameraId={activeCameraId}
              cameraFov={cameraFov}
              aspectRatio={aspectRatio}
              showGrid={viewportMode === 'director' ? showGrid : false}
              showGuides={showGuides}
              selectedActor={viewportMode === 'director' ? selectedActor : null}
              selectedProp={viewportMode === 'director' ? selectedProp : null}
              selectedCamera={viewportMode === 'director' ? selectedCamera : null}
              selectedJoint={viewportMode === 'director' ? selectedJoint : null}
              onSelectActor={viewportMode === 'director' ? selectActor : () => {}}
              onSelectProp={viewportMode === 'director' ? selectProp : () => {}}
              onSelectCamera={viewportMode === 'director' ? selectCamera : () => {}}
              onSelectJoint={viewportMode === 'director' ? setSelectedJoint : () => {}}
              actorRefs={actorRefs}
              propRefs={propRefs}
              cameraRefs={cameraRefs}
              onRegisterObject={registerSceneObject}
              placementMode={viewportMode === 'director' ? placementMode : null}
              onPlaceProp={placeProp}
              showCameraRigs={viewportMode === 'director'}
              backgroundImages={backgroundImages}
              isPreview={viewportMode === 'camera'}
              environmentMode={environmentMode}
            />
            {viewportMode === 'director' ? <OrbitControls makeDefault enabled={!isTransforming} /> : null}
            {viewportMode === 'director' && selectedActor && selectedActorTarget ? (
              <TransformGizmo
                target={selectedActorTarget}
                mode={selectedJoint ? 'rotate' : transformMode}
                onChange={(position, rotation, scale) => selectedJoint ? updateJoint(selectedActor, selectedJoint, rotation) : handleActorTransform(selectedActor, position, rotation, scale)}
                onDragStart={() => setIsTransforming(true)}
                onDragEnd={() => setIsTransforming(false)}
              />
            ) : null}
            {viewportMode === 'director' && selectedProp && selectedPropRoot ? (
              <TransformGizmo
                target={selectedPropRoot}
                mode={transformMode}
                onChange={(position, rotation, scale) => handlePropTransform(selectedProp, position, rotation, scale)}
                onDragStart={() => setIsTransforming(true)}
                onDragEnd={() => setIsTransforming(false)}
              />
            ) : null}
            {viewportMode === 'director' && selectedCamera && selectedCameraRoot ? (
              <TransformGizmo
                target={selectedCameraRoot}
                mode={transformMode}
                onChange={(position, rotation) => handleCameraTransform(selectedCamera, position, rotation, transformMode)}
                onDragStart={() => setIsTransforming(true)}
                onDragEnd={() => setIsTransforming(false)}
              />
            ) : null}
          </Canvas>
        )}

        {recordSurfaceActive ? (
          <div className="previz-record-canvas" aria-hidden="true" style={{ width: recordDimensions.width, height: recordDimensions.height }}>
            <Canvas
              style={{ width: `${recordDimensions.width}px`, height: `${recordDimensions.height}px` }}
              dpr={1}
              camera={{ position: activeCamera?.position || [0, 2.2, 8], fov: activeCamera?.fov || cameraFov, near: 0.05, far: 2000 }}
              gl={{ antialias: true, preserveDrawingBuffer: true }}
            >
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
                backgroundImages={backgroundImages}
                isPreview
                environmentMode={environmentMode}
              />
            </Canvas>
          </div>
        ) : null}

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
        props={props}
        cameras={cameras}
        fps={FPS}
      />

      {showProject && (
        <ProjectManager
          actors={actors}
          props={props}
          cameras={cameras}
          timeline={tracks}
          config={{ aspectRatio, fps: FPS, backgroundImage, backgroundImages, shotPackages, referenceLibrary }}
          onClose={() => setShowProject(false)}
          onLoad={loadProject}
        />
      )}
    </div>
  )
}
