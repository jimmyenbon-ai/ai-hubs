const fs = require('fs/promises');
const path = require('path');

async function materialImageInput(url) {
  if (typeof url !== 'string') throw new Error('参考图地址无效');
  if (/^https?:\/\//i.test(url)) return url;
  const roots = [
    { prefix: '/uploads/knowledge/', root: process.env.KNOWLEDGE_UPLOAD_DIR || path.join(__dirname, '../uploads/knowledge') },
    { prefix: '/local_storage/', root: path.join(__dirname, '../local_storage') },
  ];
  const entry = roots.find(root => url.startsWith(root.prefix));
  if (!entry) throw new Error('参考图必须来自物料中心或本地生成记录');
  const relative = decodeURIComponent(url.slice(entry.prefix.length));
  const root = await fs.realpath(entry.root), target = await fs.realpath(path.resolve(root, relative));
  if (!target.startsWith(root + path.sep)) throw new Error('参考图路径越界');
  const ext = path.extname(target).toLowerCase();
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
  if (!types[ext]) throw new Error('当前模型参考图仅支持 JPG、PNG、WebP、GIF，请转换图片格式');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('参考图过大，单图不能超过 8 MB');
  const bytes = await fs.readFile(target);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : bytes.subarray(0, 2).equals(Buffer.from([255, 216])) ? 'image/jpeg' : bytes.subarray(0, 3).toString() === 'GIF' ? 'image/gif' : bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : types[ext];
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

module.exports = { materialImageInput };
