import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST only' });
  return convertHandler(req, res);
}

export async function convertHandler(req, res) {
  try {
    const { url, cloudName, uploadPreset, folder } = req.body || {};
    if (!url || !cloudName || !uploadPreset) return res.status(400).json({ ok:false, error:'url, cloudName, uploadPreset required' });
    const imageUrl = isDirectImage(url) ? url : await extractBestImage(url);
    if (!imageUrl) return res.status(404).json({ ok:false, error:'Image source not found from this page.' });
    const uploaded = await uploadToCloudinary(imageUrl, cloudName, uploadPreset, folder || 'webp-cdn-source-maker');
    const webpUrl = makeWebpUrl(uploaded.secure_url || uploaded.url);
    return res.json({ ok:true, sourceUrl:imageUrl, webpUrl, upload: uploaded });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message || String(e) });
  }
}

function isDirectImage(u){ return /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff)(\?|#|$)/i.test(u); }
function abs(u, base){ try { return new URL(String(u||'').replace(/&amp;/g,'&'), base).href; } catch { return ''; } }
function scoreUrl(u){
  let s=50;
  if (/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u)) s+=30;
  if (/(large|full|original|photo|image|media|upload|free-ai-image)/i.test(u)) s+=20;
  if (/(logo|icon|avatar|sprite|favicon|placeholder|blank|loader|tracking|pixel)/i.test(u)) s-=60;
  return s;
}
async function extractBestImage(pageUrl){
  const r = await fetch(pageUrl, { headers: { 'user-agent':'Mozilla/5.0 Chrome/120 Safari/537.36', 'accept':'text/html,application/xhtml+xml' } });
  if (!r.ok) throw new Error('Page fetch failed: '+r.status);
  const html = await r.text();
  const $ = cheerio.load(html);
  const candidates = [];
  const add = (u, bonus=0) => { u=abs(u, pageUrl); if(!u || !/^https?:\/\//.test(u)) return; candidates.push({url:u, score:scoreUrl(u)+bonus}); };
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"],meta[name="twitter:image:src"]').each((_,el)=>add($(el).attr('content'),100));
  $('link[rel="image_src"],link[as="image"],link[rel="preload"][as="image"]').each((_,el)=>add($(el).attr('href'),70));
  $('img').each((_,el)=>{
    const src=$(el).attr('src')||$(el).attr('data-src')||$(el).attr('data-original')||$(el).attr('data-lazy-src'); add(src,40);
    const srcset=$(el).attr('srcset')||$(el).attr('data-srcset');
    if(srcset) srcset.split(',').forEach(p=>add(p.trim().split(/\s+/)[0],55));
  });
  const urls = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'<>\s]*)?/gi) || [];
  urls.slice(0,500).forEach(u=>add(u.replace(/\\\//g,'/'),20));
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]?.url || null;
}
async function uploadToCloudinary(fileUrl, cloudName, uploadPreset, folder){
  const fd = new FormData();
  fd.append('upload_preset', uploadPreset);
  if (folder) fd.append('folder', folder);
  fd.append('file', fileUrl);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method:'POST', body:fd });
  const data = await r.json();
  if(!r.ok) throw new Error(data.error?.message || 'Cloudinary upload failed');
  return data;
}
function makeWebpUrl(u){ return u.replace('/upload/','/upload/f_webp,q_auto:best/').replace(/\.(jpe?g|png|gif|avif|webp)(\?.*)?$/i,'.webp$2'); }
