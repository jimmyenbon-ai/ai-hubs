const { randomUUID } = require('crypto');

const KINDS = ['outline', 'volume', 'mainline', 'subplot', 'character', 'plot', 'item', 'scene', 'faction', 'world', 'style', 'foreshadow'];
const now = () => new Date().toISOString();
const id = () => randomUUID();
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, max = 12000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`文本格式不正确或超过 ${max} 字`);
  return value.trim();
}
function object(value, max = 24000) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > max) fail('结构化资料格式不正确或过长');
  return value;
}
const parse = value => JSON.parse(value || '{}');
const chapterRow = row => row ? { ...row, plan: parse(row.plan) } : null;
const entryRow = row => ({ ...row, data: parse(row.data), locked: Boolean(row.locked) });
const jobRow = row => row ? { ...row, input: parse(row.input), context: parse(row.context), result: parse(row.result) } : null;

async function owned(sql, userId, bookId) {
  const book = await sql.get('SELECT * FROM books WHERE id=? AND owner_id=?', [bookId, userId]);
  if (!book) fail('作品不存在或没有访问权限', 404);
  return book;
}
function revision(actual, expected) {
  if (!Number.isInteger(expected) || actual !== expected) fail('内容已被修改，请刷新并比较版本后再保存', 409);
}
async function touch(sql, bookId, kind, detail) {
  await sql.run('UPDATE books SET revision=revision+1,updated_at=? WHERE id=?', [now(), bookId]);
  await sql.run('UPDATE jobs SET status=\'stale\',error=\'作品资料已变化，请重新生成\',updated_at=? WHERE book_id=? AND status=\'ready\'', [now(), bookId]);
  await sql.run('INSERT INTO audits VALUES (?,?,?,?,?)', [id(), bookId, kind, JSON.stringify(detail), now()]);
}
async function invalidate(sql, bookId, ordinal = 0) {
  await sql.run('UPDATE chapters SET needs_review=1 WHERE book_id=? AND ordinal>?', [bookId, ordinal]);
  await sql.run('UPDATE facts SET status=\'stale\' WHERE book_id=? AND ordinal>=?', [bookId, ordinal]);
}
async function validatePlan(sql, bookId, input) {
  const plan = object(input);
  for (const key of ['goal', 'beats', 'mustInclude', 'forbidden', 'povEntityId', 'volumeId', 'storyTime']) if (plan[key] !== undefined) text(plan[key], 6000);
  const entries = await sql.all('SELECT id FROM entries WHERE book_id=?', [bookId]);
  const entityIds = new Set(entries.map(entry => entry.id));
  for (const key of ['entityIds', 'threadIds']) {
    if (plan[key] !== undefined && (!Array.isArray(plan[key]) || plan[key].length > 100 || plan[key].some(entity => !entityIds.has(entity)))) fail('章节计划引用了无效的作品实体');
  }
  if (plan.povEntityId && !entityIds.has(plan.povEntityId)) fail('叙事视角人物不属于本作品');
  if (plan.volumeId && !entityIds.has(plan.volumeId)) fail('分卷不属于本作品');
  return plan;
}
async function validateParent(sql, bookId, kind, parentId, entryId = '') {
  if (!parentId) return null;
  text(parentId, 100, true);
  let cursor = parentId;
  const seen = new Set([entryId]);
  while (cursor) {
    if (seen.has(cursor)) fail('框架节点不能挂在自己或自己的子节点下');
    if (seen.size > 100) fail('框架层级过深');
    seen.add(cursor);
    const parent = await sql.get('SELECT id,kind,parent_id FROM entries WHERE id=? AND book_id=?', [cursor, bookId]);
    if (!parent || parent.kind !== kind) fail('上级节点不属于本作品的同类框架');
    cursor = parent.parent_id;
  }
  return parentId;
}
async function saveChapter(sql, chapter, attrs) {
  revision(chapter.revision, attrs.revision);
  const title = text(attrs.title ?? chapter.title, 200, true);
  const content = text(attrs.content ?? chapter.content, 120000);
  const plan = await validatePlan(sql, chapter.book_id, attrs.plan ?? chapter.plan);
  const next = chapter.revision + 1;
  await sql.run('UPDATE chapters SET title=?,content=?,plan=?,revision=?,status=\'draft\',needs_review=0,updated_at=? WHERE id=?', [title, content, JSON.stringify(plan), next, now(), chapter.id]);
  await sql.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?)', [id(), chapter.id, next, content, JSON.stringify(plan), title, now()]);
  await invalidate(sql, chapter.book_id, chapter.ordinal);
  await touch(sql, chapter.book_id, 'chapter_saved', { chapterId: chapter.id, revision: next });
  return chapterRow(await sql.get('SELECT * FROM chapters WHERE id=?', [chapter.id]));
}

function validateFacts(candidates, chapter, entries) {
  if (!Array.isArray(candidates) || candidates.length > 60) fail('记忆条目格式不正确');
  const entities = new Set(entries.map(entry => entry.id));
  const characters = new Set(entries.filter(entry => entry.kind === 'character').map(entry => entry.id));
  const seen = new Set();
  return candidates.map(fact => {
    const entityId = fact.entity_id || '';
    if (entityId && !entities.has(entityId)) fail('记忆引用了不属于本作品的实体');
    const key = text(fact.key, 100, true);
    if (key.startsWith('__')) fail('记忆状态名不能使用系统保留名称');
    const value = text(fact.value, 2000, true);
    const quote = text(fact.quote, 1200, true);
    if (!chapter.content.includes(quote)) fail('记忆的原文依据不存在于当前章节，不能采纳');
    const knownBy = fact.known_by || [];
    if (!Array.isArray(knownBy) || knownBy.some(entity => !characters.has(entity))) fail('人物认知引用不正确');
    const kind = fact.kind || 'state';
    if (!['state', 'event', 'knowledge', 'foreshadow'].includes(kind)) fail('记忆分类不正确');
    if (kind === 'knowledge' && !knownBy.length) fail('人物认知必须标明知情人物');
    const normalizedKnownBy = [...new Set(knownBy)].sort();
    const stateKey = JSON.stringify([entityId, key, normalizedKnownBy]);
    if (kind !== 'event' && seen.has(stateKey)) fail('同一实体的最终状态重复，请人工整理后重试');
    if (kind !== 'event') seen.add(stateKey);
    return { entity_id: entityId, key, value, quote, known_by: normalizedKnownBy, kind };
  });
}

module.exports = { KINDS, now, id, fail, text, object, parse, chapterRow, entryRow, jobRow, owned, revision, touch, invalidate, validatePlan, validateParent, saveChapter, validateFacts };
