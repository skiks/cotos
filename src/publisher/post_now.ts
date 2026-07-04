import TelegramBot from 'node-telegram-bot-api';
import db from '../db.js';
import { ensureImageForPost } from '../pipeline/image_prompts.js';

const token = process.env.COTOS_BOT_TOKEN || '';
if (!token) { console.log('No COTOS_BOT_TOKEN'); process.exit(1); }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtml(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '*' && text[i+1] === '*') {
      const end = text.indexOf('**', i+2);
      if (end !== -1) {
        result += '<b>' + escapeHtml(text.slice(i+2, end)) + '</b>';
        i = end + 2; continue;
      }
    }
    if (text[i] === '_' && text[i+1] !== '_') {
      const end = text.indexOf('_', i+1);
      if (end !== -1 && text[end-1] !== '\\') {
        result += '<i>' + escapeHtml(text.slice(i+1, end)) + '</i>';
        i = end + 1; continue;
      }
    }
    if (text[i] === '|' && text[i+1] === '|') {
      const end = text.indexOf('||', i+2);
      if (end !== -1) {
        result += '<tg-spoiler>' + escapeHtml(text.slice(i+2, end)) + '</tg-spoiler>';
        i = end + 2; continue;
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

// Ensure image: if no real image, generate one BEFORE posting
let mediaUrl = post.media_url;
if (!mediaUrl || mediaUrl.includes('t.me')) {
  console.log('[Publish] No image, generating...');
  mediaUrl = await ensureImageForPost(post.id);
  if (mediaUrl) {
    db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(mediaUrl, post.id);
    console.log('[Publish] Image generated ✓');
  } else {
    console.log('[Publish] Image generation failed, posting text-only');
  }
}

const body = markdownToHtml(post.body);

if (mediaUrl) {
  try {
    let photo: any = mediaUrl;
    if (typeof photo === 'string' && photo.startsWith('data:')) {
      const [, b64] = photo.split(',');
      photo = Buffer.from(b64, 'base64');
    }
    const msg = await bot.sendPhoto('@cotos', photo, { caption: body, parse_mode: 'HTML' });
    console.log('Posted with image! msg_id:', msg.message_id);
    db.prepare("UPDATE posts SET status='posted', telegram_message_id=?, posted_at=datetime('now') WHERE id=?").run(msg.message_id, post.id);
    console.log('Done!');
    process.exit(0);
  } catch (e: any) {
    console.log('Photo failed:', e.message);
  }
}

// Fallback: text only
const msg = await bot.sendMessage('@cotos', body, { parse_mode: 'HTML' });
console.log('Posted text-only! msg_id:', msg.message_id);
db.prepare("UPDATE posts SET status='posted', telegram_message_id=?, posted_at=datetime('now') WHERE id=?").run(msg.message_id, post.id);
console.log('Done!');
