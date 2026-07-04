/**
 * COTOS — Autonomous Telegram AI/IT Channel @cotos
 *
 * Main entry point. Wires together:
 * - RSS collector
 * - Telegram collector (Python, called as subprocess)
 * - AI Pipeline (classify → score → fact-check → rewrite)
 * - Scheduler (auto-publish)
 * - Admin bot (manual oversight)
 *
 * Usage:
 *   npm run dev          — Start everything
 *   npm run collect      — Collect from RSS + Telegram
 *   npm run process      — Run AI pipeline on new items
 *   npm run publish      — Publish next draft
 */
import { loadConfig } from './config.js';
import { collectAll } from './collectors/rss.js';
import { startScheduler } from './scheduler/index.js';
import { initAdminBot } from './admin/bot.js';
import { sendMorningDigest } from './cron/dailyDigest.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadConfig();

// ─── Telegram Collection ─────────────────────────────────────
async function collectTelegram(): Promise<number> {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'collectors', 'telegram.py');
    const proc = spawn('python3', [script], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      resolve(code || 0);
    });
  });
}

// ─── Run Pipeline on new items ───────────────────────────────
async function processNewItems() {
  const { processItem } = await import('./pipeline/run.js');
  const newItems = db.prepare(`
    SELECT id FROM raw_items WHERE status = 'new'
    ORDER BY published_at DESC
    LIMIT 20
  `).all() as any[];

  let results = { posted: 0, skipped: 0, errors: 0 };
  for (const item of newItems) {
    try {
      const result = await processItem(item.id);
      if (result.action === 'post') results.posted++;
      else results.skipped++;
    } catch (err: any) {
      console.error(`[Pipeline] Error on #${item.id}: ${err.message}`);
      results.errors++;
    }
  }

  console.log(`[Pipeline] Processed: ${results.posted} posted, ${results.skipped} skipped, ${results.errors} errors`);
  return results;
}

// ─── Collect + Process Cycle ─────────────────────────────────
async function collectAndProcess() {
  console.log('\n📡 Collecting news...');

  const rssResult = await collectAll();
  await collectTelegram();

  console.log(`Collected: RSS +${rssResult.added}, TG done`);

  const newCount = (db.prepare(`SELECT COUNT(*) as c FROM raw_items WHERE status = 'new'`).get() as any)?.c || 0;
  if (newCount > 0) {
    console.log(`🔄 Processing ${newCount} new items...`);
    await processNewItems();
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log('🚀 COTOS starting...');

  // Start scheduler (checks every minute)
  startScheduler();

  // Start admin bot
  const adminToken = process.env['COTOS_ADMIN_BOT_TOKEN'] || '';
  const adminChatId = env.ADMIN_CHAT_ID || '';
  if (adminToken && adminChatId) {
    initAdminBot(adminToken, adminChatId);
  } else {
    console.log('⚠️  Admin bot not configured (set COTOS_ADMIN_BOT_TOKEN + ADMIN_CHAT_ID)');
  }

  // Morning digest at 09:00 Jakarta
  const scheduleDigest = () => {
    const now = new Date();
    const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const h = jakarta.getHours();
    const m = jakarta.getMinutes();

    if (h === 9 && m >= 0 && m <= 5 && adminToken && adminChatId) {
      sendMorningDigest(adminToken, adminChatId);
    }
  };
  setInterval(scheduleDigest, 60_000);

  // Immediate first collection + every 15 minutes
  await collectAndProcess();
  setInterval(collectAndProcess, (env.RSS_REFRESH_INTERVAL_MINUTES || 15) * 60_000);

  console.log('✅ COTOS is running');
}

main().catch(console.error);
