/**
 * COTOS Smart Image Strategy
 * 
 * Tier 1: Use source og:image (free, relevant)
 * Tier 2: If post mentions charts/benchmarks → generate infographic
 * Tier 3: Contextual AI image via Nano Banana 2 Lite
 * Tier 4: If source has video → keep original video
 */

import db from '../db.js';

// ─── Tier 1: Scrape og:image from source ───
export async function fetchSourceImage(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'COTOS-Bot/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    
    // Check for video first
    const ogVideo = html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i);
    if (ogVideo?.[1]) return `video:${ogVideo[1]}`;
    
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (ogImg?.[1]) return ogImg[1];
    
    const twImg = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (twImg?.[1]) return twImg[1];
    
  } catch { /* timeout ok */ }
  return null;
}

// ─── Tier 2+3: Smart AI image prompt based on post content ───
export function buildImagePrompt(post: {
  title: string;
  body: string;
  category: string;
  tags: string[];
  summary: string;
}): string {
  const lower = (post.body + ' ' + post.title + ' ' + post.summary).toLowerCase();
  
  // Detect content type for contextual prompt
  if (lower.includes('benchmark') || lower.includes('%') || lower.includes('сравнен') || lower.includes('график')) {
    return `infographic style comparison chart about ${post.title.slice(0,80)}. clean minimal design. dark theme. numbers and labels visible. no faces. professional tech style.`;
  }
  
  if (lower.includes('фото') || lower.includes('изображен') || lower.includes('картинк') || lower.includes('image quality') || lower.includes('разрешен')) {
    return `split comparison: left side low quality blurry image, right side sharp high quality image. label "до" and "после". ${post.category} technology concept.`;
  }
  
  if (post.category === 'fakecheck') {
    return `minimalist fact-check illustration. magnifying glass over text. red and green markers. clean dark background. no faces.`;
  }
  
  if (post.category === 'money' || post.category === 'business') {
    return `modern business tech illustration about ${post.title.slice(0,60)}. upward trend line. clean corporate style. dark background. no faces.`;
  }
  
  if (post.category === 'security') {
    return `cybersecurity concept illustration. shield with lock. dark background. glowing lines. professional.`;
  }
  
  if (post.category === 'robots') {
    return `futuristic robot illustration. sleek design. ${post.title.slice(0,60)}. dark sci-fi background.`;
  }
  
  // Default: contextual based on title
  return `modern tech illustration for article about ${post.title.slice(0,80)}. ${post.category} concept. clean style. dark background. no text overlay. professional.`;
}

// ─── Main: Get best image for post ───
export async function getPostImage(post: {
  id: number;
  title: string;
  body: string;
  category: string;
  tags: string[];
  summary: string;
  sourceUrl: string;
}): Promise<{ type: 'source' | 'video' | 'ai' | 'none'; url?: string; prompt?: string }> {
  
  // 1. Try source image/video first
  const sourceImg = await fetchSourceImage(post.sourceUrl);
  if (sourceImg) {
    if (sourceImg.startsWith('video:')) {
      return { type: 'video', url: sourceImg.replace('video:', '') };
    }
    return { type: 'source', url: sourceImg };
  }
  
  // 2. Generate contextual AI image prompt
  const prompt = buildImagePrompt(post);
  return { type: 'ai', prompt };
}

export function imagePrompt(postTitle: string, category: string): string {
  return `modern tech illustration about ${postTitle.slice(0,80)}. ${category} concept. clean dark background.`;
}

export async function attachImageToPost(postId: number, sourceUrl: string): Promise<string | null> {
  const img = await fetchSourceImage(sourceUrl);
  if (img) {
    db.prepare('UPDATE posts SET source_links = source_links || ? WHERE id = ?')
      .run(JSON.stringify({ image: img }), postId);
  }
  return img;
}
