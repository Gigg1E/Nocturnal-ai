import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

export const logger = winston.createLogger({
  level: 'info',
  format: customFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Error log file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Specialized loggers for different concerns
export function logConfigChange(key: string, oldValue: unknown, newValue: unknown, userId: string): void {
  logger.info('Config changed', {
    key,
    oldValue,
    newValue,
    changedBy: userId,
  });
}

export function logBotUsage(userId: string, action: string, details?: Record<string, unknown>): void {
  logger.info('Bot usage', {
    userId,
    action,
    ...details,
  });
}

export function logToolCall(tool: string, input: unknown, success: boolean, duration?: number): void {
  logger.info('Tool call', {
    tool,
    input,
    success,
    durationMs: duration,
  });
}

export function logError(error: Error, context?: string): void {
  logger.error(context || 'Error occurred', {
    message: error.message,
    stack: error.stack,
  });
}

export function logRateLimit(userId: string, action: string): void {
  logger.warn('Rate limit triggered', {
    userId,
    action,
  });
}

export function logChat(userId: string, chatId: string, action: 'message' | 'create' | 'delete' | 'switch' | 'clear'): void {
  logger.info('Chat activity', {
    userId,
    chatId,
    action,
  });
}
