import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const dbPath = path.join(config.dataDir, 'glaneur.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE TABLE feeds (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    site_url TEXT NOT NULL DEFAULT '',
    icon_url TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL,
    source TEXT NOT NULL,
    options TEXT NOT NULL,
    recipe TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_fetch_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT,
    error_count INTEGER NOT NULL DEFAULT 0,
    next_fetch_at INTEGER
  );
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    content TEXT,
    summary TEXT,
    image TEXT,
    author TEXT,
    published_at INTEGER,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    full_content TEXT,
    full_status TEXT,
    UNIQUE (feed_id, guid)
  );
  CREATE INDEX idx_items_feed_seen ON items (feed_id, first_seen_at DESC);
  CREATE TABLE fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    found INTEGER NOT NULL DEFAULT 0,
    kept INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    trigger TEXT NOT NULL DEFAULT 'schedule'
  );
  CREATE INDEX idx_fetch_log_feed ON fetch_log (feed_id, started_at DESC);
  `,
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

migrate();

const statements = new Map<string, StatementSync>();

function prepare(sql: string): StatementSync {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function dbSize(): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(dbPath + suffix).size;
    } catch {
      // file may not exist
    }
  }
  return total;
}
