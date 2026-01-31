import 'dotenv/config';
import { logger } from './utils/logger';
import { loadConfig } from './config';
import { getDatabase, closeDatabase } from './database/schema';
import { startBot } from './bot/client';
import { checkOllamaConnection } from './ollama/client';
import { checkToolsApiConnection } from './ollama/tools';
import { checkExtractorModel } from './ollama/extractor';
import { closeBrowser } from './services/mermaid';

async function main(): Promise<void> {
  logger.info('Starting NET.ai...');

  // Load configuration
  try {
    loadConfig();
    logger.info('Configuration loaded');
  } catch (error) {
    logger.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Initialize database
  try {
    getDatabase();
    logger.info('Database initialized');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // Check Ollama connection
  const ollamaConnected = await checkOllamaConnection();
  if (ollamaConnected) {
    logger.info('Ollama connection verified');

    // Check if extractor model is available
    const extractorAvailable = await checkExtractorModel();
    if (extractorAvailable) {
      logger.info('Entity extractor model (qwen2.5:1.5b) available');
    } else {
      logger.warn('Entity extractor model (qwen2.5:1.5b) not found. Run: ollama pull qwen2.5:1.5b');
    }
  } else {
    logger.warn('Ollama is not accessible. AI features will fail until Ollama is running.');
  }

  // Check Tools API connection
  const toolsConnected = await checkToolsApiConnection();
  if (toolsConnected) {
    logger.info('Tools API connection verified');
  } else {
    logger.warn('Tools API is not accessible. External data features will be unavailable.');
  }

  // Start Discord bot
  try {
    const client = await startBot();
    logger.info('Discord bot started successfully');

    // Set up graceful shutdown
    setupShutdown(client);
  } catch (error) {
    logger.error('Failed to start Discord bot:', error);
    process.exit(1);
  }
}

function setupShutdown(client: any): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    try {
      // Destroy Discord client
      client.destroy();
      logger.info('Discord client disconnected');

      // Close database
      closeDatabase();
      logger.info('Database connection closed');

      // Close Playwright browser
      await closeBrowser();
      logger.info('Browser closed');

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  });
}

// Start the application
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
