const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStore } = require('./store');
const { createLiteratureRouter } = require('./routes');
const { parseManuscript, splitSpans, validateExtraction, createImportRunner } = require('./imports');
const { buildContext } = require('./context');

test('million-character parsing is lossless, bounded, and keeps chapter source offsets', () => {
  const text = '海雾掠过港口，船长检查航线。\n'.repeat(70000);
  assert.ok(text.length > 1000000);
  const result = parseManuscript(text);
  assert.equal(result.chapters.map(chapter => chapter.content).join(''), text);
  assert.ok(result.chapters.every(chapter => chapter.content.length <= 6000));
  const named = '\uFEFF第一卷 雾港\r\n第一章 归航\r\n林舟回到港口。\r\n\r\n第二章 夜雨\r\n许岚收起铜钥匙。\r\n';
  const chapters = parseManuscript(named).chapters;
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].volume, '第一卷 雾港');
  for (const chapter of chapters) assert.equal(named.slice(chapter.source_start, chapter.source_end), chapter.content);
  const emoji = '甲'.repeat(5999) + '🌊' + '乙'.repeat(8000);
  const spans = splitSpans(emoji);
  assert.equal(spans.map(span => span.content).join(''), emoji);
  assert.ok(spans.every(span => !/[\uD800-\uDBFF]$/.test(span.content)));
  assert.throws(() => parseManuscript('a'.repeat(2000001)), /200 万/);
});

test('extraction rejects invented evidence and preserves uncertainty rather than assuming public truth', () => {
  const valid = { summary: '林舟回到港口。', entries: [{ kind: 'character', title: '林舟', body: '归来的船长', quote: '林舟', aliases: ['舟哥'] }], facts: [{ kind: 'state', entity: '林舟', key: '位置', value: '港口', quote: '港口' }] };
  const result = validateExtraction(valid, '林舟回到港口。');
  assert.equal(result.entries[0].visibility, 'unknown');
  assert.equal(result.facts[0].chronology, 'unknown');
  assert.throws(() => validateExtraction({ ...valid, facts: [{ ...valid.facts[0], quote: '林舟已经死亡' }] }, '林舟回到港口。'), /引文/);
});

async function fixture(t, invoke) {
  const store = createStore(':memory:');
  const module = createLiteratureRouter({ store, invoke });
  await module.importRunner.initialized;
  const app = express(); app.use(express.json({ limit: '10mb' })); app.use('/api/literature', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let cookie = '';
  const base = `http://127.0.0.1:${server.address().port}/api/literature`;
  async function request(path, method = 'GET', body, expected = 200, customCookie = cookie) {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: customCookie, 'Content-Type': 'application/json', 'X-Literature-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  }
  t.after(async () => {
    for (const parent of await store.read(sql => sql.all("SELECT id FROM literature_imports WHERE status='analyzing'"))) await module.importRunner.pause(parent.id);
    for (let i = 0; module.importRunner.controllers.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => server.close(resolve)); await store.close();
  });
  await request('/auth/setup', 'POST', { username: 'import-author', password: 'test-import-password' });
  const ownerCookie = cookie;
  const book = await request('/books', 'POST', { title: '海雾旧稿' });
  const path = `/books/${book.id}`;
  async function waitBatch(importId, status = 'review') {
    for (let i = 0; i < 200; i++) { const batch = await request(`${path}/imports/${importId}`); if (batch.status !== 'analyzing') { assert.equal(batch.status, status, JSON.stringify(batch)); return batch; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.fail('analysis timeout');
  }
  return { store, module, request, book, path, waitBatch, ownerCookie, base, cookie: () => cookie };
}

function extraction(prompt) {
  const part = JSON.parse(prompt.split('原稿分段：\n')[1]);
  const location = part.text.includes('旧城') ? '旧城' : '港口';
  const quote = part.text.includes('林舟') ? '林舟' : part.text.slice(0, 2);
  return { summary: `林舟位于${location}。`, entries: [{ kind: 'character', title: '林舟', body: `首次档案来自${location}`, quote, aliases: ['舟哥'], visibility: 'public', known_by: [] }, { kind: 'outline', title: `${part.chapter} · 已发生剧情`, body: `林舟来到${location}`, quote, aliases: [], visibility: 'public', known_by: [] }], facts: [{ kind: 'state', entity: '林舟', key: '位置', value: location, quote: location, visibility: 'public', known_by: [], chronology: 'current', story_time: '' }], issues: [] };
}

test('import to takeover loop: preview, duplicate/conflict safety, formal provenance, review, evidence, continuation, invalidation and rebuild', async t => {
  let calls = 0;
  const f = await fixture(t, async (book, system, prompt) => {
    calls++;
    if (prompt.includes('原稿分段：\n')) return { content: JSON.stringify(extraction(prompt)), usage: { prompt_tokens: 10 } };
    return { content: prompt.startsWith('先列出') ? '承接旧城的冲突。' : '林舟推开旧城的门。' };
  });
  const { request, path, waitBatch } = f;
  const sourceText = '第一章 雾港\n林舟在港口。\n第二章 归城\n林舟来到旧城。';
  const batch = await request(`${path}/imports`, 'POST', { name: '旧稿.txt', sourceText, requestId: 'initial' });
  assert.equal((await request(`${path}/imports`, 'POST', { name: '重试', sourceText, requestId: 'initial' })).id, batch.id);
  const preview = await request(`${path}/imports/${batch.id}`);
  assert.equal(preview.chapters.length, 2);
  assert.equal((await request(path)).chapters.length, 0);
  await request(`${path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  const imported = (await request(path)).chapters;
  assert.equal(imported[0].accepted_imported, 1); assert.equal(imported[0].accepted_ai_generated, 0);
  const formal = await request(`${path}/chapters/${imported[0].id}/formal`);
  assert.equal(formal.source, 'import'); assert.equal(formal.content, '林舟在港口。');
  const temporary = await request(`${path}/chapters`, 'POST', {});
  await request(`${path}/jobs`, 'POST', { type: 'write', chapterId: temporary.id }, 409);
  await request(`${path}/takeover`, 'POST', {}, 409);
  await request(`${path}/imports/${batch.id}/start`, 'POST', {});
  const ready = await waitBatch(batch.id);
  assert.equal(ready.units.length, 2); assert.equal(ready.units[0].batch_safe, 1);
  assert.equal((await request(path)).entries.length, 0);
  await request(`${path}/imports/${batch.id}/accept-batch`, 'POST', { unitIds: ready.units.map(unit => unit.id), reviewed: true });
  assert.equal((await request(`${path}/imports/${batch.id}`)).status, 'complete');
  const canonical = await request(path);
  assert.equal(canonical.entries.filter(entry => entry.kind === 'character').length, 1);
  const person = canonical.entries.find(entry => entry.kind === 'character');
  assert.match(person.body, /港口/);
  const evidence = await request(`${path}/evidence?entryId=${person.id}`);
  assert.equal(evidence.length, 2);
  const takeover = await request(`${path}/takeover`, 'POST', {});
  assert.equal((await request(`${path}/takeover`, 'POST', {})).chapterId, takeover.chapterId);
  const context = await request(`${path}/chapters/${takeover.chapterId}/context`);
  assert.equal(context.currentState.find(fact => fact.entityId === person.id).value, '旧城');
  assert.equal(context.historicalStructure.length, 2);
  assert.equal(context.plannedThreads.length, 0);
  const job = await request(`${path}/jobs`, 'POST', { type: 'write', chapterId: takeover.chapterId });
  for (let i = 0; i < 100; i++) { const result = await request(`${path}/jobs/${job.id}`); if (result.status === 'ready') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  await request(`${path}/jobs/${job.id}/apply`, 'POST', {});
  assert.match((await request(`${path}/chapters/${takeover.chapterId}`)).content, /旧城/);
  const before = calls;
  await request(`${path}/imports/${batch.id}/start`, 'POST', {}, 400);
  assert.equal(calls, before);
  const duplicate = await request(`${path}/imports`, 'POST', { sourceText, requestId: 'duplicate' });
  assert.ok((await request(`${path}/imports/${duplicate.id}`)).chapters.every(chapter => chapter.action === 'duplicate'));
  await request(`${path}/imports/${duplicate.id}/commit`, 'POST', { confirm: true }, 400);
  const conflict = await request(`${path}/imports`, 'POST', { sourceText: '第一章 雾港\n林舟已在旧城。', requestId: 'conflict' });
  const conflicting = await request(`${path}/imports/${conflict.id}`);
  assert.equal(conflicting.chapters[0].action, 'conflict');
  await request(`${path}/imports/${conflict.id}/commit`, 'POST', { confirm: true }, 409);
  assert.equal((await request(`${path}/chapters/${imported[0].id}/formal`)).content, formal.content);
  await request(`${path}/chapters/${imported[0].id}`, 'PUT', { revision: 1, content: '林舟从港口出发。' });
  assert.ok((await request(`${path}/takeover`)).problems.length > 0);
  await request(`${path}/jobs`, 'POST', { type: 'write', chapterId: takeover.chapterId }, 409);
  await request(`${path}/imports/${batch.id}/rebuild`, 'POST', { confirm: true });
  await request(`${path}/imports/${batch.id}/start`, 'POST', {});
  const rebuilt = await waitBatch(batch.id);
  const current = rebuilt.units.filter(unit => unit.status === 'ready');
  await request(`${path}/imports/${batch.id}/accept-batch`, 'POST', { unitIds: current.map(unit => unit.id), reviewed: true });
  assert.equal((await request(`${path}/takeover`)).problems.length, 0);
  assert.equal((await request(`${path}/imports/${batch.id}/source`)).text, sourceText);
  const backup = await request(`${path}/export`);
  assert.equal(backup.schemaVersion, 2); assert.ok(backup.imports.length); assert.ok(backup.evidence.length);
  await request('/users', 'POST', { username: 'another-author', password: 'another-test-password' });
  await request('/auth/login', 'POST', { username: 'another-author', password: 'another-test-password' });
  await request(`${path}/imports/${batch.id}`, 'GET', undefined, 404);
  await request(`${path}/imports/${batch.id}/source`, 'GET', undefined, 404);
  await request(`${path}/imports/${batch.id}/units/${ready.units[0].id}`, 'GET', undefined, 404);
});

test('partial manuscript is not formal and continuation preserves the original prefix', async t => {
  const f = await fixture(t, async (book, system, prompt) => ({ content: prompt.startsWith('先列出') ? '承接未完场景。' : '门后传来旧钟的声音。' }));
  const batch = await f.request(`${f.path}/imports`, 'POST', { sourceText: '第一章 未完\n林舟推开那扇门，', lastPartial: true, requestId: 'fragment' });
  await f.request(`${f.path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  const chapter = (await f.request(f.path)).chapters[0];
  assert.equal(chapter.accepted_imported, 0);
  await f.request(`${f.path}/chapters/${chapter.id}/formal`, 'GET', undefined, 404);
  const point = await f.request(`${f.path}/takeover`, 'POST', {});
  assert.equal(point.chapterId, chapter.id);
  const job = await f.request(`${f.path}/jobs`, 'POST', { type: 'write', chapterId: chapter.id });
  for (let i = 0; i < 100; i++) { const result = await f.request(`${f.path}/jobs/${job.id}`); if (result.status === 'ready') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  const adopted = await f.request(`${f.path}/jobs/${job.id}/apply`, 'POST', {});
  assert.equal(adopted.content, '林舟推开那扇门，\n\n门后传来旧钟的声音。');
  const versions = await f.request(`${f.path}/chapters/${chapter.id}/versions`);
  assert.equal(versions.find(version => version.revision === 1).content, '林舟推开那扇门，');
});

test('pause resumes only incomplete units and restart does not automatically call models', async t => {
  let blocked = false, entered, calls = 0;
  const f = await fixture(t, async (book, system, prompt, signal) => {
    calls++;
    if (blocked) { entered = true; await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('paused')), { once: true }); }); }
    return { content: JSON.stringify(extraction(prompt)) };
  });
  const batch = await f.request(`${f.path}/imports`, 'POST', { sourceText: '第一章 海雾\n林舟在港口。\n第二章 归城\n林舟在旧城。', requestId: 'resume' });
  await f.request(`${f.path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  blocked = true;
  await f.request(`${f.path}/imports/${batch.id}/start`, 'POST', {});
  for (let i = 0; !entered && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await f.request(`${f.path}/imports/${batch.id}/pause`, 'POST', {});
  for (let i = 0; f.module.importRunner.controllers.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.request(`${f.path}/imports/${batch.id}`)).status, 'paused');
  blocked = false;
  await f.request(`${f.path}/imports/${batch.id}/start`, 'POST', {});
  const done = await f.waitBatch(batch.id);
  assert.equal(calls, 3);
  assert.equal(done.units[0].attempts, 2); assert.equal(done.units[1].attempts, 1);
  await f.store.write(async sql => { await sql.run("UPDATE literature_imports SET status='analyzing' WHERE id=?", [batch.id]); await sql.run("UPDATE import_units SET status='running' WHERE id=?", [done.units[0].id]); });
  await createImportRunner(f.store, () => { assert.fail('must not auto retry after restart'); }).initialized;
  const persisted = await f.request(`${f.path}/imports/${batch.id}`);
  assert.equal(persisted.status, 'paused'); assert.equal(persisted.units[0].status, 'failed'); assert.equal(persisted.units[1].status, 'ready');
});

test('private imported canon and flashbacks do not leak into a different POV or overwrite current state', () => {
  const data = { book: { id: 'b', title: 'test', revision: 1 }, chapter: { ordinal: 3, plan: { povEntityId: 'lin' } }, entries: [{ id: 'secret', kind: 'character', title: '身份', body: '秘密', status: 'confirmed', reveal_chapter: 1, data: { _import: { knownBy: ['villain'], scope: 'retrospective' } } }], facts: [
    { id: 'old', ordinal: 1, entity_id: 'lin', key: '位置', value: '港口', known_by: [], status: 'active', source_offset: 10, created_at: '2026' },
    { id: 'new', ordinal: 1, entity_id: 'lin', key: '位置', value: '旧城', known_by: [], status: 'active', source_offset: 100, created_at: '2025' },
    { id: 'flashback', ordinal: 2, entity_id: 'lin', key: '位置', value: '回溯：故乡', kind: 'event', known_by: [], status: 'active', created_at: '2026' },
  ] };
  const pack = buildContext(data);
  assert.equal(pack.canon.length, 0); assert.equal(pack.currentState[0].value, '旧城'); assert.equal(pack.historyEvents[0].id, 'flashback');
});

test('million-character HTTP import persists raw text and every analysis span without invoking AI', async t => {
  const f = await fixture(t, () => { assert.fail('upload and preview must not invoke AI'); });
  const sourceText = '海雾掠过港口，船长检查航线。\n'.repeat(70000);
  const batch = await f.request(`${f.path}/imports`, 'POST', { sourceText, requestId: 'million', mode: 'segments' });
  await f.request(`${f.path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  const snapshot = await f.store.read(async sql => ({ text: (await sql.get('SELECT source_text FROM literature_imports WHERE id=?', [batch.id])).source_text, chapters: await sql.all('SELECT content FROM chapters WHERE book_id=? ORDER BY ordinal', [f.book.id]), units: await sql.all('SELECT start_offset,end_offset,content FROM import_units WHERE import_id=?', [batch.id]) }));
  assert.equal(snapshot.text, sourceText);
  const digest = value => require('crypto').createHash('sha256').update(value).digest('hex');
  assert.equal(digest(snapshot.chapters.map(chapter => chapter.content).join('')), digest(sourceText));
  assert.equal(snapshot.units.reduce((sum, unit) => sum + unit.content.length, 0), sourceText.length);
  assert.ok(snapshot.units.every(unit => unit.content.length <= 6000 && unit.end_offset - unit.start_offset === unit.content.length));
});

test('uncertain/private/alias results need explicit review, rollback is atomic, flashbacks remain events', async t => {
  const f = await fixture(t, async () => ({ content: JSON.stringify({ summary: '林舟在港口，许岚知道暗号。', entries: [
    { kind: 'character', title: '林舟', body: '船长', quote: '林舟', aliases: ['舟哥'], visibility: 'public' },
    { kind: 'character', title: '许岚', body: '知情者', quote: '许岚', visibility: 'public' },
    { kind: 'plot', title: '暗号', body: '只有许岚知道暗号', quote: '只有许岚知道暗号', visibility: 'private', known_by: ['许岚'] },
  ], facts: [
    { kind: 'state', entity: '舟哥', key: '位置', value: '港口', quote: '港口', visibility: 'unknown', chronology: 'unknown' },
    { kind: 'state', entity: '林舟', key: '位置', value: '故乡', quote: '故乡', visibility: 'public', chronology: 'flashback', story_time: '十年前' },
    { kind: 'knowledge', entity: '许岚', key: '暗号', value: '知道暗号', quote: '只有许岚知道暗号', visibility: 'private', known_by: ['许岚'], chronology: 'current' },
  ], issues: ['核对“舟哥”与林舟的关系'] }) }));
  const batch = await f.request(`${f.path}/imports`, 'POST', { sourceText: '第一章 港口\n林舟在港口。十年前他住在故乡。只有许岚知道暗号。', requestId: 'private' });
  await f.request(`${f.path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  await f.request(`${f.path}/imports/${batch.id}/start`, 'POST', {});
  const ready = await f.waitBatch(batch.id);
  assert.equal(ready.units[0].batch_safe, 0);
  await f.request(`${f.path}/imports/${batch.id}/accept-batch`, 'POST', { unitIds: [ready.units[0].id], reviewed: true }, 400);
  const endpoint = `${f.path}/imports/${batch.id}/units/${ready.units[0].id}/accept`;
  const value = { entries: [{ index: 0 }, { index: 1 }, { index: 2 }], facts: [{ index: 0 }, { index: 1 }, { index: 2 }], acknowledgeIssues: true };
  await f.request(endpoint, 'POST', value, 400);
  assert.equal((await f.request(f.path)).entries.length, 0);
  value.facts[0] = { index: 0, visibility: 'public', chronology: 'current', entity: '林舟' };
  value.summary = '林舟在港口。'; value.summaryVisibility = 'public';
  await f.request(endpoint, 'POST', value);
  const imported = await f.request(f.path);
  const lin = imported.entries.find(entry => entry.title === '林舟');
  const next = await f.request(`${f.path}/chapters`, 'POST', { plan: { povEntityId: lin.id } });
  const context = await f.request(`${f.path}/chapters/${next.id}/context`);
  assert.equal(context.currentState.find(fact => fact.entityId === lin.id).value, '港口');
  assert.ok(context.historyEvents.some(event => /回溯/.test(event.value)));
  assert.ok(!context.canon.some(entry => entry.title === '暗号'));
  assert.ok(!context.currentState.some(fact => fact.key === '暗号'));
  await f.request(endpoint, 'POST', value, 409);
});

test('failed analysis can be split without gaps or losing its archived source', async t => {
  const f = await fixture(t, async () => { throw new Error('test model output too long'); });
  const batch = await f.request(`${f.path}/imports`, 'POST', { sourceText: '第一章 海雾\n' + '林舟在港口。\n'.repeat(700), requestId: 'split' });
  await f.request(`${f.path}/imports/${batch.id}/commit`, 'POST', { confirm: true });
  await f.request(`${f.path}/imports/${batch.id}/start`, 'POST', {});
  const failed = await f.waitBatch(batch.id, 'paused');
  const first = failed.units[0];
  const original = await f.request(`${f.path}/imports/${batch.id}/units/${first.id}`);
  await f.request(`${f.path}/imports/${batch.id}/units/${first.id}/split`, 'POST', {});
  const finer = await f.request(`${f.path}/imports/${batch.id}`);
  assert.ok(finer.units.length > failed.units.length);
  assert.equal(finer.units[0].start_offset, original.start_offset);
  assert.equal(finer.units[finer.units.length - 1].end_offset, first.end_offset);
  assert.equal((await f.request(`${f.path}/imports/${batch.id}/units/${first.id}`)).status, 'superseded');
  for (let i = 1; i < finer.units.length; i++) assert.equal(finer.units[i].start_offset, finer.units[i - 1].end_offset);
});
