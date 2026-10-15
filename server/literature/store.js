const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'author', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT '', premise TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '', model_config_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'confirmed', locked INTEGER NOT NULL DEFAULT 0,
  reveal_chapter INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_book ON entries(book_id, kind, reveal_chapter);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, title TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1, accepted_revision INTEGER,
  needs_review INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  UNIQUE(book_id, ordinal)
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, content TEXT NOT NULL, plan TEXT NOT NULL, title TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(chapter_id, revision)
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, source_revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL, entity_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
  value TEXT NOT NULL, quote TEXT NOT NULL, known_by TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL DEFAULT 'state',
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS facts_book_time ON facts(book_id, status, ordinal);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE, type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued',
  book_revision INTEGER NOT NULL, chapter_revision INTEGER,
  input TEXT NOT NULL DEFAULT '{}', context TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_book_time ON jobs(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_chapter_source ON jobs(chapter_id,status,type,chapter_revision);
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS literature_imports (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL, source_text TEXT NOT NULL, source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview', chunk_size INTEGER NOT NULL DEFAULT 6000,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(book_id,request_id)
);
CREATE TABLE IF NOT EXISTS import_chapters (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES literature_imports(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, volume TEXT NOT NULL DEFAULT '',
  source_start INTEGER NOT NULL, source_end INTEGER NOT NULL, partial INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT 'new', chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS chapter_sources (
  chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES literature_imports(id) ON DELETE CASCADE,
  staged_id TEXT NOT NULL REFERENCES import_chapters(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL, source_hash TEXT NOT NULL, confirmed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS import_units (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES literature_imports(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, source_revision INTEGER NOT NULL,
  position INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
  content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(import_id,chapter_id,source_revision,position)
);
CREATE INDEX IF NOT EXISTS import_units_queue ON import_units(import_id,status,chapter_id,position);
CREATE INDEX IF NOT EXISTS import_units_chapter ON import_units(chapter_id,source_revision,status);
CREATE TABLE IF NOT EXISTS import_evidence (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES import_units(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, source_revision INTEGER NOT NULL,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE, fact_id TEXT REFERENCES facts(id) ON DELETE CASCADE,
  quote TEXT NOT NULL, source_offset INTEGER NOT NULL, visibility TEXT NOT NULL,
  known_by TEXT NOT NULL DEFAULT '[]', chronology TEXT NOT NULL DEFAULT 'current', story_time TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS import_evidence_book ON import_evidence(book_id,chapter_id);
CREATE TABLE IF NOT EXISTS takeovers (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  cutoff_id TEXT REFERENCES chapters(id) ON DELETE CASCADE, cutoff_ordinal INTEGER NOT NULL,
  target_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, status TEXT NOT NULL,
  manifest TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

function createStore(filename = process.env.LITERATURE_DB_PATH || path.join(__dirname, '..', 'cache', 'literature.sqlite')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new sqlite3.Database(filename);
  db.configure('busyTimeout', 5000);
  const sql = {
    get: (query, args = []) => new Promise((resolve, reject) => db.get(query, args, (err, row) => err ? reject(err) : resolve(row))),
    all: (query, args = []) => new Promise((resolve, reject) => db.all(query, args, (err, rows) => err ? reject(err) : resolve(rows))),
    run: (query, args = []) => new Promise((resolve, reject) => db.run(query, args, function (err) { err ? reject(err) : resolve({ changes: this.changes }); })),
  };
  const ready = new Promise((resolve, reject) => db.exec(SCHEMA, err => err ? reject(err) : resolve())).then(async () => {
    const columns = await sql.all('PRAGMA table_info(entries)');
    if (!columns.some(column => column.name === 'parent_id')) await sql.run('ALTER TABLE entries ADD COLUMN parent_id TEXT REFERENCES entries(id) ON DELETE SET NULL');
    await sql.run('CREATE INDEX IF NOT EXISTS entries_parent ON entries(book_id,parent_id)');
  });
  let queue = Promise.resolve();
  function serial(fn) {
    const next = queue.then(async () => { await ready; return fn(sql); });
    queue = next.catch(() => {});
    return next;
  }
  return {
    ready,
    read: serial,
    write: fn => serial(async connection => {
      await connection.run('BEGIN IMMEDIATE');
      try {
        const result = await fn(connection);
        await connection.run('COMMIT');
        return result;
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      }
    }),
    close: () => serial(() => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()))),
  };
}
module.exports = { createStore };
