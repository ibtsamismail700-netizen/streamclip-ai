// StreamClip AI — page fetch proxy for the AI Answer Checker.
// GET /api/page?url=<encoded> -> { ok, status, contentType, text }
//
// Why this exists: browsers block cross-origin page reads (CORS), so the
// checker cannot fetch a visitor's page itself. This route fetches it
// server-side and returns the raw HTML (capped) for the deterministic
// checks that run in the visitor's browser. Nothing is stored, nothing is
// logged, and no key is involved.
//
// Safety: http/https only; hostnames that are literal private/loopback IPs
// or "localhost" are refused; the body is capped and the fetch times out.

const MAX_BYTES = 1500000;

function blockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h === '::1' || h.startsWith('[')) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const raw = (req.query && req.query.url) || '';
  let target;
  try { target = new URL(String(raw)); } catch { return res.status(200).json({ ok: false, error: 'bad_url' }); }
  if (!/^https?:$/.test(target.protocol)) return res.status(200).json({ ok: false, error: 'bad_scheme' });
  if (blockedHost(target.hostname)) return res.status(200).json({ ok: false, error: 'blocked_host' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(target.href, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; StreamClipAI-AnswerChecker/1.0)', accept: 'text/html,text/plain,*/*' },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.subarray(0, MAX_BYTES).toString('utf8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, status: r.status, contentType: r.headers.get('content-type') || '', finalUrl: r.url || target.href, text });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'fetch_failed' });
  } finally {
    clearTimeout(timer);
  }
};
