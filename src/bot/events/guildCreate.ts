import { Guild } from 'discord.js';
import { logger } from '../../utils/logger';
import { isAllowed } from '../../utils/guildAllowlist';

export async function handleGuildCreate(guild: Guild): Promise<void> {
  if (isAllowed(guild.id)) {
    logger.info(`Joined approved guild: ${guild.name} (${guild.id})`);
    return;
  }

  logger.warn(`Joined UNAPPROVED guild "${guild.name}" (${guild.id}) — leaving. Add it via scripts/manage-guilds.js if this was intentional.`);
  try {
    await guild.leave();
  } catch (error) {
    logger.error(`Failed to leave unapproved guild ${guild.id}:`, error);
  }
}
