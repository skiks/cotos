#!/usr/bin/env python3
"""
COTOS Publisher — posts to @cotos via @DnLord user account (Telethon)
Supports: custom emojis, stickers, markdown (via Telegram entities)
"""

import os, sys, sqlite3, asyncio
from telethon import TelegramClient
from telethon.tl.types import MessageEntityBold, MessageEntityItalic

# ─── Config ──────────────────────────────────────────────────
SESSION = os.path.expanduser("~/.tg-bridge-session")
API_ID = int(os.environ.get("TELEGRAM_API_ID", "35895989"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "6c2709203cf56359e0d08988170ade1a")
CHANNEL = os.environ.get("COTOS_CHANNEL_ID", "@cotos")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "cotos.db")

def get_db():
    return sqlite3.connect(DB_PATH)

def apply_markdown(text):
    """Convert **bold** and _italic_ to Telegram entities for Telethon"""
    entities = []
    result = []
    i = 0
    
    while i < len(text):
        # Bold: **text**
        if text[i:i+2] == '**':
            end = text.find('**', i+2)
            if end != -1:
                bold_text = text[i+2:end]
                offset = len(''.join(result))
                result.append(bold_text)
                entities.append(MessageEntityBold(offset=offset, length=len(bold_text)))
                i = end + 2
                continue
        
        # Italic: _text_
        if text[i] == '_' and (i == 0 or text[i-1] != '\\'):
            end = text.find('_', i+1)
            if end != -1:
                italic_text = text[i+1:end]
                offset = len(''.join(result))
                result.append(italic_text)
                entities.append(MessageEntityItalic(offset=offset, length=len(italic_text)))
                i = end + 1
                continue
        
        result.append(text[i])
        i += 1
    
    return ''.join(result), entities

async def publish_post():
    db = get_db()
    post = db.execute(
        "SELECT id, body FROM posts WHERE status='draft' ORDER BY id ASC LIMIT 1"
    ).fetchone()
    
    if not post:
        print("No drafts in queue")
        return
    
    post_id, body = post
    title_preview = body[:60].replace('\n', ' ')
    print(f"Posting: {title_preview}...")
    
    # Apply markdown formatting
    formatted, entities = apply_markdown(body)
    
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()
    
    try:
        # Get channel entity
        channel = await client.get_entity(CHANNEL)
        
        # Send with entities (supports bold, italic, custom emojis, stickers)
        msg = await client.send_message(
            channel,
            formatted,
            formatting_entities=entities if entities else None,
            parse_mode='html'  # fallback
        )
        
        print(f"Posted! message_id: {msg.id}")
        
        db.execute(
            "UPDATE posts SET status='posted', telegram_message_id=?, posted_at=datetime('now') WHERE id=?",
            (msg.id, post_id)
        )
        db.commit()
        
    except Exception as e:
        print(f"Failed: {e}")
        # Fallback: plain text
        try:
            await client.send_message(channel, body)
            print("Posted plain text (formatting failed)")
        except:
            print("Fallback also failed")
    
    finally:
        await client.disconnect()
        db.close()

if __name__ == "__main__":
    asyncio.run(publish_post())
