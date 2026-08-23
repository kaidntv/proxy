const SECRET_KEY = "Yacine2026@SecretKey!";
const ADMIN_PASSWORD = "Admin@2026";

export async function onRequest(context) {
  const { request, params } = context;
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

  // ====== 3. البث - Proxy مع Headers من JSON ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
        headers: YACINE_HEADERS,
        cache: "no-store"
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      // استخرج JSON كامل
      const json = JSON.parse(decryptedText);
      const server = json.data[0];
      
      const streamUrl = server.url.replace(/\\u0026/g, '&');
      const userAgent = server.headers?.["User-Agent"] || server.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
      const referer = server.headers?.["Referer"] || server.referer || "https://x.com/";
      
      // جلب M3U8 مع Headers الصحيحة
      const m3u8Res = await fetch(streamUrl, {
        headers: {
          "User-Agent": userAgent,
          "Referer": referer,
          "Accept": "*/*"
        },
        cache: "no-store"
      });
      
      if (!m3u8Res.ok) {
        return new Response(`CDN Error: ${m3u8Res.status}`, { status: m3u8Res.status });
      }
      
      const playlistText = await m3u8Res.text();
      
      // إعادة كتابة المسارات
      const parsedUrl = new URL(streamUrl);
      const cdnOrigin = parsedUrl.origin;
      const cdnPath = parsedUrl.pathname.replace(/\/[^\/]+$/, '');
      
      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) return line;
        try {
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
          if (trimmed.startsWith('/')) return cdnOrigin + trimmed;
          return `${cdnOrigin}${cdnPath}/${trimmed}`;
        } catch (e) {
          return trimmed;
        }
      });
      
      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });

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
