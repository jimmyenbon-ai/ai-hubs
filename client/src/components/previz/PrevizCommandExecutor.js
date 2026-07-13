/**
 * PrevizCommandExecutor — AI 生成的场景命令执行器
 *
 * 纯函数模块，不直接操作 React state。
 * 通过回调函数间接调用 DirectorPreviz 中现有的 state mutations。
 *
 * 设计原则：
 * 1. 每个命令类型 → 对应的回调调用
 * 2. 所有业务逻辑（snapToGround, getPropGroundY 等）由回调内部处理
 * 3. nameToId 映射表支持同一批次中按名称引用新创建的元素
 * 4. 返回统计信息 { applied, errors } 供 UI 展示
 */

/**
 * 按 ID 或名称查找目标
 * @param {string} target - ID 或名称
 * @param {Object} nameToId - 本批次中 name → id 的映射
 * @param {Function} getAll - 返回所有元素数组的函数
 * @returns {string|null} 匹配的 ID
 */
function resolveTarget(target, nameToId, getAll) {
  if (!target) return null;
  // 1. 本批次新建元素名称映射
  if (nameToId[target]) return nameToId[target];
  // 2. 按 ID 精确匹配
  const all = getAll();
  if (!all || !all.length) return target; // fallback: 返回原始值
  const byId = all.find((a) => a.id === target);
  if (byId) return byId.id;
  // 3. 按名称模糊匹配（中文名称）
  const byName = all.find((a) => a.name === target);
  if (byName) return byName.id;
  // 4. 子串匹配（如 "actor_1" 匹配 "演员 A" 的名称中包含 "演员"）
  const bySubstring = all.find(
    (a) =>
      (a.name && a.name.includes(target)) ||
      (target && target.includes(a.name))
  );
  if (bySubstring) return bySubstring.id;
  // 5. 都没匹配到，返回原始值让回调自己处理
  return target;
}

/**
 * 对数组值做安全钳制（确保在合理范围内）
 */
function clampPosition(pos, groundLocked = true) {
  if (!pos || !Array.isArray(pos)) return pos;
  return [
    Math.max(-20, Math.min(20, Number(pos[0]) || 0)),
    groundLocked ? 0 : Math.max(-20, Math.min(20, Number(pos[1]) || 0)),
    Math.max(-20, Math.min(20, Number(pos[2]) || 0)),
  ];
}

function clampFov(fov) {
  if (fov === undefined || fov === null) return undefined;
  return Math.max(15, Math.min(90, Number(fov) || 45));
}

function clampCameraPosition(pos, freeY = false) {
  if (!pos || !Array.isArray(pos)) return pos;
  return [
    Math.max(-20, Math.min(20, Number(pos[0]) || 0)),
    freeY ? Math.max(-40, Math.min(40, Number(pos[1]) || 0)) : Math.max(0.2, Math.min(20, Number(pos[1]) || 0.2)),
    Math.max(-40, Math.min(40, Number(pos[2]) || 0)),
  ];
}

function degreesToRadians(value) {
  return (Number(value) || 0) * Math.PI / 180;
}

function lerpVector(a, b, t) {
  return [0, 1, 2].map((axis) => (Number(a?.[axis]) || 0) + ((Number(b?.[axis]) || 0) - (Number(a?.[axis]) || 0)) * t);
}

function resolveRigCenter(command, nameToId, callbacks) {
  if (Array.isArray(command.center)) return command.center.map(Number);
  const subjectId = resolveTarget(command.subject, nameToId, callbacks.getAllActors);
  const subject = callbacks.getAllActors().find((actor) => actor.id === subjectId);
  if (subject?.position) return [subject.position[0], Number(command.look_at_height) || 1.55, subject.position[2]];
  if (Array.isArray(command.lookAt)) return command.lookAt.map(Number);
  return [0, Number(command.look_at_height) || 1.55, 0];
}

function buildCameraRigKeyframes(command, nameToId, callbacks) {
  const rigType = command.rig_type || command.movement || 'dolly';
  const startTime = Math.max(0, Number(command.start_time) || 0);
  const endTime = Math.max(startTime + 0.5, Number(command.end_time ?? command.duration) || 6);
  const center = resolveRigCenter(command, nameToId, callbacks);
  const easing = command.easing || 'easeInOutCubic';
  const fovStart = clampFov(command.fov_start ?? command.fov ?? 45);
  const fovEnd = clampFov(command.fov_end ?? command.fov ?? fovStart);
  const steps = Math.max(3, Math.min(12, Number(command.steps) || (rigType === 'handheld' ? 10 : 5)));
  const keyframes = [];

  if (rigType === 'follow' && command.subject) {
    const subjectId = resolveTarget(command.subject, nameToId, callbacks.getAllActors);
    const subjectTrack = callbacks.getTrack?.('actor', subjectId);
    const offset = Array.isArray(command.offset) ? command.offset.map(Number) : [0, 1.1, -4];
    const actorKeyframes = (subjectTrack?.keyframes || []).filter((keyframe) => keyframe.time >= startTime && keyframe.time <= endTime);
    if (actorKeyframes.length >= 2) {
      return actorKeyframes.map((keyframe, index) => {
        const t = index / (actorKeyframes.length - 1);
        const subjectPosition = keyframe.position || center;
        return {
          time: keyframe.time,
          position: [subjectPosition[0] + offset[0], subjectPosition[1] + offset[1], subjectPosition[2] + offset[2]],
          lookAt: [subjectPosition[0], subjectPosition[1] + (Number(command.look_at_height) || 1.55), subjectPosition[2]],
          fov: fovStart + (fovEnd - fovStart) * t,
          easing,
        };
      });
    }
  }

  if (rigType === 'orbit') {
    const radius = Math.max(1.5, Math.min(15, Number(command.radius) || 4));
    const height = Math.max(0.5, Math.min(12, Number(command.height) || center[1]));
    const startAngle = degreesToRadians(command.start_angle ?? -35);
    const endAngle = degreesToRadians(command.end_angle ?? 35);
    for (let index = 0; index < steps; index += 1) {
      const t = index / (steps - 1);
      const angle = startAngle + (endAngle - startAngle) * t;
      keyframes.push({
        time: startTime + (endTime - startTime) * t,
        position: [center[0] + Math.sin(angle) * radius, height, center[2] + Math.cos(angle) * radius],
        lookAt: [...center],
        fov: fovStart + (fovEnd - fovStart) * t,
        easing,
      });
    }
    return keyframes;
  }

  const defaultStart = [center[0], center[1] + 0.15, center[2] + (rigType === 'pull_out' ? 3 : 7)];
  const defaultEnd = [
    center[0] + (rigType === 'truck' ? 5 : 0),
    center[1] + (rigType === 'crane' ? 4 : 0.15),
    center[2] + (rigType === 'pull_out' ? 8 : 3),
  ];
  const start = clampCameraPosition(command.start_position || command.position_start || defaultStart, true);
  const end = clampCameraPosition(command.end_position || command.position_end || defaultEnd, true);

  for (let index = 0; index < steps; index += 1) {
    const t = index / (steps - 1);
    let position = lerpVector(start, end, t);
    if (rigType === 'handheld') {
      const intensity = Math.max(0.005, Math.min(0.12, Number(command.intensity) || 0.025));
      position = [
        position[0] + Math.sin(t * Math.PI * 7) * intensity,
        position[1] + Math.sin(t * Math.PI * 11 + 0.7) * intensity * 0.55,
        position[2] + Math.sin(t * Math.PI * 5 + 1.3) * intensity * 0.35,
      ];
    }
    keyframes.push({
      time: startTime + (endTime - startTime) * t,
      position,
      lookAt: [...center],
      fov: fovStart + (fovEnd - fovStart) * t,
      easing: rigType === 'handheld' ? 'linear' : easing,
    });
  }
  return keyframes;
}

export function ensureCameraTrackForRecording({ prompt = '', duration = 15 } = {}, callbacks) {
  const cameras = callbacks.getAllCameras?.() || [];
  const activeId = callbacks.getActiveCameraId?.();
  const cameraId = cameras.some((camera) => camera.id === activeId) ? activeId : cameras[0]?.id;
  if (!cameraId) return { created: false, reason: '没有可用主机位' };
  const currentTrack = callbacks.getTrack?.('camera', cameraId);
  if (currentTrack?.keyframes?.length >= 2) return { created: false, reason: '已有摄影机轨道', cameraId };

  const actors = callbacks.getAllActors?.() || [];
  const subject = actors[0];
  const seconds = Math.max(3, Math.min(120, Number(duration) || 15));
  const wantsOrbit = /环绕|绕到|绕拍|顺时针|逆时针/.test(prompt);
  const wantsCrane = /升至|升高|升降|俯拍|高机位/.test(prompt);
  const command = wantsOrbit
    ? { rig_type: 'orbit', subject: subject?.name, start_time: 0, end_time: seconds, radius: 4.8, start_angle: -32, end_angle: 34, height: 1.45, look_at_height: 1.55, fov_start: 52, fov_end: 38, easing: 'easeInOutCubic' }
    : { rig_type: wantsCrane ? 'crane' : 'dolly', subject: subject?.name, start_time: 0, end_time: seconds, start_position: [-3.8, 1.1, 6.5], end_position: wantsCrane ? [2.8, 3.5, 6.8] : [-1.8, 1.5, 3.8], fov_start: 50, fov_end: 38, easing: 'easeInOutCubic' };
  const nameToId = subject?.name ? { [subject.name]: subject.id } : {};
  const keyframes = buildCameraRigKeyframes(command, nameToId, callbacks);
  callbacks.setCameraTrack?.(cameraId, keyframes, {
    rigType: command.rig_type,
    subject: command.subject,
    easing: command.easing,
  });
  callbacks.setActiveCamera?.(cameraId);
  callbacks.setCameraMode?.(command.rig_type === 'orbit' ? 'orbit' : command.rig_type === 'crane' ? 'drone' : 'fixed');
  return { created: keyframes.length >= 2, cameraId, keyframes: keyframes.length };
}

/**
 * 应用 AI 生成的命令列表到场景
 *
 * @param {Array} commands - AI 生成的命令数组
 * @param {Object} callbacks - 从 DirectorPreviz 传入的回调函数集合
 * @param {Function} callbacks.createActor - ({ name, position, rotation, scale, pose }) => id
 * @param {Function} callbacks.deleteActor - (id) => void
 * @param {Function} callbacks.renameActor - (id, name) => void
 * @param {Function} callbacks.createProp - (type, position, rotation, scale) => id
 * @param {Function} callbacks.deleteProp - (id) => void
 * @param {Function} callbacks.createCamera - ({ name, position, rotation, fov, lookAt }) => id
 * @param {Function} callbacks.deleteCamera - (id) => void
 * @param {Function} callbacks.selectActor - (id) => void
 * @param {Function} callbacks.selectCamera - (id) => void
 * @param {Function} callbacks.applyPose - (preset, actorId) => void
 * @param {Function} callbacks.moveActor - (id, position, rotation) => void
 * @param {Function} callbacks.moveCamera - (id, position, rotation, lookAt, fov) => void
 * @param {Function} callbacks.moveProp - (id, position, rotation, scale) => void
 * @param {Function} callbacks.configureCamera - (id, { fov, mode, lookAt }) => void
 * @param {Function} callbacks.setCameraMode - (mode) => void
 * @param {Function} callbacks.setActiveCamera - (id) => void
 * @param {Function} callbacks.setCameraFov - (fov) => void
 * @param {Function} callbacks.setAspectRatio - (ratio) => void
 * @param {Function} callbacks.setEnvironment - (mode) => void
 * @param {Function} callbacks.setTimelineDuration - (seconds) => void
 * @param {Function} callbacks.recordCameraVideo - ({ duration, delay }) => void
 * @param {Function} callbacks.focusCameraOnActor - (actorId) => void
 * @param {Function} callbacks.resetScene - () => void
 * @param {Function} callbacks.clearAllProps - () => void
 * @param {Function} callbacks.clearAllActors - () => void
 * @param {Function} callbacks.getAllActors - () => array
 * @param {Function} callbacks.getAllCameras - () => array
 * @param {Function} callbacks.getAllProps - () => array
 * @returns {{ applied: number, errors: string[] }}
 */
export function applyCommands(commands, callbacks) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { applied: 0, errors: ['命令列表为空'] };
  }

  const errors = [];
  const nameToId = {}; // 本批次中新建元素的 name → id 映射
  let environmentMode = 'ground';

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd || !cmd.type) {
      errors.push(`命令${i + 1}: 无效（缺少 type）`);
      continue;
    }

    try {
      switch (cmd.type) {
        // ---- 创建 ----
        case 'create_actor': {
          const actorId = callbacks.createActor({
            name: cmd.name,
            position: clampPosition(cmd.position),
            rotation: cmd.rotation,
            scale: cmd.scale,
            pose: cmd.pose,
          });
          if (actorId && cmd.name) {
            nameToId[cmd.name] = actorId;
          }
          if (cmd.select && actorId) {
            callbacks.selectActor(actorId);
          }
          break;
        }

        case 'create_prop': {
          const propId = callbacks.createProp(
            cmd.prop_type,
            clampPosition(cmd.position, false),
            cmd.rotation,
            cmd.scale
          );
          if (propId && cmd.name) nameToId[cmd.name] = propId;
          break;
        }

        case 'create_camera': {
          const camId = callbacks.createCamera({
            name: cmd.name,
            position: clampCameraPosition(cmd.position, environmentMode === 'space' || environmentMode === 'air'),
            rotation: cmd.rotation,
            fov: clampFov(cmd.fov),
            lookAt: cmd.lookAt,
          });
          if (camId && cmd.name) {
            nameToId[cmd.name] = camId;
          }
          if (cmd.mode) {
            callbacks.setCameraMode(cmd.mode);
          }
          if (cmd.set_active && camId) {
            callbacks.setActiveCamera(camId);
          }
          if (cmd.select && camId) {
            callbacks.selectCamera(camId);
          }
          break;
        }

        // ---- 移动/修改 ----
        case 'move_actor': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllActors);
          if (id) {
            callbacks.moveActor(
              id,
              cmd.position ? clampPosition(cmd.position) : undefined,
              cmd.rotation
            );
          }
          break;
        }

        case 'move_camera': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllCameras);
          if (id) {
            callbacks.moveCamera(
              id,
              clampCameraPosition(cmd.position, environmentMode === 'space' || environmentMode === 'air'),
              cmd.rotation,
              cmd.lookAt,
              clampFov(cmd.fov)
            );
          }
          break;
        }

        case 'move_prop': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllProps);
          if (id) {
            callbacks.moveProp(
              id,
              cmd.position ? clampPosition(cmd.position, false) : undefined,
              cmd.rotation,
              cmd.scale
            );
          }
          break;
        }

        case 'apply_pose': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllActors);
          if (id && cmd.pose) {
            callbacks.selectActor(id);
            callbacks.applyPose(cmd.pose, id);
          }
          break;
        }

        case 'configure_camera': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllCameras);
          if (id) {
            callbacks.configureCamera(id, {
              fov: clampFov(cmd.fov),
              mode: cmd.mode,
              lookAt: cmd.lookAt,
            });
            if (cmd.mode) {
              callbacks.setCameraMode(cmd.mode);
            }
          }
          break;
        }

        case 'focus_camera_on_actor': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllActors);
          if (id) {
            callbacks.focusCameraOnActor(id);
          }
          break;
        }

        case 'add_keyframe': {
          const time = Math.max(0, Math.min(120, Number(cmd.time) || 0));
          callbacks.addKeyframe?.(time);
          break;
        }

        case 'set_camera_rig': {
          const availableCameras = callbacks.getAllCameras();
          const resolvedId = resolveTarget(cmd.target, nameToId, callbacks.getAllCameras);
          const id = availableCameras.some((camera) => camera.id === resolvedId)
            ? resolvedId
            : callbacks.getActiveCameraId?.() || availableCameras[0]?.id;
          if (id) {
            const keyframes = buildCameraRigKeyframes(cmd, nameToId, callbacks);
            callbacks.setCameraTrack?.(id, keyframes, {
              rigType: cmd.rig_type || cmd.movement || 'dolly',
              subject: cmd.subject,
              easing: cmd.easing || 'easeInOutCubic',
            });
            const mode = {
              orbit: 'orbit',
              handheld: 'handheld',
              follow: 'follow',
              crane: 'drone',
            }[cmd.rig_type] || 'fixed';
            callbacks.setCameraMode?.(mode);
            callbacks.setActiveCamera?.(id);
          }
          break;
        }

        // ---- 删除 ----
        case 'delete_actor': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllActors);
          if (id) callbacks.deleteActor(id);
          break;
        }

        case 'delete_prop': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllProps);
          if (id) callbacks.deleteProp(id);
          break;
        }

        case 'delete_camera': {
          const id = resolveTarget(cmd.target, nameToId, callbacks.getAllCameras);
          if (id) callbacks.deleteCamera(id);
          break;
        }

        // ---- 全局设置 ----
        case 'set_aspect_ratio':
          if (cmd.value) callbacks.setAspectRatio(cmd.value);
          break;

        case 'set_focal_length':
          if (cmd.fov !== undefined) callbacks.setCameraFov(clampFov(cmd.fov));
          break;

        case 'set_environment':
          environmentMode = cmd.mode || environmentMode;
          if (cmd.mode) callbacks.setEnvironment?.(cmd.mode);
          break;

        case 'set_timeline_duration': {
          const seconds = Math.max(1, Math.min(120, Number(cmd.duration) || 30));
          callbacks.setTimelineDuration?.(seconds);
          break;
        }

        case 'record_camera_video': {
          callbacks.recordCameraVideo?.({
            duration: cmd.duration !== undefined ? Math.max(1, Math.min(120, Number(cmd.duration) || 30)) : undefined,
            delay: cmd.delay !== undefined ? Math.max(0, Math.min(10, Number(cmd.delay) || 0)) : undefined,
          });
          break;
        }

        case 'set_lighting':
          // 灯光调整 — 目前是信息性的，前端暂不支持动态调光
          // 不报错，因为灯光设置不阻塞场景搭建
          break;

        // ---- 重置/清空 ----
        case 'reset_scene':
          callbacks.resetScene();
          break;

        case 'clear_props':
          callbacks.clearAllProps();
          break;

        case 'clear_actors':
          callbacks.clearAllActors();
          break;

        default:
          errors.push(`命令${i + 1}: 未知类型 "${cmd.type}"`);
      }
    } catch (e) {
      errors.push(`命令${i + 1}("${cmd.type}"): ${e.message}`);
    }
  }

  return {
    applied: commands.length - errors.length,
    errors,
  };
}

export default applyCommands;
