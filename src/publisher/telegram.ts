/**
 * COTOS Telegram Publisher
 * Publishes posts to @cotos channel via Telegram Bot API
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

function getBotToken() { return process.env['COTOS_BOT_TOKEN'] || '' };
function getChannelId() { return process.env['COTOS_CHANNEL_ID'] || '@cotos' };

let bot: TelegramBot | null = null;


// ─── Custom Emoji Packs ─────────────────────────────────────
const CUSTOM_EMOJI_PACKS = [
  'https://t.me/addemoji/durovcaps',
  'https://t.me/addemoji/PepePls',
  'https://t.me/addemoji/borisovatel',
  'https://t.me/addemoji/wtc',
  'https://t.me/addstickers/FunnyCats',
];

function addCustomEmojiFooter(body: string): string {
  const pack = CUSTOM_EMOJI_PACKS[Math.floor(Math.random() * CUSTOM_EMOJI_PACKS.length)];
  return body + `

[🔥 эмодзи-пак](${pack})`;
}

function getBot(): TelegramBot {
  if (!bot) {
    const token = getBotToken(); if (!token) throw new Error('COTOS_BOT_TOKEN not set');
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

export async function publishPost(postId: number): Promise<{ message_id: number } | null> {
  interface PostRow { id: number; body: string; status: string; url: string; [key: string]: any; }
  const post = db.prepare('SELECT p.*, ri.url FROM posts p LEFT JOIN processed_items pi ON p.processed_item_id = pi.id LEFT JOIN raw_items ri ON pi.raw_item_id = ri.id WHERE p.id = ?').get(postId) as PostRow;
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.status === 'posted') return null;

  try {
    const b = getBot();
    
    // Fetch og:image from source URL
    let photoUrl: string | null = null;
    if (post.url) {
      try {
        const html = await fetch(post.url, { signal: AbortSignal.timeout(4000) }).then((r: Response) => r.text());
        const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
        const twMatch = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
        photoUrl = ogMatch?.[1] || twMatch?.[1] || null;
      } catch { /* timeout ok */ }
    }
    
    if (photoUrl) {
      try {
        const photoMsg = await b.sendPhoto(CHANNEL_ID, photoUrl, {
          caption: post.body.slice(0, 900),
          parse_mode: 'Markdown',
        });
        db.prepare("UPDATE posts SET status = 'posted', telegram_message_id = ?, posted_at = datetime('now') WHERE id = ?").run(photoMsg.message_id, postId);
        return { message_id: photoMsg.message_id };
      } catch { /* photo failed, fall back to text */ }
    }
    
    const msg = await b.sendMessage(CHANNEL_ID, post.body, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: '🎭 эмодзи', url: 'https://t.me/addemoji/durovcaps' },
          { text: '🐸 стикеры', url: 'https://t.me/addemoji/PepePls' },
        ]]
      }
    });

    db.prepare(`
      UPDATE posts SET status = 'posted', telegram_message_id = ?, posted_at = datetime('now')
      WHERE id = ?
    `).run(msg.message_id, postId);

    return { message_id: msg.message_id };
  } catch (err: any) {
    console.error(`[Publish] Failed to post #${postId}: ${err.message}`);
    db.prepare(`UPDATE posts SET status = 'failed' WHERE id = ?`).run(postId);
    return null;
  }
}

export async function publishNextDraft(): Promise<{ post_id: number; message_id: number } | null> {
  const draft = db.prepare(`
    SELECT * FROM posts WHERE status = 'draft' ORDER BY created_at ASC LIMIT 1
  `).get() as any;

  if (!draft) return null;

  const result = await publishPost(draft.id);
  return result ? { post_id: draft.id, message_id: result.message_id } : null;
}

export async function getQueue(): Promise<any[]> {
  return db.prepare(`
    SELECT p.*, pi.category, pi.total_score 
    FROM posts p 
    LEFT JOIN processed_items pi ON p.processed_item_id = pi.id 
    WHERE p.status = 'draft' 
    ORDER BY pi.total_score DESC, p.created_at ASC
  `).all();
}
