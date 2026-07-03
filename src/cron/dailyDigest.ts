/**
 * COTOS Morning Digest
 * Sends daily plan to admin bot at 09:00 Asia/Jakarta
 */
import db from '../db.js';
import { getQueue } from '../publisher/telegram.js';
import { getDailyStats } from '../analytics/collector.js';
import TelegramBot from 'node-telegram-bot-api';

export async function sendMorningDigest(adminToken: string, adminChatId: string) {
  const bot = new TelegramBot(adminToken, { polling: false });

  const queue = await getQueue();
  const stats = getDailyStats();
  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Jakarta' });

  let text = `☀️ **COTOS — ${today}**\n\n`;

  // Today's queue
  text += `📋 **Сегодня в очереди:**\n`;
  if (queue.length === 0) {
    text += 'Постов нет. Запустите сбор новостей.\n';
  } else {
    for (const p of queue.slice(0, 5)) {
      const cat = p.category || '?';
      text += `• #${p.id} — ${p.title?.slice(0, 50)} — ★${p.total_score || '?'} [${cat}]\n`;
    }
    if (queue.length > 5) text += `… и ещё ${queue.length - 5} постов\n`;
  }

  // Approve-needed
  const needApprove = db.prepare(`
    SELECT COUNT(*) as c FROM posts WHERE status = 'draft' 
    AND id IN (SELECT processed_item_id FROM processed_items WHERE total_score < 8)
  `).get() as any;

  if (needApprove?.c > 0) {
    text += `\n⚠️ **На approve:** ${needApprove.c} постов (score < 8)\n`;
  }

  // Yesterday
  text += `\n📊 **Вчера:**\n`;
  text += `Опубликовано: ${stats.posts}\n`;
  text += `Средний score: ${stats.total_score}\n`;

  text += `\nАвтопилот активен. Если ничего не делать — безопасные посты уйдут сами.`;

  await bot.sendMessage(adminChatId, text, { parse_mode: 'Markdown' });
}
