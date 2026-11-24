# StreamClip AI

Free browser tools to turn streams and lectures into Shorts, thumbnails, captions, notes, flashcards and presentations.

**Live:** https://streamclip-ai-five.vercel.app/

## How it works
Every AI tool runs in the visitor's browser with their own free Google Gemini key (added once in Settings, stored only in their browser, sent only to Google). The site has no server, no accounts and no built-in AI key.

## Pages
- `index.html` — homepage with all 21 tools, Live Now categories, Your Shorts and Recent Work
- `tools/` — one page per tool, each with a full "How this tool works" guide
- `blog/` — the StreamClip AI blog (creator guides)
- `settings.html` — Add your Gemini key, Test my key, activity log + step-by-step key guide
- `about.html`, `privacy.html`, `terms.html`, `contact.html`
- `sitemap.xml`, `robots.txt`

Static HTML/CSS/JS — no build step. Vercel serves the repository root directly (`vercel.json` enables clean URLs).

## Tests
Run the regression suite before every push:

```
node tests/regression.mjs
```

It stubs the browser + Google and covers model resolution (flagship-first / lite-first / non-Pro image), cooldown skipping, daily-vs-minute limit classification and messages, designer-brief batch parsing, and the thumbnail size table.
