/**
 * COTOS Image Fetcher
 * Scrapes og:image from source URLs for post illustrations.
 * Falls back to AI-generated image prompt if no image found.
 */
import db from '../db.js';

export async function fetchImage(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'COTOS-Bot/1.0 (Telegram AI Channel)' },
      signal: AbortSignal.timeout(5000),
    });
    const html = await response.text();

    // Try og:image first
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (ogMatch?.[1]) return ogMatch[1];

    // Try twitter:image
    const twMatch = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (twMatch?.[1]) return twMatch[1];

    // Try first <img> with reasonable size
    const imgMatch = html.match(/<img[^>]+src="(https?:[^"]+\.(jpg|png|webp))"/i);
    if (imgMatch?.[1]) return imgMatch[1];

  } catch {
    // Timeout or fetch error — skip
  }

  return null;
}

export function imagePrompt(postTitle: string, category: string): string {
  const style = category === 'fakecheck' ? 'minimalist warning illustration' :
                category === 'money' ? 'clean business tech illustration' :
                category === 'research' ? 'futuristic abstract tech' :
                'modern AI technology illustration';

  return `${style} for article about: ${postTitle.slice(0, 100)}. Clean, professional, no text.`;
}

export async function attachImageToPost(postId: number, sourceUrl: string): Promise<string | null> {
  const imageUrl = await fetchImage(sourceUrl);
  if (imageUrl) {
    db.prepare('UPDATE posts SET source_links = source_links || ? WHERE id = ?')
      .run(JSON.stringify({ image: imageUrl }), postId);
  }
  return imageUrl;
}
