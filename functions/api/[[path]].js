export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

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

  // تتبع التوجيه للحصول على رابط CDN النهائي المباشر
  async function getFinalDirectUrl(rawServerUrl) {
    try {
      const res = await fetch(rawServerUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      return res.url || rawServerUrl;
    } catch (e) {
      return rawServerUrl;
    }
  }

  // 1. قائمة المباريات: /api/events
  if (path === "events") {
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
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } 
      });
    }
  }

  // 2. تشغيل القناة المباشر (توجيه 302 فوري لرابط CDN النهائي)
  if (pathSegments[0] === "channel" && pathSegments.length > 1) {
    const channelId = pathSegments[1].replace(".m3u8", "");
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${channelId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decrypted = decryptYacine(await res.text(), t);
      const rawUrl = extractUrlFromDecrypted(decrypted);
      if (!rawUrl) return new Response("Stream URL not found", { status: 404 });
      
      const finalUrl = await getFinalDirectUrl(rawUrl);
      return Response.redirect(finalUrl, 302);
    } catch (e) {
      return new Response(`Channel Error: ${e.message}`, { status: 500 });
    }
  }

  // 3. تفاصيل أو تشغيل المباراة مباشرة (توجيه 302 فوري)
  if (pathSegments[0] === "events" && pathSegments.length > 1) {
    const rawId = pathSegments[1];
    const eventId = rawId.replace(".m3u8", "");

    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      if (!t) return new Response(JSON.stringify({ error: "Invalid Event ID" }), { status: 404 });
      
      const decryptedText = decryptYacine(await res.text(), t);

      // طلب تشغيل مباشر عبر امتداد .m3u8
      if (rawId.endsWith(".m3u8")) {
        const rawUrl = extractUrlFromDecrypted(decryptedText);
        if (!rawUrl) return new Response("Stream URL not found", { status: 404 });
        
        const finalUrl = await getFinalDirectUrl(rawUrl);
        return Response.redirect(finalUrl, 302);
      }

      // طلب قائمة السيرفرات (يرجع روابط المباشرة مفكوكة ناتجة عن الـ Redirect)
      const parsedData = JSON.parse(decryptedText);
      const rawServers = parsedData.data?.servers || parsedData.servers || parsedData.data || [];
      
      const resolvedServers = [];
      if (Array.isArray(rawServers)) {
        for (let i = 0; i < rawServers.length; i++) {
          const s = rawServers[i];
          const serverUrl = s.url || s.file || s.link;
          if (serverUrl) {
            const directUrl = await getFinalDirectUrl(serverUrl);
            resolvedServers.push({
              name: s.name || s.quality || `Server ${i + 1}`,
              url: directUrl
            });
          }
        }
      }

      return new Response(JSON.stringify({ servers: resolvedServers }), {
        headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "Endpoint not found" }), { status: 404 });
}
