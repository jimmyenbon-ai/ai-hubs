import { useEffect, useRef } from 'react'
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

export default function TransformGizmo({ target, mode, onChange, onDragStart, onDragEnd }) {
  const { camera, gl } = useThree()
  const controlsRef = useRef(null)

  useEffect(() => {
    if (!controlsRef.current || !target) return undefined
    const controls = controlsRef.current
    controls.attach(target)
    controls.setMode(mode)
    return () => controls.detach()
  }, [mode, target])

  useEffect(() => {
    if (!controlsRef.current) return undefined
    const controls = controlsRef.current

    const handleDragging = (event) => {
      if (event.value) {
        onDragStart?.()
      } else {
        if (target) {
          onChange?.(target.position.toArray(), target.rotation.toArray(), target.scale.toArray())
        }
        onDragEnd?.()
      }
    }

    controls.addEventListener('dragging-changed', handleDragging)
    return () => controls.removeEventListener('dragging-changed', handleDragging)
  }, [onChange, onDragEnd, onDragStart, target])

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

  if (!target) return null

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={mode}
      camera={camera}
      domElement={gl.domElement}
      onObjectChange={() => {
        onChange?.(target.position.toArray(), target.rotation.toArray(), target.scale.toArray())
      }}
    />
  )
}
