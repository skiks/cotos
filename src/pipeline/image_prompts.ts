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

const PROMPT_GEN = `You draw bold editorial illustrations for @cotos — an AI/IT Telegram channel.

COTOS VISUAL IDENTITY — "Bold Editorial":
- Strong, confident, slightly rebellious visual style
- High contrast: dark navy or black background with ONE bright accent color
- Accent colors cycle: electric blue, hot pink, lime green, amber yellow (pick ONE per image)
- Bold thick lines, almost like street art or poster design
- Minimal — 1-3 elements MAX. No clutter.
- Stylized company logos or product icons when relevant
- Simple geometric shapes with attitude — not safe, not boring
- Clean white text labels are OK for key terms only (product names, percentages)

WHAT TO DRAW (match the article):
- Product launch → bold icon of the product + arrow showing impact
- Comparison → split screen / before-after / versus layout
- Numbers/stats → the number itself as hero, bold and large
- Code/dev → stylized terminal or code snippet as poster art
- Business → money/flow diagram but bold and punchy

NEVER DRAW:
- Cute robots, cartoon brains, generic "AI" imagery
- Soft pastel colors, watercolor, delicate lines
- Busy infographics with lots of small text
- Realistic photos or 3D renders
- Anything that looks like a textbook

Vibe: WIRED magazine cover meets street poster. Bold. Smart. Edgy. Not safe.

Output: ONLY the image prompt in English, 150-250 chars.`;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${key}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['image','text']}}) }
    );
    const d = await r.json() as any;
    const img = d?.candidates?.[0]?.content?.parts?.find((p:any) => p.inlineData);
    return img ? `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` : null;
  } catch { return null; }
}
