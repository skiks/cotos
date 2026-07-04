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

const PROMPT_GEN = `You are an editorial illustrator for The Verge / TechCrunch.
Create a DETAILED image prompt based ONLY on the article content.

CRITICAL RULES:
- Prefer SCHEMATIC or DIAGRAMMATIC style: flowcharts, comparisons, architecture diagrams, before/after visuals
- If the article has DATA (costs, percentages, benchmarks) — show that visually
- If it's about a PRODUCT — show the product concept or UI mockup
- If it's about a TREND — show a comparison or timeline
- NO generic "AI", "robot", "futuristic tech", "neural network", "flying object"
- Think: what would an INFOGRAPHIC for this article look like?
- Dark minimalist style. No text labels. 200-350 chars English.

Output: ONLY the image prompt, nothing else.`;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${key}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['image','text']}}) }
    );
    const d = await r.json() as any;
    const img = d?.candidates?.[0]?.content?.parts?.find((p:any) => p.inlineData);
    return img ? `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` : null;
  } catch { return null; }
}
