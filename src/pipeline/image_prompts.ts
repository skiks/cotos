/**
 * Two-step image generation:
 * Step 1: AI generates a detailed visual prompt from post content
 * Step 2: Nano Banana generates image from that prompt
 * 
 * Priority: original article image → AI generation → no image
 */
import OpenAI from 'openai';
import db from '../db.js';

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
});

const PROMPT_GEN = `You design YouTube-style thumbnails for tech news articles.
Create an image prompt following these rules:

THUMBNAIL PRINCIPLES:
- ONE clear focal point: company logo, product screenshot, or conceptual icon
- Arrows (→), comparison splits (vs), before/after — guide the eye
- Bold contrasting colors: dark background + neon accent (cyan, orange, magenta)
- Minimal text: 1-3 words MAX if absolutely needed for context
- 60-30-10 color rule: 60% dark bg, 30% subject, 10% accent
- Logos of companies mentioned — pull them in if relevant
- Schematic / diagrammatic: show RELATIONSHIPS, not just objects
- Think: "what would the Verge or TechCrunch use as a hero image?"

ANTI-PATTERNS (never do):
- NO robots, NO "AI brain", NO generic neural networks
- NO abstract colorful blobs, NO "futuristic city"
- NO flying objects, NO generic "tech" imagery
- NO text-heavy infographics — visual first, text minimal

Output: ONLY the image prompt in English, 200-350 chars.`;

export async function generateVisualPrompt(postBody: string, title: string): Promise<string> {
  const response = await aiClient.chat.completions.create({
    model: process.env.COTOS_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: PROMPT_GEN },
      { role: 'user', content: `Title: ${title}\n\nPost: ${postBody.slice(0, 500)}` },
    ],
    temperature: 0.7,
    max_tokens: 200,
  });
  return response.choices[0].message.content?.trim() || '';
}

export async function generateImageForPost(postId: number): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const post = db.prepare(`
    SELECT p.*, pi.category FROM posts p 
    LEFT JOIN processed_items pi ON p.processed_item_id = pi.id 
    WHERE p.id = ?
  `).get(postId) as any;
  
  if (!post) return null;

  // Step 1: Generate visual prompt from post content
  const visualPrompt = await generateVisualPrompt(post.body, post.title);
  console.log(`[ImageGen] #${postId}: "${visualPrompt.slice(0, 100)}..."`);

  // Step 2: Generate image
  const imgData = await generateImage(visualPrompt);
  if (imgData) {
    db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(imgData, postId);
    return imgData;
  }
  return null;
}

// ─── Ensure EVERY post has an image before publishing ───────

export async function ensureImageForPost(postId: number): Promise<string | null> {
  const post = db.prepare('SELECT id, media_url FROM posts WHERE id = ?').get(postId) as any;
  if (!post) return null;
  
  // Already has real image (not t.me link)?
  if (post.media_url && !post.media_url.includes('t.me') && post.media_url.startsWith('http')) {
    return post.media_url;
  }
  
  // Generate
  console.log(`[Image] #${postId}: no real image, generating...`);
  return generateImageForPost(postId);
}

async function generateImage(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['image','text']}}) }
    );
    const d = await r.json() as any;
    const img = d?.candidates?.[0]?.content?.parts?.find((p:any) => p.inlineData);
    return img ? `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` : null;
  } catch { return null; }
}
