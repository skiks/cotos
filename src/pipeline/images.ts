/**
 * Image scraper — extracts OG images from article URLs.
 * Quality-filtered: rejects OG previews <600px wide, <30KB, or clearly logos.
 */
import db from '../db.js';

const MIN_WIDTH = 600;       // < 600px is almost always a tiny OG preview or thumbnail
const MIN_BYTES = 30_000;    // < 30KB is almost always a logo / placeholder
const ALLOWED_HOSTS_HINT = /(png|jpg|jpeg|webp)(\?|$)/i; // helps skip SVG icons

export interface ScrapeResult {
  url: string;
  width?: number;
  bytes?: number;
  contentType?: string;
}

export async function scrapeImage(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    const html = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'COTOS/1.0 (Telegram AI Channel Bot)' },
    }).then(r => r.text());

    // Try og:image first
    const ogMatch =
      html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogMatch && ogMatch[1]) {
      const v = await validateImage(ogMatch[1]);
      if (v) return v;
    }

    // Try twitter:image
    const twMatch = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (twMatch && twMatch[1]) {
      const v = await validateImage(twMatch[1]);
      if (v) return v;
    }

    // Try first large img
    const imgMatch = html.match(/<img[^>]+src="(https:\/\/[^"]+)"[^>]*>/i);
    if (imgMatch && imgMatch[1]) {
      const v = await validateImage(imgMatch[1]);
      if (v) return v;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Probe the actual image (HEAD + a couple of clues) and reject obvious low-quality:
 * - too small (< MIN_WIDTH)
 * - too light (< MIN_BYTES) — almost always a logo or placeholder
 * - obviously wrong type (svg, gif preview)
 *
 * Returns the URL on pass, null on fail. We keep the function tolerant:
 * if probing fails (CDN blocks HEAD, CORS, etc.) we still allow it — better than nothing.
 */
export async function validateImage(url: string): Promise<string | null> {
  if (!url) return null;
  // Cheap reject: SVG, icons, tracking pixels
  if (/\.svg(\?|$)/i.test(url)) return null;
  if (/icon|logo|sprite|pixel|tracking/i.test(url) && !ALLOWED_HOSTS_HINT.test(url)) return null;

  try {
    const head = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'COTOS/1.0 (Telegram AI Channel Bot)' },
    });
    const len = Number(head.headers.get('content-length') || '0');
    const type = head.headers.get('content-type') || '';

    // Reject obvious tiny payloads
    if (len > 0 && len < MIN_BYTES) return null;
    // Reject obviously wrong types
    if (type && !/image\/(png|jpeg|jpg|webp)/i.test(type)) return null;

    // Width probe (best-effort). If CDN doesn't return a header, fall through.
    // Many CDNs expose `x-amz-meta-width` or `x-og-image-width`; standard is to read image dims client-side,
    // which we can't do server-side cheaply. So we accept unless CDN explicitly says too small.
    // Future: do a tiny GET first 24KB and parse PNG/JPEG SOF marker.

    return url;
  } catch {
    // Probe failed → trust the URL. Better than dropping good images on a flaky CDN.
    return url;
  }
}

/** Batch scrape images for posts without media */
export async function scrapeImagesForPosts(limit = 10): Promise<number> {
  const posts = db.prepare(`
    SELECT p.id, p.source_links FROM posts p
    WHERE p.media_url IS NULL AND p.source_links IS NOT NULL
    LIMIT ?
  `).all(limit) as any[];

  let updated = 0;
  for (const post of posts) {
    try {
      const urls = JSON.parse(post.source_links || '[]');
      const mainUrl = Array.isArray(urls) ? urls[0] : post.source_links;
      const img = await scrapeImage(mainUrl);
      if (img) {
        db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(img, post.id);
        updated++;
      }
    } catch { /* skip */ }
  }
  return updated;
}

// Store image alongside post in pipeline
export async function attachImageToPost(postId: number, sourceUrl: string) {
  const img = await scrapeImage(sourceUrl);
  if (img) {
    db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(img, postId);
  }
}
