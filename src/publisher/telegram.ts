/**
 * COTOS Telegram Publisher
 * Publishes posts to @cotos channel via Telegram Bot API
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

function getBotToken() { return process.env['COTOS_BOT_TOKEN'] || '' };
function getChannelId() { return process.env['COTOS_CHANNEL_ID'] || '@cotos' };

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
  if (!bot) {
    const token = getBotToken(); if (!token) throw new Error('COTOS_BOT_TOKEN not set');
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

export async function publishPost(postId: number): Promise<{ message_id: number } | null> {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as any;
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.status === 'posted') return null;

  try {
    const b = getBot();
    const msg = await b.sendMessage(CHANNEL_ID, post.body, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
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
