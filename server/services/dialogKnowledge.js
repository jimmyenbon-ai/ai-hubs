const { extractKeywords, expandKeywords, scoreItem, isImageContent, getImageUrl } = require('./knowledgeSearch');

const ROLES = new Set(['product', 'logo', 'style', 'brand', 'general']);
const VIEWS = new Set(['front', 'back', 'detail', 'scene', 'any']);
const list = value => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 30) : String(value || '').split(/[,，\n]/).map(v => v.trim()).filter(Boolean).slice(0, 30);
const normalize = value => String(value || '').toLowerCase().replace(/([a-z])\s+(pro|plus|\d)/g, '$1$2').replace(/[\s_]+/g, '-');

function boundary(value, text) {
  const query = normalize(value), target = normalize(text);
  if (!query) return false;
  let start = target.indexOf(query);
  while (start >= 0) {
    const before = target[start - 1] || '', after = target[start + query.length] || '';
    if ((!/[a-z0-9]/.test(query[0]) || !/[a-z0-9]/.test(before)) && (!/[a-z0-9]/.test(query.at(-1)) || !/[a-z0-9]/.test(after))) return true;
    start = target.indexOf(query, start + 1);
  }
  return false;
}

function materialInfo(item) {
  const meta = item.metadata || {}, name = `${item.folder || item.category || ''} ${item.title || ''} ${item.originalName || ''}`;
  let role = ROLES.has(meta.assetRole) ? meta.assetRole : 'general';
  if (!meta.assetRole) {
    if (/logo|标志|标识/i.test(name)) role = 'logo';
    else if (/design|template|设计|模板|海报/i.test(item.folder || item.category || '')) role = 'style';
    else if (/brand|品牌/i.test(item.folder || item.category || '')) role = 'brand';
    else if (/product|产品/i.test(item.folder || item.category || '')) role = 'product';
  }
  let view = VIEWS.has(meta.imageView) ? meta.imageView : 'any';
  if (view === 'any') {
    if (/背面|背侧|rear|back/i.test(name)) view = 'back';
    else if (/正面|正视|front/i.test(name)) view = 'front';
    else if (/细节|detail/i.test(name)) view = 'detail';
  }
  return { role, view, product: String(meta.productName || '').trim(), aliases: list(meta.aliases), active: !['draft', 'disabled'].includes(meta.status), external: meta.allowExternal !== false, description: String(meta.description || ''), version: String(meta.version || '') };
}

function validateMaterialMetadata(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('附加信息必须是 JSON 对象'), { status: 400 });
  const result = { ...value };
  for (const key of ['productName', 'description', 'version']) if (key in result) result[key] = String(result[key] || '').slice(0, key === 'description' ? 8000 : 200);
  if ('aliases' in result) result.aliases = list(result.aliases);
  if (result.assetRole && !ROLES.has(result.assetRole)) throw Object.assign(new Error('物料用途无效'), { status: 400 });
  if (result.imageView && !VIEWS.has(result.imageView)) throw Object.assign(new Error('图片视角无效'), { status: 400 });
  if (result.status && !['approved', 'draft', 'disabled'].includes(result.status)) throw Object.assign(new Error('物料状态无效'), { status: 400 });
  if ('allowExternal' in result && typeof result.allowExternal !== 'boolean') throw Object.assign(new Error('外部调用许可必须为布尔值'), { status: 400 });
  return result;
}

function chunks(content, size = 1800, overlap = 180) {
  const result = [], text = String(content || '');
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + size / 2) end = newline + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    result.push({ start, end, content: text.slice(start, end) });
    if (end === text.length) break;
    start = Math.max(start + 1, end - overlap);
    if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
  }
  return result;
}

function productScope(items, message, requested = '') {
  const registered = new Map();
  for (const item of items) {
    const info = materialInfo(item);
    if (info.active && info.product) registered.set(info.product, [...new Set([info.product, ...info.aliases, ...(registered.get(info.product) || [])])]);
  }
  const direct = [...registered].filter(([, aliases]) => aliases.some(alias => boundary(alias, message)));
  // The longest exact identity wins (R5-Curve must not silently become R5).
  const hits = direct.filter(([name]) => !direct.some(([other]) => other !== name && normalize(other).includes(normalize(name))));
  if (hits.length > 1) return { ambiguous: hits.map(([name]) => name), product: '', aliases: [] };
  if (hits.length === 1) return { product: hits[0][0], aliases: hits[0][1], ambiguous: [] };
  const withoutModels = String(message).replace(/gpt[-\s]?image[-\s]?\d+(?:\.\d+)?(?:[-\s](?:vip|flare|sunburst))?|nano[-\s]?banana(?:[-\s](?:pro|fast|\d+|4k|vip|cl))*/gi, '');
  const codes = withoutModels.match(/\b[a-z]{1,8}\s*[-]?\d+[a-z0-9]*(?:[-][a-z0-9]+)*/gi) || [];
  const code = codes.find(v => !/^\d|^\d*k$|^\d*d$/i.test(v));
  if (code && !direct.length) return { product: code, aliases: [code], ambiguous: [] };
  if (requested) {
    const match = [...registered].find(([, aliases]) => aliases.some(alias => normalize(alias) === normalize(requested)));
    if (match) return { product: match[0], aliases: match[1], ambiguous: [] };
  }
  return { product: requested || code || '', aliases: requested || code ? [requested || code] : [], ambiguous: [] };
}

function retrieveKnowledge(items, plan, message) {
  const available = items.filter(item => materialInfo(item).active);
  const scope = productScope(available, message, plan.productName);
  const query = [message, ...(plan.searchQueries || []), scope.product].join(' ').slice(0, 1500);
  const keywords = extractKeywords(query).slice(0, 32);
  const expanded = expandKeywords(keywords).slice(0, 80);
  const texts = [], images = [], rules = [], sources = [], warnings = [];
  const variants = [
    { words: /任意弧|\bcurve[d]?\b|flexible/i, names: /任意弧|curve|flexible/i },
    { words: /直角锁|straight/i, names: /直角|straight/i },
    { words: /弧形锁|\barc\b/i, names: /弧形|\barc\b/i },
    { words: /90°|90-degree/i, names: /90°|90-degree|r5-90/i },
  ];
  const variant = variants.find(v => v.words.test(`${message} ${scope.product}`));
  for (const item of available) {
    const info = materialInfo(item), identity = `${item.title || ''} ${item.originalName || ''} ${item.folder || ''}`;
    const global = ['brand', 'logo', 'style'].includes(info.role) && !info.product;
    if (scope.product && !global) {
      const match = info.product ? normalize(info.product) === normalize(scope.product) : scope.aliases.some(alias => boundary(alias, identity));
      if (!match || (variant && !variant.names.test(`${identity} ${info.product} ${info.aliases.join(' ')}`))) continue;
    }
    if (isImageContent(item)) {
      const url = getImageUrl(item);
      if (!url) continue;
      const score = scoreItem({ ...item, content: info.description, metadata: { productName: info.product, aliases: info.aliases } }, keywords, expanded);
      if (score <= 0 && !global && !scope.product) continue;
      images.push({ id: item.id, title: item.title, url, role: info.role, view: info.view, description: info.description, allowExternal: info.external, version: info.version, score: score + (plan.referenceView === info.view && info.view !== 'any' ? 100 : 0) });
    } else {
      if (info.role === 'style' || info.role === 'brand') {
        if (global || scope.product) rules.push({ item, info });
      } else {
        for (const chunk of chunks(item.content)) {
          const score = scoreItem({ ...item, content: chunk.content, metadata: { description: info.description } }, keywords, expanded) + scoreItem({ content: chunk.content }, keywords, expanded) * 3;
          if (score > 0) texts.push({ ...chunk, item, info, score });
        }
      }
    }
  }
  const perDoc = new Map(), selected = [];
  for (const chunk of texts.sort((a, b) => b.score - a.score)) {
    if ((perDoc.get(chunk.item.id) || 0) >= 2 || selected.length >= 8) continue;
    perDoc.set(chunk.item.id, (perDoc.get(chunk.item.id) || 0) + 1);
    selected.push({ id: chunk.item.id, title: chunk.item.title, folder: chunk.item.folder, role: 'document', start: chunk.start, end: chunk.end, excerpt: chunk.content, version: chunk.info.version, allowExternal: chunk.info.external });
  }
  sources.push(...selected);
  for (const { item, info } of rules.slice(0, 4)) sources.push({ id: item.id, title: item.title, role: info.role, excerpt: String(item.content || '').slice(0, 2500), version: info.version, allowExternal: info.external });
  const ordered = images.sort((a, b) => b.score - a.score);
  const productImages = ordered.filter(img => ['product', 'general'].includes(img.role) && (plan.referenceView === 'any' || img.view === plan.referenceView || img.view === 'any'));
  const logos = plan.useLogo ? ordered.filter(img => img.role === 'logo').slice(0, 1) : [];
  const refs = [...productImages.slice(0, logos.length ? 3 : 4), ...logos];
  if (plan.needsImages && scope.product && !productImages.length) warnings.push(`未找到 ${scope.product} 对应${plan.referenceView === 'back' ? '背面' : plan.referenceView === 'front' ? '正面' : ''}产品参考图`);
  if (plan.useLogo && !logos.length) warnings.push('未找到可用的品牌 Logo');
  const styles = ordered.filter(img => img.role === 'style').slice(0, 2);
  for (const img of [...refs, ...styles]) sources.push({ ...img, score: undefined });
  return { scope, sources, documents: selected, rules: sources.filter(s => ['style', 'brand'].includes(s.role) && s.excerpt), references: refs, styleImages: styles, warnings, totalScanned: items.length, total: new Set(sources.map(s => s.id)).size };
}

module.exports = { materialInfo, validateMaterialMetadata, chunks, productScope, retrieveKnowledge, boundary };
