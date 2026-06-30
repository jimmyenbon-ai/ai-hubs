import * as THREE from 'three'

/**
 * CameraPathTools — 摄影机运镜工具集
 * CatmullRomCurve3 曲线路径 + 5种运镜模式 + 手持抖动
 */

// 创建平滑的 Catmull-Rom 曲线
export function createCameraPath(points) {
  if (!points || points.length < 2) return null
  const vecs = points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.5)
  return {
    curve,
    getPointAt: (t) => {
      const clamped = Math.max(0, Math.min(1, t))
      const pt = curve.getPointAt(clamped)
      return [pt.x, pt.y, pt.z]
    },
    getPoints: (n) => {
      const pts = curve.getPoints(n || 50)
      return pts.map((p) => [p.x, p.y, p.z])
    },
    getLength: () => curve.getLength(),
  }
}

// 在曲线上获取指定时间的位置
export function getPositionOnPath(path, t) {
  if (!path) return [0, 2.5, 8]
  return path.getPointAt(t)
}

// 根据模式计算摄影机的 lookAt 目标
export function getCameraLookAt(camera, mode, actorPosition, currentTime) {
  if (!actorPosition) return [0, 1.5, 0]

  const [ax, ay, az] = actorPosition
  const [cx, cy, cz] = camera.position || [0, 2.5, 8]

  switch (mode) {
    case 'fixed':
      // Use camera's own lookAt (default to first actor)
      return [ax, ay, az]

    case 'follow':
      // Lock onto actor with slight lead
      return [ax, ay + 0.3, az]

    case 'orbit': {
      // Orbit around actor at current camera height
      const radius = Math.sqrt((cx - ax) ** 2 + (cz - az) ** 2)
      const angle = currentTime * 0.5 // half radian per second
      const camX = ax + Math.cos(angle) * radius
      const camZ = az + Math.sin(angle) * radius
      return [ax, ay + 1, az] // Look at actor center
    }

    case 'drone': {
      // Look ahead along the path (5% ahead)
      return [ax, ay, az]
    }

    case 'handheld':
      // Same as fixed but with shake on position, lookAt stays on actor
      return [ax, ay + 0.2, az]

    default:
      return [ax, ay, az]
  }
}

// 手持抖动效果（余弦叠加微动）
export function applyHandheldShake(basePosition, intensity = 0.05, time = 0) {
  if (!basePosition) return [0, 2.5, 8]
  const [x, y, z] = basePosition

  // 多层不同频率和振幅的余弦波叠加，模拟真实手持微抖动
  const shakeX = Math.cos(time * 7.3) * intensity + Math.cos(time * 13.7) * intensity * 0.6
  const shakeY = Math.sin(time * 8.1) * intensity * 0.8 + Math.cos(time * 11.3) * intensity * 0.4
  const shakeZ = Math.cos(time * 9.5) * intensity * 0.7 + Math.sin(time * 15.1) * intensity * 0.5

  return [x + shakeX, y + shakeY, z + shakeZ]
}

// 平滑焦距过渡
export function lerpFov(currentFov, targetFov, t) {
  if (currentFov == null || targetFov == null) return currentFov || 45
  return currentFov + (targetFov - currentFov) * Math.min(1, Math.max(0, t))
}

// 将摄影机移动到路径上的指定位置 + 模式处理
export function updateCameraOnPath(cameraObj, path, t, mode, actorPosition, currentTime) {
  if (!cameraObj) return

  const pathPos = path ? getPositionOnPath(path, t) : cameraObj.position
  let finalPos = pathPos

  if (mode === 'handheld') {
    finalPos = applyHandheldShake(pathPos, 0.05, currentTime)
  } else if (mode === 'orbit') {
    const [ax, , az] = actorPosition || [0, 1.5, 0]
    const radius = 5
    const angle = currentTime * 0.5
    finalPos = [
      ax + Math.cos(angle) * radius,
      (pathPos ? pathPos[1] : 3),
      az + Math.sin(angle) * radius,
    ]
  }

  return finalPos
}

export default {
  createCameraPath,
  getPositionOnPath,
  getCameraLookAt,
  applyHandheldShake,
  lerpFov,
  updateCameraOnPath,
}
