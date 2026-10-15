const express = require('express');
const rateLimit = require('express-rate-limit');
const { createStore } = require('./store');
const { createAuth, originGuard } = require('./auth');
const { buildContext } = require('./context');
const { TYPES, contextData, createRunner } = require('./jobs');
const { createImportRunner, importBusy, assertTakeover } = require('./imports');
const { registerImportRoutes } = require('./importRoutes');
const { KINDS, now, id, fail, text, object, parse, chapterRow, entryRow, jobRow, owned, revision, touch, invalidate, validatePlan, validateParent, saveChapter, validateFacts } = require('./domain');

const AI_ACCEPTED = "EXISTS (SELECT 1 FROM jobs j WHERE j.chapter_id=c.id AND j.type IN ('write','rewrite') AND j.status='applied' AND j.chapter_revision<c.accepted_revision)";
const IMPORT_ACCEPTED = "EXISTS (SELECT 1 FROM chapter_sources s WHERE s.chapter_id=c.id AND s.confirmed=1 AND s.source_revision<=c.accepted_revision)";
const FORMAL_ACCEPTED = `(${AI_ACCEPTED} OR ${IMPORT_ACCEPTED})`;

function createLiteratureRouter({ store = createStore(), invoke } = {}) {
  const router = express.Router();
  const auth = createAuth(store);
  const runner = createRunner(store, invoke);
  const importRunner = createImportRunner(store, invoke);
  const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  const ok = (res, data) => res.json({ success: true, data });
  const read = (req, fn) => store.read(async sql => fn(sql, await owned(sql, req.literatureUser.id, req.params.bookId)));
  const write = (req, fn) => store.write(async sql => fn(sql, await owned(sql, req.literatureUser.id, req.params.bookId)));
  async function chapter(sql, req) {
    const record = await sql.get('SELECT * FROM chapters WHERE id=? AND book_id=?', [req.params.chapterId, req.params.bookId]);
    if (!record) fail('章节不存在', 404);
    return chapterRow(record);
  }
  async function job(sql, req) {
    const record = await sql.get('SELECT * FROM jobs WHERE id=? AND book_id=?', [req.params.jobId, req.params.bookId]);
    if (!record) fail('任务不存在', 404);
    return jobRow(record);
  }
  router.use(originGuard);
  router.get('/auth/me', wrap(auth.me));
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { success: false, error: '登录尝试过多，请稍后再试' } });
  router.post('/auth/setup', loginLimit, wrap(auth.register));
  router.post('/auth/login', loginLimit, wrap(auth.login));
  router.use(auth.requireUser);
  router.post('/auth/logout', wrap(auth.logout));
  router.post('/users', wrap(auth.createUser));
  registerImportRoutes(router, { store, importRunner, wrap, ok });
  router.get('/models', wrap(async (req, res) => {
    const { LLMConfig } = require('../models/workflowModel');
    const configs = await LLMConfig.findAll({});
    ok(res, configs.map(config => ({ id: config.id, name: config.name, model: config.model, provider: config.provider })));
  }));
  router.get('/books', wrap(async (req, res) => ok(res, await store.read(sql => sql.all(`SELECT b.*, (SELECT count(*) FROM chapters c WHERE c.book_id=b.id) AS chapter_count
    FROM books b WHERE owner_id=? ORDER BY updated_at DESC`, [req.literatureUser.id])))));
  router.post('/books', wrap(async (req, res) => {
    const book = { id: id(), owner_id: req.literatureUser.id, title: text(req.body.title, 200, true), genre: text(req.body.genre || '', 100), premise: text(req.body.premise || '', 12000), style: text(req.body.style || '', 6000), instructions: text(req.body.instructions || '', 6000), model_config_id: '', revision: 1, created_at: now(), updated_at: now() };
    await store.write(sql => sql.run('INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?,?)', Object.values(book)));
    ok(res, book);
  }));
  router.get('/books/:bookId', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => ({
    book,
    entries: (await sql.all('SELECT * FROM entries WHERE book_id=? ORDER BY kind,title', [book.id])).map(entryRow),
    chapters: (await sql.all(`SELECT c.id,c.book_id,c.ordinal,c.title,c.revision,c.status,c.accepted_revision,c.needs_review,c.updated_at,
      ${AI_ACCEPTED} AS accepted_ai_generated,
      ${IMPORT_ACCEPTED} AS accepted_imported,
      (SELECT v.title FROM versions v WHERE v.chapter_id=c.id AND v.revision=c.accepted_revision) AS accepted_title
      FROM chapters c WHERE c.book_id=? ORDER BY c.ordinal`, [book.id])),
    facts: (await sql.all('SELECT * FROM facts WHERE book_id=? ORDER BY ordinal DESC,created_at DESC LIMIT 200', [book.id])).map(row => ({ ...row, known_by: parse(row.known_by) })),
    factCount: (await sql.get('SELECT count(*) AS n FROM facts WHERE book_id=?', [book.id])).n,
    jobs: (await sql.all('SELECT * FROM jobs WHERE book_id=? ORDER BY created_at DESC LIMIT 30', [book.id])).map(row => { const result = jobRow(row); delete result.context; delete result.result.usage; return result; }),
    audits: await sql.all('SELECT * FROM audits WHERE book_id=? ORDER BY created_at DESC LIMIT 30', [book.id]),
  })))));
  router.put('/books/:bookId', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    revision(book.revision, req.body.revision);
    const values = [text(req.body.title ?? book.title, 200, true), text(req.body.genre ?? book.genre, 100), text(req.body.premise ?? book.premise, 12000), text(req.body.style ?? book.style, 6000), text(req.body.instructions ?? book.instructions, 6000), text(req.body.model_config_id ?? book.model_config_id, 100)];
    await sql.run('UPDATE books SET title=?,genre=?,premise=?,style=?,instructions=?,model_config_id=? WHERE id=?', [...values, book.id]);
    if (values[1] !== book.genre || values[2] !== book.premise || values[3] !== book.style || values[4] !== book.instructions) await invalidate(sql, book.id);
    await touch(sql, book.id, 'book_updated', { previousRevision: book.revision });
    return sql.get('SELECT * FROM books WHERE id=?', [book.id]);
  }))));
  router.delete('/books/:bookId', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    revision(book.revision, req.body.revision);
    if (await sql.get("SELECT id FROM jobs WHERE book_id=? AND status IN ('queued','running')", [book.id])) fail('请先取消作品中正在运行的任务', 409);
    if (await importBusy(sql, book.id)) fail('请先暂停导入分析', 409);
    await sql.run('DELETE FROM books WHERE id=?', [book.id]);
    return true;
  }))));
  router.get('/books/:bookId/facts', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => {
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    return (await sql.all('SELECT * FROM facts WHERE book_id=? ORDER BY ordinal DESC,created_at DESC LIMIT 200 OFFSET ?', [book.id, offset])).map(row => ({ ...row, known_by: parse(row.known_by) }));
  }))));
  router.post('/books/:bookId/entries', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    if (!KINDS.includes(req.body.kind)) fail('设定分类不正确');
    const record = { id: id(), book_id: book.id, kind: req.body.kind, title: text(req.body.title, 200, true), body: text(req.body.body || '', 12000), data: JSON.stringify(object(req.body.data || {})), status: ['confirmed', 'candidate'].includes(req.body.status) ? req.body.status : 'confirmed', locked: req.body.locked ? 1 : 0, reveal_chapter: Number(req.body.reveal_chapter || 1), revision: 1, updated_at: now() };
    if (!Number.isInteger(record.reveal_chapter) || record.reveal_chapter < 1) fail('可用章节序号不正确');
    record.parent_id = await validateParent(sql, book.id, record.kind, req.body.parent_id);
    await sql.run('INSERT INTO entries (id,book_id,kind,title,body,data,status,locked,reveal_chapter,revision,updated_at,parent_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', Object.values(record));
    if (record.status === 'confirmed' && ['world', 'style'].includes(record.kind)) await invalidate(sql, book.id);
    await touch(sql, book.id, 'entry_created', { entryId: record.id });
    return entryRow(record);
  }))));
  router.put('/books/:bookId/entries/:entryId', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const entry = await sql.get('SELECT * FROM entries WHERE id=? AND book_id=?', [req.params.entryId, book.id]);
    if (!entry) fail('设定不存在', 404);
    revision(entry.revision, req.body.revision);
    if (entry.locked && !req.body.confirmUnlock) fail('设定已锁定，请明确解除锁定后再修改', 409);
    const reveal = Number(req.body.reveal_chapter ?? entry.reveal_chapter);
    if (!Number.isInteger(reveal) || reveal < 1) fail('可用章节序号不正确');
    const status = req.body.status ?? entry.status;
    if (!['confirmed', 'candidate'].includes(status)) fail('设定状态不正确');
    const parentId = await validateParent(sql, book.id, entry.kind, req.body.parent_id === undefined ? entry.parent_id : req.body.parent_id, entry.id);
    await sql.run('UPDATE entries SET title=?,body=?,data=?,status=?,locked=?,reveal_chapter=?,parent_id=?,revision=revision+1,updated_at=? WHERE id=?', [text(req.body.title ?? entry.title, 200, true), text(req.body.body ?? entry.body, 12000), JSON.stringify(object(req.body.data ?? parse(entry.data))), status, req.body.locked ? 1 : 0, reveal, parentId, now(), entry.id]);
    await invalidate(sql, book.id);
    await touch(sql, book.id, 'entry_updated', { entryId: entry.id, wasLocked: Boolean(entry.locked) });
    return entryRow(await sql.get('SELECT * FROM entries WHERE id=?', [entry.id]));
  }))));
  router.delete('/books/:bookId/entries/:entryId', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const entry = await sql.get('SELECT * FROM entries WHERE id=? AND book_id=?', [req.params.entryId, book.id]);
    if (!entry) fail('设定不存在', 404);
    revision(entry.revision, req.body.revision);
    if (entry.locked) fail('请先解除设定锁定', 409);
    await sql.run('DELETE FROM entries WHERE id=?', [entry.id]);
    const linked = await sql.all('SELECT * FROM chapters WHERE book_id=? AND plan LIKE ?', [book.id, `%${entry.id}%`]);
    for (const row of linked) {
      const item = chapterRow(row);
      const plan = { ...item.plan };
      for (const key of ['entityIds', 'threadIds']) if (Array.isArray(plan[key])) plan[key] = plan[key].filter(value => value !== entry.id);
      for (const key of ['povEntityId', 'volumeId']) if (plan[key] === entry.id) plan[key] = '';
      if (JSON.stringify(plan) !== JSON.stringify(item.plan)) await saveChapter(sql, item, { revision: item.revision, plan });
    }
    await invalidate(sql, book.id);
    await touch(sql, book.id, 'entry_deleted', { entryId: entry.id });
    return true;
  }))));
  router.post('/books/:bookId/chapters', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const ordinal = (await sql.get('SELECT coalesce(max(ordinal),0)+1 AS n FROM chapters WHERE book_id=?', [book.id])).n;
    const record = { id: id(), book_id: book.id, ordinal, title: text(req.body.title || `创作计划 ${ordinal}`, 200, true), plan: JSON.stringify(await validatePlan(sql, book.id, req.body.plan || {})), content: '', status: 'draft', revision: 1, accepted_revision: null, needs_review: 0, updated_at: now() };
    await sql.run('INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?)', Object.values(record));
    await sql.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?)', [id(), record.id, 1, '', record.plan, record.title, now()]);
    await touch(sql, book.id, 'chapter_created', { chapterId: record.id });
    return chapterRow(record);
  }))));
  router.get('/books/:bookId/chapters/:chapterId', wrap(async (req, res) => ok(res, await read(req, sql => chapter(sql, req)))));
  router.get('/books/:bookId/chapters/:chapterId/formal', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => {
    const item = await sql.get(`SELECT c.*,v.title AS formal_title,v.content AS formal_content,v.plan AS formal_plan,${AI_ACCEPTED} AS formal_ai
      FROM chapters c JOIN versions v ON v.chapter_id=c.id AND v.revision=c.accepted_revision
      WHERE c.id=? AND c.book_id=? AND ${FORMAL_ACCEPTED}`, [req.params.chapterId, book.id]);
    if (!item) fail('当前计划还没有已确认的正式正文', 404);
    return { ...chapterRow(item), title: item.formal_title, content: item.formal_content, plan: parse(item.formal_plan), revision: item.accepted_revision, status: 'accepted', formal: true, source: item.formal_ai ? 'ai' : 'import' };
  }))));
  router.put('/books/:bookId/chapters/:chapterId', wrap(async (req, res) => ok(res, await write(req, async sql => saveChapter(sql, await chapter(sql, req), req.body)))));
  router.get('/books/:bookId/chapters/:chapterId/versions', wrap(async (req, res) => ok(res, await read(req, async sql => {
    const item = await chapter(sql, req);
    return (await sql.all('SELECT * FROM versions WHERE chapter_id=? ORDER BY revision DESC LIMIT 100', [item.id])).map(row => ({ ...row, plan: parse(row.plan) }));
  }))));
  router.get('/books/:bookId/chapters/:chapterId/context', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => buildContext(await contextData(sql, book, await chapter(sql, req)))))));
  router.post('/books/:bookId/chapters/:chapterId/accept', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const item = await chapter(sql, req);
    revision(item.revision, req.body.revision);
    if (!item.content.trim()) fail('空章节不能确认');
    const memory = jobRow(await sql.get("SELECT * FROM jobs WHERE id=? AND book_id=? AND chapter_id=? AND type='memory'", [req.body.jobId, book.id, item.id]));
    if (!memory || memory.status !== 'ready' || memory.book_revision !== book.revision || memory.chapter_revision !== item.revision) fail('请先为当前正文提取记忆，旧记忆不能采纳', 409);
    const selected = req.body.selected;
    if (!Array.isArray(selected) || selected.some(index => !Number.isInteger(index) || index < 0 || index >= memory.result.facts.length) || new Set(selected).size !== selected.length) fail('记忆选择不正确');
    const entries = await sql.all('SELECT * FROM entries WHERE book_id=?', [book.id]);
    const overrides = req.body.overrides || [];
    if (!Array.isArray(overrides) || overrides.length > selected.length || overrides.some(change => !selected.includes(change.index))) fail('记忆修订格式不正确');
    const facts = validateFacts(selected.map(index => {
      const original = memory.result.facts[index];
      const change = overrides.find(value => value.index === index) || {};
      return { ...original, key: change.key ?? original.key, value: change.value ?? original.value, quote: change.quote ?? original.quote, kind: change.kind ?? original.kind, known_by: change.known_by ?? original.known_by };
    }), item, entries);
    const summary = text(req.body.summary ?? memory.result.summary, 4000, true);
    await invalidate(sql, book.id, item.ordinal);
    await sql.run("UPDATE chapters SET status='accepted',accepted_revision=revision,needs_review=0,updated_at=? WHERE id=?", [now(), item.id]);
    facts.push({ entity_id: '', key: '__summary', value: summary, quote: item.content.slice(0, 200), known_by: [], kind: 'summary' });
    for (const fact of facts) await sql.run('INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id(), book.id, item.id, item.revision, item.ordinal, fact.entity_id, fact.key, fact.value, fact.quote, JSON.stringify(fact.known_by), fact.kind, 'active', now()]);
    await sql.run("UPDATE jobs SET status='applied',updated_at=? WHERE id=?", [now(), memory.id]);
    await touch(sql, book.id, 'chapter_accepted', { chapterId: item.id, revision: item.revision, factCount: facts.length });
    return { chapter: chapterRow(await sql.get('SELECT * FROM chapters WHERE id=?', [item.id])), factCount: facts.length };
  }))));
  router.post('/books/:bookId/jobs', wrap(async (req, res) => {
    await runner.initialized;
    const result = await write(req, async (sql, book) => {
      if (!TYPES.includes(req.body.type)) fail('任务类型不正确');
      const requestId = text(req.body.requestId || id(), 100, true);
      const existing = await sql.get("SELECT * FROM jobs WHERE book_id=? AND json_extract(input,'$.requestId')=?", [book.id, requestId]);
      if (existing) return jobRow(existing);
      const item = req.body.type === 'outline' ? null : chapterRow(await sql.get('SELECT * FROM chapters WHERE id=? AND book_id=?', [req.body.chapterId, book.id]));
      if (req.body.type !== 'outline' && !item) fail('请先选择章节');
      if (['review', 'memory', 'rewrite'].includes(req.body.type) && !item.content.trim()) fail('当前章节还没有正文');
      const busy = await sql.get("SELECT id FROM jobs WHERE book_id=? AND status IN ('queued','running') LIMIT 1", [book.id]);
      if (busy) fail('本作品已有任务正在运行，请等待或取消后重试', 409);
      if (await importBusy(sql, book.id)) fail('请先暂停或完成导入分析', 409);
      if (['plan', 'write', 'rewrite'].includes(req.body.type)) await assertTakeover(sql, book.id, item);
      const input = { instruction: text(req.body.instruction || '', 6000), targetWords: Math.max(500, Math.min(6000, Number(req.body.targetWords) || 2500)), requestId };
      const record = { id: id(), book_id: book.id, chapter_id: item?.id || null, type: req.body.type, status: 'queued', stage: 'queued', book_revision: book.revision, chapter_revision: item?.revision || null, input: JSON.stringify(input), context: '{}', result: '{}', error: '', created_at: now(), updated_at: now() };
      await sql.run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', Object.values(record));
      return jobRow(record);
    });
    ok(res, result);
    void runner.launch(result.id);
  }));
  router.get('/books/:bookId/jobs/:jobId', wrap(async (req, res) => ok(res, await read(req, sql => job(sql, req)))));
  router.post('/books/:bookId/jobs/:jobId/cancel', wrap(async (req, res) => {
    await read(req, sql => job(sql, req));
    await runner.cancel(req.params.jobId);
    ok(res, true);
  }));
  router.post('/books/:bookId/jobs/:jobId/apply', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const task = await job(sql, req);
    if (task.status !== 'ready') fail('任务结果不能采纳，请重新生成', 409);
    revision(book.revision, task.book_revision);
    if (task.type === 'outline') {
      const entryId = id();
      await sql.run('INSERT INTO entries (id,book_id,kind,title,body,data,status,locked,reveal_chapter,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [entryId, book.id, 'outline', 'AI 大纲候选', task.result.content, '{}', 'candidate', 0, 1, 1, now()]);
      await sql.run("UPDATE jobs SET status='applied' WHERE id=?", [task.id]);
      await touch(sql, book.id, 'outline_proposed', { jobId: task.id });
      return { entryId };
    }
    if (!['plan', 'write', 'rewrite'].includes(task.type)) fail('此任务需要在审校或记忆确认中处理');
    const item = chapterRow(await sql.get('SELECT * FROM chapters WHERE id=? AND book_id=?', [task.chapter_id, book.id]));
    if (!item) fail('章节不存在', 404);
    revision(item.revision, task.chapter_revision);
    await sql.run("UPDATE jobs SET status='applied' WHERE id=?", [task.id]);
    const { usage, ...plan } = task.result;
    return saveChapter(sql, item, { revision: item.revision, ...(task.type === 'plan' ? { plan } : { content: task.result.content }) });
  }))));
  router.get('/books/:bookId/export', wrap(async (req, res) => {
    const data = req.query.format === 'txt' ? null : await read(req, async (sql, book) => ({ schemaVersion: 2, exportedAt: now(), book, entries: (await sql.all('SELECT * FROM entries WHERE book_id=?', [book.id])).map(entryRow), chapters: (await sql.all('SELECT * FROM chapters WHERE book_id=? ORDER BY ordinal', [book.id])).map(chapterRow), facts: await sql.all('SELECT * FROM facts WHERE book_id=?', [book.id]), versions: await sql.all('SELECT v.* FROM versions v JOIN chapters c ON c.id=v.chapter_id WHERE c.book_id=?', [book.id]), audits: await sql.all('SELECT * FROM audits WHERE book_id=?', [book.id]), imports: await sql.all('SELECT * FROM literature_imports WHERE book_id=?', [book.id]), sources: await sql.all('SELECT s.* FROM chapter_sources s JOIN chapters c ON c.id=s.chapter_id WHERE c.book_id=?', [book.id]), importUnits: await sql.all('SELECT u.* FROM import_units u JOIN literature_imports i ON i.id=u.import_id WHERE i.book_id=?', [book.id]), evidence: await sql.all('SELECT * FROM import_evidence WHERE book_id=?', [book.id]), takeover: await sql.get('SELECT * FROM takeovers WHERE book_id=?', [book.id]) }));
    if (req.query.format === 'txt') {
      const output = await read(req, async (sql, book) => ({ title: book.title, chapters: await sql.all(`SELECT c.ordinal,v.title,v.content FROM chapters c
        JOIN versions v ON v.chapter_id=c.id AND v.revision=c.accepted_revision
        WHERE c.book_id=? AND ${FORMAL_ACCEPTED} ORDER BY c.ordinal`, [book.id]) }));
      res.type('text/plain').send(`${output.title}\n\n${output.chapters.map(item => `${item.ordinal}. ${item.title}\n\n${item.content}`).join('\n\n')}`);
    }
    else ok(res, data);
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.code === 'SQLITE_CONSTRAINT' ? 409 : 500);
    if (status === 500) console.error('[literature]', error);
    res.status(status).json({ success: false, error: status === 500 ? '小说工作区服务异常，请稍后重试' : error.code === 'SQLITE_CONSTRAINT' ? '名称或记录已存在' : error.message });
  });
  return { router, store, runner, importRunner };
}
module.exports = { createLiteratureRouter };
