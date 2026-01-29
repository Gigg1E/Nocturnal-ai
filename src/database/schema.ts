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

  // Users table - tracks users and their settings
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      active_chat_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chats table - stores user chats (up to 5 per user)
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Messages table - stores chat messages
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      has_image INTEGER DEFAULT 0,
      image_url TEXT,
      discord_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )
  `);

  // Rate limits table - tracks user request rates
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id TEXT PRIMARY KEY,
      last_request DATETIME,
      requests_this_minute INTEGER DEFAULT 0,
      requests_this_hour INTEGER DEFAULT 0,
      minute_reset DATETIME,
      hour_reset DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Bot stats table - tracks usage statistics
  database.exec(`
    CREATE TABLE IF NOT EXISTS bot_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stat_type TEXT NOT NULL,
      stat_value INTEGER DEFAULT 0,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for better query performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_message_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  `);

  logger.info('Database schema initialized');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info('Database connection closed');
  }
}

// Export types for use elsewhere
export interface User {
  id: string;
  username: string;
  active_chat_id: string | null;
  created_at: string;
  last_active: string;
}

export interface Chat {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  last_message_at: string;
}

export interface Message {
  id: number;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  has_image: number;
  image_url: string | null;
  discord_message_id: string | null;
  created_at: string;
}

export interface RateLimit {
  user_id: string;
  last_request: string | null;
  requests_this_minute: number;
  requests_this_hour: number;
  minute_reset: string | null;
  hour_reset: string | null;
}
