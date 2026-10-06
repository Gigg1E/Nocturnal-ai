import { logger } from '../utils/logger';

// Klipy GIF search (the provider Discord's own GIF picker links to). The
// key lives in .env as KLIPY_API_KEY. Response shape (checked against the
// live API): { result, data: { data: [ { id, slug, title, type: 'gif',
// file: { hd|md|sm|xs: { gif|webp|jpg|mp4|webm: { url, width, height,
// size } } } } ], current_page, per_page, has_next } }.

export interface KlipyGif {
  slug: string;
  title: string;
  // Posted in chat -- Discord unfurls it into an inline GIF.
  shareUrl: string;
  // Small mp4 to sample frames from when checking what the GIF shows.
  previewVideo?: string;
}

type Sizes = Partial<Record<'hd' | 'md' | 'sm' | 'xs', Partial<Record<'gif' | 'mp4' | 'jpg' | 'webp', { url?: string }>>>>;

export function klipyEnabled(): boolean {
  return !!process.env.KLIPY_API_KEY;
}

export async function searchGifs(query: string, customerId: string, count = 6): Promise<KlipyGif[]> {
  const key = process.env.KLIPY_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    q: query,
    per_page: '8', // API minimum
    page: '1',
    customer_id: customerId,
    rating: 'pg-13',
    locale: 'en_US',
  });
  try {
    const res = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search?${params}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      logger.warn(`Klipy search failed: HTTP ${res.status}`);
      return [];
    }
    const body = (await res.json()) as { data?: { data?: Array<{ slug?: string; title?: string; type?: string; file?: Sizes }> } };
    const items = body.data?.data ?? [];
    return items
      .filter((it) => it.type === 'gif' && typeof it.slug === 'string' && /^[\w-]+$/.test(it.slug))
      .slice(0, count)
      .map((it) => ({
        slug: it.slug!,
        title: it.title ?? '',
        shareUrl: `https://klipy.com/gifs/${it.slug}`,
        previewVideo: it.file?.sm?.mp4?.url ?? it.file?.md?.mp4?.url ?? it.file?.sm?.gif?.url,
      }));
  } catch (err) {
    logger.warn('Klipy search error:', err);
    return [];
  }
}
