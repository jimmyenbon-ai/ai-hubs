const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('../utils/logger');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 转换失败（code ${code}）：${stderr.slice(-1200)}`));
    });
  });
}

async function normalizePrevizVideo(req, res, next) {
  const inputPath = req.file?.path;
  if (!inputPath) {
    return res.status(400).json({ success: false, message: '没有收到待转换的视频' });
  }

  const width = Math.max(2, Number(req.body.width) || 1920);
  const height = Math.max(2, Number(req.body.height) || 1080);
  const fps = Math.max(24, Math.min(60, Number(req.body.fps) || 60));
  const outputWidth = width - (width % 2);
  const outputHeight = height - (height % 2);
  const parsed = path.parse(inputPath);
  const outputFilename = `${parsed.name}-h264.mp4`;
  const outputPath = path.join(parsed.dir, outputFilename);

  try {
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-an',
      '-vf', `scale=${outputWidth}:${outputHeight}:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-movflags', '+faststart',
      outputPath,
    ]);
    const stat = await fs.stat(outputPath);
    await fs.unlink(inputPath).catch(() => {});
    return res.json({
      success: true,
      data: {
        url: `/uploads/${outputFilename}`,
        filename: outputFilename,
        mimeType: 'video/mp4',
        ext: 'mp4',
        size: stat.size,
        width: outputWidth,
        height: outputHeight,
        fps,
      },
    });
  } catch (error) {
    logger.error('[previzVideo] normalize failed:', error.message);
    await fs.unlink(outputPath).catch(() => {});
    return next(error);
  }
}

module.exports = { normalizePrevizVideo };

