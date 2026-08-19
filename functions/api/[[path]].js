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
  
  // ترويسات دقيقة ومتكاملة لكل قطعة لضمان عدم توقف الـ CDN
  const STREAM_HEADERS = { 
    "User-Agent": "okhttp/4.12.0",
    "Referer": "http://re.ycn-redirect.online/",
    "Accept": "*/*"
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

  // 1. بروكسي الأجزاء المحسّن لمنع التوقف المفاجئ
  if (subPath === "proxy_segment") {
    const segUrl = url.searchParams.get("url");
    if (!segUrl) return new Response("Missing URL", { status: 400 });

    try {
      const segmentRes = await fetch(segUrl, { headers: STREAM_HEADERS });
      
      if (!segmentRes.ok) {
        return new Response("Segment Fetch Failed", { status: segmentRes.status });
      }

      const contentType = segmentRes.headers.get("Content-Type") || "application/javascript";

      return new Response(segmentRes.body, {
        status: segmentRes.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      });
    } catch (err) {
      return new Response("Segment Proxy Error", { status: 500 });
    }
  }

  // 2. جلب قائمة المباريات
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
      streams = [
        { quality: "Server 1", url: `${origin}/api/stream/${eventId}.m3u8` }
      ];
    }

    return new Response(JSON.stringify({ streams }), {
      headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
    });
  }

  // 4. جلب التصنيفات
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

  // 6. توليد ملف M3U8 وتوجيه روابط الـ .js إلى البروكسي
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);

    try {
      let rawUrl = "";

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

      if (!rawUrl) {
        return new Response("Stream URL not found", { status: 404 });
      }
      
      const streamRes = await fetch(rawUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow"
      });

      if (!streamRes.ok) {
        return new Response(`Stream CDN Error: ${streamRes.status}`, { status: streamRes.status });
      }

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url;
      const urlObj = new URL(finalUrl);
      const originBase = `${urlObj.protocol}//${urlObj.host}`;
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);

      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          let absoluteSegmentUrl = trimmed;
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            absoluteSegmentUrl = trimmed;
          } else if (trimmed.startsWith('/')) {
            absoluteSegmentUrl = originBase + trimmed;
          } else {
            absoluteSegmentUrl = originBase + basePath + trimmed;
          }
          return `${origin}/api/proxy_segment?url=` + encodeURIComponent(absoluteSegmentUrl);
        }
        return line;
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }

  return new Response("Stable Proxy is Active!", {
    headers: { "Content-Type": "text/plain" }
  });
}
