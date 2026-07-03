/**
 * COTOS AI Pipeline: classify → score → rewrite → fact-check
 * Uses OpenAI-compatible API (works with DeepSeek, OpenAI, Claude via proxy)
 */
import OpenAI from 'openai';
import db from '../db.js';
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

const REWRITE_PROMPT = `Ты пишешь пост для Telegram-канала @cotos.

Автор: Алён. Шарит в AI/IT, пишет не как задрот и не как корпоративный блог.
Стиль: умный, уверенный, живой, немного дерзкий, простыми словами.
Аудитория: друзья, предприниматели, обычные люди, фаундеры, ребята с Бали.

Правила:
- **300-500 символов.**
- **Мат — РЕДКО. МАКСИМУМ в 10% предложений. Только когда прям напрашивается. Метко, не как быдло.**
- **Маркдаун ОБЯЗАТЕЛЕН: **жирный** на ключевых словах, _курсив_ на иронии, ||спойлер|| если интрига. Это помогает читать.**
- **Пиши ВСЕГДА с маленькой буквы. Даже начало предложения.**
- **Допускай опечатки: «пшел» «чо» «ща» «ваще» «эт» «кароч».**
- **Никаких заглавных букв. Вообще.**
- Без канцелярита. Простые слова.
- Звучи как пацан который шарит и спешит.

Формат:
{хук}
{суть — 1-2 абзаца}
{от себя — 1 предложение, если есть}
{вывод — 1 строка}

Входные данные:
Заголовок: {title}
Контекст: {context}
Категория: {category}`;

const FACTCHECK_PROMPT = `Проверь этот AI/IT материал. Return JSON only:
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
      { role: 'system', content: 'Ты — Алён. Айтишник с Бали. Пишешь в телегу друзьям быстро с опечатками без заглавных букв. АКТИВНО используй **bold** и *italic* markdown — это помогает читать. Мат — ОЧЕНЬ редко, только когда прям идеально в тему. Без быдло-стиля. Вставляй кастомные эмодзи ссылки на паки типа t.me/addemoji/blabla.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 400,
  });
  return response.choices[0].message.content || '';
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
    scores.recommendation || (scores.total_score >= 5 ? 'post' : 'skip'),
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
      INSERT INTO posts (processed_item_id, post_type, title, body, source_links, status)
      VALUES (?, 'main_news', ?, ?, ?, 'draft')
    `).run(processedId, raw.title, postBody, raw.url);

    db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run('posted', rawId);
    return { action: 'post', category: classification.category, score: scores.total_score };
  }

  db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run('skipped', rawId);
  return { action: 'skip', reason: scores.reason || `score ${scores.total_score} < 8` };
}
