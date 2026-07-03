import Parser from 'rss-parser';
import crypto from 'crypto';
import db from '../db.js';

const parser = new Parser();

interface RSSSource {
  name: string;
  url: string;
  priority: number;
}

// MVP sources — official AI blogs only
const SOURCES: RSSSource[] = [
  { name: 'OpenAI Blog', url: 'https://openai.com/news/rss.xml', priority: 10 },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', priority: 10 },
  // Anthropic has no RSS — skip
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', priority: 9 },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', priority: 8 },
  { name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI', priority: 8 },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', priority: 6 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', priority: 6 },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', priority: 6 },
];

function hashItem(title: string, url: string): string {
  return crypto.createHash('sha256').update(`${title}|${url}`).digest('hex').slice(0, 16);
}

const MAX_AGE_HOURS = 48;
function isFresh(publishedAt: string): boolean {
  const age = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
  return age <= MAX_AGE_HOURS;
}

async function collectSource(source: RSSSource): Promise<number> {
  let added = 0;
  try {
    const feed = await parser.parseURL(source.url);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO raw_items (source_name, external_id, url, title, raw_text, author, published_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of feed.items || []) {
      const pubDate = item.isoDate || item.pubDate || new Date().toISOString();
      if (!isFresh(pubDate)) continue;
      const title = item.title || 'Untitled';
      const url = item.link || '';
      const rawText = (item.contentSnippet || item.content || '').slice(0, 5000);
      const author = item.creator || source.name;
      const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
      const hash = hashItem(title, url);

      const result = insert.run(source.name, item.guid || url, url, title, rawText, author, publishedAt, hash);
      if (result.changes > 0) added++;
    }
  } catch (err: any) {
    console.error(`[RSS] ${source.name}: ${err.message}`);
  }
  return added;
}

export async function collectAll(): Promise<{ total: number; added: number }> {
  let totalAdded = 0;
  let totalProcessed = 0;

  for (const source of SOURCES) {
    const added = await collectSource(source);
    totalProcessed++;
    totalAdded += added;
  }

  return { total: totalProcessed, added: totalAdded };
}

// Run standalone
if (process.argv[1]?.includes('rss')) {
  collectAll().then(r => console.log(`Collected ${r.added} new items from ${r.total} sources`));
}
