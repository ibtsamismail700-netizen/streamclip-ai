# StreamClip AI

Free browser tools to turn streams and lectures into Shorts, thumbnails, captions, notes, flashcards and presentations.

**Live:** deployed on Vercel from this repository.

## How it works
Every AI tool runs in the visitor's browser with their own free Google Gemini key (added once in Settings, stored only in their browser, sent only to Google). The site has no server, no accounts and no built-in AI key.

## Pages
- `index.html` — homepage with all 10 tools
- `tools/` — one page per tool, each with a full "How this tool works" guide
- `settings.html` — Add your Gemini key + step-by-step key guide
- `about.html`, `privacy.html`, `terms.html`, `contact.html`

Static HTML/CSS/JS — no build step. Vercel serves the repository root directly (`vercel.json` enables clean URLs).
