#!/usr/bin/env python3
"""
COTOS Telegram Collector
Uses existing @DnLord Telethon session to read AI/IT channels.
Stores messages in COTOS SQLite DB.
"""

import os, sys, sqlite3, hashlib, yaml, asyncio
from datetime import datetime, timezone
from telethon import TelegramClient
from telethon.errors import ChannelPrivateError, FloodWaitError

# ─── Config ──────────────────────────────────────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SESSION = os.path.expanduser("~/.tg-bridge-session")
API_ID = int(os.environ.get("TELEGRAM_API_ID", "35895989"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "6c2709203cf56359e0d08988170ade1a")
DB_PATH = os.path.join(PROJECT_ROOT, "..", "data", "cotos.db")
SOURCES_YAML = os.path.join(PROJECT_ROOT, "..", "config", "sources.yaml")

MSG_LIMIT = 3  # messages per channel per run

# ─── DB ──────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    return db

def hash_item(title, text):
    return hashlib.sha256(f"{title}|{text[:200]}".encode()).hexdigest()[:16]

# ─── Load sources ────────────────────────────────────────────
def load_sources():
    with open(SOURCES_YAML) as f:
        data = yaml.safe_load(f)
    sources = []
    for lang in ("russian", "english"):
        for ch in data.get(lang, []):
            sources.append({
                "username": ch["username"],
                "priority": ch.get("priority", 5),
                "hint": ch.get("hint", "models"),
                "language": lang,
            })
    return sources

# ─── Collect ─────────────────────────────────────────────────
async def collect():
    sources = load_sources()
    print(f"📡 Loading {len(sources)} Telegram sources...")

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()

    db = get_db()
    added = 0

    for src in sources:
        try:
            entity = await client.get_entity(src["username"])
            messages = await client.get_messages(entity, limit=MSG_LIMIT)

            for msg in messages:
                if not msg.text:
                    continue
                title = msg.text[:80].replace("\n", " ")
                text = msg.text[:5000]
                url = f"https://t.me/{src['username']}/{msg.id}"
                h = hash_item(title, text)

                try:
                    cursor = db.execute(
                        """INSERT OR IGNORE INTO raw_items 
                           (source_name, external_id, url, title, raw_text, author, published_at, hash)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (f"tg:{src['username']}", str(msg.id), url, title, text,
                         src["username"], msg.date.isoformat(), h),
                    )
                    if cursor.rowcount > 0:
                        added += 1
                except Exception:
                    pass

            print(f"  ✅ {src['username']}: {len(messages)} msgs")

        except ChannelPrivateError:
            print(f"  🔒 {src['username']}: private/invite only (join first)")
        except FloodWaitError as e:
            print(f"  ⏳ {src['username']}: flood wait {e.seconds}s, skipping")
        except Exception as e:
            print(f"  ❌ {src['username']}: {e}")

    db.commit()
    db.close()
    await client.disconnect()
    print(f"\n✅ Collected {added} new items from Telegram")

if __name__ == "__main__":
    asyncio.run(collect())
