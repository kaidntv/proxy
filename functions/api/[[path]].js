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

  function extractUrlFromDecrypted(decryptedText) {
    if (!decryptedText) return "";
    let trimmed = decryptedText.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    try {
      const json = JSON.parse(trimmed);
      const findUrl = (obj) => {
        if (!obj) return "";
        if (Array.isArray(obj)) {
          for (const item of obj) { const found = findUrl(item); if (found) return found; }
          return "";
        }
        if (typeof obj === 'object') {
          const urlProps = ['url', 'file', 'link', 'stream_url', 'play_url', 'src'];
          for (const prop of urlProps) {
            if (obj[prop] && typeof obj[prop] === 'string' && (obj[prop].startsWith('http://') || obj[prop].startsWith('https://'))) return obj[prop];
          }
          for (const key in obj) {
            if (obj[key] && typeof obj[key] === 'string' && (obj[key].startsWith('http://') || obj[key].startsWith('https://'))) return obj[key];
          }
          for (const key in obj) {
            if (typeof obj[key] === 'object') { const found = findUrl(obj[key]); if (found) return found; }
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

  // ====== 2. تفاصيل مباراة - يرجع streams جاهزة ======
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

  // ====== 3. البث ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);
    const sessionKey = `stream_url_${targetId}_${serverIndex}`;
    const m3u8CacheKey = `m3u8_cache_${targetId}_${serverIndex}`;

    try {
      try {
        const cachedM3u8 = await env.YACINE_CACHE.get(m3u8CacheKey, 'text');
        if (cachedM3u8) {
          return new Response(cachedM3u8, {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" }
          });
        }
      } catch (e) {}

      let finalCdnPlaylistUrl = "";
      try {
        const cached = await env.YACINE_CACHE.get(sessionKey, 'json');
        if (cached && cached.url && (Date.now() - cached.time < CACHE_DURATION.stream_session)) finalCdnPlaylistUrl = cached.url;
      } catch (e) {}

      if (!finalCdnPlaylistUrl) {
        const channelData = await getCachedOrFetch(`channel_url_${targetId}`, `https://def.yacinelive.com/api/channel/${targetId}`, CACHE_DURATION.stream_url);
        let rawRedirectUrl = extractUrlFromDecrypted(channelData);
        if (!rawRedirectUrl) return new Response("Stream URL not found", { status: 404 });

        const redirectRes = await fetch(rawRedirectUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://x.com/" },
          redirect: "follow"
        });

        if (!redirectRes.ok) {
          try { await env.YACINE_CACHE.delete(sessionKey); } catch (e) {}
          return new Response(`Redirect Error: ${redirectRes.status}`, { status: redirectRes.status });
        }

        finalCdnPlaylistUrl = redirectRes.url;
        try {
          await env.YACINE_CACHE.put(sessionKey, JSON.stringify({ url: finalCdnPlaylistUrl, time: Date.now() }), { expirationTtl: Math.floor(CACHE_DURATION.stream_session / 1000) });
        } catch (e) {}
      }

      const streamRes = await fetch(finalCdnPlaylistUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://x.com/" }
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
              try { return `URI="${new URL(uriValue, cdnOrigin).href}"`; } catch (e) { return match; }
            });
          }
          return line;
        }
        try {
          if (trimmed.startsWith('/')) return cdnOrigin + trimmed;
          return new URL(trimmed, finalUrl).href.split('?')[0];
        } catch (e) { return trimmed; }
      });

      const finalM3u8 = rewrittenLines.join('\n');
      try { await env.YACINE_CACHE.put(m3u8CacheKey, finalM3u8, { expirationTtl: CACHE_DURATION.m3u8_cache }); } catch (e) {}

      return new Response(finalM3u8, {
        status: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Yacine Active!", { headers: { "Content-Type": "text/plain" } });
}
