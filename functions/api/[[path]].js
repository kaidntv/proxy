const BASE_KEY = "c!xZj+N9&G@Ev@vw";
const YACINE_HEADERS = { "Accept": "application/json", "User-Agent": "okhttp/4.12.0" };

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  const cache = caches.default;
  const subPath = (params.path || []).join('/');

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

  // ====== المباريات (كاش 60 ثانية) ======
  if (subPath === "events") {
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    const res = await fetch("https://def.yacinelive.com/api/events", { headers: YACINE_HEADERS });
    const t = res.headers.get('T') || res.headers.get('t') || "";
    const decrypted = decryptYacine(await res.text(), t);
    const response = new Response(decrypted, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  // ====== تفاصيل مباراة (كاش 60 ثانية) ======
  if (subPath.startsWith("events/")) {
    const eventId = subPath.split("/")[1];
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
    const t = res.headers.get('T') || res.headers.get('t') || "";
    const decrypted = decryptYacine(await res.text(), t);
    const response = new Response(decrypted, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  // ====== البث - يجلب M3U8 مع Headers ويعيده ======
  if (subPath.startsWith("stream/")) {
    const targetId = subPath.split("/").pop().replace(".m3u8", "");
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { headers: YACINE_HEADERS, cache: "no-store" });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      const json = JSON.parse(decryptedText);
      const server = json.data?.[0] || json[0];
      
      if (!server || !server.url) return new Response("No stream", { status: 404 });
      
      const streamUrl = server.url.replace(/\\u0026/g, '&');
      const userAgent = server.headers?.["User-Agent"] || server.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      const referer = server.headers?.["Referer"] || server.referer || "https://x.com/";
      
      const m3u8Res = await fetch(streamUrl, {
        headers: { "User-Agent": userAgent, "Referer": referer, "Accept": "*/*" },
        cache: "no-store"
      });
      
      if (!m3u8Res.ok) return new Response(`Error: ${m3u8Res.status}`, { status: m3u8Res.status });
      
      const playlistText = await m3u8Res.text();
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
      
      const response = new Response(rewritten.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=5"
        }
      });
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response("Yacine Active!", { headers: { "Content-Type": "text/plain" } });
}
