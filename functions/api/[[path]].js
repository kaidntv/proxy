const activeSessions = new Map();
const playlistCache = new Map(); // <--- الميزة المضافة: تخزين مؤقت لملف البث لمدة 3 ثوانٍ لتخفيف الطلبات

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

  function extractUrlFromDecrypted(decryptedText) {
    if (!decryptedText) return "";
    let trimmed = decryptedText.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    try {
      const json = JSON.parse(trimmed);
      const servers = json.data?.servers || json.servers || json.data || json;
      if (Array.isArray(servers)) {
        const s = servers[0];
        return s?.url || s?.file || s?.link || "";
      } else if (typeof servers === 'object' && servers !== null) {
        return servers.url || servers.file || servers.link || "";
      } else if (typeof servers === 'string' && (servers.startsWith('http://') || servers.startsWith('https://'))) {
        return servers;
      }
    } catch (e) {
      const match = decryptedText.match(/https?:\/\/[^\s"']+/);
      if (match) return match[0];
    }
    return "";
  }

  // 1. جلب المباريات
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

  // 1.5. جلب تفاصيل مباراة/حدث معين وسيرفراتها (/api/events/{id})
  if (subPath.startsWith("events/") && subPath !== "events") {
    const eventId = subPath.split("/")[1];
    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      let streamsList = [{ quality: "Server 1", url: `${origin}/api/stream/${eventId}.m3u8` }];
      try {
        const json = JSON.parse(decryptedText);
        const servers = json.data?.servers || json.servers || json.data;
        if (Array.isArray(servers) && servers.length > 0) {
          streamsList = servers.map((s, idx) => ({
            quality: s.quality || `Server ${idx + 1}`,
            url: `${origin}/api/stream/${eventId}.m3u8?server=${idx}`
          }));
        }
      } catch (e) {}

      return new Response(JSON.stringify({ streams: streamsList }), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ streams: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
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

  // 3. جلب القنوات
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

  // 4. معالجة البث وتثبيت رابط الـ CDN النهائي مع التخزين المؤقت الذكي
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    const sessionKey = `${targetId}_${serverIndex}`;
    const now = Date.now();

    // فحص الكاش: إذا طلب المستخدمون نفس البث خلال أقل من 3 ثوانٍ، نرسل النتيجة المخزنة مباشرة لتوفير الطلبات
    const cachedItem = playlistCache.get(sessionKey);
    if (cachedItem && (now - cachedItem.time < 3000)) {
      return new Response(cachedItem.text, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
        }
      });
    }

    try {
      let finalCdnPlaylistUrl = "";
      const session = activeSessions.get(sessionKey);

      // إذا كانت الجلسة محفوظة ولم يمض عليها 15 دقيقة، نستخدم رابط الـ CDN النهائي الثابت مباشرة
      if (session && (now - session.time < 900000)) {
        finalCdnPlaylistUrl = session.url;
      } else {
        let rawRedirectUrl = "";

        // جلب وفك تشفير بيانات القناة لمرة واحدة
        try {
          const chRes = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
            headers: YACINE_HEADERS,
            cf: { cacheTtl: 0, cacheEverything: false }
          });
          const chT = chRes.headers.get('T') || chRes.headers.get('t') || "";
          const decryptedText = decryptYacine(await chRes.text(), chT);
          rawRedirectUrl = extractUrlFromDecrypted(decryptedText);
        } catch (e) {}

        if (!rawRedirectUrl) {
          try {
            const eventRes = await fetch(`https://def.yacinelive.com/api/event/${targetId}`, { 
              headers: YACINE_HEADERS,
              cf: { cacheTtl: 0, cacheEverything: false }
            });
            const eventT = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
            const decryptedText = decryptYacine(await eventRes.text(), eventT);
            rawRedirectUrl = extractUrlFromDecrypted(decryptedText);
          } catch (e) {}
        }

        if (!rawRedirectUrl) return new Response("Stream URL not found", { status: 404 });

        // اتباع الـ Redirect (302) للحصول على رابط الـ CDN النهائي واستقرار المسار
        const redirectRes = await fetch(rawRedirectUrl, {
          headers: {
            "User-Agent": "okhttp/4.12.0",
            "Referer": "http://re.ycn-redirect.com/"
          },
          redirect: "follow",
          cf: { cacheTtl: 0, cacheEverything: false }
        });

        if (!redirectRes.ok) return new Response(`Redirect Error: ${redirectRes.status}`, { status: redirectRes.status });

        finalCdnPlaylistUrl = redirectRes.url; // رابط الـ CDN النهائي والثابت
        activeSessions.set(sessionKey, { url: finalCdnPlaylistUrl, time: now });
      }

      // جلب ملف الـ M3U8 مباشرة من نفس سيرفر الـ CDN الثابت
      const streamRes = await fetch(finalCdnPlaylistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://x.com/"
        },
        cf: { cacheTttl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) {
        activeSessions.delete(sessionKey);
        return new Response(`CDN Error: ${streamRes.status}`, { status: streamRes.status });
      }

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url; 
      const parsedFinalUrl = new URL(finalUrl);
      const cdnOrigin = parsedFinalUrl.origin; 

      // إعادة كتابة المسارات النسبية للقطع لتعمل بسلاسة مطلقة
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

      const finalResponseText = rewrittenLines.join('\n');

      // حفظ النتيجة في الكاش لتوفير الطلبات المتكررة
      playlistCache.set(sessionKey, { text: finalResponseText, time: now });

      return new Response(finalResponseText, {
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

  return new Response("Yacine Stable-Session Worker Active!", { headers: { "Content-Type": "text/plain" } });
}
