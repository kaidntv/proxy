export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const origin = url.origin;

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

  const STREAM_HEADERS = {
    "User-Agent": "okhttp/4.12.0",
    "Referer": "http://re.ycn-redirect.com/"
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

  // معالج البروكسي لإعادة كتابة M3U8 وتمرير قطع TS بـ Headers التطبيق الرسمي
  async function proxyStream(targetUrl) {
    try {
      const res = await fetch(targetUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!res.ok) {
        return new Response(`Error fetching source: ${res.status}`, { status: res.status });
      }

      const finalUrl = res.url;
      const contentType = res.headers.get("content-type") || "";
      const isM3u8 = contentType.includes("mpegurl") || contentType.includes("m3u8") || targetUrl.includes(".m3u8") || finalUrl.includes(".m3u8");

      if (isM3u8) {
        const playlistText = await res.text();
        const rewritten = playlistText.split('\n').map(line => {
          let trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith('#')) {
            if (trimmed.includes('URI=')) {
              return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
                try {
                  const abs = new URL(uriValue, finalUrl).href;
                  return `URI="${origin}/api/proxy?url=${encodeURIComponent(abs)}"`;
                } catch (e) {
                  return match;
                }
              });
            }
            return line;
          }

          try {
            const abs = new URL(trimmed, finalUrl).href;
            return `${origin}/api/proxy?url=${encodeURIComponent(abs)}`;
          } catch (e) {
            return trimmed;
          }
        }).join('\n');

        return new Response(rewritten, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
          }
        });
      } else {
        // تمرير قطع البث (.ts) المباشرة
        return new Response(res.body, {
          status: 200,
          headers: {
            "Content-Type": contentType || "video/mp2t",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, { status: 500 });
    }
  }

  // 1. مسار البروكسي الخاص بالقطع: /api/proxy?url=...
  if (path === "proxy") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response("Missing url param", { status: 400 });
    return await proxyStream(targetUrl);
  }

  // 2. قائمة المباريات: /api/events
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

  // 3. تشغيل القناة مباشرة: /api/channel/1424.m3u8
  if (pathSegments[0] === "channel" && pathSegments.length > 1) {
    const channelId = pathSegments[1].replace(".m3u8", "");
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${channelId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decrypted = decryptYacine(await res.text(), t);
      const streamUrl = extractUrlFromDecrypted(decrypted);
      if (!streamUrl) return new Response("Stream URL not found", { status: 404 });
      return await proxyStream(streamUrl);
    } catch (e) {
      return new Response(`Channel Error: ${e.message}`, { status: 500 });
    }
  }

  // 4. تفاصيل أو تشغيل المباراة: /api/events/2863226942.m3u8 أو /api/events/2863226942
  if (pathSegments[0] === "events" && pathSegments.length > 1) {
    const rawId = pathSegments[1];
    const eventId = rawId.replace(".m3u8", "");

    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      if (!t) return new Response(JSON.stringify({ error: "Invalid Event ID" }), { status: 404 });
      
      const decryptedText = decryptYacine(await res.text(), t);

      // إذا طلبت تشغيل M3U8 مباشر للمباراة
      if (rawId.endsWith(".m3u8")) {
        const streamUrl = extractUrlFromDecrypted(decryptedText);
        if (!streamUrl) return new Response("Stream URL not found", { status: 404 });
        return await proxyStream(streamUrl);
      }

      // إذا طلبت قائمة السيرفرات جاهزة مع روابط البروكسي الشغالة
      const parsedData = JSON.parse(decryptedText);
      const rawServers = parsedData.data?.servers || parsedData.servers || parsedData.data || [];
      const proxiedServers = Array.isArray(rawServers) ? rawServers.map((s, idx) => ({
        name: s.name || s.quality || `Server ${idx + 1}`,
        url: `${origin}/api/proxy?url=${encodeURIComponent(s.url)}`
      })) : [];

      return new Response(JSON.stringify({ servers: proxiedServers }), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "Endpoint not found" }), { status: 404 });
}
