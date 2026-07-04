/**
 * Nano Banana 2 Lite image generator
 * Uses Gemini API — $0.034/image, ~4 seconds
 */
import { buildImagePrompt } from './images.js';

const MODEL = 'gemini-3-pro-image';

function getKey(): string {
  const k = process.env['GEMINI_API_KEY'] || '';
  if (!k) throw new Error('GEMINI_API_KEY not set');
  return k;
}

export async function generateImage(prompt: string): Promise<Buffer | null> {
  const key = getKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );
  const data = await res.json() as any;
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  return null;
}

export async function generatePostImage(post: {
  title: string;
  body: string;
  category: string;
  tags: string;
  summary: string;
}): Promise<Buffer | null> {
  const tags = JSON.parse(post.tags || '[]');
  const prompt = buildImagePrompt({ ...post, tags });
  return generateImage(prompt);
}
