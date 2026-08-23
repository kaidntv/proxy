const CACHE_DURATION = {
  events: 36000000,
  stream_url: 2592000000,
  stream_session: 1800000,
  m3u8_cache: 30
};

const BASE_KEY = "c!xZj+N9&G@Ev@vw";
const YACINE_HEADERS = { 
  "Accept": "application/json", 
  "User-Agent": "okhttp/4.12.0" 
};

export async function onRequest(context) {
  const { request, params, env } = context;
  const url = new URL(request.url);
  const subPath = (params.path || []).join('/');
  const origin = url.origin;

  function decryptYacine(encryptedData, headerT) {
    const fullKey = BASE_KEY + headerT;
    const binaryString = atob(encryptedData);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    const fullKeyBytes = new TextEncoder().encode(fullKey);
    const decrypted = new Uint8Array(len);
    for (let i = 0; i < len; i++) decrypted[i] = bytes[i] ^ fullKeyBytes[i % fullKeyBytes.length];
    return new TextDecoder().decode(decrypted);
  }

  async function getCachedOrFetch(cacheKey, fetchUrl, duration) {
    const now = Date.now();
    try {
      const cached = await env.YACINE_CACHE.get(cacheKey, 'json');
      if (cached && cached.data && (now - cached.time < duration)) return cached.data;
    } catch (e) {}
    const res = await fetch(fetchUrl, { headers: YACINE_HEADERS });
    const t = res.headers.get('T') || res.headers.get('t') || "";
    const data = decryptYacine(await res.text(), t);
    try {
      await env.YACINE_CACHE.put(cacheKey, JSON.stringify({ data, time: now }), { expirationTtl: Math.floor(duration / 1000) });
    } catch (e) {}
    return data;
  }

  // ====== 1. المباريات ======
  if (subPath === "events") {
    try {
      const data = await getCachedOrFetch("events_v1", "https://def.yacinelive.com/api/events", CACHE_DURATION.events);
      return new Response(data, {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=36000" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // ====== 2. تفاصيل مباراة - يرجع streams ======
  if (subPath.startsWith("events/")) {
    const eventId = subPath.split("/")[1];
    try {
      const data = await getCachedOrFetch(`event_v1_${eventId}`, `https://def.yacinelive.com/api/event/${eventId}`, CACHE_DURATION.events);
      const json = JSON.parse(data);
      const servers = json.data || [];
      
      const streams = servers.map((s, idx) => ({
        quality: s.name || `Server ${idx + 1}`,
        url: `${origin}/api/stream/${eventId}.m3u8?server=${idx}`
      }));
      
      return new Response(JSON.stringify({ streams }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=36000" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ streams: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // ====== 3. البث - يستخدم event data مباشرة ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const eventId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    const m3u8CacheKey = `m3u8_${eventId}_${serverIndex}`;

    try {
      // جرب من الكاش
      try {
        const cachedM3u8 = await env.YACINE_CACHE.get(m3u8CacheKey, 'text');
        if (cachedM3u8) {
          return new Response(cachedM3u8, {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=10" }
          });
        }
      } catch (e) {}

      // جلب بيانات الحدث
      const eventData = await getCachedOrFetch(
        `event_v1_${eventId}`, 
        `https://def.yacinelive.com/api/event/${eventId}`, 
        CACHE_DURATION.events
      );
      
      const json = JSON.parse(eventData);
      const servers = json.data || [];
      const server = servers[serverIndex] || servers[0];
      
      if (!server || !server.url) {
        return new Response("No stream available", { status: 404 });
      }
      
      const streamUrl = server.url.replace(/\\u0026/g, '&');
      const userAgent = server.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
      const referer = server.referer || "";
      
      // جلب M3U8 مع Headers
      const headers = {
        "User-Agent": userAgent,
        "Accept": "*/*"
      };
      if (referer && referer !== '') headers["Referer"] = referer;
      
      const m3u8Res = await fetch(streamUrl, { headers });
      
      if (!m3u8Res.ok) {
        return new Response(`CDN Error: ${m3u8Res.status}`, { status: m3u8Res.status });
      }
      
      const playlistText = await m3u8Res.text();
      
      // إعادة كتابة المسارات
      const parsedUrl = new URL(streamUrl);
      const cdnOrigin = parsedUrl.origin;
      const cdnPath = parsedUrl.pathname.replace(/\/[^\/]+$/, '');
      
      const rewritten = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
          if (trimmed.startsWith('/')) return cdnOrigin + trimmed;
          return `${cdnOrigin}${cdnPath}/${trimmed}`;
        } catch (e) { return line; }
      });
      
      const finalM3u8 = rewritten.join('\n');
      
      // خزن في الكاش
      try { 
        await env.YACINE_CACHE.put(m3u8CacheKey, finalM3u8, { expirationTtl: CACHE_DURATION.m3u8_cache }); 
      } catch (e) {}
      
      return new Response(finalM3u8, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=10"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Yacine Active!", { headers: { "Content-Type": "text/plain" } });
}
