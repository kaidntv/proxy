  // 5. توليد ملف M3U8 وتحويل الروابط إلى روابط CDN مباشرة ومطلقة بدون كاش
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
      
      // جلب ملف الـ M3U8 مع منع التخزين المؤقت (Cache) نهائياً
      const streamRes = await fetch(rawUrl, {
        headers: STREAM_HEADERS,
        redirect: "follow",
        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      });

      if (!streamRes.ok) {
        return new Response(`Stream CDN Error: ${streamRes.status}`, { status: streamRes.status });
      }

      const playlistText = await streamRes.text();
      const finalUrl = streamRes.url; 
      const urlObj = new URL(finalUrl);
      const originBase = `${urlObj.protocol}//${urlObj.host}`;
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);

      // تحويل جميع الأجزاء النسبية إلى روابط CDN مباشرة ومطلقة
      const rewrittenLines = playlistText.split('\n').map(line => {
        let trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          } else if (trimmed.startsWith('/')) {
            return originBase + trimmed;
          } else {
            return originBase + basePath + trimmed;
          }
        }
        return line;
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0"
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }
