/**
 * Cloudflare Worker: CCTV HLS Stream Reverse Proxy with CORS Support
 * Project: Bangkok Flood Intelligence
 * 
 * วิธีการทำงาน:
 * สคริปต์นี้จะทำหน้าที่เป็น Reverse Proxy รับสัญญาณสตรีม HLS (.m3u8 และ .ts)
 * จากเซิร์ฟเวอร์เทศบาลนครนนทบุรี (stream.firsttech.co.th) แล้วเติม Header:
 * Access-Control-Allow-Origin: *
 * เพื่อให้เบราว์เซอร์สามารถเล่นวิดีโอสดผ่านหน้าเว็บ (GitHub Pages) ได้โดยไม่ถูกบล็อก CORS
 */

export default {
  async fetch(request, env, ctx) {
    // 1. จัดการคำขอ CORS Preflight (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    // 2. ตรวจสอบและแปลงปลายทางไปยังเซิร์ฟเวอร์สตรีมมิ่งต้นทาง
    // รองรับทั้งแบบยิงตรงผ่าน Path (/live/nakornnont.stream/...)
    // หรือระบุ query ?url=https://...
    let targetUrl;
    if (url.searchParams.has("url")) {
      targetUrl = url.searchParams.get("url");
    } else {
      targetUrl = "https://stream.firsttech.co.th" + url.pathname + url.search;
    }

    try {
      // 3. เตรียม Header สำหรับส่งไปยังต้นทาง
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.set("Host", "stream.firsttech.co.th");
      forwardHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      forwardHeaders.delete("Origin");
      forwardHeaders.delete("Referer");

      // 4. ดึงข้อมูลจากเซิร์ฟเวอร์สตรีมมิ่งต้นทาง
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
      });

      // 5. โคลนและแนบ CORS Headers กลับไปยังเบราว์เซอร์
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response("CCTV Stream Proxy Error: " + err.message, {
        status: 502,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  },
};
