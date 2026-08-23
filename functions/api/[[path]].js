export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // تنظيف المسار واستخراج الأجزاء مع إزالة /api/ إن وجدت
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

  // دالة فك التشفير
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

  // 1. جلب قائمة المباريات
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

  // 2. جلب تفاصيل مباراة معينة
  if (pathSegments[0] === "events" && pathSegments.length > 1) {
    const eventId = pathSegments[1];
    try {
      const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { 
        headers: YACINE_HEADERS,
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      const t = res.headers.get('T') || res.headers.get('t') || "";
      const decryptedText = decryptYacine(await res.text(), t);
      
      return new Response(decryptedText, {
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
