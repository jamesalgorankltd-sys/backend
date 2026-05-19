async function fetchWithBrowserHeaders(url) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": new URL(url).origin + "/"
  };
  return fetch(url, { headers, redirect: "follow" });
}

function absolutize(src, base) {
  try { return new URL(src, base).href; } catch { return null; }
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

function extractImageCandidates(html, pageUrl) {
  const out = [];
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/ig,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/ig,
    /<img[^>]+src=["']([^"']+)["']/ig,
    /["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/ig
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) out.push(absolutize(m[1], pageUrl));
  }
  return uniq(out);
}

async function uploadRemoteToCloudinary({ imageUrl, cloudName, uploadPreset, folder }) {
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const form = new FormData();
  form.append("file", imageUrl);
  form.append("upload_preset", uploadPreset);
  if (folder) form.append("folder", folder);
  const r = await fetch(endpoint, { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Cloudinary upload failed ${r.status}`);
  return data;
}

function webpUrlFromCloudinary(data) {
  const secure = data.secure_url || data.url;
  if (!secure) return null;
  return secure.replace("/upload/", "/upload/f_webp,q_auto:best/").replace(/\.(jpg|jpeg|png|gif|avif|webp)(\?.*)?$/i, ".webp$2");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, message: "Backend working" });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { url, cloudName, uploadPreset, folder } = req.body || {};
    if (!url || !cloudName || !uploadPreset) {
      return res.status(400).json({ ok: false, error: "Missing url, cloudName, or uploadPreset" });
    }

    const directImage = /\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i.test(url);
    let finalImageUrl = url;

    if (!directImage) {
      const page = await fetchWithBrowserHeaders(url);
      if (!page.ok) {
        return res.status(200).json({ ok: false, blocked: true, error: `Page fetch failed: ${page.status}`, advice: "This website blocks server fetching. Open page in browser, copy direct image address, or drag/drop image." });
      }
      const html = await page.text();
      const candidates = extractImageCandidates(html, url);
      if (!candidates.length) {
        return res.status(200).json({ ok: false, error: "No image source found on page", advice: "Use direct image URL or drag/drop image." });
      }
      finalImageUrl = candidates[0];
    }

    const uploaded = await uploadRemoteToCloudinary({ imageUrl: finalImageUrl, cloudName, uploadPreset, folder });
    const webpUrl = webpUrlFromCloudinary(uploaded);
    return res.status(200).json({ ok: true, webpUrl, url: webpUrl, imageUrl: finalImageUrl, cloudinary: uploaded });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || "Backend conversion failed" });
  }
}
