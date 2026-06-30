import * as THREE from 'three'

/**
 * ExportRenderers — ShaderMaterial 渲染导出
 * 深度图、骨骼线、角色遮罩的正确 Three.js 实现
 */

// 深度图 ShaderMaterial（近白远黑）
const depthVertexShader = /* glsl */ `
varying vec4 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const depthFragmentShader = /* glsl */ `
uniform float uFarPlane;
varying vec4 vWorldPos;
void main() {
  float depth = length(vWorldPos.xyz - cameraPosition);
  float normalized = clamp(depth / uFarPlane, 0.0, 1.0);
  // Near = white, Far = black
  float gray = 1.0 - normalized;
  gl_FragColor = vec4(vec3(gray), 1.0);
}
`

export function createDepthMaterial(farPlane = 100) {
  return new THREE.ShaderMaterial({
    vertexShader: depthVertexShader,
    fragmentShader: depthFragmentShader,
    uniforms: {
      uFarPlane: { value: farPlane },
    },
    depthTest: true,
    depthWrite: true,
  })
}

// 骨骼线材质（白线黑底）
export function createSkeletonMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    opacity: 1,
    transparent: false,
  })
}

// 角色遮罩材质（纯色，无光照）
export function createMaskMaterial(hexColor) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(hexColor),
    depthTest: true,
    depthWrite: true,
  })
}

// 场景材质覆盖 + 恢复
const originalMaterials = new Map()

export function overrideSceneMaterials(rootObject3D, mode) {
  if (!rootObject3D) return () => {}

  // Clear previous storage
  originalMaterials.clear()

  const depthMat = createDepthMaterial()
  const skeletonMat = createSkeletonMaterial()

  // Actor colors for masks
  const actorColors = [
    0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff,
    0xff8844, 0x88ff44, 0x4488ff, 0xff4488,
  ]
  let colorIndex = 0

  rootObject3D.traverse((child) => {
    if (!child.isMesh) return

    // Skip helper/guide objects
    if (child.material && child.material.isShaderMaterial) return

    // Store original material
    originalMaterials.set(child, child.material)

    if (mode === 'depth') {
      child.material = depthMat
    } else if (mode === 'skeleton') {
      child.material = skeletonMat
      // Ensure wireframe geometry has edges for better visibility
      if (!child.geometry.attributes.position) return
    } else if (mode === 'mask') {
      // Assign distinct colors per mesh for actor masks
      // Actors have colored body parts, props get gray
      const color = (child.parent && child.parent.userData && child.parent.userData.isActor)
        ? actorColors[colorIndex++ % actorColors.length]
        : 0x333333
      child.material = createMaskMaterial(color)
    }
  })

  // Return restore function
  return () => {
    originalMaterials.forEach((mat, mesh) => {
      mesh.material = mat
    })
    originalMaterials.clear()
  }
}

// 渲染单帧并导出为 dataURL
export function renderExportFrame(renderer, scene, camera, mode, width = 1920, height = 1080) {
  if (!renderer || !scene || !camera) return null

  const oldSize = renderer.getSize(new THREE.Vector2())
  renderer.setSize(width, height)

  // Set background based on mode
  const oldBg = scene.background
  const oldFog = scene.fog

  if (mode === 'depth' || mode === 'skeleton' || mode === 'mask') {
    scene.background = new THREE.Color(0x000000)
    scene.fog = null
  }

  // Override materials
  const restore = overrideSceneMaterials(scene, mode)

  // Render
  renderer.render(scene, camera)

  // Capture
  const dataURL = renderer.domElement.toDataURL('image/png')

  // Restore
  restore()
  scene.background = oldBg
  scene.fog = oldFog
  renderer.setSize(oldSize.x, oldSize.y)

  return dataURL
}

// 导出文件下载
export function downloadDataURL(dataURL, filename) {
  if (!dataURL) return
  const link = document.createElement('a')
  link.download = filename
  link.href = dataURL
  link.click()
}

export default {
  createDepthMaterial,
  createSkeletonMaterial,
  createMaskMaterial,
  overrideSceneMaterials,
  renderExportFrame,
  downloadDataURL,
}
