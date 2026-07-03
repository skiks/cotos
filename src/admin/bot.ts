/**
 * COTOS Admin Bot
 * Commands: /today, /queue, /stats, /pause, /resume
 * Inline buttons: Publish, Rewrite, Reject, etc.
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';
import { publishPost, getQueue } from '../publisher/telegram.js';

let bot: TelegramBot | null = null;
let autopilotEnabled = true;

export function initAdminBot(token: string, adminChatId: string) {
  bot = new TelegramBot(token, { polling: true });
  const chatId = adminChatId;

  // ─── /today ──────────────────────────────────────────
  bot.onText(/\/today/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;

    const queue = await getQueue();
    const today = new Date().toLocaleDateString('ru-RU');

    let text = `📅 **План на ${today}**\n\n`;
    if (queue.length === 0) {
      text += 'Очередь пуста. Новых постов нет.';
    } else {
      text += `В очереди: **${queue.length}** постов\n\n`;
      for (const p of queue.slice(0, 10)) {
        text += `• #${p.id} — ${p.title?.slice(0, 60)} — ★${p.total_score || '?'}\n`;
      }
    }

    text += `\nАвтопилот: ${autopilotEnabled ? '🟢 включен' : '🔴 выключен'}`;
    await bot?.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ─── /queue ──────────────────────────────────────────
  bot.onText(/\/queue/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;

    const queue = await getQueue();
    if (queue.length === 0) {
      await bot?.sendMessage(chatId, 'Очередь пуста.');
      return;
    }

    for (const p of queue.slice(0, 5)) {
      const body = p.body?.slice(0, 1500) || '(нет текста)';
      const keyboard = {
        inline_keyboard: [[
          { text: '✅ Publish', callback_data: `publish:${p.id}` },
          { text: '❌ Reject', callback_data: `reject:${p.id}` },
        ]],
      };
      await bot?.sendMessage(chatId, `*#${p.id}* ★${p.total_score || '?'}\n\n${body}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
  });

  // ─── /stats ──────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;

    const posted = db.prepare(`SELECT COUNT(*) as c FROM posts WHERE status = 'posted'`).get() as any;
    const drafted = db.prepare(`SELECT COUNT(*) as c FROM posts WHERE status = 'draft'`).get() as any;
    const collected = db.prepare(`SELECT COUNT(*) as c FROM raw_items`).get() as any;

    const text = `📊 **COTOS Статистика**\n\n` +
      `Собрано новостей: ${collected.c}\n` +
      `Постов в очереди: ${drafted.c}\n` +
      `Опубликовано: ${posted.c}\n` +
      `Автопилот: ${autopilotEnabled ? '🟢' : '🔴'}`;

    await bot?.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ─── /pause /resume ──────────────────────────────────
  bot.onText(/\/pause/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    autopilotEnabled = false;
    await bot?.sendMessage(chatId, '🔴 Автопилот выключен. Посты не будут публиковаться автоматически.');
  });

  bot.onText(/\/resume/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    autopilotEnabled = true;
    await bot?.sendMessage(chatId, '🟢 Автопилот включен.');
  });

  // ─── Inline buttons ──────────────────────────────────
  bot.on('callback_query', async (query) => {
    const [action, idStr] = query.data?.split(':') || [];
    const postId = parseInt(idStr || '0');

    if (action === 'publish') {
      const result = await publishPost(postId);
      if (result) {
        await bot?.answerCallbackQuery(query.id, { text: '✅ Опубликовано!' });
        await bot?.sendMessage(chatId, `Пост #${postId} опубликован → message_id: ${result.message_id}`);
      } else {
        await bot?.answerCallbackQuery(query.id, { text: '❌ Ошибка публикации' });
      }
    } else if (action === 'reject') {
      db.prepare(`UPDATE posts SET status = 'rejected' WHERE id = ?`).run(postId);
      await bot?.answerCallbackQuery(query.id, { text: '❌ Отклонено' });
    }
  });

  console.log(`🤖 Admin bot started, listening for @${bot.botInfo?.username}`);
}

export function isAutopilotEnabled(): boolean {
  return autopilotEnabled;
}
