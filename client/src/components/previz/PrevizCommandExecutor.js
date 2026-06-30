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
function clampPosition(pos) {
  if (!pos || !Array.isArray(pos)) return pos;
  return [
    Math.max(-20, Math.min(20, Number(pos[0]) || 0)),
    0, // Y 轴强制为 0（由回调 snapToGround 处理）
    Math.max(-20, Math.min(20, Number(pos[2]) || 0)),
  ];
}

function clampFov(fov) {
  if (fov === undefined || fov === null) return undefined;
  return Math.max(15, Math.min(90, Number(fov) || 45));
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
          callbacks.createProp(
            cmd.prop_type,
            clampPosition(cmd.position),
            cmd.rotation,
            cmd.scale
          );
          break;
        }

        case 'create_camera': {
          const camId = callbacks.createCamera({
            name: cmd.name,
            position: cmd.position,
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
              cmd.position,
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
              cmd.position ? clampPosition(cmd.position) : undefined,
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
