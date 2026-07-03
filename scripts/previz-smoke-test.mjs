const API_BASE = process.env.PREVIZ_API_BASE || 'http://localhost:3007';

const cases = [
  {
    id: 'film_walk_talk',
    material_type: 'script',
    director_profile: 'film_director',
    source_title: '雨夜双人对话',
    prompt: '一段电影剧情：雨夜城市天桥下，两名刑警一边并排行走一边低声争论案件真相。开头从背后跟拍，随后侧面跟随，最后绕到前方倒退拍摄，两人停在路灯下，其中一人拿出一张照片。整体要像电影一镜到底和切镜结合，不要平淡，要有推拉变焦、前景遮挡、地面湿润反光参照。请拆分为可审核3D预演分镜。',
  },
  {
    id: 'product_led',
    material_type: 'product',
    director_profile: 'product_animator',
    source_title: 'LED显示屏产品片',
    prompt: '企业产品广告：一个正方形LED显示屏产品，黑场中升起，屏幕像素网格逐层点亮，镜头从正面低机位推近，然后绕到侧面展示厚度和边框，最后回到正面定格。要求摄影机可以固定或运动，产品本体要有丝滑动作。输出给AI视频平台做产品运镜参考。',
  },
  {
    id: 'corp_promo',
    material_type: 'script',
    director_profile: 'commercial_director',
    source_title: '智慧展厅宣传片',
    prompt: '企业宣传片脚本：清晨，现代化展厅灯光逐步亮起，访客走进展厅，墙面大屏展示公司技术路线，镜头穿过前景玻璃和展台，最后停在一块LED大屏和讲解员旁边。要求科技感、稳定高级、空间层次强，适合做宣传片AI视频参考。',
  },
  {
    id: 'scifi_air',
    material_type: 'space_air',
    director_profile: 'cinematographer',
    source_title: '太空飞船掠过行星',
    prompt: '科幻太空镜头：一艘飞船从暗处掠过小行星带，摄影机先远景观察，再快速侧向跟拍，最后长焦压缩到飞船和巨大行星同框。没有地面，所有物体悬空，要有空间纵深和速度感。请拆分分镜，每镜都能独立生成3D预演。',
  },
];

function containsAimLanguage(text = '') {
  return /lookAt|对准|脸|头胸|面部|中点/.test(text);
}

function scorePlan(plan) {
  const shots = plan?.shots || [];
  const problems = [];
  if (shots.length < 4) problems.push('分镜数量偏少');
  if (shots.some((shot) => Number(shot.duration) > 12)) problems.push('存在超过12秒镜头');
  if (shots.some((shot) => !shot.camera_movement)) problems.push('有镜头缺运镜');
  if (shots.some((shot) => !shot.focal && !shot.fov)) problems.push('有镜头缺焦段/FOV');
  if (shots.some((shot) => !shot.transition_in && !shot.transition_out)) problems.push('有镜头缺衔接');
  if (shots.some((shot) => !shot.previz_prompt || !containsAimLanguage(shot.previz_prompt))) problems.push('有镜头缺少对准/lookAt描述');
  return { shotCount: shots.length, total: plan?.total_duration, problems };
}

function scoreCommands(commands = []) {
  const types = commands.map((command) => command.type);
  const createCameras = commands.filter((command) => command.type === 'create_camera');
  const cameraMoves = commands.filter((command) => command.type === 'move_camera');
  const keyframes = commands.filter((command) => command.type === 'add_keyframe');
  const problems = [];
  if (!types.includes('set_timeline_duration')) problems.push('缺 set_timeline_duration');
  if (!types.includes('record_camera_video')) problems.push('缺 record_camera_video');
  if (keyframes.length < 3) problems.push('关键帧少于3个');
  if (cameraMoves.length > 0 && !cameraMoves.every((command) => Array.isArray(command.lookAt))) problems.push('有 move_camera 缺 lookAt');
  if (!createCameras.some((command) => Array.isArray(command.lookAt)) && !cameraMoves.some((command) => Array.isArray(command.lookAt))) problems.push('摄影机缺 lookAt');
  if (!commands.some((command) => command.type === 'create_camera' || command.type === 'move_camera' || command.type === 'configure_camera')) problems.push('缺摄影机控制');
  return { commandCount: commands.length, keyframes: keyframes.length, cameraMoves: cameraMoves.length, problems, types };
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

async function main() {
  const planResults = [];
  const directResults = [];

  for (const testCase of cases) {
    const { data } = await postJson('/api/previz/plan', {
      prompt: testCase.prompt,
      director_profile: testCase.director_profile,
      material_type: testCase.material_type,
      source_title: testCase.source_title,
    });

    const plan = data.data?.plan;
    planResults.push({
      id: testCase.id,
      ok: data.success,
      message: data.message,
      score: data.success ? scorePlan(plan) : null,
      sampleShots: (plan?.shots || []).slice(0, 3).map((shot) => ({
        id: shot.id,
        title: shot.title,
        duration: shot.duration,
        shot_size: shot.shot_size,
        focal: shot.focal,
        fov: shot.fov,
        movement: shot.camera_movement,
        transition_out: shot.transition_out,
        review_notes: shot.review_notes,
        promptHasAim: containsAimLanguage(shot.previz_prompt),
      })),
    });

    const firstShot = plan?.shots?.[0];
    if (!firstShot) continue;

    const directPrompt = `只生成并录制当前分镜，不要生成整段故事。

[当前分镜]
编号：${firstShot.id}
标题：${firstShot.title}
时长：${firstShot.duration}秒
场景：${firstShot.scene}
画面目标：${firstShot.visual_goal}
角色：${(firstShot.characters || []).join('、')}
道具：${(firstShot.props || []).join('、')}
动作：${firstShot.action}
景别：${firstShot.shot_size}
机位角度：${firstShot.camera_angle}
焦段/FOV：${firstShot.focal}${firstShot.fov ? ` / FOV ${firstShot.fov}` : ''}
运镜：${firstShot.camera_movement}

[执行要求]
1. 先 reset_scene 清理上一镜的演员和道具，但保留上传背景图、画幅和当前工程。
2. set_timeline_duration 必须等于 ${firstShot.duration}。
3. 至少建立 time=0、中段、time=${firstShot.duration} 三个关键帧。
4. 摄影机必须用 lookAt 对准主体脸部/头胸区域，双人镜头 lookAt 对准两人中点的脸部高度。
5. 如果有变焦，关键帧里必须体现 FOV 变化。
6. 地面场景必须有清楚的地面参照物或地面纹理/道路/地毯。
7. 最后 record_camera_video duration=${firstShot.duration}。

${firstShot.previz_prompt || ''}`;

    const { data: directData } = await postJson('/api/previz/direct', {
      scene_context: {
        actorCount: 0,
        propCount: 0,
        cameraCount: 1,
        currentFov: 40,
        currentAspect: '16:9',
        hasBackgroundImage: false,
        environmentMode: testCase.material_type === 'space_air' ? 'space' : 'ground',
      },
      prompt: directPrompt,
      director_profile: 'cinematographer',
      material_type: testCase.material_type,
      source_title: `${testCase.source_title} ${firstShot.id}`,
    });

    const commands = directData.data?.commands || [];
    directResults.push({
      id: testCase.id,
      shot: firstShot.id,
      ok: directData.success,
      message: directData.message,
      score: directData.success ? scoreCommands(commands) : null,
      commands: commands.slice(0, 10),
    });
  }

  console.log(JSON.stringify({ planResults, directResults }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
