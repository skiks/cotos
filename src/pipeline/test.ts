import { processItem } from '../pipeline/run.js';

const ids = process.argv.slice(2).map(Number);
if (ids.length === 0) {
  console.log('Usage: npx tsx src/pipeline/test.ts <id1> <id2> ...');
  process.exit(1);
}

for (const id of ids) {
  try {
    const result = await processItem(id);
    console.log(`#${id}: ${result.action} — ${result.reason || 'score ' + result.score}`);
  } catch (e: any) {
    console.error(`#${id}: ERROR — ${e.message}`);
  }
}
console.log('Done');
