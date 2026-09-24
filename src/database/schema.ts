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

function initializeSchema(): void {
  const database = db;

  // Rate limits table - standalone, no foreign keys
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id TEXT PRIMARY KEY,
      last_request DATETIME,
      requests_this_minute INTEGER DEFAULT 0,
      requests_this_hour INTEGER DEFAULT 0,
      minute_reset DATETIME,
      hour_reset DATETIME
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
  last_request: string | null;
  requests_this_minute: number;
  requests_this_hour: number;
  minute_reset: string | null;
  hour_reset: string | null;
}
