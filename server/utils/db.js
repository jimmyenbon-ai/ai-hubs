// SQLite 数据库初始化
// 零依赖轻量迁移：用 sqlite3 替代 JSON 文件持久化
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'cache', 'aihubs.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[db] Failed to open database:', err.message);
  } else {
    console.log('[db] SQLite database opened:', DB_PATH);
  }
});

// 初始化表结构
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS image_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_prompt TEXT,
  api_prompt TEXT,
  aspect_ratio TEXT,
  image_size TEXT,
  result_image_url TEXT,
  reference_images TEXT,
  api_provider TEXT,
  model_name TEXT,
  user_id INTEGER,
  points_cost INTEGER,
  template_id INTEGER,
  template_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS music_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT,
  title TEXT,
  make_instrumental INTEGER DEFAULT 0,
  gpt_description_prompt TEXT,
  prompt TEXT,
  tags TEXT,
  negative_tags TEXT,
  task TEXT,
  continue_clip_id TEXT,
  continue_at REAL,
  cover_clip_id TEXT,
  metadata TEXT,
  task_ids TEXT,
  audio_url TEXT,
  audio_urls TEXT,
  user_id INTEGER,
  points_cost INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS video_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  model TEXT,
  mode TEXT,
  prompt TEXT,
  first_frame_image TEXT,
  last_frame_image TEXT,
  reference_images TEXT,
  reference_video TEXT,
  reference_audio TEXT,
  resolution TEXT,
  ratio TEXT,
  duration INTEGER,
  seed INTEGER,
  generate_audio INTEGER DEFAULT 1,
  watermark INTEGER DEFAULT 0,
  status TEXT,
  video_url TEXT,
  last_frame_url TEXT,
  user_id INTEGER,
  points_cost INTEGER,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_image_history_created ON image_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_history_created ON music_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_history_created ON video_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_history_template ON image_history(template_id);
`;

// 初始化
db.exec(INIT_SQL, (err) => {
  if (err) console.error('[db] Table init error:', err.message);
  else console.log('[db] Database tables ready');
});

module.exports = db;
