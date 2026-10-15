const { id, now, fail, text, parse, owned, touch, chapterRow, saveChapter } = require('./domain');
const { hash, parseManuscript, splitSpans, classify, createUnits, ensureIdle, acceptUnit, importCoverage } = require('./imports');

function registerImportRoutes(router, { store, importRunner, wrap, ok }) {
  const read = (req, fn) => store.read(async sql => fn(sql, await owned(sql, req.literatureUser.id, req.params.bookId)));
  const write = (req, fn) => store.write(async sql => fn(sql, await owned(sql, req.literatureUser.id, req.params.bookId)));
  async function parent(sql, req) {
    const record = await sql.get('SELECT * FROM literature_imports WHERE id=? AND book_id=?', [req.params.importId, req.params.bookId]);
    if (!record) fail('导入批次不存在', 404);
    return record;
  }
  const metadata = record => { const { source_text, ...rest } = record; return { ...rest, characters: source_text.length }; };
  async function unit(sql, req) {
    await parent(sql, req);
    const record = await sql.get('SELECT u.*,c.title,c.ordinal,c.revision AS current_revision FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.id=? AND u.import_id=?', [req.params.unitId, req.params.importId]);
    if (!record) fail('分析分段不存在', 404);
    const result = parse(record.result); delete result.usage;
    return { ...record, result };
  }
  router.get('/books/:bookId/imports', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => ({
    imports: await sql.all(`SELECT i.id,i.name,i.status,i.created_at,i.updated_at,length(i.source_text) AS characters,
      (SELECT count(*) FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=i.id AND u.source_revision=c.accepted_revision AND u.status!='superseded') AS total,
      (SELECT count(*) FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=i.id AND u.source_revision=c.accepted_revision AND u.status='accepted') AS accepted,
      (SELECT count(*) FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=i.id AND u.source_revision=c.accepted_revision AND u.status='ready') AS ready
      FROM literature_imports i WHERE i.book_id=? ORDER BY i.created_at DESC`, [book.id]),
    takeover: await sql.get('SELECT * FROM takeovers WHERE book_id=?', [book.id]),
  })))));
  router.post('/books/:bookId/imports', wrap(async (req, res) => {
    const parsed = parseManuscript(req.body.sourceText, { mode: req.body.mode, chunkSize: req.body.chunkSize || 6000 });
    ok(res, await write(req, async (sql, book) => {
      const requestId = text(req.body.requestId, 100, true);
      const prior = await sql.get('SELECT * FROM literature_imports WHERE book_id=? AND request_id=?', [book.id, requestId]);
      if (prior) return metadata(prior);
      await ensureIdle(sql, book.id);
      const record = { id: id(), book_id: book.id, name: text(req.body.name || '导入原稿', 200, true), source_text: req.body.sourceText, source_hash: hash(req.body.sourceText), status: 'preview', chunk_size: parsed.chunkSize, request_id: requestId, created_at: now(), updated_at: now() };
      await sql.run('INSERT INTO literature_imports VALUES (?,?,?,?,?,?,?,?,?,?)', Object.values(record));
      const chapters = await classify(sql, book.id, parsed.chapters);
      for (const [position, chapter] of chapters.entries()) await sql.run('INSERT INTO import_chapters VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id(), record.id, position, chapter.title, chapter.content, chapter.volume, chapter.source_start, chapter.source_end, req.body.lastPartial && position === chapters.length - 1 ? 1 : 0, chapter.action, null]);
      return { ...metadata(record), detected: parsed.detected, chapters: chapters.length };
    }));
  }));
  router.get('/books/:bookId/imports/:importId', wrap(async (req, res) => ok(res, await read(req, async sql => {
    const record = await parent(sql, req);
    const unitOffset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const state = ['ready', 'accepted', 'failed', 'stale', 'pending', 'running'].includes(req.query.status) ? req.query.status : '';
    const where = " AND u.source_revision=c.accepted_revision AND u.status!='superseded'" + (state ? ' AND u.status=?' : '');
    const args = state ? [record.id, state] : [record.id];
    return { ...metadata(record),
      chapters: await sql.all('SELECT id,position,title,volume,partial,action,chapter_id,length(content) AS characters FROM import_chapters WHERE import_id=? ORDER BY position', [record.id]),
      counts: await sql.all("SELECT u.status,count(*) AS n FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=? AND u.source_revision=c.accepted_revision AND u.status!='superseded' GROUP BY u.status", [record.id]),
      units: await sql.all(`SELECT u.id,u.chapter_id,u.source_revision,u.position,u.start_offset,u.end_offset,u.status,u.error,u.attempts,c.title,c.ordinal,
        json_extract(u.result,'$.summary') AS summary,coalesce(json_array_length(u.result,'$.entries'),0) AS entry_count,coalesce(json_array_length(u.result,'$.facts'),0) AS fact_count,
        (u.status='ready' AND coalesce(json_array_length(u.result,'$.issues'),0)=0
          AND NOT EXISTS(SELECT 1 FROM json_each(u.result,'$.entries') x WHERE json_extract(x.value,'$.visibility')!='public')
          AND NOT EXISTS(SELECT 1 FROM json_each(u.result,'$.facts') x WHERE json_extract(x.value,'$.visibility')!='public' OR json_extract(x.value,'$.chronology')!='current' OR json_extract(x.value,'$.kind')='knowledge')) AS batch_safe
        FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=?${where} ORDER BY c.ordinal,u.position LIMIT 50 OFFSET ?`, [...args, unitOffset]),
      unitCount: (await sql.get(`SELECT count(*) AS n FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE u.import_id=?${where}`, args)).n,
    };
  }))));
  router.get('/books/:bookId/imports/:importId/source', wrap(async (req, res) => ok(res, await read(req, async sql => { const record = await parent(sql, req); return { name: record.name, text: record.source_text }; }))));
  router.get('/books/:bookId/imports/:importId/chapters/:stagedId', wrap(async (req, res) => ok(res, await read(req, async sql => {
    await parent(sql, req);
    const chapter = await sql.get('SELECT * FROM import_chapters WHERE id=? AND import_id=?', [req.params.stagedId, req.params.importId]);
    if (!chapter) fail('预览章节不存在', 404);
    return chapter;
  }))));
  router.put('/books/:bookId/imports/:importId/chapters/:stagedId', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    if ((await parent(sql, req)).status !== 'preview') fail('已导入原文不可在预览中修改', 409);
    const chapter = await sql.get('SELECT * FROM import_chapters WHERE id=? AND import_id=?', [req.params.stagedId, req.params.importId]);
    if (!chapter) fail('预览章节不存在', 404);
    chapter.title = text(req.body.title ?? chapter.title, 200, true);
    const [checked] = await classify(sql, book.id, [chapter]);
    await sql.run('UPDATE import_chapters SET title=?,partial=?,action=? WHERE id=?', [chapter.title, req.body.partial ? 1 : 0, req.body.excluded ? 'excluded' : checked.action, chapter.id]);
    return true;
  }))));
  router.post('/books/:bookId/imports/:importId/reorder', wrap(async (req, res) => ok(res, await write(req, async sql => {
    if ((await parent(sql, req)).status !== 'preview') fail('只能调整导入前的章节顺序', 409);
    const chapters = await sql.all('SELECT id FROM import_chapters WHERE import_id=?', [req.params.importId]);
    const order = req.body.order;
    if (!Array.isArray(order) || new Set(order).size !== chapters.length || order.length !== chapters.length || order.some(key => !chapters.some(chapter => chapter.id === key))) fail('章节顺序不完整');
    for (const [position, key] of order.entries()) await sql.run('UPDATE import_chapters SET position=? WHERE id=?', [position, key]);
    return true;
  }))));
  router.post('/books/:bookId/imports/:importId/commit', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const record = await parent(sql, req);
    if (record.status !== 'preview') return { importId: record.id, alreadyImported: true };
    if (req.body.confirm !== true) fail('需要作者明确确认原稿与章节顺序');
    await ensureIdle(sql, book.id);
    const staged = await sql.all("SELECT * FROM import_chapters WHERE import_id=? AND action!='excluded' ORDER BY position", [record.id]);
    const checked = await classify(sql, book.id, staged);
    if (checked.some(chapter => chapter.action === 'conflict')) fail('存在同名但内容不同的章节，请改名或排除，系统不会覆盖旧稿', 409);
    const incoming = checked.filter(chapter => chapter.action === 'new');
    if (!incoming.length) fail('没有可新增的正文；相同内容会跳过');
    if (incoming.some((chapter, index) => chapter.partial && index !== incoming.length - 1)) fail('未完成片段只能放在本批最后');
    const previousPartial = await sql.get('SELECT c.id FROM chapters c JOIN chapter_sources s ON s.chapter_id=c.id WHERE c.book_id=? AND s.confirmed=0 AND c.accepted_revision IS NULL', [book.id]);
    if (previousPartial) fail('作品有未完成的导入片段，请先完成或另建作品，避免追加次序不明确', 409);
    let ordinal = (await sql.get('SELECT coalesce(max(ordinal),0) AS n FROM chapters WHERE book_id=?', [book.id])).n;
    for (const candidate of checked) {
      if (candidate.action === 'duplicate') { await sql.run("UPDATE import_chapters SET action='duplicate' WHERE id=?", [candidate.id]); continue; }
      const chapter = { id: id(), title: candidate.title, content: candidate.content, revision: 1 };
      await sql.run('INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?)', [chapter.id, book.id, ++ordinal, chapter.title, '{}', chapter.content, candidate.partial ? 'draft' : 'accepted', 1, candidate.partial ? null : 1, candidate.partial ? 0 : 1, now()]);
      await sql.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?)', [id(), chapter.id, 1, chapter.content, '{}', chapter.title, now()]);
      await sql.run('INSERT INTO chapter_sources VALUES (?,?,?,?,?,?)', [chapter.id, record.id, candidate.id, 1, hash(chapter.content), candidate.partial ? 0 : 1]);
      await sql.run("UPDATE import_chapters SET chapter_id=?,action='imported' WHERE id=?", [chapter.id, candidate.id]);
      if (!candidate.partial) await createUnits(sql, record.id, chapter, record.chunk_size);
    }
    await sql.run("UPDATE literature_imports SET status='imported',updated_at=? WHERE id=?", [now(), record.id]);
    await touch(sql, book.id, 'manuscript_imported', { importId: record.id, chapters: incoming.length });
    return { importId: record.id, chapters: incoming.length };
  }))));
  router.post('/books/:bookId/imports/:importId/start', wrap(async (req, res) => {
    await importRunner.initialized;
    await write(req, async (sql, book) => {
      const record = await parent(sql, req);
      if (record.status === 'preview') fail('请先确认导入原文');
      if (importRunner.controllers.has(record.id)) fail('分析仍在运行或停止中，请稍后再试', 409);
      await ensureIdle(sql, book.id);
      await sql.run("UPDATE import_units SET status='pending',error='' WHERE import_id=? AND status='failed'", [record.id]);
      if (!await sql.get("SELECT id FROM import_units WHERE import_id=? AND status='pending'", [record.id])) fail('没有待分析分段；失效资料请先重建，已完成分段不会重复调用');
      await sql.run("UPDATE literature_imports SET status='analyzing',updated_at=? WHERE id=?", [now(), record.id]);
    });
    ok(res, true); await importRunner.launch(req.params.importId);
  }));
  router.post('/books/:bookId/imports/:importId/pause', wrap(async (req, res) => { await read(req, sql => parent(sql, req)); await importRunner.pause(req.params.importId); ok(res, true); }));
  router.post('/books/:bookId/imports/:importId/rebuild', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const record = await parent(sql, req); await ensureIdle(sql, book.id);
    if (record.status === 'preview' || req.body.confirm !== true) fail('请明确确认以当前保存稿重建分析，原始上传文件仍会保留');
    const chapters = await sql.all('SELECT c.* FROM chapters c JOIN chapter_sources s ON s.chapter_id=c.id WHERE s.import_id=? AND s.confirmed=1 ORDER BY c.ordinal', [record.id]);
    for (const chapter of chapters) {
      const units = await sql.all("SELECT status FROM import_units WHERE chapter_id=? AND source_revision=? AND status!='superseded'", [chapter.id, chapter.revision]);
      if (chapter.revision === chapter.accepted_revision && units.length && !units.some(item => item.status === 'stale')) continue;
      await sql.run("UPDATE facts SET status='stale' WHERE chapter_id=?", [chapter.id]);
      await sql.run("UPDATE import_units SET status='stale' WHERE chapter_id=? AND source_revision!=? AND status!='superseded'", [chapter.id, chapter.revision]);
      await sql.run("UPDATE chapters SET accepted_revision=revision,status='accepted',needs_review=1 WHERE id=?", [chapter.id]);
      await createUnits(sql, record.id, chapter, record.chunk_size);
      await sql.run("UPDATE import_units SET status='pending',result='{}',error='' WHERE chapter_id=? AND source_revision=? AND status!='superseded'", [chapter.id, chapter.revision]);
    }
    await sql.run("UPDATE literature_imports SET status='paused',updated_at=? WHERE id=?", [now(), record.id]);
    await sql.run("UPDATE takeovers SET status='stale' WHERE book_id=?", [book.id]);
    await touch(sql, book.id, 'import_rebuilt', { importId: record.id });
    return true;
  }))));
  router.get('/books/:bookId/imports/:importId/units/:unitId', wrap(async (req, res) => ok(res, await read(req, sql => unit(sql, req)))));
  router.post('/books/:bookId/imports/:importId/units/:unitId/split', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    await ensureIdle(sql, book.id);
    const item = await unit(sql, req);
    if (!['failed', 'pending', 'ready', 'stale'].includes(item.status) || item.content.length < 1500 || item.current_revision !== item.source_revision) fail('此分段不能继续细分；失效正文请先重建');
    const minimum = await sql.get('SELECT min(position) AS n FROM import_units WHERE chapter_id=? AND source_revision=?', [item.chapter_id, item.source_revision]);
    await sql.run("UPDATE import_units SET status='superseded',position=? WHERE id=?", [Math.min(-1, minimum.n - 1), item.id]);
    for (const [index, span] of splitSpans(item.content, Math.max(750, Math.floor(item.content.length / 2))).entries()) await sql.run('INSERT INTO import_units (id,import_id,chapter_id,source_revision,position,start_offset,end_offset,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id(), item.import_id, item.chapter_id, item.source_revision, 1000000000 + index, item.start_offset + span.start, item.start_offset + span.end, span.content, now(), now()]);
    const active = await sql.all("SELECT id FROM import_units WHERE chapter_id=? AND source_revision=? AND status!='superseded' ORDER BY start_offset", [item.chapter_id, item.source_revision]);
    for (const [index, row] of active.entries()) await sql.run('UPDATE import_units SET position=? WHERE id=?', [900000000 + index, row.id]);
    for (const [index, row] of active.entries()) await sql.run('UPDATE import_units SET position=? WHERE id=?', [index, row.id]);
    await sql.run("UPDATE literature_imports SET status='paused',updated_at=? WHERE id=?", [now(), item.import_id]);
    return { segments: active.length };
  }))));
  router.post('/books/:bookId/imports/:importId/units/:unitId/accept', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    const item = await unit(sql, req);
    if (item.result.issues?.length && req.body.acknowledgeIssues !== true) fail('请先核对本段待核实问题');
    return acceptUnit(sql, book, item, req.body);
  }))));
  router.post('/books/:bookId/imports/:importId/accept-batch', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    await parent(sql, req);
    const ids = req.body.unitIds;
    if (req.body.reviewed !== true || !Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) fail('每批最多确认 20 段，需要明确核对原文与分析结果');
    for (const unitId of ids) {
      const item = await sql.get('SELECT * FROM import_units WHERE id=? AND import_id=?', [unitId, req.params.importId]);
      if (!item) fail('分段不属于本次导入');
      const result = parse(item.result);
      if (item.status !== 'ready' || result.issues?.length || result.entries.some(entry => entry.visibility !== 'public') || result.facts.some(fact => fact.visibility !== 'public' || fact.chronology !== 'current' || fact.kind === 'knowledge')) fail('含秘密、时间疑问或冲突的分段需要逐段审核，不能批量确认');
      const existing = await sql.all('SELECT id,kind,title FROM entries WHERE book_id=?', [book.id]);
      const entries = result.entries.map((entry, index) => { const targets = existing.filter(target => target.kind === entry.kind && target.title.trim().toLocaleLowerCase() === entry.title.trim().toLocaleLowerCase()); if (targets.length > 1) fail('同名实体存在歧义，请逐段明确对应'); return { index, targetId: targets[0]?.id || '' }; });
      await acceptUnit(sql, book, item, { entries, facts: result.facts.map((_, index) => ({ index })), summary: result.summary, acknowledgeIssues: true });
    }
    return { accepted: ids.length };
  }))));
  router.get('/books/:bookId/takeover', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => {
    const cutoff = await sql.get('SELECT coalesce(max(ordinal),0) AS n FROM chapters WHERE book_id=? AND accepted_revision IS NOT NULL', [book.id]);
    const coverage = await importCoverage(sql, book.id, cutoff.n);
    return { snapshot: await sql.get('SELECT * FROM takeovers WHERE book_id=?', [book.id]), cutoff: cutoff.n, problems: coverage.problems, importedChapters: coverage.chapters.length,
      framework: await sql.all('SELECT kind,count(*) AS n FROM entries WHERE book_id=? AND status=\'confirmed\' GROUP BY kind', [book.id]),
      pending: await sql.all("SELECT u.status,count(*) AS n FROM import_units u JOIN chapters c ON c.id=u.chapter_id WHERE c.book_id=? AND u.source_revision=c.accepted_revision AND u.status NOT IN ('accepted','superseded') GROUP BY u.status", [book.id]),
      partials: await sql.all('SELECT c.id,c.title,c.ordinal FROM chapters c JOIN chapter_sources s ON s.chapter_id=c.id WHERE c.book_id=? AND s.confirmed=0 AND c.accepted_revision IS NULL ORDER BY c.ordinal', [book.id]),
    };
  }))));
  router.post('/books/:bookId/takeover', wrap(async (req, res) => ok(res, await write(req, async (sql, book) => {
    await ensureIdle(sql, book.id);
    const cutoff = await sql.get('SELECT * FROM chapters WHERE book_id=? AND accepted_revision IS NOT NULL ORDER BY ordinal DESC LIMIT 1', [book.id]);
    if (req.body.cutoffId && req.body.cutoffId !== cutoff?.id) fail('本版接管末尾续写；如需中途分支，请另建作品导入对应范围');
    const coverage = await importCoverage(sql, book.id, cutoff?.ordinal || 0);
    if (coverage.problems.length) fail(`还有 ${coverage.problems.length} 章未完成分析审核或有修订，请先处理`, 409);
    if (!await sql.get('SELECT s.chapter_id FROM chapter_sources s JOIN chapters c ON c.id=s.chapter_id WHERE c.book_id=?', [book.id])) fail('作品还没有导入原稿');
    let target = await sql.get('SELECT c.* FROM chapters c JOIN chapter_sources s ON s.chapter_id=c.id WHERE c.book_id=? AND s.confirmed=0 AND c.accepted_revision IS NULL ORDER BY c.ordinal LIMIT 1', [book.id]);
    const previous = await sql.get('SELECT * FROM takeovers WHERE book_id=?', [book.id]);
    if (!target && previous?.cutoff_id === cutoff?.id) target = await sql.get("SELECT * FROM chapters WHERE id=? AND status='draft'", [previous.target_id]);
    if (!target) {
      const ordinal = (await sql.get('SELECT coalesce(max(ordinal),0)+1 AS n FROM chapters WHERE book_id=?', [book.id])).n;
      target = { id: id(), ordinal, title: `续写计划 ${ordinal}` };
      const plan = JSON.stringify({ goal: text(req.body.goal || '承接已确认原作，继续未完成剧情', 6000), mustInclude: '保持已确认的人物状态、物品归属与文风，不把候选未来剧情当成历史' });
      await sql.run('INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?)', [target.id, book.id, ordinal, target.title, plan, '', 'draft', 1, null, 0, now()]);
      await sql.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?)', [id(), target.id, 1, '', plan, target.title, now()]);
    }
    if (target.ordinal <= (cutoff?.ordinal || 0)) fail('未完成片段顺序不正确，请先整理章节', 409);
    if (await sql.get('SELECT chapter_id FROM chapter_sources WHERE chapter_id=? AND confirmed=0', [target.id])) {
      const current = chapterRow(await sql.get('SELECT * FROM chapters WHERE id=?', [target.id]));
      if (!current.plan.importContinuation) await saveChapter(sql, current, { revision: current.revision, plan: { ...current.plan, importContinuation: true } });
    }
    const manifest = { importedChapters: coverage.chapters.length, cutoffTitle: cutoff?.title || '尚无完整章节', sourceVersions: coverage.chapters.map(chapter => ({ id: chapter.id, revision: chapter.accepted_revision })), targetTitle: target.title };
    await sql.run('INSERT INTO takeovers VALUES (?,?,?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET cutoff_id=excluded.cutoff_id,cutoff_ordinal=excluded.cutoff_ordinal,target_id=excluded.target_id,status=excluded.status,manifest=excluded.manifest,created_at=excluded.created_at', [book.id, cutoff?.id || null, cutoff?.ordinal || 0, target.id, 'ready', JSON.stringify(manifest), now()]);
    await touch(sql, book.id, 'takeover_created', { cutoffId: cutoff?.id, targetId: target.id });
    return { chapterId: target.id, manifest };
  }))));
  router.get('/books/:bookId/evidence', wrap(async (req, res) => ok(res, await read(req, async (sql, book) => sql.all(`SELECT e.*,u.import_id,c.title,c.ordinal FROM import_evidence e JOIN import_units u ON u.id=e.unit_id JOIN chapters c ON c.id=e.chapter_id WHERE e.book_id=? AND (e.entry_id=? OR e.fact_id=?) ORDER BY c.ordinal,e.source_offset LIMIT 100`, [book.id, String(req.query.entryId || ''), String(req.query.factId || '')])))));
}
module.exports = { registerImportRoutes };
