const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { retrieveKnowledge, productScope, chunks, validateMaterialMetadata } = require('./dialogKnowledge');
const { createDialogAgent, normalizePlan, selectModel, selectStyle } = require('./dialogAgent');
const { createDialogRuns } = require('./dialogRuns');

const document = (id, title, content, metadata = {}) => ({ id, title, originalName: title, folder: 'product', type: 'text', content, metadata });
const image = (id, product, view = 'back', extra = {}) => ({ id, title: `${product} ${view}`, type: 'image', folder: 'product', fileUrl: `/uploads/knowledge/${id}.png`, metadata: { productName: product, imageView: view, assetRole: 'product', ...extra } });
const plan = extra => ({ needsText: false, needsImages: true, imageCount: 1, imageAspectRatio: '16:9', imageSize: '1K', referenceView: 'back', searchQueries: ['轻量化'], productName: 'R5-Curve', useLogo: false, ...extra });
const fixtures = [document('curve', 'R5-Curve 参数', 'R5-Curve 重量8KG。适合展会。', { productName: 'R5-Curve', aliases: ['任意弧'] }), image('correct', 'R5-Curve'), image('wrong', 'R5Plus'), image('arc', 'R5-Arc'), { ...image('logo', '', 'any'), title: 'Enbon Logo', folder: 'brand', metadata: { assetRole: 'logo' } }, { ...image('style', '', 'any'), title: '科技风海报', folder: 'design', metadata: { assetRole: 'style', description: '冷灰背景，大留白' } }];

test('retrieval scans beyond 100 entries and retrieves matching passages after 15000 characters', () => {
  const all = Array.from({ length: 180 }, (_, i) => document(`noise-${i}`, '其他产品', '无关资料', { productName: 'X1' }));
  all.push(document('tail', 'R5-Curve 说明', '普通说明。'.repeat(6000) + '\n尾部关键卖点：航运锁扣实现轻量化。', { productName: 'R5-Curve' }));
  const result = retrieveKnowledge(all, plan({ searchQueries: ['航运锁扣'] }), 'R5-Curve 航运锁扣');
  assert.equal(result.totalScanned, 181);
  assert.ok(result.documents.some(source => source.excerpt.includes('航运锁扣') && source.start > 15000));
  for (const source of result.documents) assert.equal(source.excerpt, all.at(-1).content.slice(source.start, source.end));
});
test('exact product, aliases and view isolate product references from other variants and style images', () => {
  const result = retrieveKnowledge(fixtures, plan({ useLogo: true }), '给任意弧做背面海报加Logo');
  assert.equal(result.scope.product, 'R5-Curve');
  assert.deepEqual(result.references.map(ref => ref.id), ['correct', 'logo']);
  assert.ok(result.styleImages.some(ref => ref.id === 'style'));
  assert.ok(!result.references.some(ref => ref.id === 'style'));
  const missing = retrieveKnowledge(fixtures, plan({ productName: 'R5Plus', referenceView: 'front' }), 'R5Plus 正面');
  assert.equal(missing.references.length, 0);
});
test('unknown explicit products do not fall back to planner-selected or previous products', () => {
  assert.equal(productScope(fixtures, 'R99 做产品图', 'R5-Curve').product, 'R99');
  const result = retrieveKnowledge(fixtures, plan({ productName: 'R99' }), 'R99 背面图');
  assert.equal(result.references.length, 0);
  assert.equal(result.documents.length, 0);
  assert.equal(productScope(fixtures, '用 gpt-image-2.5-sunburst 生成一张概念图').product, '');
});
test('draft, disabled and unreviewed visual suggestions cannot become evidence', () => {
  const items = [image('draft', 'R5-Curve', 'back', { status: 'draft' }), image('off', 'R5-Curve', 'back', { status: 'disabled' }), image('candidate', 'R5-Curve', 'back', { analysis: { candidate: { description: '未经核实重量999KG' } } })];
  const result = retrieveKnowledge(items, plan(), 'R5-Curve');
  assert.deepEqual(result.references.map(ref => ref.id), ['candidate']);
  assert.ok(!JSON.stringify(result).includes('999KG'));
  assert.throws(() => validateMaterialMetadata({ allowExternal: 'false' }), /布尔/);
  assert.throws(() => validateMaterialMetadata([]), /对象/);
  assert.throws(() => validateMaterialMetadata({ assetRole: 'secret' }), /用途/);
});
test('chunking preserves Unicode boundaries and covers entire large sources', () => {
  const content = '资料😀\n'.repeat(10000), parts = chunks(content);
  assert.equal(parts[0].start, 0); assert.equal(parts.at(-1).end, content.length);
  assert.ok(parts.every((part, i) => !/[\uDC00-\uDFFF]/.test(part.content[0]) && !/[\uD800-\uDBFF]/.test(part.content.at(-1)) && (!i || part.start <= parts[i - 1].end)));
});
test('model and style choices honor explicit configuration and validate size capabilities', () => {
  const styles = [{ id: 'default', name: '科技风', parameters: { dialogDefault: true, model: 'gpt-image-2' } }, { id: 'other', name: '展会风' }];
  assert.equal(selectStyle(styles, '普通海报', 'auto').id, 'default');
  assert.equal(selectStyle(styles, '采用展会风', 'auto').id, 'other');
  assert.equal(selectStyle(styles, '科技风', 'other').id, 'other');
  assert.equal(selectModel(plan(), '使用gpt-image-2.5-sunburst', null).model, 'gpt-image-2.5-sunburst');
  assert.equal(selectModel(plan({ imageSize: '4K' }), '', null).model, 'gpt-image-2.5-flare');
  assert.throws(() => selectModel(plan({ imageSize: '4K' }), '', styles[0]), /不支持/);
  assert.throws(() => selectModel(plan(), '', null, { model: 'invented-model' }), /不可用/);
  assert.equal(normalizePlan(plan({ imageCount: 999 })).imageCount, 5);
  assert.throws(() => normalizePlan({ needsImages: 'true' }), /格式/);
});

function harness(extra = {}) {
  const records = [], calls = [], generated = [], states = [];
  let request = plan(extra.plan);
  const agent = createDialogAgent({
    invoke: async (system, input) => {
      calls.push({ system, input });
      if (system.includes('任务规划器')) return { content: JSON.stringify(request), usage: { prompt_tokens: 10, completion_tokens: 5 } };
      if (system.includes('视觉创意总监')) return { content: JSON.stringify(Array.from({ length: request.imageCount }, () => ({ prompt: 'Keep the actual R5-Curve product unchanged, simple exhibition background.' }))) };
      return { content: '根据资料，产品重量为8KG。' };
    },
    knowledge: async () => extra.items || fixtures,
    styles: async () => [{ id: 'style-default', name: '公司科技风', parameters: { dialogDefault: true, brandRules: '禁止改变产品结构', model: 'gpt-image-2.5-flare' } }],
    history: async () => records,
    previous: async () => extra.previous || null,
    saveMessage: async (id, record) => { const value = { id: `m${records.length}`, ...record }; records.push(value); return value; },
    generate: async params => { generated.push(params); if (extra.fail) throw new Error('上游结果未知，连接超时'); return { imageUrl: '/local_storage/result.png' }; },
    checkpoint: state => states.push(state),
  });
  return { agent, records, calls, generated, states, setPlan: value => { request = value; } };
}
test('agent creates a grounded task, applies brand rules, preserves sources and uses selected model', async () => {
  const h = harness();
  const result = await h.agent({ conversationId: 'c1', message: 'R5-Curve 做真实背面海报' });
  assert.equal(result.status, 'completed');
  assert.equal(result.images.length, 1);
  assert.equal(h.generated[0].model, 'gpt-image-2.5-flare');
  assert.deepEqual(h.generated[0].referenceImages, ['/uploads/knowledge/correct.png']);
  assert.ok(h.calls[1].input.includes('禁止改变产品结构'));
  assert.equal(h.records.at(-1).metadata.sources[0].id, 'curve');
  assert.equal(result.usage.prompt_tokens, 10);
});
test('missing product materials and private evidence stop before generation or external content synthesis', async () => {
  const missing = harness({ items: [] });
  assert.equal((await missing.agent({ conversationId: 'c', message: 'R5-Curve 背面海报' })).status, 'needs_input');
  assert.equal(missing.generated.length, 0); assert.equal(missing.calls.length, 1);
  const privateDoc = harness({ items: [document('secret', 'R5-Curve 秘密', '商业机密999', { productName: 'R5-Curve', allowExternal: false }), image('private', 'R5-Curve')] });
  const result = await privateDoc.agent({ conversationId: 'c', message: 'R5-Curve 产品图' });
  assert.equal(result.status, 'needs_input');
  assert.equal(privateDoc.calls.length, 1); assert.ok(!privateDoc.calls[0].input.includes('商业机密999'));
});
test('unknown upstream outcomes do not silently retry or switch models', async () => {
  const h = harness({ fail: true, plan: { imageCount: 3 } });
  const result = await h.agent({ conversationId: 'c', message: 'R5-Curve 三张图' });
  assert.equal(result.status, 'partial'); assert.equal(h.generated.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('结果未知')));
});
test('follow-up edits use an explicit previous artifact, not a different product', async () => {
  const h = harness({ plan: { editImageIndex: 2 }, previous: { plan: plan({ model: 'gpt-image-2.5-sunburst', imageSize: '2K', imageAspectRatio: '9:16' }), images: [{ imageUrl: '/local_storage/one.png' }, { imageUrl: '/local_storage/two.png' }] } });
  const result = await h.agent({ conversationId: 'c', message: '第二张背景简单一些' });
  assert.equal(result.images.length, 1); assert.equal(h.generated[0].referenceImages[0], '/local_storage/two.png');
  assert.equal(h.generated[0].model, 'gpt-image-2.5-sunburst'); assert.equal(h.generated[0].imageSize, '2K'); assert.equal(h.generated[0].aspectRatio, '9:16');
});
test('question answering synthesizes evidence and does not trigger image generation', async () => {
  const h = harness({ plan: { needsImages: false, needsText: false } });
  const result = await h.agent({ conversationId: 'c', message: 'R5-Curve 重量多少？' });
  assert.equal(result.content, '根据资料，产品重量为8KG。'); assert.equal(h.generated.length, 0);
});
test('durable runs enforce idempotency and per-conversation locking, retain checkpoints and cancellation', async t => {
  let release;
  const store = createDialogRuns({ filename: ':memory:', execute: async ({ checkpoint, signal, emit }) => {
    checkpoint({ plan: { productName: 'R5' } }); emit('status', { message: 'working' });
    await new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); });
    return { status: 'completed', content: 'ok' };
  } });
  t.after(() => store.close());
  const request = { conversationId: 'c', message: 'do it', requestId: 'request', options: {} };
  const run = store.start(request);
  assert.equal(store.start(request).id, run.id);
  assert.throws(() => store.start({ ...request, requestId: 'other' }), /正在|执行/);
  assert.throws(() => store.start({ ...request, message: 'changed' }), /标识/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(run.id).state.plan.productName, 'R5'); assert.equal(store.events(run.id).length, 1);
  release(); await store.wait(run.id); assert.equal(store.get(run.id).status, 'completed');
  const second = store.start({ ...request, requestId: 'two' });
  await new Promise(resolve => setImmediate(resolve)); store.cancel(second.id); await store.wait(second.id);
  assert.equal(store.get(second.id).status, 'cancelled');
});
test('restart retains results and marks running work interrupted without paid resubmission', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'runs.sqlite');
  let calls = 0;
  let store = createDialogRuns({ filename, execute: async () => { calls++; return { status: 'completed', images: [{ imageUrl: 'result' }], plan: { productName: 'R5' } }; } });
  const first = store.start({ conversationId: 'c', message: 'image', requestId: 'once' }); await store.wait(first.id); await store.close();
  const Database = require('better-sqlite3'), db = new Database(filename);
  db.prepare('UPDATE dialog_runs SET status=? WHERE id=?').run('running', first.id); db.close();
  store = createDialogRuns({ filename, execute: async () => { calls++; } });
  assert.equal(store.get(first.id).status, 'interrupted'); assert.equal(store.get(first.id).result.images[0].imageUrl, 'result'); assert.equal(calls, 1);
  await store.close();
});
