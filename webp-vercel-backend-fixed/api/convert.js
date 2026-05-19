export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, message: 'Backend working. Use POST with url, cloudName, uploadPreset.' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    const { url, cloudName, uploadPreset, folder } = req.body || {};
    if (!url || !cloudName || !uploadPreset) return res.status(400).json({ ok: false, error: 'url, cloudName and uploadPreset required' });

    const sourceUrl = isDirectImage(url) ? cleanUrl(url) : await findBestImage(url);
    if (!sourceUrl) return res.status(404).json({ ok: false, error: 'Image source not found on this page' });

    const uploaded = await uploadToCloudinary({ sourceUrl, cloudName, uploadPreset, folder });
    const originalUrl = uploaded.secure_url || uploaded.url;
    const webpUrl = makeWebpUrl(originalUrl);

    return res.status(200).json({ ok: true, webpUrl, url: webpUrl, cdnUrl: webpUrl, sourceUrl, originalUrl });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Backend conversion failed' });
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanUrl(u) { return String(u || '').trim().replace(/&amp;/g, '&'); }
function isDirectImage(u) { return /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff)(\?|#|$)/i.test(u || ''); }
function absolute(u, base) { try { return new URL(cleanUrl(u).replace(/\\\//g, '/'), base).href; } catch { return ''; } }

async function findBestImage(pageUrl) {
  const htmlRes = await fetch(pageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  if (!htmlRes.ok) throw new Error('Page fetch failed: ' + htmlRes.status);
  const html = await htmlRes.text();
  const base = htmlRes.url || pageUrl;
  const found = new Map();
  const add = (raw, source='html', bonus=0) => {
    const url = absolute(raw, base);
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    let score = bonus;
    if (source === 'meta') score += 120;
    if (source === 'srcset') score += 80;
    if (source === 'img') score += 60;
    if (/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i.test(url)) score += 40;
    if (/(large|full|original|photo|image|media|upload|free-ai-image|cdn)/i.test(url)) score += 20;
    if (/(logo|icon|avatar|sprite|favicon|placeholder|blank|loader|tracking|pixel)/i.test(url)) score -= 80;
    const prev = found.get(url);
    if (!prev || score > prev.score) found.set(url, { url, score, source });
  };

  const attr = '(?:content|href|src|data-src|data-original|data-lazy-src)=["\\']([^"\\']+)["\\']';
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/ig,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/ig
  ];
  for (const re of metaPatterns) for (const m of html.matchAll(re)) add(m[1], 'meta');

  for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/ig)) add(m[1], 'img');
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/ig)) {
    m[1].split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean).forEach(u => add(u, 'srcset'));
  }
  const directUrls = html.match(/https?:\\?\/\\?\/[^"'<>()\s]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'<>()\s]*)?/gi) || [];
  directUrls.slice(0, 600).forEach(u => add(u, 'regex'));

  const candidates = [...found.values()].sort((a,b) => b.score - a.score);
  if (!candidates.length) throw new Error('Image source not found in page HTML');
  return candidates[0].url;
}

async function uploadToCloudinary({ sourceUrl, cloudName, uploadPreset, folder }) {
  const imgRes = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'referer': new URL(sourceUrl).origin + '/'
    },
    redirect: 'follow'
  });
  if (!imgRes.ok) throw new Error('Image download failed: ' + imgRes.status);
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await imgRes.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: contentType });

  const fd = new FormData();
  fd.append('upload_preset', uploadPreset);
  if (folder) fd.append('folder', folder);
  fd.append('file', blob, 'source-image');

  const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd });
  const data = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(data?.error?.message || 'Cloudinary upload failed');
  return data;
}

function makeWebpUrl(u) {
  return String(u).replace('/upload/', '/upload/f_webp,q_auto:best/').replace(/\.(jpe?g|png|gif|avif|webp)(\?.*)?$/i, '.webp$2');
}
