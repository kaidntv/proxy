const CACHE_DURATION = {
  channels: 2592000000,
  categories: 2592000000,
  events: 36000000,
  stream_url: 1800000,
  redirect_cache: 1800
};

const SECRET_KEY = "Yacine2026@SecretKey!";
const ADMIN_PASSWORD = "Admin@2026";
const GITHUB_STREAM = "https://raw.githubusercontent.com/alysjc7-dot/site/refs/heads/main/log/bMjeyq.m3u8";

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const cache = caches.default;
  
  const subPath = (params.path || []).join('/');
  const origin = url.origin;
  
  // ====== لوحة التحكم ======
  if (subPath === "admin" || subPath === "admin/") {
    const adminPass = url.searchParams.get('pass') || '';
    
    if (adminPass !== ADMIN_PASSWORD) {
      return new Response(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>لوحة التحكم</title>
          <style>
            body { background: #0a0a0b; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .login-box { background: #16161a; padding: 30px; border-radius: 15px; text-align: center; border: 1px solid rgba(255,255,255,0.2); }
            input { padding: 12px; border-radius: 8px; border: 1px solid #333; background: #1c1c21; color: #fff; font-size: 16px; width: 250px; text-align: center; }
            button { padding: 12px 30px; border-radius: 8px; border: none; background: #fff; color: #000; font-weight: bold; cursor: pointer; margin-top: 10px; font-size: 16px; }
          </style>
        </head>
        <body>
          <div class="login-box">
            <h2>🔒 لوحة التحكم</h2>
            <p>أدخل كلمة المرور</p>
            <form method="GET" action="/api/admin">
              <input type="password" name="pass" placeholder="كلمة المرور" autofocus>
              <br>
              <button type="submit">دخول</button>
            </form>
          </div>
        </body>
        </html>
      `, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }
    
    return new Response(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>لوحة التحكم</title>
        <style>
          body { background: #0a0a0b; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .panel { background: #16161a; padding: 30px; border-radius: 15px; text-align: center; border: 1px solid rgba(255,255,255,0.2); max-width: 400px; }
          .info { color: #4ade80; font-size: 18px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="panel">
          <h2>✅ لوحة التحكم تعمل</h2>
          <p class="info">النظام يعمل بشكل صحيح</p>
        </div>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }
  
  // ====== حماية ======
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
  const blockedBots = ['bot', 'crawler', 'spider', 'scanner', 'curl', 'wget'];
  if (blockedBots.some(bot => userAgent.includes(bot))) {
    return new Response('Forbidden', { status: 403 });
  }

  const BASE_KEY = "c!xZj+N9&G@Ev@vw";
  const YACINE_HEADERS = { 
    "Accept": "application/json", 
    "User-Agent": "okhttp/4.12.0" 
  };

  function decryptYacine(encryptedData, headerT) {
    const fullKey = BASE_KEY + headerT;
    const binaryString = atob(encryptedData);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const fullKeyBytes = new TextEncoder().encode(fullKey);
    const decrypted = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      decrypted[i] = bytes[i] ^ fullKeyBytes[i % fullKeyBytes.length];
    }
    return new TextDecoder().decode(decrypted);
  }

  function extractUrlFromDecrypted(decryptedText) {
    if (!decryptedText) return "";
    let trimmed = decryptedText.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    try {
      const json = JSON.parse(trimmed);
      const findUrl = (obj) => {
        if (!obj) return "";
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = findUrl(item);
            if (found) return found;
          }
          return "";
        }
        if (typeof obj === 'object') {
          const urlProps = ['url', 'file', 'link', 'stream_url', 'play_url', 'src'];
          for (const prop of urlProps) {
            if (obj[prop] && typeof obj[prop] === 'string' && 
                (obj[prop].startsWith('http://') || obj[prop].startsWith('https://'))) {
              return obj[prop];
            }
          }
          for (const key in obj) {
            if (obj[key] && typeof obj[key] === 'string' && 
                (obj[key].startsWith('http://') || obj[key].startsWith('https://'))) {
              return obj[key];
            }
          }
          for (const key in obj) {
            if (typeof obj[key] === 'object') {
              const found = findUrl(obj[key]);
              if (found) return found;
            }
          }
        }
        return "";
      };
      const foundUrl = findUrl(json);
      if (foundUrl) return foundUrl;
    } catch (e) {}
    const urlMatch = trimmed.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) return urlMatch[0];
    return "";
  }

  // ====== 1. التصنيفات ======
  if (subPath === "categories") {
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      
      const response = new Response(data, {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2592000"
        }
      });
      
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // ====== 2. كل القنوات ======
  if (subPath === "all-channels") {
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const categories = [4, 5, 6, 7];
      const qualityNames = { 4: '1080p', 5: '720p', 6: '360p', 7: '244p' };
      const allChannels = {};
      
      for (const catId of categories) {
        const res = await fetch(`https://def.yacinelive.com/api/categories/${catId}/channels`, { headers: YACINE_HEADERS });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const data = decryptYacine(await res.text(), t);
        
        const parsed = JSON.parse(data);
        const list = parsed.data || [];
        
        list.forEach(ch => {
          const chName = ch.name;
          const chId = ch.id || ch.channel_id;
          
          if (!allChannels[chName]) {
            allChannels[chName] = {
              name: chName,
              logo: ch.logo,
              qualities: {}
            };
          }
          
          allChannels[chName].qualities[qualityNames[catId]] = `${origin}/api/stream/${chId}.m3u8`;
        });
      }
      
      const channelsArray = Object.values(allChannels);
      const response = new Response(JSON.stringify({ data: channelsArray }), {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2592000"
        }
      });
      
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // ====== 3. البث - Redirect مباشر ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    
    const redirectCacheKey = new Request(`https://redirect/${targetId}`);
    const cachedRedirect = await cache.match(redirectCacheKey);
    if (cachedRedirect) {
      return cachedRedirect;
    }
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      let rawRedirectUrl = extractUrlFromDecrypted(decryptedText);
      if (!rawRedirectUrl) return new Response("Stream URL not found", { status: 404 });

      const redirectRes = await fetch(rawRedirectUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://x.com/"
        },
        redirect: "follow"
      });

      if (!redirectRes.ok) {
        return new Response(`Redirect Error: ${redirectRes.status}`, { status: redirectRes.status });
      }

      const finalCdnUrl = redirectRes.url;
      
      // إنشاء Redirect بدون تعديل headers
      const response = new Response(null, {
        status: 302,
        headers: {
          "Location": finalCdnUrl,
          "Cache-Control": "public, max-age=1800",
          "Access-Control-Allow-Origin": "*"
        }
      });
      
      context.waitUntil(cache.put(redirectCacheKey, response.clone()));
      
      return response;

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, headers: { "Content-Type": "application/json" } 
      });
    }
  }

  return new Response("Yacine Stable-Session Worker Active!", { 
    headers: { "Content-Type": "text/plain" } 
  });
}
