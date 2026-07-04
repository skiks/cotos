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

const PROMPT_GEN = `You design flat minimal illustrations for tech articles.
Style: clean flat vector art, like Stripe or Notion blog illustrations.

DESIGN RULES:
- Flat colors, no gradients, no neon, no glow effects
- Simple geometric shapes, clean lines
- ONE clear concept per image — the core idea of the article
- White or light background
- Logos of mentioned companies as simple flat icons
- Minimal elements: 2-4 objects max
- No text on image, no labels
- Schematic, conceptual, editorial

COLORS:
- Soft, muted palette: navy, slate, warm gray, soft blue, muted orange
- No neon, no cyan/magenta, no dark mode aesthetic

ANTI-PATTERNS:
- NO robots, NO AI brains, NO neural networks
- NO glowing effects, NO futuristic sci-fi
- NO abstract colorful blobs
- NO dark backgrounds

Think: Stripe Press, Notion blog, or Monotype editorial illustrations.

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
