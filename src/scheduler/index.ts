/**
 * COTOS Scheduler
 * Publishes posts at 09:30, 13:00, 16:30, 20:30 Asia/Jakarta
 * Autopilot: score >= 8 + no red flags → auto-publish
 */
import { publishPost, getQueue } from '../publisher/telegram.js';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

// Schedule slots in Jakarta time
const SLOTS = [
  { time: '09:30', type: 'main_news', label: 'Главная новость' },
  { time: '13:00', type: 'tool_or_business', label: 'Инструмент / Бизнес' },
  { time: '16:30', type: 'experiment_or_dev', label: 'Dev / Эксперимент' },
  { time: '20:30', type: 'opinion_or_fakecheck', label: 'Мнение / Антихайп' },
];

const EXTRA_SLOTS = ['11:30', '18:30', '22:30'];

function nowJakarta(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function getNextSlot(): { time: string; type: string } | null {
  const now = nowJakarta();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Check regular slots
  for (const slot of SLOTS) {
    const slotMinutes = timeToMinutes(slot.time);
    // Slot is "due" if we're within 5 minutes after it
    if (currentMinutes >= slotMinutes && currentMinutes <= slotMinutes + 5) {
      return slot;
    }
  }

  // Check extra slots
  for (const extra of EXTRA_SLOTS) {
    const extraMinutes = timeToMinutes(extra);
    if (currentMinutes >= extraMinutes && currentMinutes <= extraMinutes + 5) {
      return { time: extra, type: 'extra' };
    }
  }

  return null;
}

export async function tick(): Promise<{ published: number; skipped: number }> {
  const slot = getNextSlot();
  if (!slot) return { published: 0, skipped: 0 };

  const queue = await getQueue();
  if (queue.length === 0) return { published: 0, skipped: 0 };

  // Filter: only posts with score >= 8 (autopilot) or any score after 1h in queue
  const candidates = queue.filter((p: any) => {
    const score = p.total_score || 0;
    const isAutoPublish = score >= 8;
    const created = new Date(p.created_at);
    const hoursAgo = (Date.now() - created.getTime()) / 3600000;
    const isOld = hoursAgo >= 1;
    return isAutoPublish || isOld;
  });

  if (candidates.length === 0) return { published: 0, skipped: 0 };

  // Pick best match for slot type
  const best = candidates[0];
  const result = await publishPost(best.id);

  if (result) {
    const label = slot.type === 'main_news' ? 'Главная новость' : 
                  slot.type === 'tool_or_business' ? 'Инструмент/Бизнес' : 
                  slot.type === 'experiment_or_dev' ? 'Dev/Эксперимент' : 
                  'Мнение/Антихайп';
    console.log(`[Scheduler] Published #${best.id} → ${label}`);
    return { published: 1, skipped: 0 };
  }

  return { published: 0, skipped: 1 };
}

// Run continuously, check every minute
export function startScheduler() {
  console.log(`⏰ Scheduler started (${TIMEZONE}), slots: ${SLOTS.map(s => s.time).join(', ')}`);

  // Check immediately on start
  tick();

  // Then every minute
  setInterval(tick, 60_000);
}
