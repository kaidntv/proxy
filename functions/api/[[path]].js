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

  // دالة فك التشفير الأساسية
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

  // دالة ذكية لاستخراج الرابط الحقيقي بعد فك التشفير
  function extractUrlFromDecrypted(decryptedText) {
    if (!decryptedText) return "";
    let trimmed = decryptedText.trim();
    
    // إذا كان رابطاً مباشراً
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }

    try {
      const json = JSON.parse(trimmed);
      const servers = json.data?.servers || json.servers || json.data || json;
      if (Array.isArray(servers)) {
        const s = servers[0];
        return s?.url || s?.file || s?.link || "";
      } else if (typeof servers === 'object' && servers !== null) {
        return servers.url || servers.file || servers.link || "";
      } else if (typeof servers === 'string' && (servers.startsWith('http://') || servers.startsWith('https://'))) {
        return servers;
      }
    } catch (e) {
      // إذا لم يكن JSON، ابحث عن أي رابط داخل النص عبر التعبير المنتظم
      const match = decryptedText.match(/https?:\/\/[^\s"']+/);
      if (match) return match[0];
    }
    return "";
  }

  // 1. جلب المباريات
  if (subPath === "events") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/events", { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // 2. جلب التصنيفات
  if (subPath === "categories") {
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      return new Response(decryptYacine(await res.text(), t), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }

  // 3. جلب القنوات
  if (subPath.startsWith("categories/") && subPath.endsWith("/channels")) {
    const categoryId = subPath.split("/")[1] || "1";
    try {
      const res = await fetch(`https://def.yacinelive.com/api/categories/${categoryId}/channels`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
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

  // 4. معالجة البث، فك التشفير المباشر، وتمرير الرابط خلفه بدون أي توقف
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    const serverIndex = parseInt(url.searchParams.get("server") || "0", 10);

    try {
      let rawUrl = "";

      // محاولة الجلب من رابط القناة المباشر وفك تشفيره
      try {
        const chRes = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
          headers: YACINE_HEADERS,
          cf: { cacheTtl: 0, cacheEverything: false }
        });
        const chT = chRes.headers.get('T') || chRes.headers.get('t') || "";
        const decryptedText = decryptYacine(await chRes.text(), chT);
        rawUrl = extractUrlFromDecrypted(decryptedText);
      } catch (e) {}

      // محاولة بديلة من الأحداث إذا لزم الأمر
      if (!rawUrl) {
        try {
          const eventRes = await fetch(`https://def.yacinelive.com/api/event/${targetId}`, { 
            headers: YACINE_HEADERS,
            cf: { cacheTtl: 0, cacheEverything: false }
          });
          const eventT = eventRes.headers.get('T') || eventRes.headers.get('t') || "";
          const decryptedText = decryptYacine(await eventRes.text(), eventT);
          rawUrl = extractUrlFromDecrypted(decryptedText);
        } catch (e) {}
      }

      if (!rawUrl) return new Response("Stream URL not found after decryption", { status: 404 });

      // اتباع الرابط والتوجه لسيرفر الـ CDN النهائي
      const streamRes = await fetch(rawUrl, {
        headers: {
          "User-Agent": "okhttp/4.12.0",
          "Referer": "http://re.ycn-redirect.com/"
        },
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      if (!streamRes.ok) return new Response(`CDN Error: ${streamRes.status}`, { status: streamRes.status });

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url; 
      const parsedFinalUrl = new URL(finalUrl);
      const cdnOrigin = parsedFinalUrl.origin; 

      // إعادة كتابة مسارات الـ M3U8 والقطع بدقة تامة
      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
          if (trimmed.includes('URI=')) {
            return trimmed.replace(/URI=["']([^"']+)["']/, (match, uriValue) => {
              try {
                return `URI="${new URL(uriValue, cdnOrigin).href}"`;
              } catch (e) {
                return match;
              }
            });
          }
          return line;
        }

        try {
          if (trimmed.startsWith('/')) {
            return cdnOrigin + trimmed;
          }
          return new URL(trimmed, finalUrl).href.split('?')[0];
        } catch (e) {
          return trimmed;
        }
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Yacine Decrypt-Direct Worker Active!", { headers: { "Content-Type": "text/plain" } });
}
