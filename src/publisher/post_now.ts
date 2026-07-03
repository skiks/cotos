import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

const token = process.env.COTOS_BOT_TOKEN || '';
if (!token) { console.log('No COTOS_BOT_TOKEN'); process.exit(1); }

const bot = new TelegramBot(token, { polling: false });

const post = db.prepare("SELECT * FROM posts WHERE status='draft' ORDER BY id ASC LIMIT 1").get() as any;
if (!post) { console.log('No drafts in queue'); process.exit(0); }

console.log('Posting:', post.title.slice(0, 60) + '...');

const opts: any = { parse_mode: 'Markdown' };
if (post.media_url) {
  try {
    await bot.sendPhoto('@cotos', post.media_url, { caption: post.body, parse_mode: 'Markdown' });
    console.log('Posted with image!');
  } catch {
    // Fallback to text-only if image fails
    await bot.sendMessage('@cotos', post.body, opts);
    console.log('Posted text-only (image failed)');
  }
} else {
  await bot.sendMessage('@cotos', post.body, opts);
}
const msg = await bot.sendMessage('@cotos', ' ', { disable_notification: true }) // dummy to get msg_id
  .catch(() => ({ message_id: 0 }));

console.log('Posted!');

db.prepare("UPDATE posts SET status='posted', telegram_message_id=?, posted_at=datetime('now') WHERE id=?").run(msg.message_id, post.id);
console.log('DB updated. Done!');
