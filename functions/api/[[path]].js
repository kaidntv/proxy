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
  
  const STREAM_HEADERS = { 
    "User-Agent": "okhttp/4.12.0",
    "Accept": "*/*",
    "Connection": "Keep-Alive",
    "Referer": "https://www.yacinelive.com/",
    "Origin": "https://www.yacinelive.com"
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

  // 1. بروكسي القطع (Segment Proxy) لحقن الهيدرات الإجبارية للـ CDN
  if (subPath === "proxy_segment") {
    const segUrl = url.searchParams.get("url");
    if (!segUrl) return new Response("Missing URL", { status: 400 });

    try {
      const upstreamHeaders = new Headers(STREAM_HEADERS);
      const rangeHeader = request.headers.get("Range");
      if (rangeHeader) upstreamHeaders.set("Range", rangeHeader);

      const segmentRes = await fetch(segUrl, { 
        headers: upstreamHeaders,
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      
      if (!segmentRes.ok) return new Response("", { status: segmentRes.status });

      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");

      let contentType = segmentRes.headers.get("Content-Type") || "";
      if (segUrl.includes(".js") || contentType.includes("javascript") || contentType.includes("text")) {
        contentType = "video/mp4";
      }
      responseHeaders.set("Content-Type", contentType || "application/octet-stream");

      const contentLength = segmentRes.headers.get("Content-Length");
      if (contentLength) responseHeaders.set("Content-Length", contentLength);

      const contentRange = segmentRes.headers.get("Content-Range");
      if (contentRange) responseHeaders.set("Content-Range", contentRange);

      return new Response(segmentRes.body, {
        status: segmentRes.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response("", { status: 500 });
    }
  }

  // 2. جلب قائمة المباريات (Events API)
  if (subPath === "events") {
    try {
      const eventsRes = await fetch("https://def.yacinelive.com/api/events", { headers: YACINE_HEADERS });
      const eventsT = eventsRes.headers.get('T') || eventsRes.headers.get('t') || "";
      const eventsText = await eventsRes.text();
      return new Response(decryptYacine(eventsText, eventsT), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // 3. جلب سيرفرات مباراة محددة
  if (subPath.startsWith("event/") || subPath.startsWith("events/")) {
    const eventId = subPath.split("/").pop();
    let streams = [];

    try {
      const eventRes = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
      const eventT = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
      const eventText = await eventRes.text();
      const eventData = JSON.parse(decryptYacine(eventText, eventT));

      let rawServers = [];
      const possible = eventData.data || eventData;
      if (Array.isArray(possible)) {
        rawServers = possible;
      } else if (possible && typeof possible === 'object') {
        rawServers = possible.servers || possible.streams || possible.qualities || possible.links || [];
        if (rawServers.length === 0 && (possible.url || possible.file)) {
          rawServers = [possible];
        }
      }

      if (rawServers.length > 0) {
        streams = rawServers.map((server, index) => ({
          quality: server.title || server.quality || server.name || `Server ${index + 1}`,
          url: `${origin}/api/stream/${eventId}.m3u8?server=${index}`
        }));
      }
    } catch (e) {}

    if (streams.length === 0) {
      streams = [{ quality: "Server 1", url: `${origin}/api/stream/${eventId}.m3u8` }];
    }

    return new Response(JSON.stringify({ streams }), {
      headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
    });
  }

  // 4. جلب التصنيفات (Categories API)
  if (subPath === "categories") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { headers: YACINE_HEADERS });
      const tValue = res.headers.get('T') || res.headers.get('t') || "";
      const text = await res.text();
      return new Response(decryptYacine(text, tValue), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // 5. جلب قنوات تصنيف معين
  if (subPath.startsWith("categories/") && subPath.endsWith("/channels")) {
    const parts = subPath.split("/");
    const categoryId = parts[1] || "1";

    try {
      const res = await fetch(`https://def.yacinelive.com/api/categories/${categoryId}/channels`, { headers: YACINE_HEADERS });
      const tValue = res.headers.get('T') || res.headers.get('t') || "";
      const text = await res.text();
      const data = JSON.parse(decryptYacine(text, tValue));

      const list = data.data || data;
      if (Array.isArray(list)) {
        list.forEach(channel => {
          const chId = channel.id || channel.channel_id;
          if (chId) {
            channel.streams = [
              { quality: "Server 1", url: `${origin}/api/stream/${chId}.m3u8` }
            ];
            channel.stream_url = `${origin}/api/stream/${chId}.m3u8`;
          }
        });
      }

      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // 6. جلب وتحديث ملف M3U8 طيرانياً (الحل الجذري لمشكلة الـ 4 دقائق لجميع القنوات)
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);

    try {
      let rawUrl = "";

      // محاولة الجلب كـ Event
      try {
        const eventRes = await fetch(`https://def.yacinelive.com/api/event/${targetId}`, { headers: YACINE_HEADERS });
        const eventT = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
        const eventData = JSON.parse(decryptYacine(await eventRes.text(), eventT));
        const rawServers = eventData.data?.servers || eventData.servers || eventData.data || eventData;
        if (Array.isArray(rawServers)) {
          const selectedServer = rawServers[serverIndex] || rawServers[0];
          rawUrl = selectedServer?.url || selectedServer?.file || selectedServer?.link || "";
        }
      } catch (e) {}

      // إن لم تكن Event، جرب كـ Channel عادية
      if (!rawUrl) {
        try {
          const chRes = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { headers: YACINE_HEADERS });
          const chT = chRes.headers.get('T') || chRes.headers.get('t') || "";
          const chData = JSON.parse(decryptYacine(await chRes.text(), chT));
          const servers = chData.data || chData || [];
          const selectedServer = (Array.isArray(servers) ? servers : [servers])[serverIndex] || servers[0];
          rawUrl = selectedServer?.url || selectedServer?.file || "";
        } catch (e) {}
      }

      if (!rawUrl) return new Response("Stream URL not found", { status: 404 });
      
      const streamRes = await fetch(rawUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) return new Response(`Stream CDN Error`, { status: streamRes.status });

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url; 

      // إعادة كتابة الروابط لتمر عبر بروكسي القطع، وإزالة وسوم التوقف المؤقت
      const rewrittenLines = playlistText.split('\n').filter(line => {
        return line.trim() !== "#EXT-X-DISCONTINUITY";
      }).map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#') && trimmed.includes('URI=')) {
          return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
            try {
              const absoluteUri = new URL(uriValue, finalUrl).href;
              const proxiedUri = `${origin}/api/proxy_segment?url=` + encodeURIComponent(absoluteUri);
              return `URI="${proxiedUri}"`;
            } catch (e) {
              return match;
            }
          });
        }

        if (!trimmed.startsWith('#')) {
          try {
            const absoluteSegmentUrl = new URL(trimmed, finalUrl).href;
            return `${origin}/api/proxy_segment?url=` + encodeURIComponent(absoluteSegmentUrl);
          } catch (e) {
            return trimmed;
          }
        }

        return line;
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
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }

  return new Response("All Yacine APIs are Active & Running!", {
    headers: { "Content-Type": "text/plain" }
  });
}
