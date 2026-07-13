import { useEffect, useRef } from 'react'
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

export default function TransformGizmo({ target, mode, onChange, onDragStart, onDragEnd }) {
  const { camera, gl, scene } = useThree()
  const controlsRef = useRef(null)

  let current = target
  let isInCurrentScene = false
  while (current) {
    if (current === scene) {
      isInCurrentScene = true
      break
    }
    current = current.parent
  }
  const attachedTarget = isInCurrentScene ? target : null

  useEffect(() => {
    if (!controlsRef.current) return undefined
    const controls = controlsRef.current

    const handleDragging = (event) => {
      if (event.value) {
        onDragStart?.()
      } else {
        if (attachedTarget) {
          onChange?.(attachedTarget.position.toArray(), attachedTarget.rotation.toArray(), attachedTarget.scale.toArray())
        }
        onDragEnd?.()
      }
    }

    controls.addEventListener('dragging-changed', handleDragging)
    return () => controls.removeEventListener('dragging-changed', handleDragging)
  }, [attachedTarget, onChange, onDragEnd, onDragStart])

  useEffect(() => {
    const handleKey = (event) => {
      if (!controlsRef.current) return
      if (event.key === 'w' || event.key === 'W') controlsRef.current.setMode('translate')
      if (event.key === 'e' || event.key === 'E') controlsRef.current.setMode('rotate')
      if (event.key === 'r' || event.key === 'R') controlsRef.current.setMode('scale')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  if (!attachedTarget) return null

  return (
    <TransformControls
      ref={controlsRef}
      object={attachedTarget}
      mode={mode}
      camera={camera}
      domElement={gl.domElement}
      onObjectChange={() => {
        onChange?.(attachedTarget.position.toArray(), attachedTarget.rotation.toArray(), attachedTarget.scale.toArray())
      }}
    />
  )
}
