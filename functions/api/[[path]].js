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

  // ====== المباريات ======
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

  // ====== تفاصيل مباراة (سيرفرات) ======
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

  return new Response("Yacine Active!", { headers: { "Content-Type": "text/plain" } });
}
