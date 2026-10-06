// Pure post-processing of Answer Machine replies (no Discord/Ollama imports,
// testable from dist/).

// The bot never posts links of its own: a model can be talked into
// repeating a user's (possibly malicious) URL or invite. The only links it
// sends are GIF links built by code from Klipy search results, sent
// separately. Masked links keep their text, bare URLs/invites are dropped.
const MASKED_LINK = /\[([^\]]*)\]\(\s*<?[^)\s]+>?\s*\)/g;
const URLISH = /<?\b(?:https?:\/\/|www\.)\S+>?|\b(?:discord(?:app)?\.(?:gg|com\/invite)|dsc\.gg)\/\S+/gi;

export function scrubLinks(text: string): string {
  return text
    .replace(MASKED_LINK, '$1')
    .replace(URLISH, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// The model sometimes echoes the transcript format at the start of its
// reply ("[you] (just now): ...", "[Rixo] ↩: ..."). Strip one leading
// bracketed speaker tag plus any ↩/→ marker and time.
export function stripSpeakerPrefix(text: string): string {
  return text.replace(/^\s*\[[^\]\n]{1,60}\]\s*(?:\([^)\n]{1,20}\)\s*)?(?:[↩→][^:\n]{0,60})?:\s*/, '').trim();
}

// The reply model asks for a GIF or one of the server's stickers with a tag
// like [gif: side eye] or [sticker: kekw]. First of each kind wins; every
// tag is stripped from the text either way.
const MEDIA_TAG = /\[(gif|sticker)\s*:\s*([^\]\n]{1,60})\]/gi;

export function extractMediaTags(text: string): { text: string; gif?: string; sticker?: string } {
  let gif: string | undefined;
  let sticker: string | undefined;
  const stripped = text.replace(MEDIA_TAG, (_m, kind: string, arg: string) => {
    const v = arg.trim();
    if (kind.toLowerCase() === 'gif') gif ??= v;
    else sticker ??= v;
    return '';
  });
  return { text: stripped.replace(/[ \t]{2,}/g, ' ').trim(), gif, sticker };
}

// :name: -> <:name:id> for this server's custom emojis (case-insensitive),
// leaving anything unknown as plain text.
export function resolveCustomEmojis(text: string, emojis: Map<string, string>): string {
  if (!emojis.size) return text;
  return text.replace(/(?<!<a?):([\w~]{2,32}):(?!\d)/g, (m, name: string) => emojis.get(name.toLowerCase()) ?? m);
}

// Reply as a Discord reply only when the message being answered has been
// buried: at least this many messages came after it. An immediate answer to
// the line just above is a plain message, like a regular chatter would do.
export const THREAD_REPLY_GAP = 3;

export function shouldThreadReply(messagesAfterTarget: number): boolean {
  return messagesAfterTarget >= THREAD_REPLY_GAP;
}
