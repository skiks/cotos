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

// ─── Smart image prompt from post content ───
export function buildSmartPrompt(post: {
  title: string;
  body: string;
  category: string;
  summary: string;
}): string {
  const text = (post.body + ' ' + post.title + ' ' + post.summary).toLowerCase();
  
  // Extract key entities
  const companies = text.match(/\b(openai|google|meta|anthropic|microsoft|apple|mistral|deepseek|nvidia|tesla|xai)\b/gi) || [];
  const topics = text.match(/\b(ai|llm|agent|coding|robot|model|chip|video|image|voice|code|app|api|benchmark|security|privacy)\b/gi) || [];
  
  // Build prompt from keywords
  let prompt = '';
  
  if (companies.length > 0) {
    prompt += companies.slice(0, 2).join(' and ') + ' ';
  }
  
  if (topics.length > 0) {
    prompt += topics.slice(0, 3).join(' ') + ' ';
  }
  
  // Category-specific style
  const styles: Record<string, string> = {
    fakecheck: 'fact check illustration with magnifying glass',
    money: 'business growth chart with tech elements',
    research: 'scientific abstract visualization',
    robots: 'futuristic robot design',
    security: 'cybersecurity shield and lock',
    dev: 'code editor with AI autocomplete',
    models: 'neural network abstract visualization',
    tools: 'clean SaaS product interface',
  };
  
  prompt += styles[post.category] || 'modern tech abstract';
  prompt += '. professional quality. no text overlay.';
  
  return prompt;
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
