const CACHE_DURATION = {
  channels: 2592000000,     // 30 يوم
  categories: 2592000000,   // 30 يوم
  events: 36000000,         // 10 ساعات
  stream_url: 2592000000,   // 30 يوم
  stream_session: 1800000,  // 30 دقيقة
  m3u8_cache: 30            // 30 ثانية
};

const SECRET_KEY = "Yacine2026@SecretKey!";
const ADMIN_PASSWORD = "Admin@2026";
const GITHUB_STREAM = "https://raw.githubusercontent.com/alysjc7-dot/site/refs/heads/main/log/bMjeyq.m3u8";

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const cache = caches.default;
  
  // المسار من params
  const subPath = (params.path || []).join('/');
  const origin = url.origin;
  
  // ====== لوحة التحكم ======
  if (subPath === "admin" || subPath === "admin/") {
    const adminAction = url.searchParams.get('action') || '';
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
            button:hover { background: #ddd; }
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
    
    if (adminAction === 'toggle') {
      try {
        const current = await env.YACINE_CACHE.get('stream_mode', 'text') || 'yacine';
        const newMode = current === 'yacine' ? 'github' : 'yacine';
        await env.YACINE_CACHE.put('stream_mode', newMode);
        return Response.redirect('/api/admin?pass=' + adminPass + '&msg=' + (newMode === 'github' ? 'تم التبديل إلى GitHub Stream' : 'تم التبديل إلى Yacine'));
      } catch (e) {
        return new Response('Error: ' + e.message, { status: 500 });
      }
    }
    
    const currentMode = await env.YACINE_CACHE.get('stream_mode', 'text') || 'yacine';
    const msg = url.searchParams.get('msg') || '';
    
    return new Response(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>لوحة التحكم</title>
        <style>
          body { background: #0a0a0b; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .panel { background: #16161a; padding: 30px; border-radius: 15px; text-align: center; border: 1px solid rgba(255,255,255,0.2); max-width: 400px; }
          .mode-badge { display: inline-block; padding: 10px 20px; border-radius: 10px; font-weight: bold; font-size: 18px; margin: 20px 0; }
          .mode-yacine { background: #1a3a1a; color: #4ade80; border: 2px solid #4ade80; }
          .mode-github { background: #1a1a3a; color: #60a5fa; border: 2px solid #60a5fa; }
          button { padding: 15px 40px; border-radius: 10px; border: none; font-weight: bold; cursor: pointer; font-size: 18px; margin-top: 20px; }
          .btn-toggle { background: #fff; color: #000; }
          .btn-toggle:hover { background: #ddd; }
          .msg { color: #4ade80; margin: 10px 0; font-weight: bold; }
          .info { color: #888; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="panel">
          <h2>🎛️ لوحة التحكم</h2>
          ${msg ? `<div class="msg">✅ ${msg}</div>` : ''}
          <p>وضع البث الحالي:</p>
          <div class="mode-badge ${currentMode === 'github' ? 'mode-github' : 'mode-yacine'}">
            ${currentMode === 'github' ? '🔵 GitHub Stream' : '🟢 Yacine Stream'}
          </div>
          <br>
          <a href="/api/admin?pass=${adminPass}&action=toggle">
            <button class="btn-toggle">🔄 تبديل الوضع</button>
          </a>
          <div class="info">
            <p>الرابط الحالي: ${currentMode === 'github' ? GITHUB_STREAM : 'Yacine API'}</p>
          </div>
        </div>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }
  
  // ====== حماية من البوتات ======
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
  const blockedBots = ['bot', 'crawler', 'spider', 'scanner', 'curl', 'wget', 'python', 'go-http', 'java'];
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
      const servers = json.data?.servers || json.servers || json.data;
      if (Array.isArray(servers) && servers.length > 0) {
        const first = servers[0];
        if (first && typeof first === 'object') {
          return first.url || first.file || first.link || "";
        }
        if (first && typeof first === 'string') {
          return first;
        }
      }
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
      const res = await fetch("https://def.yacinelive.com/api/categories", { 
        headers: YACINE_HEADERS
      });
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
        const res = await fetch(`https://def.yacinelive.com/api/categories/${catId}/channels`, { 
          headers: YACINE_HEADERS
        });
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

  // ====== 3. القنوات حسب التصنيف ======
  if (subPath.startsWith("categories/") && subPath.endsWith("/channels")) {
    const categoryId = subPath.split("/")[1] || "1";
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/categories/${categoryId}/channels`, { 
        headers: YACINE_HEADERS
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      
      const parsed = JSON.parse(data);
      const list = parsed.data || parsed;
      if (Array.isArray(list)) {
        list.forEach(ch => {
          const chId = ch.id || ch.channel_id;
          if (chId) {
            ch.streams = [{ quality: "Server 1", url: `${origin}/api/stream/${chId}.m3u8` }];
            ch.stream_url = `${origin}/api/stream/${chId}.m3u8`;
          }
        });
      }
      
      const response = new Response(JSON.stringify(parsed), {
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

  // ====== 4. المباريات ======
  if (subPath === "events") {
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { 
        headers: YACINE_HEADERS
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      
      const response = new Response(data, {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=36000"
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

  // ====== 5. البث ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    
    // Cache API للـ M3U8
    const m3u8CacheKey = new Request(url.toString());
    const cachedM3u8 = await cache.match(m3u8CacheKey);
    if (cachedM3u8) return cachedM3u8;

    try {
      const streamMode = await env.YACINE_CACHE.get('stream_mode', 'text') || 'yacine';
      
      // وضع GitHub
      if (streamMode === 'github') {
        const githubRes = await fetch(GITHUB_STREAM, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        if (!githubRes.ok) {
          return new Response(`GitHub Error: ${githubRes.status}`, { status: githubRes.status });
        }
        
        const githubPlaylist = await githubRes.text();
        const githubParsed = new URL(GITHUB_STREAM);
        const githubOrigin = githubParsed.origin;
        const githubPath = githubParsed.pathname.replace(/\/[^\/]+$/, '');
        
        const githubLines = githubPlaylist.split('\n').map(line => {
          let trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) return line;
          try {
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
            if (trimmed.startsWith('/')) return githubOrigin + trimmed;
            return `${githubOrigin}${githubPath}/${trimmed}`;
          } catch (e) {
            return trimmed;
          }
        });
        
        return new Response(githubLines.join('\n'), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30"
          }
        });
      }
      
      // وضع Yacine
      const sessionKey = `stream_url_${targetId}_${serverIndex}`;
      let finalCdnPlaylistUrl = "";
      
      try {
        const cached = await env.YACINE_CACHE.get(sessionKey, 'json');
        if (cached && cached.url && (Date.now() - cached.time < CACHE_DURATION.stream_session)) {
          finalCdnPlaylistUrl = cached.url;
        }
      } catch (e) {}

      if (!finalCdnPlaylistUrl) {
        const res = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
          headers: YACINE_HEADERS
        });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const decryptedText = decryptYacine(await res.text(), t);
        
        let rawRedirectUrl = extractUrlFromDecrypted(decryptedText);
        if (!rawRedirectUrl) return new Response("Stream URL not found", { status: 404 });

        const redirectRes = await fetch(rawRedirectUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://x.com/"
          },
          redirect: "follow",
          cf: { cacheTtl: 0, cacheEverything: false }
        });

        if (!redirectRes.ok) {
          try { await env.YACINE_CACHE.delete(sessionKey); } catch (e) {}
          return new Response(`Redirect Error: ${redirectRes.status}`, { status: redirectRes.status });
        }

        finalCdnPlaylistUrl = redirectRes.url;
        try {
          await env.YACINE_CACHE.put(sessionKey, JSON.stringify({ url: finalCdnPlaylistUrl, time: Date.now() }), {
            expirationTtl: Math.floor(CACHE_DURATION.stream_session / 1000)
          });
        } catch (e) {}
      }

      const streamRes = await fetch(finalCdnPlaylistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://x.com/"
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) {
        try { await env.YACINE_CACHE.delete(sessionKey); } catch (e) {}
        return new Response(`CDN Error: ${streamRes.status}`, { status: streamRes.status });
      }

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url;
      const parsedFinalUrl = new URL(finalUrl);
      const cdnOrigin = parsedFinalUrl.origin;

      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          if (trimmed.includes('URI=')) {
            return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
              try {
                return `URI="${new URL(uriValue, cdnOrigin).href}"`;
              } catch (e) {
                return match;
              }
            });
          }
          return line;
        }
        try {
          if (trimmed.startsWith('/')) {
            return cdnOrigin + trimmed;
          }
          return new URL(trimmed, finalUrl).href.split('?')[0];
        } catch (e) {
          return trimmed;
        }
      });

      const finalM3u8 = rewrittenLines.join('\n');
      
      const response = new Response(finalM3u8, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=30"
        }
      });
      
      // خزن في Cache API (مجاني وغير محدود)
      context.waitUntil(cache.put(m3u8CacheKey, response.clone()));
      
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
