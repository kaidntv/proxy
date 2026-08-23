export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // تنظيف المسار واستخراج الأجزاء
  let path = url.pathname.replace(/^\/+|\/+$/g, ''); 
  if (path.startsWith('api/')) {
    path = path.slice(4);
  } else if (path === 'api') {
    path = '';
  }
  
  const pathSegments = path.split('/');
  const BASE_KEY = "c!xZj+N9&G@Ev@vw";
  const YACINE_HEADERS = { 
    "Accept": "application/json", 
    "User-Agent": "okhttp/4.12.0" 
  };

  // دالة فك تشفير Yacine
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

  // استخراج رابط البث من البيانات المشفورة
  function extractUrlFromDecrypted(decryptedText) {
    if (!decryptedText) return "";
    let trimmed = decryptedText.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    try {
      const json = JSON.parse(trimmed);
      const servers = json.data?.servers || json.servers || json.data || json;
      if (Array.isArray(servers) && servers.length > 0) {
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

  // معالجة جلب ملف الميديا المباشر
  async function handleStreamPlayback(targetId, type = "channel") {
    try {
      const apiUrl = type === "event" 
        ? `https://def.yacinelive.com/api/event/${targetId}`
        : `https://def.yacinelive.com/api/channel/${targetId}`;

      const res = await fetch(apiUrl, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      const t = res.headers.get('T') || res.headers.get('t') || "";
      if (!t) {
        return new Response("Invalid ID or decryption key missing", { status: 404 });
      }

      const decryptedText = decryptYacine(await res.text(), t);
      const rawRedirectUrl = extractUrlFromDecrypted(decryptedText);

      if (!rawRedirectUrl) {
        return new Response("Stream URL not found", { status: 404 });
      }

      // تتبع إعادة التوجيه 302 مع إرسال الهيدرات المطلوبة للتطبيق
      const redirectRes = await fetch(rawRedirectUrl, {
        headers: {
          "User-Agent": "okhttp/4.12.0",
          "Referer": "http://re.ycn-redirect.com/"
        },
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!redirectRes.ok) {
        return new Response(`Redirect error: ${redirectRes.status}`, { status: redirectRes.status });
      }

      const finalUrl = redirectRes.url;
      const streamRes = await fetch(finalUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://x.com/"
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) {
        return new Response(`CDN Stream error: ${streamRes.status}`, { status: streamRes.status });
      }

      const playlistText = await streamRes.text();

      // إعادة كتابة المسارات إلى روابط كاملة لملاءمة جميع المشغلات والمتصفحات
      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
          if (trimmed.includes('URI=')) {
            return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
              try {
                return `URI="${new URL(uriValue, finalUrl).href}"`;
              } catch (e) {
                return match;
              }
            });
          }
          return line;
        }

        try {
          return new URL(trimmed, finalUrl).href;
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
      return new Response(`Stream Error: ${err.message}`, { status: 500 });
    }
  }

  // 1. جلب المباريات: /events أو /api/events
  if (path === "events") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*" 
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } 
      });
    }
  }

  // 2. تشغيل القناة المباشرة: /channel/1424.m3u8 أو /api/channel/1424.m3u8
  if (pathSegments[0] === "channel" && pathSegments.length > 1) {
    const rawId = pathSegments[1];
    const channelId = rawId.replace(".m3u8", "");
    return await handleStreamPlayback(channelId, "channel");
  }

  // 3. تشغيل أو جلب تفاصيل المباراة: /events/123.m3u8
  if (pathSegments[0] === "events" && pathSegments.length > 1) {
    const rawId = pathSegments[1];
    const eventId = rawId.replace(".m3u8", "");
    
    if (rawId.endsWith(".m3u8")) {
      return await handleStreamPlayback(eventId, "event");
    }

    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      if (!t) {
        return new Response(JSON.stringify({ error: "Invalid Event ID" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      const decryptedText = decryptYacine(await res.text(), t);
      return new Response(decryptedText, {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*" 
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Endpoint not found" }), { 
    status: 404, 
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
  });
}
