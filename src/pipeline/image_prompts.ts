/**
 * Smart image prompt generator — extracts key concepts from post content
 * and creates a contextual visual prompt for Nano Banana
 */
import db from '../db.js';

function extractKeywords(text: string): string {
  // Extract bold names (companies, products)
  const boldNames = [...text.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]);
  
  // Extract key phrases (remove markdown formatting)
  const cleanText = text.replace(/[*_|]/g, ' ');
  const words = cleanText.split(/\s+/).filter(w => w.length > 4);
  
  // Find unique meaningful words
  const stopWords = new Set(['кароч', 'такой', 'такая', 'чтобы', 'который', 'просто', 'реально', 'вообще', 'сейчас', 'можно', 'самый']);
  const keywords = [...new Set([...boldNames, ...words])]
    .filter(w => !stopWords.has(w.toLowerCase()))
    .slice(0, 5);
  
  return keywords.join(', ');
}

export function buildImagePrompt(post: { title: string; body: string; category: string }): string {
  const keywords = extractKeywords(post.body);
  
  const categoryStyles: Record<string, string> = {
    models: 'futuristic AI model visualization, neural network diagram style',
    agents: 'autonomous AI agent illustration, robotic process automation',
    tools: 'clean SaaS product illustration, modern UI card',
    dev: 'code editor dark theme, terminal visualization with glowing text',
    business: 'professional business infographic with data charts',
    research: 'scientific paper visualization, abstract data patterns',
    security: 'cybersecurity shield lock, dark hacker aesthetic',
    robots: 'robot hardware device, mechanical engineering sketch',
    money: 'financial growth chart, startup funding illustration',
  };

  const style = categoryStyles[post.category] || 'modern tech illustration, clean aesthetic';
  const shortTitle = post.title?.slice(0, 60) || keywords;
  
  return `Tech illustration for AI news. Topic: ${shortTitle}. Key elements: ${keywords}. Style: ${style}. Clean, professional, no text on image. Suitable for Telegram channel post.`;
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
  console.log(`[ImageGen] Prompt: ${prompt.slice(0, 100)}...`);

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
