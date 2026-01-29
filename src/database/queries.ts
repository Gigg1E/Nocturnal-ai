import { getDatabase, User, Chat, Message, RateLimit } from './schema';
import { getConfig } from '../config';
import { logger, logChat } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// ==================== USER OPERATIONS ====================

export function getOrCreateUser(userId: string, username: string): User {
  const db = getDatabase();

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;

  if (!user) {
    db.prepare(`
      INSERT INTO users (id, username) VALUES (?, ?)
    `).run(userId, username);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;

    // Create default chat for new user
    createChat(userId, 'General');
    logger.info(`New user created: ${username} (${userId})`);
  } else {
    // Update last active and username if changed
    db.prepare(`
      UPDATE users SET last_active = CURRENT_TIMESTAMP, username = ? WHERE id = ?
    `).run(username, userId);
  }

  return user;
}

export function getUser(userId: string): User | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
}

export function setActiveChat(userId: string, chatId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE users SET active_chat_id = ? WHERE id = ?').run(chatId, userId);
  logChat(userId, chatId, 'switch');
}

// ==================== CHAT OPERATIONS ====================

export function createChat(userId: string, name: string): Chat | null {
  const db = getDatabase();
  const config = getConfig();

  // Check chat limit
  const chatCount = db.prepare('SELECT COUNT(*) as count FROM chats WHERE user_id = ?').get(userId) as { count: number };

  if (chatCount.count >= config.bot.maxChatsPerUser) {
    return null;
  }

  const chatId = uuidv4();

  db.prepare(`
    INSERT INTO chats (id, user_id, name) VALUES (?, ?, ?)
  `).run(chatId, userId, name);

  // Set as active chat
  setActiveChat(userId, chatId);

  logChat(userId, chatId, 'create');

  return db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as Chat;
}

export function getUserChats(userId: string): Chat[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM chats WHERE user_id = ? ORDER BY last_message_at DESC
  `).all(userId) as Chat[];
}

export function getChat(chatId: string): Chat | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as Chat | undefined;
}

export function getActiveChat(userId: string): Chat | undefined {
  const db = getDatabase();
  const user = getUser(userId);

  if (!user?.active_chat_id) {
    // Get most recent chat or create one
    const chats = getUserChats(userId);
    if (chats.length > 0) {
      setActiveChat(userId, chats[0].id);
      return chats[0];
    }
    return undefined;
  }

  return getChat(user.active_chat_id);
}

export function deleteChat(chatId: string, userId: string): boolean {
  const db = getDatabase();

  // Verify ownership
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, userId) as Chat | undefined;

  if (!chat) {
    return false;
  }

  // Delete messages first (cascade should handle this, but being explicit)
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);

  // If this was active chat, switch to another
  const user = getUser(userId);
  if (user?.active_chat_id === chatId) {
    const remainingChats = getUserChats(userId);
    if (remainingChats.length > 0) {
      setActiveChat(userId, remainingChats[0].id);
    } else {
      db.prepare('UPDATE users SET active_chat_id = NULL WHERE id = ?').run(userId);
    }
  }

  logChat(userId, chatId, 'delete');
  return true;
}

export function clearChat(chatId: string, userId: string): boolean {
  const db = getDatabase();

  // Verify ownership
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, userId) as Chat | undefined;

  if (!chat) {
    return false;
  }

  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
  logChat(userId, chatId, 'clear');
  return true;
}

export function renameChat(chatId: string, userId: string, newName: string): boolean {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE chats SET name = ? WHERE id = ? AND user_id = ?
  `).run(newName, chatId, userId);

  return result.changes > 0;
}

// ==================== MESSAGE OPERATIONS ====================

export function addMessage(
  chatId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  options?: {
    hasImage?: boolean;
    imageUrl?: string;
    discordMessageId?: string;
  }
): Message {
  const db = getDatabase();

  const result = db.prepare(`
    INSERT INTO messages (chat_id, role, content, has_image, image_url, discord_message_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    chatId,
    role,
    content,
    options?.hasImage ? 1 : 0,
    options?.imageUrl || null,
    options?.discordMessageId || null
  );

  // Update chat's last_message_at
  db.prepare('UPDATE chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as Message;
}

export function getChatMessages(chatId: string, limit: number = 50): Message[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(chatId, limit) as Message[];
}

export function getRecentMessages(chatId: string, count: number = 10): Message[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(chatId, count).reverse() as Message[];
}

export function getMessageByDiscordId(discordMessageId: string): Message | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM messages WHERE discord_message_id = ?
  `).get(discordMessageId) as Message | undefined;
}

export function getMessageContext(discordMessageId: string, contextCount: number = 5): Message[] {
  const db = getDatabase();

  // Find the message
  const targetMessage = getMessageByDiscordId(discordMessageId);
  if (!targetMessage) {
    return [];
  }

  // Get surrounding messages from the same chat
  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE chat_id = ? AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `).all(targetMessage.chat_id, targetMessage.created_at, contextCount) as Message[];
}

// ==================== RATE LIMIT OPERATIONS ====================

export function getRateLimit(userId: string): RateLimit {
  const db = getDatabase();

  let rateLimit = db.prepare('SELECT * FROM rate_limits WHERE user_id = ?').get(userId) as RateLimit | undefined;

  if (!rateLimit) {
    db.prepare(`
      INSERT INTO rate_limits (user_id, minute_reset, hour_reset)
      VALUES (?, datetime('now'), datetime('now'))
    `).run(userId);
    rateLimit = db.prepare('SELECT * FROM rate_limits WHERE user_id = ?').get(userId) as RateLimit;
  }

  return rateLimit;
}

export function updateRateLimit(userId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  let rateLimit = getRateLimit(userId);

  // Check if minute needs reset
  const minuteReset = rateLimit.minute_reset ? new Date(rateLimit.minute_reset) : new Date();
  const hourReset = rateLimit.hour_reset ? new Date(rateLimit.hour_reset) : new Date();
  const nowDate = new Date();

  let newMinuteCount = rateLimit.requests_this_minute;
  let newHourCount = rateLimit.requests_this_hour;
  let newMinuteReset = rateLimit.minute_reset;
  let newHourReset = rateLimit.hour_reset;

  // Reset minute counter if a minute has passed
  if (nowDate.getTime() - minuteReset.getTime() > 60000) {
    newMinuteCount = 0;
    newMinuteReset = now;
  }

  // Reset hour counter if an hour has passed
  if (nowDate.getTime() - hourReset.getTime() > 3600000) {
    newHourCount = 0;
    newHourReset = now;
  }

  db.prepare(`
    UPDATE rate_limits
    SET last_request = ?,
        requests_this_minute = ?,
        requests_this_hour = ?,
        minute_reset = ?,
        hour_reset = ?
    WHERE user_id = ?
  `).run(now, newMinuteCount + 1, newHourCount + 1, newMinuteReset, newHourReset, userId);
}

export function checkRateLimit(userId: string): { allowed: boolean; reason?: string; cooldownRemaining?: number } {
  const config = getConfig();
  const rateLimit = getRateLimit(userId);
  const now = new Date();

  // Check cooldown
  if (rateLimit.last_request) {
    const lastRequest = new Date(rateLimit.last_request);
    const timeSinceLastRequest = now.getTime() - lastRequest.getTime();

    if (timeSinceLastRequest < config.rateLimit.cooldownMs) {
      return {
        allowed: false,
        reason: 'cooldown',
        cooldownRemaining: Math.ceil((config.rateLimit.cooldownMs - timeSinceLastRequest) / 1000)
      };
    }
  }

  // Check minute rate
  const minuteReset = rateLimit.minute_reset ? new Date(rateLimit.minute_reset) : new Date();
  if (now.getTime() - minuteReset.getTime() <= 60000) {
    if (rateLimit.requests_this_minute >= config.rateLimit.maxRequestsPerMinute) {
      return {
        allowed: false,
        reason: 'minute_limit'
      };
    }
  }

  // Check hour rate
  const hourReset = rateLimit.hour_reset ? new Date(rateLimit.hour_reset) : new Date();
  if (now.getTime() - hourReset.getTime() <= 3600000) {
    if (rateLimit.requests_this_hour >= config.rateLimit.maxRequestsPerHour) {
      return {
        allowed: false,
        reason: 'hour_limit'
      };
    }
  }

  return { allowed: true };
}

// ==================== STATS OPERATIONS ====================

export function incrementStat(statType: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO bot_stats (stat_type, stat_value) VALUES (?, 1)
  `).run(statType);
}

export function getStats(): Record<string, number> {
  const db = getDatabase();
  const stats: Record<string, number> = {};

  // Total users
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  stats.totalUsers = userCount.count;

  // Total chats
  const chatCount = db.prepare('SELECT COUNT(*) as count FROM chats').get() as { count: number };
  stats.totalChats = chatCount.count;

  // Total messages
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
  stats.totalMessages = messageCount.count;

  // Messages today
  const todayMessages = db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE date(created_at) = date('now')
  `).get() as { count: number };
  stats.messagesToday = todayMessages.count;

  // Active users today
  const activeToday = db.prepare(`
    SELECT COUNT(*) as count FROM users
    WHERE date(last_active) = date('now')
  `).get() as { count: number };
  stats.activeUsersToday = activeToday.count;

  return stats;
}
