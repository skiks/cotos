# COTOS Fix Plan — July 4, 2026

## Phase 1: Stability + Style (no keys needed)

- [ ] Enable SQLite WAL mode for concurrent reads
- [ ] Add RSS timeout (10s per source, skip slow ones)
- [ ] Remove HackerNews RSS (slowest, times out)
- [ ] Lock temperature at 0.7 for consistent style
- [ ] Single prompt source — kill parallel agents

## Phase 2: Images (needs GEMINI_API_KEY)

- [ ] Add GEMINI_API_KEY to .env
- [ ] Ensure every post has image before publishing
- [ ] Two-step prompt: AI visual brief → Nano Banana

## Phase 3: Growth

- [ ] Analytics: track views, forwards, reactions
- [ ] Learning loop: boost categories that perform
- [ ] Reddit/GitHub Trending parsers

## Phase 4: Monetize

- [ ] Soft offer injection (1 in 5-7 posts)
- [ ] Lead form link
- [ ] CRM integration
