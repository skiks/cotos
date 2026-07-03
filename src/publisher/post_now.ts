import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

const token = process.env.COTOS_BOT_TOKEN || '';
if (!token) { console.log('No COTOS_BOT_TOKEN'); process.exit(1); }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convert AI markdown to Telegram HTML: **text**→<b>text</b>, _text_→<i>text</i>, ||text||→<tg-spoiler>text</tg-spoiler>
function markdownToHtml(text: string): string {
  let result = '';
  let i = 0;
  
  while (i < text.length) {
    if (text[i] === '*' && text[i+1] === '*') {
      const end = text.indexOf('**', i+2);
      if (end !== -1) {
        result += '<b>' + escapeHtml(text.slice(i+2, end)) + '</b>';
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '_' && text[i+1] !== '_') {
      const end = text.indexOf('_', i+1);
      if (end !== -1 && text[end-1] !== '\\') {
        result += '<i>' + escapeHtml(text.slice(i+1, end)) + '</i>';
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '|' && text[i+1] === '|') {
      const end = text.indexOf('||', i+2);
      if (end !== -1) {
        result += '<tg-spoiler>' + escapeHtml(text.slice(i+2, end)) + '</tg-spoiler>';
        i = end + 2;
        continue;
      }
    }
    result += escapeHtml(text[i]);
    i++;
  }
  return result;
}

const bot = new TelegramBot(token, { polling: false });

const post = db.prepare("SELECT * FROM posts WHERE status='draft' ORDER BY id ASC LIMIT 1").get() as any;
if (!post) { console.log('No drafts in queue'); process.exit(0); }

console.log('Posting:', post.title.slice(0, 60) + '...');

const body = markdownToHtml(post.body);

const opts: any = { parse_mode: 'HTML' };
if (post.media_url) {
  try {
    await bot.sendPhoto('@cotos', post.media_url, { caption: body, parse_mode: 'HTML' });
    console.log('Posted with image!');
  } catch {
    // Fallback to text-only if image fails
    await bot.sendMessage('@cotos', body, opts);
    console.log('Posted text-only (image failed)');
  }
} else {
  await bot.sendMessage('@cotos', body, opts);
}
const msg = await bot.sendMessage('@cotos', ' ', { disable_notification: true }) // dummy to get msg_id
  .catch(() => ({ message_id: 0 }));

console.log('Posted!');

db.prepare("UPDATE posts SET status='posted', telegram_message_id=?, posted_at=datetime('now') WHERE id=?").run(msg.message_id, post.id);
console.log('DB updated. Done!');
