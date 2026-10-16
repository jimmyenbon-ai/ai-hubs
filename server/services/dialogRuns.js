const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const TERMINAL = new Set(['completed', 'partial', 'needs_input', 'failed', 'cancelled', 'interrupted']);

function createDialogRuns({ filename = path.join(__dirname, '../cache/ai_dialog_runs.sqlite'), execute }) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS dialog_runs (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
    error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dialog_runs_conversation ON dialog_runs(conversation_id,created_at);
  CREATE TABLE IF NOT EXISTS dialog_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,event TEXT NOT NULL,data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS dialog_events_run ON dialog_events(run_id,seq);`);
  db.prepare("UPDATE dialog_runs SET status='interrupted',error='服务已重启，任务未自动重发。请核对已有结果后发起新任务。' WHERE status IN ('queued','running')").run();
  const active = new Map();
  const select = db.prepare('SELECT * FROM dialog_runs WHERE id=?');
  const decode = row => row ? { ...row, input: JSON.parse(row.input), state: JSON.parse(row.state), result: row.result ? JSON.parse(row.result) : null } : null;
  const get = id => decode(select.get(id));
  const update = (id, patch) => {
    const run = get(id);
    if (!run) return;
    const next = { ...run, ...patch };
    db.prepare('UPDATE dialog_runs SET status=?,state=?,result=?,error=?,updated_at=? WHERE id=?').run(next.status, JSON.stringify(next.state), next.result ? JSON.stringify(next.result) : null, next.error, new Date().toISOString(), id);
  };
  const emit = (id, event, data) => db.prepare('INSERT INTO dialog_events(run_id,event,data) VALUES (?,?,?)').run(id, event, JSON.stringify(data));
  return {
    get,
    byRequest(id) { return decode(db.prepare('SELECT * FROM dialog_runs WHERE request_id=?').get(id)); },
    events(id, after = 0) { return db.prepare('SELECT seq,event,data FROM dialog_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200').all(id, after).map(row => ({ ...row, data: JSON.parse(row.data) })); },
    latest(conversationId) { return decode(db.prepare('SELECT * FROM dialog_runs WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1').get(conversationId)); },
    previous(conversationId) {
      const row = db.prepare("SELECT * FROM dialog_runs WHERE conversation_id=? AND status IN ('completed','partial') AND result IS NOT NULL AND json_extract(result,'$.images[0].imageUrl') IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(conversationId);
      return row ? JSON.parse(row.result) : null;
    },
    isBusy(conversationId) { return active.has(conversationId); },
    start({ conversationId, message, requestId, options = {} }) {
      const existing = decode(db.prepare('SELECT * FROM dialog_runs WHERE request_id=?').get(requestId));
      if (existing) {
        if (existing.conversation_id !== conversationId || existing.input.message !== message || JSON.stringify(existing.input.options) !== JSON.stringify(options)) throw Object.assign(new Error('请求标识已用于其他任务'), { status: 409 });
        return existing;
      }
      if (active.has(conversationId)) throw Object.assign(new Error('本对话已有任务在执行，请等待或停止后再发送'), { status: 409 });
      const id = randomUUID(), time = new Date().toISOString(), controller = new AbortController();
      db.prepare('INSERT INTO dialog_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, conversationId, requestId, 'queued', JSON.stringify({ message, options }), '{}', null, '', time, time);
      active.set(conversationId, { id, controller });
      const work = Promise.resolve().then(async () => {
        update(id, { status: 'running' });
        try {
          const result = await execute({ conversationId, message, options, signal: controller.signal,
            emit: (event, data) => { if (!controller.signal.aborted) emit(id, event, data); },
            checkpoint: patch => { const run = get(id); update(id, { state: { ...run.state, ...patch } }); },
          });
          const status = controller.signal.aborted ? 'cancelled' : result.status || 'completed';
          update(id, { status, result });
          emit(id, 'done', { ...result, status, conversationId, runId: id });
        } catch (error) {
          const status = controller.signal.aborted ? 'cancelled' : 'failed';
          update(id, { status, error: error.message });
          emit(id, 'error', { message: error.message, status, runId: id });
        } finally { active.delete(conversationId); }
      });
      active.get(conversationId).work = work;
      return get(id);
    },
    cancel(id) {
      const run = get(id);
      const running = run && active.get(run.conversation_id);
      if (running?.id === id) running.controller.abort();
      return get(id);
    },
    async wait(id) { const run = get(id); await active.get(run?.conversation_id)?.work; return get(id); },
    async close() { for (const task of active.values()) task.controller.abort(); await Promise.all([...active.values()].map(task => task.work)); db.close(); },
    terminal: status => TERMINAL.has(status),
  };
}

module.exports = { createDialogRuns };
