module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Backend working' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { url, cloudName, uploadPreset, folder } = body;

    if (!url || !cloudName || !uploadPreset) {
      return res.status(400).json({ ok: false, error: 'url, cloudName, uploadPreset required' });
    }

    const sourceUrl = isDirectImage(url) ? url : await extractImageFromPage(url);
    if (!sourceUrl) {
      return res.status(404).json({ ok: false, error: 'Image source not found from this page' });
    }

    const uploaded = await uploadRemoteToCloudinary({ sourceUrl, cloudName, uploadPreset, folder });
    const webpUrl = makeWebpUrl(uploaded.secure_url || uploaded.url);

    return res.status(200).json({ ok: true, sourceUrl, webpUrl, upload: uploaded });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};

function isDirectImage(u) {
  return /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff)(\?|#|$)/i.test(String(u || ''));
}

function cleanUrl(u, base) {
  try {
    let s = String(u || '').trim().replace(/&amp;/g, '&').replace(/\\\//g, '/');
    if (!s) return '';
    return new URL(s, base).href;
  } catch (_) {
    return '';
  }
}

function scoreImageUrl(u) {
  let score = 10;
  if (/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i.test(u)) score += 50;
  if (/(large|full|original|photo|image|media|upload|cdn|free-ai-image|preview)/i.test(u)) score += 25;
  if (/(logo|icon|avatar|sprite|favicon|placeholder|blank|loader|tracking|pixel|svg)/i.test(u)) score -= 80;
  if (/width=|w=|quality=|q=|format=/i.test(u)) score += 5;
  return score;
}

async function extractImageFromPage(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });

  if (!response.ok) throw new Error('Page fetch failed: ' + response.status);
  const html = await response.text();
  const candidates = [];

  const add = (raw, bonus) => {
    const u = cleanUrl(raw, pageUrl);
    if (!u || !/^https?:\/\//i.test(u)) return;
    candidates.push({ url: u, score: scoreImageUrl(u) + (bonus || 0) });
  };

  // meta images first
  const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) add(m[1], 120);

  // reverse order meta content/property
  const metaRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]*>/gi;
  while ((m = metaRe2.exec(html))) add(m[1], 120);

  // link image preload
  const linkRe = /<link[^>]+(?:rel=["']image_src["']|as=["']image["'])[^>]+href=["']([^"']+)["'][^>]*>/gi;
  while ((m = linkRe.exec(html))) add(m[1], 80);

  // img src/data-src/srcset
  const imgTagRe = /<img[^>]+>/gi;
  let tag;
  while ((tag = imgTagRe.exec(html))) {
    const t = tag[0];
    ['src','data-src','data-original','data-lazy-src','data-image','data-url'].forEach(attr => {
      const r = new RegExp(attr + '=["\\']([^"\\']+)["\\']', 'i').exec(t);
      if (r) add(r[1], 55);
    });
    const ss = /(?:srcset|data-srcset)=["']([^"']+)["']/i.exec(t);
    if (ss) ss[1].split(',').forEach(p => add(p.trim().split(/\s+/)[0], 65));
  }

  // JSON/inline direct image URLs
  const urlRe = /https?:\\?\/\\?\/[^"'<>\s)]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'<>\s)]*)?/gi;
  while ((m = urlRe.exec(html)) && candidates.length < 1000) add(m[0], 30);

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].url : '';
}

async function uploadRemoteToCloudinary({ sourceUrl, cloudName, uploadPreset, folder }) {
  const form = new FormData();
  form.append('file', sourceUrl);
  form.append('upload_preset', uploadPreset);
  if (folder) form.append('folder', folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data && data.error && data.error.message ? data.error.message : 'Cloudinary upload failed');
  return data;
}

function makeWebpUrl(u) {
  return String(u).replace('/upload/', '/upload/f_webp,q_auto:best/').replace(/\.(jpe?g|png|gif|avif|webp)(\?.*)?$/i, '.webp$2');
}
