import { ensureImageForPost } from './image_prompts.js';
import db from '../db.js';

const limit = parseInt(process.argv[2] || '3');
const drafts = db.prepare(`
  SELECT id FROM posts 
  WHERE status='draft' AND (media_url IS NULL OR media_url LIKE '%t.me%')
  LIMIT ?
`).all(limit) as any[];

console.log(`Generating images for ${drafts.length} drafts...`);

for (const d of drafts) {
  const img = await ensureImageForPost(d.id);
  console.log(`#${d.id}: ${img ? '✅ generated' : '❌ failed'}`);
}
console.log('Done');
