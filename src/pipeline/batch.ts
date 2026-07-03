/**
 * COTOS Batch Processor — processes all new raw_items through AI pipeline
 * Usage: npx tsx src/pipeline/batch.ts [limit]
 */
import { processItem } from './run.js';
import db from '../db.js';

const limit = parseInt(process.argv[2] || '50');

const items = db.prepare(
  `SELECT id, title FROM raw_items WHERE status = 'new' ORDER BY id ASC LIMIT ?`
).all(limit) as any[];

console.log(`🔍 Processing ${items.length} items (limit ${limit})...`);
let posts = 0, skipped = 0, errors = 0;

for (const item of items) {
  try {
    const result = await processItem(item.id);
    if (result.action === 'post') {
      posts++;
      console.log(`  ✅ #${item.id}: POST (score ${result.score}) — ${item.title.slice(0,60)}`);
    } else {
      skipped++;
    }
    // Rate limit: 1 request per 2 seconds
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: any) {
    errors++;
    console.error(`  ❌ #${item.id}: ${e.message}`);
  }
}

const queueCount = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='draft'").get() as any)?.c || 0;
console.log(`\n📊 Done: ${posts} posts, ${skipped} skipped, ${errors} errors`);
console.log(`Queue: ${queueCount} drafts`);
