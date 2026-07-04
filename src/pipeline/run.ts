/**
 * COTOS AI Pipeline: classify → score → rewrite → fact-check
 * Uses OpenAI-compatible API (works with DeepSeek, OpenAI, Claude via proxy)
 */
import OpenAI from 'openai';
import db from '../db.js';
import { ensureImageForPost } from './image_prompts.js';
import { attachImageToPost } from '../media/images.js';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
});

const MODEL = process.env.COTOS_MODEL || 'deepseek-chat';

// ─── PROMPTS ───────────────────────────────────────────────────

const CLASSIFY_PROMPT = `Classify this AI/IT news item. Return JSON only:
{
  "category": "models|agents|tools|dev|business|research|security|robots|creative|fakecheck|money|local|personal",
  "tags": ["tag1", "tag2", "tag3"],
  "is_ai_it": true/false,
  "is_english": true/false,
  "is_hype": true/false,
  "summary_ru": "краткое описание на русском, 2-3 предложения"
}`;

const SCORE_PROMPT = `Score this AI/IT news item (1-10). Return JSON only:
{
  "novelty": <1-10>,
  "practical_value": <1-10>,
  "wow_effect": <1-10>,
  "money_potential": <1-10>,
  "credibility": <1-10>,
  "personal_fit": <1-10>,
  "total_score": <weighted average>,
  "recommendation": "post|skip|hold",
  "reason": "кратко почему"
}
Weights: novelty=0.18, practical=0.22, wow=0.15, money=0.18, credibility=0.17, personal_fit=0.10`;

const REWRITE_PROMPT = `You write posts for Telegram channel @cotos in Russian.

Author: Alen. He curates AI/IT news — NOT a product creator. Never say "we launched" or "I built". Correct: "developers shipped", "the team released", "company X launched".
Tone: smart, confident, casual, slightly edgy, simple words. Audience: friends, entrepreneurs, regular people, founders, Bali crowd.

Rules:
- **300-500 characters. Short.**
- **Cursing — RARE. Max 10% of sentences. Only when it fits naturally. Precise, not trashy.**
- **Markdown: **bold** ONLY on company/product names (OpenAI, Google, iPhone, Claude).**
- **NO bold on verbs (launched, made), adjectives (cool, fast), or generic words.**
- **EXAMPLE: "**OpenAI** shipped a new model" — correct. "OpenAI **shipped** a new **model**" — WRONG.**
- _italic_ for irony, ||spoiler|| for intrigue.
- **Mostly lowercase. Capitals — RARE, only for proper nouns (OpenAI, Google).**
- **Allow typos: "пшел" "чо" "ща" "ваще" "эт" "кароч".**
- No corporate speak. Simple words.
- Sound like a guy who knows his shit and is in a hurry.

Format:
{hook}
{meat — 1-2 paragraphs}
{opinion — 1 sentence if applicable}
{takeaway — 1 line}

Input:
Title: {title}
Context: {context}
Category: {category}`;

const FACTCHECK_PROMPT = `Fact-check this AI/IT material. Return JSON only:
{
  "verified_claims": ["что подтверждено"],
  "unverified_claims": ["что под вопросом"],
  "risk_level": "low|medium|high",
  "publish_recommendation": "publish|publish_with_caution|hold|skip",
  "needed_disclaimer": "если нужен дисклеймер",
  "safe_summary": "безопасное резюме"
}`;

// ─── AI CALLS ──────────────────────────────────────────────────

async function aiCall(systemPrompt: string, userContent: string): Promise<any> {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(response.choices[0].message.content || '{}');
}

// ─── PIPELINE STEPS ────────────────────────────────────────────

export async function classify(rawItem: { title: string; raw_text: string }) {
  const result = await aiCall(CLASSIFY_PROMPT, `Title: ${rawItem.title}\n\nContent: ${rawItem.raw_text?.slice(0, 2000)}`);
  return result;
}

export async function score(rawItem: { title: string; summary_ru: string; category: string }) {
  const result = await aiCall(SCORE_PROMPT, `Title: ${rawItem.title}\nSummary: ${rawItem.summary_ru}\nCategory: ${rawItem.category}`);
  // Calculate weighted score
  result.total_score = (
    (result.novelty || 5) * 0.18 +
    (result.practical_value || 5) * 0.22 +
    (result.wow_effect || 5) * 0.15 +
    (result.money_potential || 5) * 0.18 +
    (result.credibility || 5) * 0.17 +
    (result.personal_fit || 5) * 0.10
  );
  result.total_score = Math.round(result.total_score * 10) / 10;
  return result;
}

export async function rewrite(item: { title: string; summary_ru: string; category: string; source_url: string }) {
  const context = `${item.summary_ru}\n\nИсточник: ${item.source_url}`;
  const prompt = REWRITE_PROMPT
    .replace('{title}', item.title)
    .replace('{context}', context)
    .replace('{category}', item.category);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'Ты — Алён. Куратор AI/IT новостей с Бали. Ты не запускаешь продукты, ты про них пишешь. "Разрабы сделали", "компания выкатила" — твой стиль. Не "мы запустили". Пишешь в телегу друзьям быстро с опечатками без заглавных букв. <b>жирный</b> ТОЛЬКО для имён собственных — компании, продукты, сервисы. Не жирни обычные слова. — это помогает читать. Мат — ОЧЕНЬ редко, только когда прям идеально в тему. Без быдло-стиля. Вставляй кастомные эмодзи ссылки на паки типа t.me/addemoji/blabla.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 400,
  });
  let htmlBody = response.choices[0].message.content || '';
    // Convert markdown to HTML for Telegram
    htmlBody = htmlBody.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    htmlBody = htmlBody.replace(/\|\|(.+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
    htmlBody = htmlBody.replace(/_([^_]+)_/g, '<i>$1</i>');
    return htmlBody;
}

export async function factCheck(item: { title: string; summary_ru: string }) {
  const result = await aiCall(FACTCHECK_PROMPT, `Title: ${item.title}\nSummary: ${item.summary_ru}`);
  return result;
}

// ─── FULL PIPELINE ─────────────────────────────────────────────

export async function processItem(rawId: number) {
  const raw = db.prepare('SELECT * FROM raw_items WHERE id = ?').get(rawId) as any;
  if (!raw) throw new Error(`Raw item ${rawId} not found`);
  if (raw.status !== 'new') return { action: 'skip', reason: 'already processed' };

  // 1. Classify
  const classification = await classify(raw);
  if (!classification.is_ai_it) {
    db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run('rejected', rawId);
    return { action: 'skip', reason: 'not AI/IT' };
  }

  // 2. Score
  const scores = await score({ title: raw.title, summary_ru: classification.summary_ru, category: classification.category });

  // 3. Fact-check
  const facts = await factCheck({ title: raw.title, summary_ru: classification.summary_ru });

  // 4. Store processed item
  const insert = db.prepare(`
    INSERT OR REPLACE INTO processed_items 
    (raw_item_id, summary, category, tags, novelty_score, practical_score, wow_score, money_score, credibility_score, total_score, recommendation, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insert.run(
    rawId,
    classification.summary_ru,
    classification.category,
    JSON.stringify(classification.tags || []),
    scores.novelty, scores.practical_value, scores.wow_effect, scores.money_potential, scores.credibility,
    scores.total_score,
    scores.recommendation || (scores.total_score >= 3 ? 'post' : 'skip'),
    scores.reason
  );
  const processedId = Number(info.lastInsertRowid);

  // 5. Rewrite if score >= 8
  if (scores.total_score >= 6 && facts.risk_level !== 'high') {
    const postBody = await rewrite({
      title: raw.title,
      summary_ru: classification.summary_ru,
      category: classification.category,
      source_url: raw.url,
    });

    db.prepare(`
      INSERT INTO posts (processed_item_id, post_type, title, body, source_links, media_url, status)
      VALUES (?, 'main_news', ?, ?, ?, ?, 'draft')
    `).run(processedId, raw.title, postBody, raw.url, raw.media_url || null);

    // Async: generate AI image if no source media
    if (!raw.media_url) {
      ensureImageForPost(Number(db.prepare('SELECT last_insert_rowid()').get() as any)).then(imgUrl => {
        if (imgUrl) db.prepare('UPDATE posts SET media_url = ? WHERE id = (SELECT MAX(id) FROM posts)').run(imgUrl);
      }).catch(() => {});
    }

    db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run('posted', rawId);
    return { action: 'post', category: classification.category, score: scores.total_score };
  }

  db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run('skipped', rawId);
  return { action: 'skip', reason: scores.reason || `score ${scores.total_score} < 8` };
}
