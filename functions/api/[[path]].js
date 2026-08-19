// ذاكرة مؤقتة لتثبيت جلسة القناة وضمان عدم تغير السيرفر فجأة أثناء التحديث
const urlCache = new Map();

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const pathSegments = params.path || [];
  const subPath = pathSegments.join('/');
  const origin = url.origin;

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

  // 1. جلب قائمة المباريات
  if (subPath === "events") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // 2. جلب التصنيفات
  if (subPath === "categories") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // 3. جلب قنوات تصنيف معين
  if (subPath.startsWith("categories/") && subPath.endsWith("/channels")) {
    const categoryId = subPath.split("/")[1] || "1";
    try {
      const res = await fetch(`https://def.yacinelive.com/api/categories/${categoryId}/channels`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = JSON.parse(decryptYacine(await res.text(), t));
      
      const list = data.data || data;
      if (Array.isArray(list)) {
        list.forEach(ch => {
          const chId = ch.id || ch.channel_id;
          if (chId) {
            ch.streams = [{ quality: "Server 1", url: `${origin}/api/stream/${chId}.m3u8` }];
            ch.stream_url = `${origin}/api/stream/${chId}.m3u8`;
          }
        });
      }
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // 4. توليد ملف M3U8 مع ثبات الجلسة (Session Caching) لمنع التوقف والتقطيع
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    const cacheKey = `${targetId}_${serverIndex}`;

    try {
      let rawUrl = "";
      const cachedData = urlCache.get(cacheKey);
      const now = Date.now();

      // إذا كان هناك رابط مخزن ولم يمض عليه دقيقتان، نستخدمه لضمان استقرار المشغل وعدم تغير السيرفر
      if (cachedData && (now - cachedData.time < 120000)) {
        rawUrl = cachedData.url;
      } else {
        // جلب جديد من API ياسين
        try {
          const eventRes = await fetch(`https://def.yacinelive.com/api/event/${targetId}`, { 
            headers: YACINE_HEADERS,
            cf: { cacheTtl: 0, cacheEverything: false }
          });
          const eventT = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
          const eventData = JSON.parse(decryptYacine(await eventRes.text(), eventT));
          const rawServers = eventData.data?.servers || eventData.servers || eventData.data || eventData;
          if (Array.isArray(rawServers)) {
            const selectedServer = rawServers[serverIndex] || rawServers[0];
            rawUrl = selectedServer?.url || selectedServer?.file || selectedServer?.link || "";
          }
        } catch (e) {}

        if (!rawUrl) {
          try {
            const chRes = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
              headers: YACINE_HEADERS,
              cf: { cacheTtl: 0, cacheEverything: false }
            });
            const chT = chRes.headers.get('T') || chRes.headers.get('t') || "";
            const chData = JSON.parse(decryptYacine(await chRes.text(), chT));
            const servers = chData.data || chData || [];
            const selectedServer = (Array.isArray(servers) ? servers : [servers])[serverIndex] || servers[0];
            rawUrl = selectedServer?.url || selectedServer?.file || "";
          } catch (e) {}
        }

        if (rawUrl) {
          urlCache.set(cacheKey, { url: rawUrl, time: now });
        }
      }

      if (!rawUrl) return new Response("Stream URL not found", { status: 404 });

      const streamRes = await fetch(rawUrl, {
        headers: {
          "User-Agent": "okhttp/4.12.0",
          "Referer": "http://re.ycn-redirect.com/"
        },
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) {
        // إذا فشل الرابط المخزن (انتهت صلاحيته فعلياً)، نحذفه لكي يجلب رابطاً جديداً في المحاولة التالية
        urlCache.delete(cacheKey);
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

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Yacine Session-Locked Worker Active!", { headers: { "Content-Type": "text/plain" } });
}
