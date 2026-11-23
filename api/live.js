// StreamClip AI — Live Now backend (Vercel serverless function).
// GET /api/live?cat=<slug> -> { category, streams: [...] }
//
// Uses the site owner's YouTube Data API v3 key from the YOUTUBE_API_KEY
// environment variable (Vercel project settings). The key is never sent to
// the browser, never logged, and upstream error bodies are never forwarded
// (they could contain request details) — failures collapse to fixed codes.
//
// Quota note: search.list costs 100 units per uncached call, so responses
// are CDN-cached (s-maxage=180) to keep daily usage small.

const TERMS = {
  'gta-6': 'GTA 6',
  'gta-5-rp': 'GTA 5 RP',
  'fortnite': 'Fortnite',
  'minecraft': 'Minecraft',
  'free-fire': 'Free Fire',
  'bgmi-pubg': 'BGMI PUBG',
  'valorant': 'Valorant',
  'call-of-duty': 'Call of Duty',
  'roblox': 'Roblox',
  'just-chatting': 'Just Chatting',
  'irl': 'IRL',
};

const API = 'https://www.googleapis.com/youtube/v3';

async function yt(path, key) {
  const r = await fetch(`${API}${path}&key=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  return r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.status(501).json({ error: 'not_configured' });

  const slug = String((req.query && req.query.cat) || '').trim().toLowerCase();
  const term = TERMS[slug] || slug.replace(/-/g, ' ') || 'live';

  try {
    const search = await yt(
      `/search?part=snippet&type=video&eventType=live&order=viewCount&maxResults=12&q=${encodeURIComponent(term)}`,
      key
    );
    const items = Array.isArray(search.items) ? search.items : [];
    const ids = items.map((it) => it && it.id && it.id.videoId).filter(Boolean);

    // Concurrent viewers per video (one batched call, 1 unit).
    const viewers = {};
    if (ids.length) {
      const vids = await yt(
        `/videos?part=liveStreamingDetails&id=${encodeURIComponent(ids.join(','))}`,
        key
      );
      for (const v of vids.items || []) {
        const n = v && v.liveStreamingDetails
          ? parseInt(v.liveStreamingDetails.concurrentViewers, 10)
          : NaN;
        viewers[v.id] = Number.isFinite(n) ? n : null;
      }
    }

    const streams = items
      .filter((it) => it && it.id && it.id.videoId)
      .map((it) => {
        const id = it.id.videoId;
        const sn = it.snippet || {};
        return {
          id,
          title: sn.title || '',
          channel: sn.channelTitle || '',
          thumbnail: (sn.thumbnails && sn.thumbnails.medium && sn.thumbnails.medium.url) || '',
          viewers: id in viewers ? viewers[id] : null,
          url: `https://www.youtube.com/watch?v=${id}`,
        };
      });

    res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({ category: term, streams });
  } catch {
    // Quota exceeded, API disabled, network failure — one honest code,
    // no upstream body (and therefore no key) ever leaks to the client.
    return res.status(502).json({ error: 'youtube_unavailable' });
  }
};
