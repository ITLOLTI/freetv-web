/**
 * FreeTV relay – a tiny Cloudflare Worker that lets the FreeTV web app reach IPTV servers.
 *
 * Why: browsers block web pages from reading http:// servers and servers without CORS headers.
 * This relay fetches the address for the app, adds the needed headers, and serves it over https.
 * HLS playlists (.m3u8) are rewritten so every segment also goes through the relay.
 *
 * Setup (free): dash.cloudflare.com → Workers & Pages → Create → Worker → paste this file → Deploy.
 * Then change KEY below to your own secret word and put the same word in FreeTV → Settings → Relay key.
 */
const KEY = "change-me-to-a-secret-word";
// (The Mac app runs this same relay on your own computer, so no Cloudflare is needed there.)
export const RELAY_KEY = KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, X-Final-Url",
  "Access-Control-Max-Age": "86400",
};

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const self = new URL(request.url);
    const target = self.searchParams.get("u");
    if (!target) return new Response("FreeTV relay is running.", { headers: { ...CORS, "Content-Type": "text/plain" } });
    if (self.searchParams.get("k") !== KEY) return new Response("Wrong relay key", { status: 403, headers: CORS });
    let url;
    try { url = new URL(target); } catch (e) { return new Response("Bad url", { status: 400, headers: CORS }); }
    if (!/^https?:$/.test(url.protocol)) return new Response("Bad url", { status: 400, headers: CORS });

    const extra = self.searchParams.get("h");
    const headers = new Headers();
    headers.set("User-Agent", "Mozilla/5.0 (Linux; Android 11; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
    if (extra) {
      try { for (const [k, v] of Object.entries(JSON.parse(b64urlDecode(extra)))) headers.set(k, v); } catch (e) {}
    }
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);

    const init = { method: request.method === "POST" ? "POST" : "GET", headers, redirect: "follow" };
    if (request.method === "POST") init.body = await request.text();

    let res;
    try { res = await fetch(url.toString(), init); }
    catch (e) { return new Response("Relay could not reach the server: " + e.message, { status: 502, headers: CORS }); }

    const out = new Headers(CORS);
    for (const h of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified"]) {
      const v = res.headers.get(h); if (v) out.set(h, v);
    }
    out.set("X-Final-Url", res.url || url.toString());
    out.set("Cache-Control", "no-store");

    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    const looksHls = type.includes("mpegurl") || /\.m3u8(\?|$)/i.test(url.pathname) || /\.m3u8(\?|$)/i.test(res.url || "");
    const len = Number(res.headers.get("Content-Length") || 0);
    if (looksHls && (!len || len < 2_000_000)) {
      const text = await res.text();
      if (text.includes("#EXT-X-")) {
        const base = res.url || url.toString();
        const wrap = (u) => {
          let abs; try { abs = new URL(u, base).toString(); } catch (e) { return u; }
          const p = new URL(self.origin + self.pathname);
          p.searchParams.set("u", abs); p.searchParams.set("k", KEY);
          if (extra) p.searchParams.set("h", extra);
          return p.toString();
        };
        const body = text.split(/\r?\n/).map((line) => {
          const l = line.trim();
          if (!l) return line;
          if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
          return wrap(l);
        }).join("\n");
        out.set("Content-Type", "application/vnd.apple.mpegurl");
        out.delete("Content-Length");
        return new Response(body, { status: res.status, headers: out });
      }
      out.delete("Content-Length");
      return new Response(text, { status: res.status, headers: out });
    }
    return new Response(res.body, { status: res.status, headers: out });
  },
};
