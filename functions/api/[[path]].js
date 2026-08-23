const SECRET_KEY = "Yacine2026@SecretKey!";

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  const cache = caches.default;
  
  const subPath = (params.path || []).join('/');
  const origin = url.origin;
  
  const BASE_KEY = "c!xZj+N9&G@Ev@vw";
  const YACINE_HEADERS = { 
    "Accept": "application/json", 
    "User-Agent": "okhttp/4.12.0" 
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

  // ====== التصنيفات ======
  if (subPath === "categories") {
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const res = await fetch("https://def.yacinelive.com/api/categories", { headers: YACINE_HEADERS });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const data = decryptYacine(await res.text(), t);
      
      const response = new Response(data, {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2592000"
        }
      });
      
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // ====== كل القنوات ======
  if (subPath === "all-channels") {
    const cacheKey = new Request(url.toString());
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const categories = [4, 5, 6, 7];
      const qualityNames = { 4: '1080p', 5: '720p', 6: '360p', 7: '244p' };
      const allChannels = {};
      
      for (const catId of categories) {
        const res = await fetch(`https://def.yacinelive.com/api/categories/${catId}/channels`, { headers: YACINE_HEADERS });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const data = decryptYacine(await res.text(), t);
        
        const parsed = JSON.parse(data);
        const list = parsed.data || [];
        
        list.forEach(ch => {
          const chName = ch.name;
          const chId = ch.id || ch.channel_id;
          
          if (!allChannels[chName]) {
            allChannels[chName] = {
              name: chName,
              logo: ch.logo,
              qualities: {}
            };
          }
          
          allChannels[chName].qualities[qualityNames[catId]] = `${origin}/api/stream/${chId}.m3u8`;
        });
      }
      
      const channelsArray = Object.values(allChannels);
      const response = new Response(JSON.stringify({ data: channelsArray }), {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2592000"
        }
      });
      
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, data: [] }), { 
        status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // ====== البث - يرجع JSON بالرابط + Headers ======
  if (subPath.startsWith("stream/")) {
    const lastSegment = subPath.split("/").pop();
    const targetId = lastSegment.replace(".m3u8", "");
    
    try {
      const res = await fetch(`https://def.yacinelive.com/api/channel/${targetId}`, { 
        headers: YACINE_HEADERS,
        cache: "no-store"
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      const json = JSON.parse(decryptedText);
      const server = json.data[0];
      
      const streamUrl = server.url.replace(/\\u0026/g, '&');
      const userAgent = server.headers?.["User-Agent"] || server.user_agent || "Mozilla/5.0";
      const referer = server.headers?.["Referer"] || server.referer || "https://x.com/";
      
      // يرجع JSON - HTML سيستخدم hls.js مع Headers
      return new Response(JSON.stringify({
        url: streamUrl,
        userAgent: userAgent,
        referer: referer
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, headers: { "Content-Type": "application/json" } 
      });
    }
  }

  return new Response("Yacine Stable Worker Active!", { 
    headers: { "Content-Type": "text/plain" } 
  });
}
