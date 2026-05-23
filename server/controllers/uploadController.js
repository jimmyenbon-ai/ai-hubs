const path = require('path');

// POST /api/upload
// expects multipart/form-data with field "files"
// returns: { success, message, files: [{ id, url, filename }] }
async function handleUpload(req, res, next) {
  try {
    const files = req.files || [];
    if (!files.length) {
      const err = new Error('请至少上传一张图片');
      err.status = 400;
      throw err;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const result = files.map((file, index) => {
      const relativePath = path
        .join('uploads', path.basename(file.path))
        .replace(/\\/g, '/');

      return {
        id: index + 1, // per-request index
        url: `${baseUrl}/${relativePath}`,
        filename: file.filename,
      };
    });

    res.json({
      success: true,
      message: '上传成功',
      files: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleUpload,
};

