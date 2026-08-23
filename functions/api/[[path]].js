const CACHE_DURATION = {
  events: 60000,
  m3u8: 10
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
  const cache = caches.default;

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

  // ====== المباريات ======
  if (subPath === "events") {
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      const response = new Response(data, {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" }
      });
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500 });
    }
  }

  // ====== تفاصيل المباراة والسيرفرات ======
  if (subPath.startsWith("events/")) {
    const eventId = subPath.split("/")[1];
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      const response = new Response(data, {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" }
      });
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ====== البث - يجلب M3U8 ويعيده ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const eventId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    try {
      // 1. جلب السيرفرات من event
      const eventRes = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
      const t = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
      const eventData = decryptYacine(await eventRes.text(), t);
      const json = JSON.parse(eventData);
      const servers = json.data || [];
      const server = servers[serverIndex] || servers[0];
      
      if (!server || !server.url) return new Response("No stream", { status: 404 });
      
      // 2. استخراج معلومات البث
      const streamUrl = server.url.replace(/\\u0026/g, '&');
      const userAgent = server.user_agent || server.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      const referer = server.referer || server.headers?.["Referer"] || "";
      
      // 3. جلب M3U8
      const headers = { "User-Agent": userAgent, "Accept": "*/*" };
      if (referer && referer !== '') headers["Referer"] = referer;
      
      const m3u8Res = await fetch(streamUrl, { headers });
      
      if (!m3u8Res.ok) return new Response(`Error: ${m3u8Res.status}`, { status: m3u8Res.status });
      
      const playlistText = await m3u8Res.text();
      
      // 4. إعادة كتابة المسارات
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
      
      const response = new Response(finalM3u8, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=10"
        }
      });
      
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response("OK", { headers: { "Content-Type": "text/plain" } });
}
