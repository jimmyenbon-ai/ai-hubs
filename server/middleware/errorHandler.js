// Global error handler middleware
// Ensures consistent error responses: { success: false, message }
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error('Error:', err);

  let status = err.status || 500;
  let message = err.message || '服务器内部错误，请稍后重试';

  // Multer (multipart/form-data) errors should be client errors, not 500
  // MulterError codes: LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, LIMIT_UNEXPECTED_FILE, ...
  if (err && (err.name === 'MulterError' || err.code)) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      const mb = Number(process.env.MAX_UPLOAD_MB || 10);
      message = `文件过大，请上传不超过 ${Number.isFinite(mb) ? mb : 10}MB 的图片`;
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      status = 400;
      message = '上传文件数量超限';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      message = '上传字段不符合预期';
    }
  }

  res.status(status).json({
    success: false,
    message,
  });
}

module.exports = errorHandler;

