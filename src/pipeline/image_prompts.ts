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

const PROMPT_GEN = `Ты — создатель визуальных промптов для AI-генерации изображений.
На основе текста поста создай детальный промпт на английском для генерации иллюстрации.

Правила:
- Опиши КОНКРЕТНУЮ сцену или концепт из поста, а не абстрактный "AI".
- Укажи стиль: editorial illustration, dark tech aesthetic, minimalist.
- Никакого текста на изображении.
- Должно выглядеть как иллюстрация к техно-новости.
- 150-250 символов на английском.

Верни ТОЛЬКО промпт, без пояснений.`;

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
  console.log(`[ImageGen] #${postId}: generating visual prompt...`);
  const visualPrompt = await generateVisualPrompt(post.body, post.title);
  console.log(`[ImageGen] #${postId}: "${visualPrompt.slice(0, 120)}..."`);

  // Step 2: Generate image via Nano Banana
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: visualPrompt }] }],
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
