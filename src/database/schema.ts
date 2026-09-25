import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'net.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

// Adds `guild_id TEXT` to a table if it's missing, backfilling existing rows
// with DISCORD_SERVER_ID (the only guild this data could have come from
// before multi-server support existed). Idempotent.
function ensureGuildIdColumn(database: Database.Database, table: string): void {
  const cols = (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (cols.includes('guild_id')) return;

  database.exec(`ALTER TABLE ${table} ADD COLUMN guild_id TEXT`);
  const legacyGuildId = process.env.DISCORD_SERVER_ID || null;
  if (legacyGuildId) {
    database.prepare(`UPDATE ${table} SET guild_id = ? WHERE guild_id IS NULL`).run(legacyGuildId);
  }
  logger.info(`Migrated ${table}: added guild_id column (backfilled with ${legacyGuildId ?? 'nothing — DISCORD_SERVER_ID unset'})`);
}

function initializeSchema(): void {
  const database = db;

  // v2: rate limits keyed by (user_id, guild_id) instead of user_id alone, so
  // limits don't bleed across servers. Named _v2 (rather than migrating the
  // old table's single-column PK in place, which SQLite can't do without a
  // full rebuild) since this is just ephemeral per-minute/hour counters —
  // losing the old table's in-flight window on upgrade is harmless.
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits_v2 (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      last_request DATETIME,
      requests_this_minute INTEGER DEFAULT 0,
      requests_this_hour INTEGER DEFAULT 0,
      minute_reset DATETIME,
      hour_reset DATETIME,
      PRIMARY KEY (user_id, guild_id)
    )
  `);

  // Simple usage tracking
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_stats_created_at ON usage_stats(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_stats_user_id ON usage_stats(user_id);
  `);

  ensureGuildIdColumn(database, 'usage_stats');
  database.exec(`CREATE INDEX IF NOT EXISTS idx_usage_stats_guild_id ON usage_stats(guild_id)`);

  // Per-user (not per-guild) — personality/memory follow the person across
  // every server and, eventually, the website, since it's about who they
  // are rather than which server they're talking in.
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_personality (
      user_id TEXT PRIMARY KEY,
      personality TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Capped at 10 facts/user (enforced in code, not here) — a simple
  // LRU-by-mention cache: touching a fact moves it to slot 1, and whatever
  // falls off the end past slot 10 is dropped.
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT NOT NULL,
      slot INTEGER NOT NULL,
      fact TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, slot)
    )
  `);

  // User-authored (not auto-extracted like user_memory), so no slot/eviction
  // machinery needed -- one JSON array of {topic, value} pairs per user,
  // replaced wholesale on /personality preferences set. Structured rather
  // than a free blob so it can be validated on input, formatted as a clean
  // list rather than a run-on sentence, and (later) filtered per-item for
  // relevance instead of always injecting the whole thing.
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  logger.info('Database schema initialized');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info('Database connection closed');
  }
}

export interface RateLimit {
  user_id: string;
  guild_id: string;
  last_request: string | null;
  requests_this_minute: number;
  requests_this_hour: number;
  minute_reset: string | null;
  hour_reset: string | null;
}
