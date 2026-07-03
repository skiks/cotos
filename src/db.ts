import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'cotos.db');

// Ensure data dir
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS raw_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url TEXT,
    title TEXT NOT NULL,
    raw_text TEXT,
    author TEXT,
    published_at TEXT,
    collected_at TEXT DEFAULT (datetime('now')),
    hash TEXT UNIQUE,
    status TEXT DEFAULT 'new'
  );

  CREATE TABLE IF NOT EXISTS processed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_item_id INTEGER UNIQUE REFERENCES raw_items(id),
    summary TEXT,
    category TEXT,
    tags TEXT,
    novelty_score REAL,
    practical_score REAL,
    wow_score REAL,
    money_score REAL,
    credibility_score REAL,
    total_score REAL,
    recommendation TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    processed_item_id INTEGER REFERENCES processed_items(id),
    telegram_message_id INTEGER,
    post_type TEXT,
    title TEXT,
    body TEXT,
    source_links TEXT,
    status TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    posted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS post_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER REFERENCES posts(id),
    url_hash TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export default db;
