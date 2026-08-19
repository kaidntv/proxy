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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "Referer": "http://re.ycn-redirect.com/",
    "Origin": "http://re.ycn-redirect.com",
    "Accept": "*/*",
    "Connection": "Keep-Alive"
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

  // 1. بروكسي القطع مع الهيدرات الصحيحة
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

      return new Response(segmentRes.body, {
        status: segmentRes.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response("", { status: 500 });
    }
  }

  // 2. باقي الـ APIs الأساسية (Categories & Events)
  if (subPath === "events") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  if (subPath === "categories") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  if (subPath.startsWith("categories/") && subPath.endsWith("/channels")) {
    const categoryId = subPath.split("/")[1] || "1";
    try {
      const res = await fetch(`https://def.yacinelive.com/api/categories/${categoryId}/channels`, { headers: YACINE_HEADERS });
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

  // 3. معالجة وتوليد الـ M3U8 واتباع التوجيه بدقة
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");

    try {
      let rawUrl = "";
      try {
        const chRes = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { headers: YACINE_HEADERS });
        const chT = chRes.headers.get('T') || chRes.headers.get('t') || "";
        const chData = JSON.parse(decryptYacine(await chRes.text(), chT));
        const servers = chData.data || chData || [];
        rawUrl = (Array.isArray(servers) ? servers[0] : servers)?.url || "";
      } catch (e) {}

      if (!rawUrl) return new Response("Stream URL not found", { status: 404 });

      // تتبع الـ Redirect للحصول على الرابط النهائي بدقة
      const redirectCheck = await fetch(rawUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow"
      });
      const finalStreamUrl = redirectCheck.url;

      const streamRes = await fetch(finalStreamUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) return new Response(`CDN Error: ${streamRes.status}`, { status: streamRes.status });

      const playlistText = await streamRes.text();
      const baseUrl = finalStreamUrl.substring(0, finalStreamUrl.lastIndexOf("/") + 1);

      const rewrittenLines = playlistText.split('\n').filter(line => {
        return line.trim() !== "#EXT-X-DISCONTINUITY";
      }).map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#') && trimmed.includes('URI=')) {
          return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
            try {
              const absoluteUri = new URL(uriValue, finalStreamUrl).href;
              return `URI="${origin}/api/proxy_segment?url=${encodeURIComponent(absoluteUri)}"`;
            } catch (e) {
              return match;
            }
          });
        }

        if (!trimmed.startsWith('#')) {
          try {
            const absoluteSegmentUrl = new URL(trimmed, baseUrl).href;
            return `${origin}/api/proxy_segment?url=${encodeURIComponent(absoluteSegmentUrl)}`;
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
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Worker is running perfectly!", { headers: { "Content-Type": "text/plain" } });
}
