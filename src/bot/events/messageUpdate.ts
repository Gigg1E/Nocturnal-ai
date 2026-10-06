import { Message, PartialMessage } from 'discord.js';
import { isCasualChatChannel } from '../../config/guildConfig';
import { attachLatePreviews } from '../../services/casualChat';
import { messagePreviews } from './messageCreate';

// Discord adds link previews (Tenor/GIPHY/Klipy GIFs, pasted image links,
// YouTube titles) to a message shortly after it's sent, as an update.
// Answer Machine channels pick those up so the bot can see a GIF someone
// posted as a link, or what a YouTube link is.
export async function handleMessageUpdate(
  _old: Message | PartialMessage,
  updated: Message | PartialMessage
): Promise<void> {
  if (!updated.guildId || updated.author?.bot) return;
  if (!isCasualChatChannel(updated.guildId, updated.channelId)) return;
  if (!updated.embeds.length) return;
  const { images, links } = messagePreviews(updated as Message);
  attachLatePreviews(updated.channelId, updated.id, images, links);
}
