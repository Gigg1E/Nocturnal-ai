import { Message, PartialMessage } from 'discord.js';
import { isCasualChatChannel } from '../../config/guildConfig';
import { attachLateImages } from '../../services/casualChat';
import { messageImageUrls } from './messageCreate';

// Discord adds link previews (Tenor/GIPHY GIFs, pasted image links) to a
// message shortly after it's sent, as an update. Answer Machine channels
// pick those images up so the bot can see a GIF someone posted as a link.
export async function handleMessageUpdate(
  _old: Message | PartialMessage,
  updated: Message | PartialMessage
): Promise<void> {
  if (!updated.guildId || updated.author?.bot) return;
  if (!isCasualChatChannel(updated.guildId, updated.channelId)) return;
  if (!updated.embeds.length) return;
  attachLateImages(updated.channelId, updated.id, messageImageUrls(updated as Message));
}
