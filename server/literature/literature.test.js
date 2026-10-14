const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStore } = require('./store');
const { buildContext } = require('./context');
const { validateFacts } = require('./domain');
const { createLiteratureRouter } = require('./routes');
const { createRunner } = require('./jobs');

const book = { id: 'book', revision: 1, title: '归航', genre: '悬疑', premise: '失踪的船', style: '克制、第三人称', instructions: '不能复活死者' };
const entry = (id, extra = {}) => ({ id, kind: 'character', title: id, body: '确认设定', data: {}, status: 'confirmed', locked: false, reveal_chapter: 1, ...extra });
const fact = (id, ordinal, value, extra = {}) => ({ id, ordinal, entity_id: 'lin', key: '位置', value, quote: value, status: 'active', chapter_id: `c${ordinal}`, source_revision: 2, known_by: [], created_at: `2026-01-${String(ordinal).padStart(2, '0')}`, ...extra });

test('chapter-scoped context excludes future and candidate canon, chooses latest past state', () => {
  const pack = buildContext({ book, chapter: { id: 'c4', ordinal: 4, revision: 1, title: '港口', plan: { entityIds: ['lin'] } }, entries: [entry('lin'), entry('secret', { reveal_chapter: 8 }), entry('idea', { status: 'candidate' })], facts: [fact('f1', 1, '旧城'), fact('f2', 3, '港口'), fact('future', 8, '王宫'), fact('stale', 2, '荒漠', { status: 'stale' })] });
  assert.deepEqual(pack.canon.map(item => item.id), ['lin']);
  assert.equal(pack.currentState[0].value, '港口');
  assert.equal(pack.manifest.excludedFutureEntries, 1);
  assert.equal(pack.currentState.length, 1);
});
test('very long fiction has bounded context and retains required state', () => {
  const entries = [entry('lin', { locked: true }), ...Array.from({ length: 1000 }, (_, i) => entry(`other-${i}`, { body: '设定内容'.repeat(80) }))];
  const facts = Array.from({ length: 5000 }, (_, i) => fact(`f-${i}`, i + 1, `位置${i}`, { entity_id: `actor-${i}` }));
  facts.push(fact('required', 5999, '最后确认的位置'));
  const pack = buildContext({ book, chapter: { ordinal: 6000, title: '归来', plan: { entityIds: ['lin'] } }, entries, facts, budget: 12000 });
  assert.ok(JSON.stringify(pack).length <= 12000);
  assert.ok(pack.currentState.some(item => item.id === 'required'));
  assert.ok(pack.manifest.omittedEntries > 0);
  assert.ok(pack.manifest.omittedFacts > 0);
});
test('locked canon cannot be silently dropped when budget is exceeded', () => {
  assert.throws(() => buildContext({ book, chapter: { ordinal: 2, plan: {} }, entries: [entry('world', { locked: true, body: '规则'.repeat(20000) })], facts: [], budget: 6000 }), /必需设定超过/);
});
test('memory extraction sees the entire current chapter or rejects excess size', () => {
  const content = '开头不可忽略。' + '正文'.repeat(5500) + '结尾事实。';
  const pack = buildContext({ book, chapter: { ordinal: 2, plan: {}, content }, entries: [], facts: [], taskType: 'memory' });
  assert.equal(pack.excerpts[0].content, content);
  assert.equal(pack.excerpts[0].omittedPrefixCharacters, 0);
  assert.throws(() => buildContext({ book, chapter: { ordinal: 2, plan: {}, content }, entries: [], facts: [], taskType: 'review', budget: 6000 }), /完整正文/);
});
test('historical events with the same key are retained independently', () => {
  const pack = buildContext({ book, chapter: { ordinal: 5, plan: {} }, entries: [], facts: [fact('a', 1, '第一次会面', { kind: 'event' }), fact('b', 3, '第二次会面', { kind: 'event' })] });
  assert.equal(pack.historyEvents.length, 2);
  assert.equal(pack.currentState.length, 0);
});
test('POV writing excludes private knowledge, while review sees it with its disclosure boundary', () => {
  const input = { book, chapter: { ordinal: 5, plan: { povEntityId: 'lin' } }, entries: [entry('lin'), entry('villain')], facts: [fact('secret', 3, '真实身份', { kind: 'knowledge', known_by: ['villain'] })] };
  assert.equal(buildContext({ ...input, taskType: 'write' }).currentState.length, 0);
  assert.equal(buildContext({ ...input, taskType: 'write' }).manifest.excludedUnknownFacts, 1);
  assert.equal(buildContext({ ...input, taskType: 'review' }).currentState[0].knownBy[0], 'villain');
});
test('framework parents are included with children and inherited disclosure cannot be bypassed', () => {
  const root = entry('root', { kind: 'outline', body: '核心剧情约束' });
  const child = entry('child', { kind: 'outline', parent_id: 'root' });
  const input = { book, chapter: { ordinal: 2, plan: { entityIds: ['child'] } }, entries: [root, child], facts: [] };
  assert.deepEqual(new Set(buildContext(input).canon.map(item => item.id)), new Set(['root', 'child']));
  assert.equal(buildContext({ ...input, entries: [{ ...root, reveal_chapter: 10 }, child] }).canon.length, 0);
  assert.equal(buildContext({ ...input, entries: [{ ...root, status: 'candidate' }, child] }).canon.length, 0);
});
test('facts require exact source quotes and in-book entity references', () => {
  const chapter = { content: '林舟把铜钥匙交给许岚。' };
  assert.throws(() => validateFacts([{ entity_id: 'foreign', key: '持有', value: '钥匙', quote: '林舟' }], chapter, [entry('lin')]), /本作品/);
  assert.throws(() => validateFacts([{ entity_id: 'lin', key: '死亡', value: '已死亡', quote: '林舟死了' }], chapter, [entry('lin')]), /原文依据/);
  assert.equal(validateFacts([{ entity_id: 'lin', key: '位置', value: '港口', quote: '林舟', known_by: ['lin'] }], chapter, [entry('lin')]).length, 1);
});
test('database transactions roll back, data survives reopen, interrupted jobs fail without changing drafts', async t => {
  const fs = require('fs');
  const path = require('path');
  const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'literature-test-'));
  const filename = path.join(directory, 'book.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let store = createStore(filename);
  await assert.rejects(store.write(async sql => { await sql.run('INSERT INTO users VALUES (?,?,?,?,?)', ['rollback', 'rollback', 'hash', 'author', 'now']); throw new Error('rollback'); }));
  assert.equal((await store.read(sql => sql.get('SELECT count(*) AS n FROM users'))).n, 0);
  await store.write(async sql => {
    await sql.run('INSERT INTO users VALUES (?,?,?,?,?)', ['owner', 'owner', 'hash', 'author', 'now']);
    await sql.run('INSERT INTO books (id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)', ['book', 'owner', '长篇存档', 'now', 'now']);
    await sql.run('INSERT INTO jobs (id,book_id,type,status,book_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['interrupted', 'book', 'outline', 'running', 1, 'now', 'now']);
  });
  await store.close();
  store = createStore(filename);
  await createRunner(store).initialized;
  assert.equal((await store.read(sql => sql.get('SELECT title FROM books'))).title, '长篇存档');
  assert.equal((await store.read(sql => sql.get('SELECT status FROM jobs'))).status, 'failed');
  await store.close();
});

test('HTTP workflow: auth, isolation, draft adoption, memory acceptance, versions, stale jobs, cancellation', async t => {
  const store = createStore(':memory:');
  let blocked = false, release;
  const invoke = async (book, system, prompt, signal) => {
    if (blocked) await new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
    const context = JSON.parse(prompt.split('上下文包：\n')[1]);
    const person = context.canon.find(item => item.title === '林舟');
    let content = '林舟在港口把铜钥匙交给许岚。夜雨落在甲板上。';
    if (prompt.startsWith('先列出')) content = '港口相遇，交出钥匙，保留悬念。';
    if (prompt.startsWith('为本章')) content = JSON.stringify({ goal: '交出钥匙', beats: '相遇、交接', entityIds: person ? [person.id] : [] });
    if (prompt.startsWith('审校')) content = JSON.stringify({ summary: '需要人工核实', issues: [] });
    if (prompt.startsWith('从当前草稿')) content = JSON.stringify({ summary: '林舟交出了钥匙。', facts: [{ entity_id: person?.id || '', key: '位置', value: '港口', quote: '林舟在港口', known_by: [] }] });
    return { content, usage: { prompt_tokens: 10, completion_tokens: 20 } };
  };
  const module = createLiteratureRouter({ store, invoke });
  const app = express(); app.use(express.json()); app.use('/api/literature', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/literature`;
  let cookie = '';
  async function request(path, method = 'GET', body, expected = 200, customCookie = cookie) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Literature-Request': '1', Cookie: customCookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result.data;
  }
  async function waitJob(bookId, jobId, status = 'ready') {
    for (let i = 0; i < 100; i++) {
      const result = await request(`/books/${bookId}/jobs/${jobId}`);
      if (!['queued', 'running'].includes(result.status)) { assert.equal(result.status, status, JSON.stringify(result)); return result; }
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail('job timeout');
  }
  await request('/books', 'GET', undefined, 401);
  await request('/auth/setup', 'POST', { username: 'owner', password: 'safe-test-password' });
  const ownerCookie = cookie;
  await request('/users', 'POST', { username: 'other', password: 'other-safe-password' });
  const b = await request('/books', 'POST', { title: '归航', genre: '悬疑', premise: '寻找失踪的船' });
  const baseBook = `/books/${b.id}`;
  const person = await request(`${baseBook}/entries`, 'POST', { kind: 'character', title: '林舟', body: '沉默的船长', locked: true });
  const root = await request(`${baseBook}/entries`, 'POST', { kind: 'outline', title: '核心大纲' });
  const child = await request(`${baseBook}/entries`, 'POST', { kind: 'outline', title: '第一幕', parent_id: root.id });
  assert.equal(child.parent_id, root.id);
  await request(`${baseBook}/entries/${root.id}`, 'PUT', { revision: 1, parent_id: child.id }, 400);
  await request(`${baseBook}/entries`, 'POST', { kind: 'character', title: '错误分类', parent_id: root.id }, 400);
  await request(`${baseBook}/entries/${root.id}`, 'DELETE', { revision: 1 });
  assert.equal((await request(baseBook)).entries.find(item => item.id === child.id).parent_id, null);
  await request(`${baseBook}/entries/${person.id}`, 'PUT', { revision: 1, body: '改变背景', locked: true }, 409);
  const c1 = await request(`${baseBook}/chapters`, 'POST', { plan: { entityIds: [person.id] } });
  assert.equal((await request(baseBook)).chapters[0].accepted_ai_generated, 0);
  await request(`${baseBook}/chapters/${c1.id}/formal`, 'GET', undefined, 404);
  const write = await request(`${baseBook}/jobs`, 'POST', { type: 'write', chapterId: c1.id, requestId: 'write-1' });
  await waitJob(b.id, write.id);
  assert.equal((await request(`${baseBook}/chapters/${c1.id}`)).content, '');
  const adopted = await request(`${baseBook}/jobs/${write.id}/apply`, 'POST', {});
  assert.equal(adopted.revision, 2);
  assert.match(adopted.content, /铜钥匙/);
  assert.equal((await request(baseBook)).facts.length, 0);
  assert.equal((await request(baseBook)).chapters[0].accepted_ai_generated, 0);
  const memory = await request(`${baseBook}/jobs`, 'POST', { type: 'memory', chapterId: c1.id });
  const extracted = await waitJob(b.id, memory.id);
  assert.equal((await request(baseBook)).facts.length, 0);
  await request(`${baseBook}/chapters/${c1.id}/accept`, 'POST', { revision: 2, jobId: memory.id, selected: [0], summary: extracted.result.summary, overrides: [{ index: 0, quote: '不存在的引文' }] }, 400);
  await request(`${baseBook}/chapters/${c1.id}/accept`, 'POST', { revision: 2, jobId: memory.id, selected: [0], summary: extracted.result.summary });
  assert.equal((await request(baseBook)).chapters[0].accepted_ai_generated, 1);
  assert.match((await request(`${baseBook}/chapters/${c1.id}/formal`)).content, /铜钥匙/);
  const c2 = await request(`${baseBook}/chapters`, 'POST', {});
  const context = await request(`${baseBook}/chapters/${c2.id}/context`);
  assert.ok(context.currentState.some(state => state.value === '港口'));
  assert.equal(context.history.length, 1);
  const versions = await request(`${baseBook}/chapters/${c1.id}/versions`);
  assert.equal(versions.length, 2);
  await request(`${baseBook}/chapters/${c1.id}`, 'PUT', { revision: 1, content: 'stale' }, 409);
  await request(`${baseBook}/chapters/${c1.id}`, 'PUT', { revision: 2, content: '林舟去了旧城。' });
  assert.doesNotMatch((await request(`${baseBook}/chapters/${c1.id}/formal`)).content, /林舟去了旧城/);
  const formalText = await (await fetch(`${base}${baseBook}/export?format=txt`, { headers: { Cookie: cookie } })).text();
  assert.match(formalText, /铜钥匙/);
  assert.doesNotMatch(formalText, /林舟去了旧城/);
  assert.equal((await request(`${baseBook}/chapters/${c2.id}/context`)).currentState.length, 0);
  assert.equal((await request(baseBook)).chapters.find(item => item.id === c2.id).needs_review, 1);
  blocked = true;
  const pending = await request(`${baseBook}/jobs`, 'POST', { type: 'write', chapterId: c2.id, requestId: 'once' });
  const duplicate = await request(`${baseBook}/jobs`, 'POST', { type: 'write', chapterId: c2.id, requestId: 'once' });
  assert.equal(pending.id, duplicate.id);
  for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(release);
  await request(`${baseBook}/entries`, 'POST', { kind: 'world', title: '规则', body: '不能复活' });
  blocked = false; release(); release = null;
  await waitJob(b.id, pending.id, 'stale');
  await request(`${baseBook}/jobs/${pending.id}/apply`, 'POST', {}, 409);
  blocked = true;
  const cancelled = await request(`${baseBook}/jobs`, 'POST', { type: 'write', chapterId: c2.id });
  for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await request(`${baseBook}/jobs/${cancelled.id}/cancel`, 'POST', {});
  blocked = false; release?.();
  await waitJob(b.id, cancelled.id, 'cancelled');
  const manual = await request(`${baseBook}/chapters`, 'POST', {});
  await request(`${baseBook}/chapters/${manual.id}`, 'PUT', { revision: 1, content: '林舟在港口等待。' });
  const manualMemory = await request(`${baseBook}/jobs`, 'POST', { type: 'memory', chapterId: manual.id });
  const manualResult = await waitJob(b.id, manualMemory.id);
  await request(`${baseBook}/chapters/${manual.id}/accept`, 'POST', { revision: 2, jobId: manualMemory.id, selected: [0], summary: manualResult.result.summary });
  assert.equal((await request(baseBook)).chapters.find(item => item.id === manual.id).accepted_ai_generated, 0);
  await request(`${baseBook}/chapters/${manual.id}/formal`, 'GET', undefined, 404);
  await request('/auth/login', 'POST', { username: 'other', password: 'other-safe-password' });
  assert.deepEqual(await request('/books'), []);
  await request(baseBook, 'GET', undefined, 404);
  await request(baseBook, 'DELETE', { revision: 1 }, 404);
  await request(`${baseBook}/jobs/${write.id}`, 'GET', undefined, 404);
  await request('/users', 'POST', { username: 'evil', password: 'safe-evil-password' }, 403);
  await request('/auth/setup', 'POST', { username: 'second', password: 'safe-second-password' }, 403);
  const noGuard = await fetch(`${base}/books`, { method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'bad' }) });
  assert.equal(noGuard.status, 403);
  await new Promise(resolve => setTimeout(resolve, 30));
});
