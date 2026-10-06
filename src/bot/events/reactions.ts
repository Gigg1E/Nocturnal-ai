import { MessageReaction, PartialMessageReaction, User, PartialUser, Message, PartialMessage } from 'discord.js';
import { isCasualChatChannel } from '../../config/guildConfig';
import { recordReaction, forgetMessage } from '../../services/casualChat';

// Answer Machine channels only. Reactions are recorded as background
// context on the line they belong to; they never trigger the bot to speak.
async function onReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean
): Promise<void> {
  const msg = reaction.message;
  if (!msg.guildId || !isCasualChatChannel(msg.guildId, msg.channelId)) return;
  const botId = msg.client.user?.id;
  const who = user.id === botId
    ? 'you'
    : msg.guild?.members.cache.get(user.id)?.displayName ?? user.username ?? 'someone';
  // Custom emoji as :name: (what the model can read); unicode as itself.
  const emoji = reaction.emoji.id ? `:${reaction.emoji.name ?? 'emoji'}:` : reaction.emoji.name;
  if (!emoji) return;
  recordReaction(msg.channelId, msg.id, emoji, who, added);
}

export function handleReactionAdd(r: MessageReaction | PartialMessageReaction, u: User | PartialUser): Promise<void> {
  return onReaction(r, u, true);
}

export function handleReactionRemove(r: MessageReaction | PartialMessageReaction, u: User | PartialUser): Promise<void> {
  return onReaction(r, u, false);
}

export async function handleMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guildId || !isCasualChatChannel(message.guildId, message.channelId)) return;
  forgetMessage(message.channelId, message.id);
}
