/**
 * Image scraper — extracts OG images from article URLs
 * Uses metascraper or falls back to regex on HTML
 */
import db from '../db.js';

export async function scrapeImage(url: string): Promise<string | null> {
  if (!url) return null;
  
  try {
    const html = await fetch(url, { 
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'COTOS/1.0 (Telegram AI Channel Bot)' }
    }).then(r => r.text());
    
    // Try og:image first
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogMatch) return ogMatch[1];
    
    // Try twitter:image
    const twMatch = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (twMatch) return twMatch[1];
    
    // Try first large img
    const imgMatch = html.match(/<img[^>]+src="(https:\/\/[^"]+)"[^>]*>/i);
    if (imgMatch) return imgMatch[1];
    
    return null;
  } catch {
    return null;
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
