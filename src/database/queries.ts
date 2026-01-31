import { getDatabase, RateLimit } from './schema';
import { getConfig } from '../config';

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

  const rateLimit = getRateLimit(userId);

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

// ==================== SIMPLE STATS ====================

export function trackUsage(userId: string, action: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO usage_stats (user_id, action) VALUES (?, ?)
  `).run(userId, action);
}

export function getStats(): Record<string, number> {
  const db = getDatabase();
  const stats: Record<string, number> = {};

  // Total unique users
  const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM usage_stats').get() as { count: number };
  stats.totalUsers = uniqueUsers.count;

  // Total requests
  const totalRequests = db.prepare('SELECT COUNT(*) as count FROM usage_stats').get() as { count: number };
  stats.totalRequests = totalRequests.count;

  // Requests today
  const todayRequests = db.prepare(`
    SELECT COUNT(*) as count FROM usage_stats
    WHERE date(created_at) = date('now')
  `).get() as { count: number };
  stats.requestsToday = todayRequests.count;

  // Active users today
  const activeToday = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM usage_stats
    WHERE date(created_at) = date('now')
  `).get() as { count: number };
  stats.activeUsersToday = activeToday.count;

  return stats;
}
