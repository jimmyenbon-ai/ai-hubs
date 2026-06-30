const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { execFile } = require('child_process');

const uploadDir =
  process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// 参考图外链上传配置（复用 AI-web 项目的思路，默认走 0x0.st）
const REF_IMAGE_UPLOAD_URL =
  process.env.REF_IMAGE_UPLOAD_URL || 'https://0x0.st';
const REF_IMAGE_UPLOAD_TIMEOUT_MS = Number(
  // 30s 在部分网络/图床上偏紧，默认放宽到 120s；仍可用环境变量覆盖
  process.env.REF_IMAGE_UPLOAD_TIMEOUT_MS || 120000,
);
const REF_IMAGE_UPLOAD_USER_AGENT =
  process.env.REF_IMAGE_UPLOAD_USER_AGENT || 'curl/8.4.0';
const REF_IMAGE_UPLOAD_METHOD =
  (process.env.REF_IMAGE_UPLOAD_METHOD || 'auto').toLowerCase(); // auto | axios | curl
const REF_IMAGE_UPLOAD_RETRIES = Number(process.env.REF_IMAGE_UPLOAD_RETRIES || 2);
const REF_IMAGE_UPLOAD_RETRY_DELAY_MS = Number(
  process.env.REF_IMAGE_UPLOAD_RETRY_DELAY_MS || 600,
);
const REF_IMAGE_UPLOAD_ENABLE_TELEGRAPH_FALLBACK =
  (process.env.REF_IMAGE_UPLOAD_ENABLE_TELEGRAPH_FALLBACK || 'true')
    .toLowerCase() !== 'false';
const REF_IMAGE_UPLOAD_ENABLE_UGUU_FALLBACK =
  (process.env.REF_IMAGE_UPLOAD_ENABLE_UGUU_FALLBACK || 'true')
    .toLowerCase() !== 'false';

// ImgBB 上传配置（作为备用图床）
const REF_IMAGE_UPLOAD_ENABLE_IMGBB_FALLBACK =
  (process.env.REF_IMAGE_UPLOAD_ENABLE_IMGBB_FALLBACK || 'true')
    .toLowerCase() !== 'false';
const { appConfig } = require('./appConfig');

function getImgbbApiKey() { return appConfig.imgb_api_key || ''; }

/**
 * 使用 ImgBB API 上传图片（支持 base64 编码上传）
 * @param {Buffer} fileBuffer - 图片文件 Buffer
 * @param {string} filename - 文件名
 * @returns {Promise<string>} - 公网可访问的图片 URL
 */
async function uploadToImgBB(fileBuffer, filename) {
  if (!getImgbbApiKey()) {
    throw new Error('未配置 getImgbbApiKey()');
  }

  // 将图片转为 base64（ImgBB 支持直接传 base64，不需要 multipart）
  const base64 = fileBuffer.toString('base64');

  const form = new URLSearchParams();
  form.append('key', getImgbbApiKey());
  form.append('image', base64);
  if (filename) {
    form.append('name', filename.replace(/\.[^/.]+$/, '')); // 去掉扩展名
  }

  const resp = await axios.post('https://api.imgbb.com/1/upload', form, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REF_IMAGE_UPLOAD_USER_AGENT,
      Accept: 'application/json',
    },
    timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS,
    responseType: 'json',
  });

  const data = resp.data;

  // ImgBB 返回格式: { success: true, data: { url: "..." } }
  if (!data || data.success !== true) {
    throw new Error(`ImgBB 上传失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const imageUrl = data.data?.url;
  if (!isHttpUrl(imageUrl)) {
    throw new Error(`ImgBB 返回非有效 URL: ${String(imageUrl).slice(0, 100)}`);
  }

  return imageUrl;
}

/**
 * 判断URL是否是本地URL
 * @param {string} url - 图片URL
 * @returns {boolean}
 */
function isLocalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    // 本地/内网地址
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.')
    ) return true;
    // 隧道/内网穿透服务 — AI API 无法直接访问（免费版有警告页/限流）
    if (
      hostname.includes('ngrok') ||
      hostname.includes('tunnel') ||
      hostname.includes('localtunnel') ||
      hostname.includes('serveo') ||
      hostname.includes('loca.lt')
    ) return true;
    return false;
  } catch {
    // 如果不是有效的URL，可能是相对路径
    return !url.startsWith('http://') && !url.startsWith('https://');
  }
}

/**
 * 判断字符串是否为 http/https URL
 * @param {string} s
 * @returns {boolean}
 */
function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
}

/**
 * 根据本地 URL（如 http://localhost:5000/uploads/xxx.png 或 /uploads/xxx.png）
 * 解析出真实文件路径
 * @param {string} imageUrl
 * @returns {string} filePath
 */
function resolveLocalFilePath(imageUrl) {
  let filePath;

  // 尝试解析为URL
  try {
    const urlObj = new URL(imageUrl);
    const relativePath = urlObj.pathname; // 例如: /uploads/filename.jpg

    // 如果是/uploads/开头的路径，提取文件名到上传目录
    if (relativePath.startsWith('/uploads/')) {
      const filename = path.basename(relativePath);
      filePath = path.join(uploadDir, filename);
    } else {
      // 尝试直接使用路径（去掉开头的/）
      const cleanPath = relativePath.startsWith('/')
        ? relativePath.slice(1)
        : relativePath;
      filePath = path.join(__dirname, '..', cleanPath);
    }
  } catch {
    // 如果不是有效的URL，可能是相对路径，直接使用
    const cleanPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
    filePath = path.join(__dirname, '..', cleanPath);
  }

  return filePath;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatUploadCtx(method) {
  return `method=${method} url=${REF_IMAGE_UPLOAD_URL} timeoutMs=${REF_IMAGE_UPLOAD_TIMEOUT_MS}`;
}

function wrapUploadError(err, method) {
  const raw = err?.message || String(err);
  // axios 超时一般是 ECONNABORTED；curl 超时常见为 ETIMEDOUT / timed out
  const code = err?.code ? ` code=${err.code}` : '';
  const suffix = `${formatUploadCtx(method)}${code}`;
  if (/timeout|timed out|ECONNABORTED|ETIMEDOUT/i.test(raw)) {
    return new Error(`参考图上传超时（${suffix}）: ${raw}`);
  }
  return new Error(`参考图上传失败（${suffix}）: ${raw}`);
}

/**
 * 使用系统 curl 上传（在某些网络环境下比 Node 直连更稳定）
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function uploadFileViaCurl(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-fsS',
      '-A',
      REF_IMAGE_UPLOAD_USER_AGENT,
      '-F',
      `file=@${filePath}`,
      REF_IMAGE_UPLOAD_URL,
    ];

    execFile(
      'curl',
      args,
      { windowsHide: true, timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS },
      (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || String(err)).toString();
        return reject(wrapUploadError(new Error(msg.trim().slice(0, 300)), 'curl'));
      }
      const text = (stdout || '').toString().trim();
      const firstToken = (text || '').trim().split(/\s+/)[0];
      if (!isHttpUrl(firstToken)) {
        return reject(
          new Error(`curl 上传返回内容非URL: ${text.slice(0, 200) || '空响应'}`),
        );
      }
      resolve(firstToken);
      },
    );
  });
}

/**
 * 将图片URL转换为base64格式
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<string>} base64格式的图片数据（包含data:image/...前缀）
 */
async function urlToBase64(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('无效的图片URL');
  }

  // 如果是本地URL，从文件系统读取
  if (isLocalUrl(imageUrl)) {
    try {
      const filePath = resolveLocalFilePath(imageUrl);

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      // 读取文件
      const fileBuffer = fs.readFileSync(filePath);
      
      // 获取文件扩展名以确定MIME类型
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const mimeType = mimeTypes[ext] || 'image/jpeg';

      // 转换为base64
      const base64 = fileBuffer.toString('base64');
      return `data:${mimeType};base64,${base64}`;
    } catch (err) {
      throw new Error(`读取本地图片失败: ${err.message}`);
    }
  }

  // 如果是外部URL，下载并转换为base64
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      // 与参考图上传超时保持一致，避免“下载原图很慢但上传超时已调大”的割裂体验
      timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS,
    });

    // 从Content-Type获取MIME类型，如果没有则从URL推断
    let mimeType = response.headers['content-type'] || 'image/jpeg';
    if (!mimeType.startsWith('image/')) {
      const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      mimeType = mimeTypes[ext] || 'image/jpeg';
    }

    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    throw new Error(`下载图片失败: ${err.message}`);
  }
}

/**
 * 将本地图片上传到公共图床，返回可被 MXAPI 访问的 http(s) URL
 * 目前默认使用 0x0.st，避免 MXAPI 无法访问你本机的 localhost:5000
 * @param {string} imageUrl - 本地图片 URL 或相对路径
 * @returns {Promise<string>} - 公网可访问的图片 URL
 */
async function uploadLocalImageToPublicUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('无效的本地图片URL');
  }

  const filePath = resolveLocalFilePath(imageUrl);

  if (!fs.existsSync(filePath)) {
    throw new Error(`本地参考图文件不存在: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase() || '.jpg';
  const filename =
    `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` + ext;

  const form = new FormData();
  form.append('file', fileBuffer, { filename });

  const headers = {
    ...form.getHeaders(),
    'User-Agent': REF_IMAGE_UPLOAD_USER_AGENT,
    Accept: '*/*',
  };

  // 支持多种上传方式：auto(先 axios，失败后 curl) / axios / curl
  const attemptAxios = async () => {
    try {
      const resp = await axios.post(REF_IMAGE_UPLOAD_URL, form, {
        headers,
        timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS,
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const text =
        typeof resp.data === 'string'
          ? resp.data
          : resp.data
            ? String(resp.data)
            : '';

      const firstToken = (text || '').trim().split(/\s+/)[0];
      if (!isHttpUrl(firstToken)) {
        throw new Error(
          `参考图上传返回内容非URL: ${text.slice(0, 200) || '空响应'}`,
        );
      }
      return firstToken;
    } catch (e) {
      throw wrapUploadError(e, 'axios');
    }
  };

  const attemptCurl = async () => uploadFileViaCurl(filePath);

  const methods =
    REF_IMAGE_UPLOAD_METHOD === 'axios'
      ? ['axios']
      : REF_IMAGE_UPLOAD_METHOD === 'curl'
        ? ['curl']
        : ['axios', 'curl'];

  let lastErr;

  for (let i = 0; i <= REF_IMAGE_UPLOAD_RETRIES; i += 1) {
    for (const m of methods) {
      try {
        if (m === 'axios') return await attemptAxios();
        return await attemptCurl();
      } catch (e) {
        lastErr = e;
      }
    }

    if (i < REF_IMAGE_UPLOAD_RETRIES) {
      await sleep(REF_IMAGE_UPLOAD_RETRY_DELAY_MS * (i + 1));
    }
  }

  // 如果默认图床 0x0.st 无法访问，再尝试 telegra.ph 和 uguu.se 兜底
  const baseUploadUrl = (REF_IMAGE_UPLOAD_URL || '').trim();
  const isDefault0x0 =
    baseUploadUrl === 'https://0x0.st' || baseUploadUrl === 'http://0x0.st';

  const tryTelegraphFallback = async () => {
    const telegraphForm = new FormData();
    telegraphForm.append('file', fileBuffer, { filename });

    const telegraphHeaders = {
      ...telegraphForm.getHeaders(),
      'User-Agent': REF_IMAGE_UPLOAD_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
    };

    const resp = await axios.post('https://telegra.ph/upload', telegraphForm, {
      headers: telegraphHeaders,
      timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const text =
      typeof resp.data === 'string'
        ? resp.data
        : resp.data
          ? JSON.stringify(resp.data)
          : '';

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `telegra.ph 返回内容无法解析为 JSON: ${text.slice(0, 200) || '空响应'}`,
      );
    }

    const src =
      Array.isArray(json) && json[0] && typeof json[0].src === 'string'
        ? json[0].src
        : '';
    const url = src ? `https://telegra.ph${src}` : '';
    if (!isHttpUrl(url)) {
      throw new Error(
        `telegra.ph 返回内容非有效 URL: ${text.slice(0, 200) || '空响应'}`,
      );
    }
    return url;
  };

  const tryUguuFallback = async () => {
    const uguuForm = new FormData();
    uguuForm.append('files[]', fileBuffer, { filename });

    const uguuHeaders = {
      ...uguuForm.getHeaders(),
      'User-Agent': REF_IMAGE_UPLOAD_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
    };

    const resp = await axios.post('https://uguu.se/upload.php', uguuForm, {
      headers: uguuHeaders,
      timeout: REF_IMAGE_UPLOAD_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const text =
      typeof resp.data === 'string'
        ? resp.data
        : resp.data
          ? JSON.stringify(resp.data)
          : '';

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `uguu.se 返回内容无法解析为 JSON: ${text.slice(0, 200) || '空响应'}`,
      );
    }

    const url =
      json &&
      json.success === true &&
      Array.isArray(json.files) &&
      json.files[0] &&
      typeof json.files[0].url === 'string'
        ? String(json.files[0].url).trim()
        : '';

    if (!isHttpUrl(url)) {
      throw new Error(
        `uguu.se 返回内容非有效 URL: ${text.slice(0, 200) || '空响应'}`,
      );
    }
    return url;
  };

  if (isDefault0x0) {
    // 仅当默认使用 0x0.st 时才启用多图床兜底
    try {
      if (REF_IMAGE_UPLOAD_ENABLE_TELEGRAPH_FALLBACK) {
        return await tryTelegraphFallback();
      }
    } catch (e) {
      lastErr = e;
    }

    try {
      if (REF_IMAGE_UPLOAD_ENABLE_UGUU_FALLBACK) {
        return await tryUguuFallback();
      }
    } catch (e) {
      lastErr = e;
    }

    // ImgBB 备用（支持 base64 上传，作为最后的兜底）
    try {
      if (REF_IMAGE_UPLOAD_ENABLE_IMGBB_FALLBACK && getImgbbApiKey()) {
        return await uploadToImgBB(fileBuffer, filename);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`参考图上传失败: ${lastErr?.message || String(lastErr)}`);
}

/**
 * 批量将图片URL数组转换为base64数组
 * @param {string[]} imageUrls - 图片URL数组
 * @returns {Promise<string[]>} base64格式的图片数据数组
 */
async function urlsToBase64(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return [];
  }

  const promises = imageUrls.map((url) => urlToBase64(url));
  return Promise.all(promises);
}

/**
 * 确保图片 URL 对 MXAPI 可访问：
 * - 如果已是公网 http(s) URL，直接返回
 * - 如果是本地/内网 URL（localhost / 192.168.x / 10.x 等），先上传到公共图床再返回
 * @param {string} imageUrl
 * @returns {Promise<string|null>}
 */
async function ensurePublicImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;

  // 不是本地/内网地址且已经是 http/https，认为是公网 URL，直接透传
  if (!isLocalUrl(imageUrl) && isHttpUrl(imageUrl)) {
    return imageUrl;
  }

  // 本地或内网地址，需要上传到公网图床
  return uploadLocalImageToPublicUrl(imageUrl);
}

module.exports = {
  urlToBase64,
  urlsToBase64,
  isLocalUrl,
  ensurePublicImageUrl,
  uploadLocalImageToPublicUrl,
};
