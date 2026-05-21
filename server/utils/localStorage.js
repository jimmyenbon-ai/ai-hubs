/**
 * 本地归档存储 — 自动保存生成结果到本地目录
 * 不影响前台功能，纯后台静默备份
 *
 * 目录结构:
 *   server/local_storage/
 *     images/YYYY-MM-DD/    ← 生成的图片
 *     videos/YYYY-MM-DD/    ← 生成的视频
 *     texts/YYYY-MM-DD/     ← 生成的文案
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');

const ROOT = path.join(__dirname, '..', 'local_storage');

function dateDir() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * 下载图片并保存到本地
 * @param {string} imageUrl — 公网可访问的图片 URL
 * @param {object} meta — 元信息 { id, model, prompt?, provider? }
 */
async function saveImage(imageUrl, meta = {}) {
  if (!imageUrl) return;
  try {
    const dir = path.join(ROOT, 'images', dateDir());
    await ensureDir(dir);

    const ext = '.jpg';
    const name = `img_${meta.id || Date.now()}_${Date.now()}${ext}`;
    const filePath = path.join(dir, name);

    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    await fsp.writeFile(filePath, Buffer.from(resp.data));

    // 同时写一个 .meta.txt 记录原始信息
    if (meta.prompt || meta.model) {
      const metaPath = filePath.replace(ext, '.meta.txt');
      const metaLines = [
        `id: ${meta.id || '-'}`,
        `model: ${meta.model || '-'}`,
        `provider: ${meta.provider || '-'}`,
        `url: ${imageUrl}`,
        `prompt: ${meta.prompt || '-'}`,
        `saved: ${new Date().toISOString()}`,
      ];
      await fsp.writeFile(metaPath, metaLines.join('\n'), 'utf8');
    }

    logger.info('[localStorage] 图片已存档', { path: filePath });
    return filePath;
  } catch (err) {
    logger.warn('[localStorage] 图片存档失败', { url: String(imageUrl).slice(0, 80), error: err.message });
  }
}

/**
 * 下载视频并保存到本地
 * @param {string} videoUrl — 公网可访问的视频 URL
 * @param {object} meta — 元信息 { taskId, model, prompt? }
 */
async function saveVideo(videoUrl, meta = {}) {
  if (!videoUrl) return;
  try {
    const dir = path.join(ROOT, 'videos', dateDir());
    await ensureDir(dir);

    // 尝试从 URL 取扩展名
    let ext = '.mp4';
    try {
      const urlExt = path.extname(new URL(videoUrl).pathname).toLowerCase();
      if (['.mp4', '.mov', '.webm', '.avi'].includes(urlExt)) {
        ext = urlExt;
      }
    } catch (_) { /* ignore */ }

    const name = `vid_${meta.taskId || Date.now()}_${Date.now()}${ext}`;
    const filePath = path.join(dir, name);

    const resp = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 300000, // 视频可能很大，5分钟超时
    });
    await fsp.writeFile(filePath, Buffer.from(resp.data));

    // 写 meta 文件
    const metaPath = filePath.replace(ext, '.meta.txt');
    const metaLines = [
      `taskId: ${meta.taskId || '-'}`,
      `model: ${meta.model || '-'}`,
      `url: ${videoUrl}`,
      `prompt: ${meta.prompt || '-'}`,
      `duration: ${meta.duration || '-'}`,
      `resolution: ${meta.resolution || '-'}`,
      `saved: ${new Date().toISOString()}`,
    ];
    await fsp.writeFile(metaPath, metaLines.join('\n'), 'utf8');

    logger.info('[localStorage] 视频已存档', { path: filePath });
    return filePath;
  } catch (err) {
    logger.warn('[localStorage] 视频存档失败', { url: String(videoUrl).slice(0, 80), error: err.message });
  }
}

/**
 * 保存生成的文案/文本
 * @param {string} content — 文本内容
 * @param {object} meta — 元信息 { source, title?, type? }
 */
async function saveText(content, meta = {}) {
  if (!content || typeof content !== 'string') return;
  try {
    const dir = path.join(ROOT, 'texts', dateDir());
    await ensureDir(dir);

    const ts = Date.now();
    const name = `txt_${meta.source || 'generate'}_${ts}.txt`;
    const filePath = path.join(dir, name);

    const header = [
      `source: ${meta.source || '-'}`,
      `title: ${meta.title || '-'}`,
      `type: ${meta.type || '-'}`,
      `saved: ${new Date().toISOString()}`,
      `${'='.repeat(40)}`,
      '',
    ].join('\n');

    await fsp.writeFile(filePath, header + content, 'utf8');

    logger.info('[localStorage] 文案已存档', { path: filePath, length: content.length });
    return filePath;
  } catch (err) {
    logger.warn('[localStorage] 文案存档失败', { error: err.message });
  }
}

/**
 * 下载音频并保存到本地
 * @param {string} audioUrl — 公网可访问的音频 URL
 * @param {object} meta — 元信息 { taskId, model, title? }
 */
async function saveAudio(audioUrl, meta = {}) {
  if (!audioUrl) return;
  try {
    const dir = path.join(ROOT, 'audios', dateDir());
    await ensureDir(dir);

    let ext = '.mp3';
    try {
      const urlExt = path.extname(new URL(audioUrl).pathname).toLowerCase();
      if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(urlExt)) {
        ext = urlExt;
      }
    } catch (_) { /* ignore */ }

    const name = `aud_${meta.taskId || Date.now()}_${Date.now()}${ext}`;
    const filePath = path.join(dir, name);

    const resp = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    await fsp.writeFile(filePath, Buffer.from(resp.data));

    const metaPath = filePath.replace(ext, '.meta.txt');
    const metaLines = [
      `taskId: ${meta.taskId || '-'}`,
      `model: ${meta.model || '-'}`,
      `title: ${meta.title || '-'}`,
      `url: ${audioUrl}`,
      `saved: ${new Date().toISOString()}`,
    ];
    await fsp.writeFile(metaPath, metaLines.join('\n'), 'utf8');

    logger.info('[localStorage] 音频已存档', { path: filePath });
    return filePath;
  } catch (err) {
    logger.warn('[localStorage] 音频存档失败', { url: String(audioUrl).slice(0, 80), error: err.message });
  }
}

module.exports = { saveImage, saveVideo, saveText, saveAudio };
