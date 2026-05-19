const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff)(\?|#|$)/i;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isDirectImage(url) {
  return IMAGE_EXT_RE.test(url || '');
}

function absoluteUrl(src, base) {
  try { return new URL(src, base).href; } catch { return ''; }
}

function cleanUrl(u) {
  return String(u || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')
    .trim();
}

function firstSrcsetUrl(srcset) {
  if (!srcset) return '';
  return srcset.split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean).pop() || '';
}

async function findImageFromPage(pageUrl) {
  const r = await fetch(pageUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });
  if (!r.ok) throw new Error('Page fetch failed: ' + r.status);
  const html = await r.text();

  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return absoluteUrl(cleanUrl(m[1]), pageUrl);
  }

  const srcsetMatches = [...html.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)]
    .map(m => absoluteUrl(cleanUrl(firstSrcsetUrl(m[1])), pageUrl))
    .filter(Boolean)
    .filter(u => !/(logo|icon|avatar|sprite|favicon|placeholder)/i.test(u));
  if (srcsetMatches[0]) return srcsetMatches[0];

  const imageMatches = [...html.matchAll(/(?:src|data-src|data-original|data-lazy-src)=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi)]
    .map(m => absoluteUrl(cleanUrl(m[1]), pageUrl))
    .filter(Boolean)
    .filter(u => !/(logo|icon|avatar|sprite|favicon|placeholder)/i.test(u));
  if (imageMatches[0]) return imageMatches[0];

  const raw = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'<>\s]*)?/i);
  if (raw?.[0]) return cleanUrl(raw[0]);

  throw new Error('Image source not found on this page. Try direct image URL.');
}

async function uploadToCloudinary(imageUrl, cloudName, uploadPreset, folder) {
  const fd = new FormData();
  fd.append('file', imageUrl);
  fd.append('upload_preset', uploadPreset);
  if (folder) fd.append('folder', folder);

  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: fd
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || 'Cloudinary upload failed');
  return data;
}

function makeWebpUrl(url) {
  if (!url) return '';
  let u = url.replace('/upload/', '/upload/f_webp,q_auto:best/');
  u = u.replace(/\.(jpe?g|png|gif|avif|webp)(\?.*)?$/i, '.webp$2');
  return u;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Backend working' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { url, cloudName, uploadPreset, folder } = req.body || {};
    if (!url) throw new Error('URL missing');
    if (!cloudName) throw new Error('Cloudinary cloud name missing');
    if (!uploadPreset) throw new Error('Cloudinary upload preset missing');

    const sourceUrl = isDirectImage(url) ? url : await findImageFromPage(url);
    const uploaded = await uploadToCloudinary(sourceUrl, cloudName, uploadPreset, folder || 'webp-cdn-source-maker');
    const webpUrl = makeWebpUrl(uploaded.secure_url || uploaded.url);

    return res.status(200).json({
      ok: true,
      sourceUrl,
      webpUrl,
      url: webpUrl,
      secure_url: webpUrl,
      public_id: uploaded.public_id,
      html: `<img src="${webpUrl}" alt="" loading="lazy">`
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Backend conversion failed' });
  }
}
