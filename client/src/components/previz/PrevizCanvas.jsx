/* eslint-disable react-refresh/only-export-components */
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Line, Text } from '@react-three/drei'
import * as THREE from 'three'

export const POSE_PARTS = [
  'head', 'spine',
  'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
  'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
]

export const DEFAULT_POSE = {
  rootPosition: [0, 0.95, 0],
  rootRotation: [0, 0, 0],
  ...Object.fromEntries(POSE_PARTS.map((part) => [part, [0, 0, 0]])),
}

const PROP_GROUND_Y = {
  box: 0.5, cylinder: 0.5, platform: 0.15, wall: 1.5,
  bed: 0.3, table: 0.5, chair: 0.45, sofa: 0.4, cabinet: 0.9,
  desk: 0.52, bookshelf: 1.1, shelf: 0.9,
  door: 1.1, window: 1.4, screen: 0.9, carpet: 0.03,
  corridor: 1.5, elevator: 2, console: 0.75, cockpit: 1, hatch: 1.25,
  med_bed: 0.35, lab_table: 0.55,
  building: 4, street: 0.05, lamp: 2, billboard: 2, bridge: 1,
}

export function snapToGround(position) {
  return [position[0], 0, position[2]]
}

export function getPropGroundY(type) {
  return PROP_GROUND_Y[type] ?? 0.5
}

export function getAspectValue(aspectRatio) {
  if (aspectRatio === '2.35:1') return 2.35
  if (aspectRatio === '9:16') return 9 / 16
  if (aspectRatio === '1:1') return 1
  return 16 / 9
}

export function findJointRef(root, jointName) {
  if (!root) return null
  let found = null
  root.traverse((child) => {
    if (!found && child.userData?.joint === jointName) found = child
  })
  return found
}

function BoxPart({ args, position, rotation, color, selected, onClick }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow onClick={onClick}>
      <boxGeometry args={args} />
      <meshStandardMaterial
        color={selected ? '#00ffcc' : color}
        roughness={0.55}
        metalness={0.04}
        emissive={selected ? '#004c44' : '#000000'}
        emissiveIntensity={selected ? 0.5 : 0}
      />
    </mesh>
  )
}

function assignForwardedRef(forwardedRef, value) {
  if (typeof forwardedRef === 'function') forwardedRef(value)
  else if (forwardedRef) forwardedRef.current = value
}

function JointGroup({ part, position, rotation, selected, children }) {
  return (
    <group userData={{ joint: part }} position={position} rotation={rotation || [0, 0, 0]}>
      {children(selected)}
    </group>
  )
}

export const ActorModel = forwardRef(function ActorModel({ actor, selected, selectedJoint, onSelect, onSelectJoint }, ref) {
  const groupRef = useRef(null)
  const { color, position, rotation, scale, name, pose } = actor
  const p = pose || DEFAULT_POSE
  const body = color || '#3366ff'
  const skin = '#d79b70'
  const limb = '#7b808a'

  const jointClick = (part) => (event) => {
    event.stopPropagation()
    onSelect?.(actor.id)
    onSelectJoint?.(part)
  }

  return (
    <group
      ref={(node) => {
        groupRef.current = node
        assignForwardedRef(ref, node)
      }}
      position={position}
      rotation={rotation}
      scale={scale}
      userData={{ isActorRoot: true, actorId: actor.id }}
      onClick={(event) => { event.stopPropagation(); onSelect?.(actor.id) }}
    >
      <group position={p.rootPosition || [0, 0.95, 0]} rotation={p.rootRotation || [0, 0, 0]}>
        <BoxPart args={[0.5, 0.28, 0.32]} color={body} position={[0, 0, 0]} />

        <JointGroup part="spine" position={[0, 0.42, 0]} rotation={p.spine} selected={selected && selectedJoint === 'spine'}>
          {(isSelected) => (
            <>
              <BoxPart args={[0.52, 0.72, 0.32]} color={body} selected={isSelected} position={[0, 0, 0]} onClick={jointClick('spine')} />
              <JointGroup part="head" position={[0, 0.55, 0]} rotation={p.head} selected={selected && selectedJoint === 'head'}>
                {(headSelected) => <BoxPart args={[0.34, 0.34, 0.34]} color={skin} selected={headSelected} position={[0, 0, 0]} onClick={jointClick('head')} />}
              </JointGroup>
            </>
          )}
        </JointGroup>

        <JointGroup part="leftUpperArm" position={[0.42, 0.45, 0]} rotation={p.leftUpperArm} selected={selected && selectedJoint === 'leftUpperArm'}>
          {(isSelected) => (
            <>
              <BoxPart args={[0.16, 0.48, 0.16]} color={limb} selected={isSelected} position={[0, -0.24, 0]} onClick={jointClick('leftUpperArm')} />
              <JointGroup part="leftLowerArm" position={[0, -0.52, 0]} rotation={p.leftLowerArm} selected={selected && selectedJoint === 'leftLowerArm'}>
                {(lowerSelected) => <BoxPart args={[0.14, 0.44, 0.14]} color={limb} selected={lowerSelected} position={[0, -0.22, 0]} onClick={jointClick('leftLowerArm')} />}
              </JointGroup>
            </>
          )}
        </JointGroup>

        <JointGroup part="rightUpperArm" position={[-0.42, 0.45, 0]} rotation={p.rightUpperArm} selected={selected && selectedJoint === 'rightUpperArm'}>
          {(isSelected) => (
            <>
              <BoxPart args={[0.16, 0.48, 0.16]} color={limb} selected={isSelected} position={[0, -0.24, 0]} onClick={jointClick('rightUpperArm')} />
              <JointGroup part="rightLowerArm" position={[0, -0.52, 0]} rotation={p.rightLowerArm} selected={selected && selectedJoint === 'rightLowerArm'}>
                {(lowerSelected) => <BoxPart args={[0.14, 0.44, 0.14]} color={limb} selected={lowerSelected} position={[0, -0.22, 0]} onClick={jointClick('rightLowerArm')} />}
              </JointGroup>
            </>
          )}
        </JointGroup>

        <JointGroup part="leftUpperLeg" position={[0.16, -0.16, 0]} rotation={p.leftUpperLeg} selected={selected && selectedJoint === 'leftUpperLeg'}>
          {(isSelected) => (
            <>
              <BoxPart args={[0.2, 0.58, 0.2]} color={limb} selected={isSelected} position={[0, -0.29, 0]} onClick={jointClick('leftUpperLeg')} />
              <JointGroup part="leftLowerLeg" position={[0, -0.62, 0]} rotation={p.leftLowerLeg} selected={selected && selectedJoint === 'leftLowerLeg'}>
                {(lowerSelected) => <BoxPart args={[0.18, 0.55, 0.18]} color={limb} selected={lowerSelected} position={[0, -0.28, 0]} onClick={jointClick('leftLowerLeg')} />}
              </JointGroup>
            </>
          )}
        </JointGroup>

        <JointGroup part="rightUpperLeg" position={[-0.16, -0.16, 0]} rotation={p.rightUpperLeg} selected={selected && selectedJoint === 'rightUpperLeg'}>
          {(isSelected) => (
            <>
              <BoxPart args={[0.2, 0.58, 0.2]} color={limb} selected={isSelected} position={[0, -0.29, 0]} onClick={jointClick('rightUpperLeg')} />
              <JointGroup part="rightLowerLeg" position={[0, -0.62, 0]} rotation={p.rightLowerLeg} selected={selected && selectedJoint === 'rightLowerLeg'}>
                {(lowerSelected) => <BoxPart args={[0.18, 0.55, 0.18]} color={limb} selected={lowerSelected} position={[0, -0.28, 0]} onClick={jointClick('rightLowerLeg')} />}
              </JointGroup>
            </>
          )}
        </JointGroup>
      </group>

      <Billboard position={[0, 2.35, 0]}>
        <Text fontSize={0.26} color="white" anchorX="center" anchorY="bottom" outlineWidth={0.02} outlineColor="black">
          {name}
        </Text>
      </Billboard>

      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.62, 0.68, 32]} />
          <meshBasicMaterial color="#00ffcc" side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
})

function PropMesh({ args, position, color, children }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      {children || <boxGeometry args={args} />}
      <meshStandardMaterial color={color} roughness={0.62} metalness={0.05} />
    </mesh>
  )
}

function Furniture({ type, color }) {
  const c = color || '#666666'
  switch (type) {
    case 'bed':
      return (
        <>
          <PropMesh args={[2.4, 0.28, 1.55]} position={[0, 0, 0]} color={c} />
          <PropMesh args={[2.2, 0.16, 1.4]} position={[0, 0.25, 0]} color="#9ca3af" />
          <PropMesh args={[0.42, 0.18, 1.35]} position={[-0.78, 0.43, 0]} color="#d8c7a3" />
        </>
      )
    case 'table':
    case 'desk':
      return (
        <>
          <PropMesh args={type === 'desk' ? [2.1, 0.14, 0.85] : [1.6, 0.12, 1]} position={[0, 0.32, 0]} color={c} />
          {[-0.65, 0.65].flatMap((x) => [-0.38, 0.38].map((z) => <PropMesh key={`${x}-${z}`} args={[0.1, 0.65, 0.1]} position={[x, -0.02, z]} color={c} />))}
        </>
      )
    case 'bookshelf':
    case 'shelf':
      return (
        <>
          <PropMesh args={type === 'bookshelf' ? [1.25, 2.15, 0.32] : [1.55, 1.45, 0.32]} position={[0, 0, 0]} color={c} />
          {[-0.55, 0, 0.55].map((x) => <PropMesh key={`v-${x}`} args={[0.05, type === 'bookshelf' ? 2.05 : 1.35, 0.36]} position={[x, 0, 0]} color="#3f3f46" />)}
          {[-0.65, -0.2, 0.25, 0.7].map((y) => <PropMesh key={`h-${y}`} args={[1.28, 0.06, 0.38]} position={[0, y, 0]} color="#3f3f46" />)}
          {[-0.35, 0.05, 0.42].map((x, i) => (
            <PropMesh key={`books-${i}`} args={[0.18, 0.42, 0.08]} position={[x, -0.43 + i * 0.45, -0.19]} color={['#2563eb', '#dc2626', '#f59e0b'][i]} />
          ))}
        </>
      )
    case 'chair':
      return (
        <>
          <PropMesh args={[0.58, 0.12, 0.55]} position={[0, 0.05, 0]} color={c} />
          <PropMesh args={[0.58, 0.75, 0.1]} position={[0, 0.42, 0.26]} color={c} />
          {[-0.22, 0.22].flatMap((x) => [-0.18, 0.18].map((z) => <PropMesh key={`${x}-${z}`} args={[0.07, 0.48, 0.07]} position={[x, -0.22, z]} color={c} />))}
        </>
      )
    case 'sofa':
      return (
        <>
          <PropMesh args={[2, 0.36, 0.82]} position={[0, -0.05, 0]} color={c} />
          <PropMesh args={[2.05, 0.7, 0.18]} position={[0, 0.25, 0.4]} color={c} />
          <PropMesh args={[0.18, 0.46, 0.82]} position={[-1.1, 0.08, 0]} color={c} />
          <PropMesh args={[0.18, 0.46, 0.82]} position={[1.1, 0.08, 0]} color={c} />
        </>
      )
    case 'door':
    case 'hatch':
      return (
        <>
          <PropMesh args={[type === 'hatch' ? 1.5 : 1, type === 'hatch' ? 2.5 : 2.2, 0.12]} position={[0, 0, 0]} color={c} />
          <PropMesh args={[0.08, 0.08, 0.08]} position={[0.32, 0, -0.08]} color="#facc15" />
        </>
      )
    case 'window':
      return (
        <>
          <PropMesh args={[1.35, 1.5, 0.08]} position={[0, 0, 0]} color="#334155" />
          <PropMesh args={[1.08, 1.2, 0.09]} position={[0, 0, -0.01]} color="#60a5fa" />
        </>
      )
    case 'console':
    case 'cockpit':
      return (
        <>
          <PropMesh args={[2.6, 0.65, 0.9]} position={[0, -0.15, 0]} color={c} />
          <PropMesh args={[2.2, 0.08, 0.55]} position={[0, 0.25, -0.08]} color="#111827" />
          <PropMesh args={[0.5, 0.32, 0.04]} position={[-0.55, 0.34, -0.38]} color="#22d3ee" />
          <PropMesh args={[0.5, 0.32, 0.04]} position={[0.55, 0.34, -0.38]} color="#34d399" />
        </>
      )
    case 'corridor':
      return (
        <>
          <PropMesh args={[8, 0.1, 1.5]} position={[0, -1.45, 0]} color="#4b5563" />
          <PropMesh args={[8, 3, 0.08]} position={[0, 0, -0.75]} color={c} />
          <PropMesh args={[8, 3, 0.08]} position={[0, 0, 0.75]} color={c} />
          <PropMesh args={[8, 0.08, 1.5]} position={[0, 1.48, 0]} color="#374151" />
        </>
      )
    case 'lamp':
      return (
        <>
          <mesh position={[0, 0, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.12, 4, 10]} />
            <meshStandardMaterial color={c} roughness={0.5} />
          </mesh>
          <pointLight position={[0, 2.2, 0]} intensity={0.8} color="#ffe8a3" distance={7} />
          <PropMesh args={[0.48, 0.18, 0.48]} position={[0, 2.05, 0]} color="#fde68a" />
        </>
      )
    case 'platform':
      return (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[1.5, 1.5, 0.3, 48]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      )
    case 'cylinder':
      return (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      )
    default: {
      const boxes = {
        wall: [4, 3, 0.18], cabinet: [1, 1.8, 0.6], screen: [2, 1.8, 0.08], carpet: [3, 0.05, 2],
        elevator: [2, 4, 2], base_module: [5, 2, 5], med_bed: [2.2, 0.7, 1], lab_table: [2, 1, 0.8],
        building: [6, 8, 6], street: [10, 0.1, 3], billboard: [3, 2, 0.3], bridge: [8, 2, 2],
      }
      return <PropMesh args={boxes[type] || [1, 1, 1]} position={[0, 0, 0]} color={c} />
    }
  }
}

export const PropModel = forwardRef(function PropModel({ prop, selected, onSelect }, ref) {
  const { type, position, rotation, scale, color } = prop
  return (
    <group ref={(node) => assignForwardedRef(ref, node)} position={position} rotation={rotation} scale={scale} onClick={(event) => { event.stopPropagation(); onSelect?.(prop.id) }}>
      <Furniture type={type} color={color} />
      {selected && (
        <mesh>
          <boxGeometry args={[1.25, 1.25, 1.25]} />
          <meshBasicMaterial color="#00ffcc" wireframe transparent opacity={0.55} />
        </mesh>
      )}
    </group>
  )
})

export const MovieCameraRig = forwardRef(function MovieCameraRig({ camera, active, onSelect, selected, showPath, pathPoints }, ref) {
  const groupRef = useRef(null)
  const pos = camera.position || [0, 2.2, 8]
  const isActive = active || selected

  useFrame(() => {
    if (groupRef.current && camera.lookAt) {
      groupRef.current.lookAt(new THREE.Vector3(...camera.lookAt))
    }
  })

  return (
    <group
      ref={(node) => {
        groupRef.current = node
        assignForwardedRef(ref, node)
      }}
      position={pos}
      rotation={camera.lookAt ? undefined : camera.rotation || [0, 0, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect?.(camera.id) }}
    >
      <mesh>
        <boxGeometry args={[0.54, 0.36, 0.62]} />
        <meshBasicMaterial color={selected ? '#00ff44' : isActive ? '#ffcc00' : '#ff4444'} wireframe />
      </mesh>
      <mesh position={[0, 0, -0.44]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.08, 0.55, 12]} />
        <meshBasicMaterial color={selected ? '#00ff44' : isActive ? '#ffcc00' : '#ff4444'} wireframe />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.56, 0.62, 32]} />
          <meshBasicMaterial color="#00ffcc" side={THREE.DoubleSide} />
        </mesh>
      )}
      {showPath && pathPoints?.length > 1 && <Line points={pathPoints} color="#ffaa00" lineWidth={1} />}
    </group>
  )
})

function GroundReference({ showGrid = true, muted = false }) {
  const floorColor = muted ? '#16231f' : '#1b2a24'
  const gridPrimary = muted ? '#3f6f61' : '#5f8278'
  const gridSecondary = muted ? '#28433c' : '#36534b'
  const laneColor = muted ? '#00d6aa' : '#00ffcc'
  const depthColor = muted ? '#f5b84b' : '#ffcc66'
  const markerColor = muted ? '#6ab8ff' : '#8bd3ff'

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial
          color={floorColor}
          roughness={0.82}
          metalness={0}
          transparent
          opacity={muted ? 0.86 : 0.92}
        />
      </mesh>
      {showGrid && <gridHelper args={[50, 50, gridPrimary, gridSecondary]} />}
      <Line points={[[-25, 0.018, 0], [25, 0.018, 0]]} color={laneColor} lineWidth={muted ? 1.4 : 1} transparent opacity={muted ? 0.55 : 0.38} />
      <Line points={[[0, 0.02, -25], [0, 0.02, 25]]} color={depthColor} lineWidth={muted ? 1.4 : 1} transparent opacity={muted ? 0.52 : 0.34} />
      {[-4, -2, 2, 4].map((z) => (
        <Line key={`lane-z-${z}`} points={[[-18, 0.016, z], [18, 0.016, z]]} color={markerColor} lineWidth={0.7} transparent opacity={muted ? 0.22 : 0.18} />
      ))}
    </>
  )
}

function BackgroundPlane({ image }) {
  const [texture, setTexture] = useState(null)

  useEffect(() => {
    if (!image?.url) return undefined
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.load(image.url, (loaded) => {
      if (disposed) {
        loaded.dispose()
        return
      }
      loaded.colorSpace = THREE.SRGBColorSpace
      setTexture(loaded)
    })
    return () => {
      disposed = true
      setTexture((prev) => {
        prev?.dispose?.()
        return null
      })
    }
  }, [image?.url])

  if (!image?.url || !texture) return null
  const ratio = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 16 / 9
  const height = image.height || image.size || 7
  const width = image.width || height * ratio
  const position = image.position || [0, height / 2 - 0.15, -9]
  const rotation = image.rotation || [0, 0, 0]
  const arc = image.arc || 0
  const radius = arc > 0 ? Math.max(1, width / arc) : 1
  const segments = arc > 0 ? 64 : 1
  const geometryArgs = arc > 0
    ? [radius, radius, height, segments, 1, true, -arc / 2, arc]
    : [width, height]
  return (
    <mesh position={position} rotation={rotation} receiveShadow={false}>
      {arc > 0 ? <cylinderGeometry args={geometryArgs} /> : <planeGeometry args={geometryArgs} />}
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function SceneSetup({ showGrid, showGuides, fogColor, lights, backgroundImage, backgroundImages, preview = false }) {
  const images = backgroundImages || (backgroundImage ? [backgroundImage] : [])
  return (
    <>
      {images.map((image, index) => <BackgroundPlane key={image.id || image.url || index} image={image} />)}
      {(showGrid || preview) && <GroundReference showGrid={showGrid || preview} muted={preview} />}
      <fog attach="fog" args={[fogColor || '#1e1e1e', 15, 65]} />
      <ambientLight intensity={lights?.ambient ?? 0.35} />
      <directionalLight position={[5, 10, 7]} intensity={lights?.main ?? 0.85} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-3, 5, -5]} intensity={lights?.rim ?? 0.5} color="#00ffcc" />
      {showGuides && <CompositionGuides />}
    </>
  )
}

function CompositionGuides() {
  const size = 2
  return [
    [[-size, size / 3, 0], [size, size / 3, 0]],
    [[-size, -size / 3, 0], [size, -size / 3, 0]],
    [[size / 3, -size, 0], [size / 3, size, 0]],
    [[-size / 3, -size, 0], [-size / 3, size, 0]],
  ].map(([a, b], index) => (
    <Line key={index} points={[a, b]} color="#ffffff" lineWidth={0.5} opacity={0.12} transparent />
  ))
}
