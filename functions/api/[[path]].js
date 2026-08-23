export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace('/api/', '').replace(/^\/+/, '');

    const BASE_KEY = "c!xZj+N9&G@Ev@vw";
    
    // الهيدرات الرسمية للتطبيق
    const YACINE_HEADERS = { 
      "Accept": "application/json", 
      "User-Agent": "okhttp/4.12.0" 
    };
    
    const STREAM_HEADERS = {
      "User-Agent": "okhttp/4.12.0",
      "Referer": "http://re.ycn-redirect.com/"
    };

    // 1. فك تشفير استجابات Yacine
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

    // 2. استخراج رابط البث المباشر
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
        }
      } catch (e) {}
      const urlMatch = trimmed.match(/https?:\/\/[^\s"']+/);
      return urlMatch ? urlMatch[0] : "";
    }

    // ====== 1. قائمة المباريات (Events) ======
    if (path === "events") {
      try {
        const res = await fetch("https://def.yacinelive.com/api/events", { headers: YACINE_HEADERS });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const data = decryptYacine(await res.text(), t);
        
        return new Response(data, {
          headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ====== 2. تفاصيل المباراة والسيرفرات (Event Details) ======
    if (path.startsWith("events/")) {
      const eventId = path.split("/")[1].replace(".m3u8", "");
      try {
        const res = await fetch(`https://def.yacinelive.com/api/event/${eventId}`, { headers: YACINE_HEADERS });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const decryptedText = decryptYacine(await res.text(), t);
        
        const parsed = JSON.parse(decryptedText);
        const servers = parsed.data?.servers || parsed.servers || [];
        
        const streamsList = servers.map((s, idx) => ({
          quality: s.quality || s.name || `Server ${idx + 1}`,
          url: `${origin}/api/stream/${eventId}.m3u8?server=${idx}`
        }));

        return new Response(JSON.stringify({ streams: streamsList }), {
          headers: { "Content-Type": "application/json; charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ====== 3. آلية جلب ورابط البث التشغيلي (Stream) ======
    if (path.startsWith("stream/")) {
      const targetId = path.split("/").pop().replace(".m3u8", "");
      
      try {
        // جلب وتفكيك رابط المباراة الرسمي
        const res = await fetch(`https://def.yacinelive.com/api/event/${targetId}`, { headers: YACINE_HEADERS });
        const t = res.headers.get('T') || res.headers.get('t') || "";
        const decrypted = decryptYacine(await res.text(), t);
        const rawRedirectUrl = extractUrlFromDecrypted(decrypted);

        if (!rawRedirectUrl) return new Response("Stream URL not found", { status: 404 });

        // تتبع التوجيه (302) باستخدام الهيدرات الرسمية للحصول على رابط الـ CDN النهائي
        const redirectRes = await fetch(rawRedirectUrl, { headers: STREAM_HEADERS, redirect: "follow" });
        const finalCdnPlaylistUrl = redirectRes.url;

        // جلب ملف الـ M3U8
        const playlistRes = await fetch(finalCdnPlaylistUrl, { headers: STREAM_HEADERS });
        const playlistText = await playlistRes.text();

        // تحويل روابط قطع الفيديو الموهة (.js/.ts) وتمريرها عبر البروكسي
        const rewritten = playlistText.split('\n').map(line => {
          let trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          try {
            const absChunkUrl = new URL(trimmed, finalCdnPlaylistUrl).href;
            return `${origin}/api/proxy?url=${encodeURIComponent(absChunkUrl)}`;
          } catch (e) {
            return trimmed;
          }
        }).join('\n');

        return new Response(rewritten, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(`Stream Error: ${err.message}`, { status: 500 });
      }
    }

    // ====== 4. البروكسي الخاص بقطع الفيديو (.js / .ts) ======
    if (path === "proxy") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url param", { status: 400 });

      try {
        const res = await fetch(targetUrl, { headers: STREAM_HEADERS, redirect: "follow" });
        
        return new Response(res.body, {
          status: 200,
          headers: {
            "Content-Type": "video/mp2t",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (e) {
        return new Response(`Proxy Error: ${e.message}`, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
