export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  const pathSegments = params.path || [];
  const subPath = pathSegments.join('/');
  const origin = url.origin;

  const BASE_KEY = "c!xZj+N9&G@Ev@vw";
  const YACINE_HEADERS = { 
    "Accept": "application/json", 
    "User-Agent": "okhttp/4.12.0" 
  };

  // دالة فك التشفير الخاص بـ Yacine TV
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

  // 1. جلب قائمة المباريات والفعاليات (/events)
  if (subPath === "events") {
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
        headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // 2. جلب تفاصيل مباراة معينة وسيرفراتها (/events/{id})
  if (subPath.startsWith("events/") && subPath !== "events") {
    const eventId = subPath.split("/")[1];
    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      let streamsList = [{ quality: "Server 1", url: `${origin}/api/stream/${eventId}.m3u8` }];
      try {
        const json = JSON.parse(decryptedText);
        const servers = json.data?.servers || json.servers || json.data;
        if (Array.isArray(servers) && servers.length > 0) {
          streamsList = servers.map((s, idx) => ({
            quality: s.quality || `Server ${idx + 1}`,
            url: s.url || s.file || s.link || `${origin}/api/stream/${eventId}.m3u8?server=${idx}`
          }));
        }
      } catch (e) {}

      return new Response(JSON.stringify({ streams: streamsList }), {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*" 
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ streams: [] }), { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }

  // إرجاع خطأ 404 لأي مسار آخر (تم إيقاف باقي المسارات)
  return new Response(JSON.stringify({ error: "Endpoint disabled or not found" }), { 
    status: 404, 
    headers: { 
      "Content-Type": "application/json", 
      "Access-Control-Allow-Origin": "*" 
    } 
  });
}
