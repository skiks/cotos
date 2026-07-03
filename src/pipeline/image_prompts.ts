/**
 * Smart image prompt generator — creates illustration briefs from post content
 * Strategy: original image from source first, AI generation as fallback
 */
import db from '../db.js';

export function buildImagePrompt(post: { title: string; body: string; category: string }): string {
  // Extract the core topic from title (first 100 chars after removing markdown)
  const cleanTitle = post.title?.replace(/[*_#`]/g, '').slice(0, 100) || '';
  
  // Extract first meaningful sentence after the hook (skip first line = hook)
  const lines = post.body.split('\n').filter(l => l.length > 20);
  const summaryLine = lines[1] || lines[0] || '';
  const cleanSummary = summaryLine.replace(/[*_#`|]/g, ' ').slice(0, 150);
  
  // Build a specific illustration brief — not generic
  return [
    `Editorial illustration for a tech news article.`,
    `Article topic: "${cleanTitle}"`,
    `Key idea: ${cleanSummary}`,
    `Style: bold, minimalist tech illustration. Dark background with accent colors. No text labels. No clipart. Professional but edgy.`,
    `Must visually represent the SPECIFIC topic above — not generic "AI" imagery.`,
  ].join('\n');
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

  const prompt = buildImagePrompt(post);
  console.log(`[ImageGen] #${postId}: ${prompt.slice(0, 120)}...`);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['image', 'text'] }
        })
      }
    );
    
    const data = await resp.json() as any;
    const imgData = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (imgData) {
      return `data:${imgData.inlineData.mimeType};base64,${imgData.inlineData.data}`;
    }
    return null;
  } catch (e: any) {
    console.error(`[ImageGen] Error: ${e.message}`);
    return null;
  }
}
