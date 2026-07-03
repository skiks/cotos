/**
 * COTOS Community Activation Prompt Generator
 * Generates prompts for REAL people to spark discussion.
 * NEVER auto-posts these — they're suggestions only.
 */
import db from '../db.js';

export interface CommunityPrompt {
  post_id: number;
  delay_minutes: number;
  type: 'simple_question' | 'business_angle' | 'skeptical_question' | 'friend_reaction';
  text: string;
  goal: string;
}

export function generatePrompts(postId: number): CommunityPrompt[] {
  const post = db.prepare('SELECT p.*, pi.category, pi.summary FROM posts p LEFT JOIN processed_items pi ON p.processed_item_id = pi.id WHERE p.id = ?').get(postId) as any;
  if (!post) return [];

  const title = post.title || 'этот пост';
  const category = post.category || 'AI';

  const prompts: CommunityPrompt[] = [
    {
      post_id: postId,
      delay_minutes: 10,
      type: 'simple_question',
      text: `А ${title.toLowerCase().includes('ai') ? 'это' : 'эта тема'} реально работает или пока только на бумаге?`,
      goal: 'дать повод ответить автору',
    },
    {
      post_id: postId,
      delay_minutes: 25,
      type: 'business_angle',
      text: `А для маленького бизнеса это применимо или только для корпораций?`,
      goal: 'перевести тему в применение',
    },
    {
      post_id: postId,
      delay_minutes: 50,
      type: 'skeptical_question',
      text: `А в чём подвох? Такие штуки обычно красиво выглядят только на демо.`,
      goal: 'дать автору показать экспертность',
    },
    {
      post_id: postId,
      delay_minutes: 90,
      type: 'friend_reaction',
      text: `Вот это звучит как раз полезно для тех, кто ещё всё руками делает 🔥`,
      goal: 'человеческий social proof',
    },
  ];

  // Store in community_tasks for reference
  const insert = db.prepare(`
    INSERT INTO community_tasks (post_id, task_type, suggested_text, scheduled_at, status)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'), 'pending')
  `);

  for (const p of prompts) {
    insert.run(p.post_id, p.type, p.text, p.delay_minutes);
  }

  return prompts;
}

export function getPendingPrompts(): CommunityPrompt[] {
  return db.prepare(`
    SELECT * FROM community_tasks 
    WHERE status = 'pending' 
    AND datetime(scheduled_at) <= datetime('now')
  `).all() as any[];
}
