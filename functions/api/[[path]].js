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

  // 1. قائمة المباريات
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

  // 2. استخراج أول رابط مباشر للمباراة بدون بروكسي
  if (pathSegments[0] === "events" && pathSegments.length > 1) {
    const eventId = pathSegments[1];
    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      if (!t) {
        return new Response(JSON.stringify({ error: "Invalid Event ID" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const decryptedText = decryptYacine(await res.text(), t);
      const parsedData = JSON.parse(decryptedText);
      const rawServers = parsedData.data?.servers || parsedData.servers || parsedData.data || [];

      if (!Array.isArray(rawServers) || rawServers.length === 0) {
        return new Response(JSON.stringify({ error: "No stream servers found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // التقاط أول رابط سيرفر
      const firstServerUrl = rawServers[0].url || rawServers[0].file || rawServers[0].link;

      if (!firstServerUrl) {
        return new Response(JSON.stringify({ error: "Stream URL missing" }), { status: 404 });
      }

      // تتبع إعادة التوجيه للحصول على الرابط النهائي المباشر (Direct CDN)
      const redirectRes = await fetch(firstServerUrl, {
        headers: {
          "User-Agent": "okhttp/4.12.0",
          "Referer": "http://re.ycn-redirect.com/"
        },
        redirect: "follow",
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      const finalStreamUrl = redirectRes.url || firstServerUrl;

      // تحويل تلقائي (302 Redirect) إلى الرابط المباشر إذا تم إضافة ?redirect=true
      if (url.searchParams.get("redirect") === "true") {
        return Response.redirect(finalStreamUrl, 302);
      }

      // إرجاع الرابط المباشر والنهائي داخل JSON
      return new Response(JSON.stringify({ 
        url: finalStreamUrl 
      }), {
        headers: { 
          "Content-Type": "application/json; charset=UTF-8", 
          "Access-Control-Allow-Origin": "*" 
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Endpoint not found" }), { 
    status: 404, 
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
  });
}
