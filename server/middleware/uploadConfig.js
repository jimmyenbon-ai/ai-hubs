const path = require('path');
const multer = require('multer');
const fs = require('fs');

const uploadDir =
  process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^\w\-]+/g, '');
    cb(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safeBase}${ext}`,
    );
  },
});

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/aac', 'audio/flac',
];

function fileFilter(req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error(
      `不支持的文件类型：${file.mimetype}，仅支持 JPG/PNG/WebP/GIF/视频/音频`,
    );
    err.status = 400;
    cb(err);
  }
}

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 10);
const maxFileSizeBytes =
  Number.isFinite(maxUploadMb) && maxUploadMb > 0
    ? Math.floor(maxUploadMb * 1024 * 1024)
    : 10 * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxFileSizeBytes, // per-file limit
    files: 9,
  },
});

module.exports = upload;

