/**
 * COTOS Admin Bot — личный бот Алёна для управления каналом
 * Команды: /today, /queue, /stats, /pause, /resume
 */
import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

const token = process.env.COTOS_ADMIN_BOT_TOKEN || '';
if (!token) {
  console.error('COTOS_ADMIN_BOT_TOKEN not set');
  process.exit(1);
}

const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID || '602562');

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    '👋 COTOS Admin Bot',
    '',
    '/today — план на сегодня',
    '/queue — очередь постов',
    '/stats — статистика',
    '/pause — пауза автопостинга',
    '/resume — запуск автопостинга',
  ].join('\n'));
});

bot.onText(/\/today/, (msg) => {
  const drafts = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='draft'").get() as any;
  const posted = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='posted' AND posted_at > date('now')").get() as any;
  const rawNew = db.prepare("SELECT COUNT(*) as c FROM raw_items WHERE status='new'").get() as any;
  bot.sendMessage(msg.chat.id, [
    '📅 Сегодня:',
    `• Постов опубликовано: ${posted.c}`,
    `• Драфтов в очереди: ${drafts.c}`,
    `• Новых айтемов: ${rawNew.c}`,
  ].join('\n'));
});

bot.onText(/\/queue/, (msg) => {
  const queue = db.prepare(`
    SELECT p.id, p.title, pi.total_score 
    FROM posts p LEFT JOIN processed_items pi ON p.processed_item_id = pi.id 
    WHERE p.status='draft' ORDER BY pi.total_score DESC LIMIT 10
  `).all() as any[];
  
  if (queue.length === 0) {
    bot.sendMessage(msg.chat.id, '📋 Очередь пуста.');
    return;
  }
  
  bot.sendMessage(msg.chat.id, '📋 Очередь:\n' + queue.map(
    (p: any) => `• [${p.total_score || '?'}] ${(p.title || '').slice(0, 60)}`
  ).join('\n'));
});

bot.onText(/\/stats/, (msg) => {
  const raw = db.prepare('SELECT COUNT(*) as c FROM raw_items').get() as any;
  const proc = db.prepare('SELECT COUNT(*) as c FROM processed_items').get() as any;
  const posted = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='posted'").get() as any;
  const drafts = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='draft'").get() as any;
  
  bot.sendMessage(msg.chat.id, [
    '📊 Статистика:',
    `• Собрано: ${raw.c}`,
    `• Обработано: ${proc.c}`,
    `• Опубликовано: ${posted.c}`,
    `• В очереди: ${drafts.c}`,
  ].join('\n'));
});

console.log(`✅ Admin bot started. Chat: @CotosAdminBot (admin: ${ADMIN_ID})`);
