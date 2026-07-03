import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';

const token = process.env.COTOS_BOT_TOKEN || '';
if (!token) { console.log('No COTOS_BOT_TOKEN'); process.exit(1); }

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Parse AI-generated markdown (**bold**, _italic_, ||spoiler||) into MarkdownV2-safe format
function parseAiMarkdown(text: string): string {
  let result = '';
  let i = 0;
  const parts: string[] = [];
  
  while (i < text.length) {
    // Bold: **text**
    if (text[i] === '*' && text[i+1] === '*') {
      const end = text.indexOf('**', i+2);
      if (end !== -1) {
        parts.push(escapeMarkdownV2(result));
        result = '';
        parts.push('*' + text.slice(i+2, end) + '*');
        i = end + 2;
        continue;
      }
    }
    // Italic: _text_ (but not __)
    if (text[i] === '_' && text[i+1] !== '_') {
      const end = text.indexOf('_', i+1);
      if (end !== -1) {
        parts.push(escapeMarkdownV2(result));
        result = '';
        parts.push('_' + text.slice(i+1, end) + '_');
        i = end + 1;
        continue;
      }
    }
    // Spoiler: ||text||
    if (text[i] === '|' && text[i+1] === '|') {
      const end = text.indexOf('||', i+2);
      if (end !== -1) {
        parts.push(escapeMarkdownV2(result));
        result = '';
        parts.push('||' + text.slice(i+2, end) + '||');
        i = end + 2;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  parts.push(escapeMarkdownV2(result));
  return parts.join('');
}

const bot = new TelegramBot(token, { polling: false });

const post = db.prepare("SELECT * FROM posts WHERE status='draft' ORDER BY id ASC LIMIT 1").get() as any;
if (!post) { console.log('No drafts in queue'); process.exit(0); }

console.log('Posting:', post.title.slice(0, 60) + '...');

const body = parseAiMarkdown(post.body);

const opts: any = { parse_mode: 'MarkdownV2' };
if (post.media_url) {
  try {
    await bot.sendPhoto('@cotos', post.media_url, { caption: body, parse_mode: 'MarkdownV2' });
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
