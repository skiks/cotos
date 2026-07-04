/**
 * COTOS Telegram Publisher — always sends photo + HTML caption
 * Image priority: source og:image → Nano Banana generation
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

function getBotToken() { return process.env['COTOS_BOT_TOKEN'] || '' }
function getChannelId() { return process.env['COTOS_CHANNEL_ID'] || '@cotos' }
function getGeminiKey() { return process.env['GEMINI_API_KEY'] || '' }

let bot: TelegramBot | null = null;
function getBot(): TelegramBot {
  if (!bot) {
    const t = getBotToken();
    if (!t) throw new Error('COTOS_BOT_TOKEN not set');
    bot = new TelegramBot(t, { polling: false });
  }
  return bot;
}

async function fetchSourceImage(url: string): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const html = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    }).then(r => r.text());
    const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
           || html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (m) {
      const imgUrl = m[1].replace(/&amp;/g, '&');
      const imgResp = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
      return Buffer.from(await imgResp.arrayBuffer());
    }
  } catch {}
  return null;
}

async function generateAIImage(prompt: string): Promise<Buffer | null> {
  const key = getGeminiKey();
  if (!key) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
        signal: AbortSignal.timeout(25000),
      }
    );
    const data = await resp.json() as any;
    for (const part of data?.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  } catch {}
  return null;
}

async function getPostImage(post: any): Promise<{ buffer: Buffer; source: string } | null> {
  // 1. Try source og:image
  if (post.url) {
    const img = await fetchSourceImage(post.url);
    if (img) return { buffer: img, source: 'source' };
  }
  
  // 2. Generate via Nano Banana
  const summary = post.summary || post.title || '';
  const prompt = `flat vector illustration. minimal design. muted colors. simple shapes. white background. ${summary.slice(0, 120)}`;
  const aiImg = await generateAIImage(prompt);
  if (aiImg) return { buffer: aiImg, source: 'nano_banana' };
  
  return null;
}

export async function publishPost(postId: number): Promise<{ message_id: number; image_source: string } | null> {
  const post = db.prepare(`
    SELECT p.*, pi.summary, ri.url, ri.title
    FROM posts p
    LEFT JOIN processed_items pi ON p.processed_item_id = pi.id
    LEFT JOIN raw_items ri ON pi.raw_item_id = ri.id
    WHERE p.id = ?
  `).get(postId) as any;

  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.status === 'posted') return null;

  const b = getBot();
  const chat = getChannelId();
  
  // Get image
  const img = await getPostImage(post);
  
  // Clean HTML
  let body = post.body || '';
  body = body.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  body = body.replace(/\|\|(.+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
  
  if (img) {
    // Send as photo with HTML caption
    try {
      const msg = await b.sendPhoto(chat, img.buffer, {
        caption: body.slice(0, 1024),
        parse_mode: 'HTML',
      }, {
        filename: 'post.jpg',
        contentType: 'image/jpeg',
      });
      
      db.prepare(`
        UPDATE posts SET status = 'posted', telegram_message_id = ?, posted_at = datetime('now')
        WHERE id = ?
      `).run(msg.message_id, postId);
      
      return { message_id: msg.message_id, image_source: img.source };
    } catch (err: any) {
      console.error(`[Publish] Photo failed: ${err.message}`);
    }
  }
  
  // Fallback: text only
  const msg = await b.sendMessage(chat, body, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  
  db.prepare(`
    UPDATE posts SET status = 'posted', telegram_message_id = ?, posted_at = datetime('now')
    WHERE id = ?
  `).run(msg.message_id, postId);
  
  return { message_id: msg.message_id, image_source: 'none' };
}

export async function getQueue(): Promise<any[]> {
  return db.prepare(`
    SELECT p.*, pi.category, pi.total_score, ri.url
    FROM posts p
    LEFT JOIN processed_items pi ON p.processed_item_id = pi.id
    LEFT JOIN raw_items ri ON pi.raw_item_id = ri.id
    WHERE p.status = 'draft'
    ORDER BY pi.total_score DESC, p.created_at ASC
  `).all();
}
