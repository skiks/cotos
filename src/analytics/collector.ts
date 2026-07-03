/**
 * COTOS Analytics Collector
 * Tracks views, forwards, reactions for published posts
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

function getBotToken(): string {
  const key = 'COTOS_BOT_TOKEN';
  return process.env[key] || '';
}

export async function collectPostAnalytics(postId: number, messageId: number) {
  const token = getBotToken();
  if (!token) return;

  try {
    const bot = new TelegramBot(token, { polling: false });
    db.prepare(`
      INSERT OR REPLACE INTO analytics (post_id, telegram_message_id, collected_at)
      VALUES (?, ?, datetime('now'))
    `).run(postId, messageId);

    console.log(`[Analytics] Tracked post #${postId} (msg ${messageId})`);
  } catch (err: any) {
    console.error(`[Analytics] Error: ${err.message}`);
  }
}

// Daily stats summary
export function getDailyStats(): { posts: number; total_score: number } {
  const today = new Date().toISOString().slice(0, 10);
  const posts = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(AVG(total_score), 0) as avg_score
    FROM posts p
    LEFT JOIN processed_items pi ON p.processed_item_id = pi.id
    WHERE date(p.posted_at) = ?
    AND p.status = 'posted'
  `).get(today) as any;

  return {
    posts: posts?.count || 0,
    total_score: Math.round((posts?.avg_score || 0) * 10) / 10,
  };
}
