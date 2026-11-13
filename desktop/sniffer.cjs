// FreeTV Web Sniffer – media detection, download manager and conversion studio (Mac app only).
// A separate module: nothing here touches the IPTV code. Three detection engines, tried in order:
//   1. yt-dlp (site-specific extractors)   2. page scan (HTML, JSON-LD, players, playlists)
//   3. deep scan (loads the page in a hidden browser window and watches its network traffic)
// DRM-protected streams and pages that need a login are reported as such and are never bypassed.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MEDIA_RE = /\.(m3u8|mpd|mp4|webm|mov|m4v|mkv|mp3|m4a|aac|flac|wav|ogg|opus)(?=$|[?#])/i;
const AUDIO_EXT = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"];
const safe = (s) => String(s || "video").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || "video";
const extOf = (u) => { try { const m = MEDIA_RE.exec(new URL(u).pathname); return m ? m[1].toLowerCase() : ""; } catch (e) { return ""; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.init = function init(ctx) {
  const { app, ipcMain, dialog } = ctx;
  const stateFile = () => path.join(app.getPath("userData"), "freetv-sniffer.json");
  const st = { jobs: [], conv: [], settings: { maxActive: 3, connections: 6 } };
  try { Object.assign(st, JSON.parse(fs.readFileSync(stateFile(), "utf8"))); } catch (e) {}
  st.jobs.forEach((j) => { if (j.state === "downloading" || j.state === "queued") j.state = "paused"; j.speed = 0; });
  st.conv.forEach((c) => { if (c.state === "converting" || c.state === "queued") { c.state = "failed"; c.error = "FreeTV was closed"; } });
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(stateFile(), JSON.stringify(st)); } catch (e) {} }, 400); };
  const emit = (type, data) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send("sn:event", { type, ...data }); };
  const pushJobs = () => { emit("jobs", { jobs: st.jobs }); save(); };
  const pushConv = () => { emit("conv", { conv: st.conv }); save(); };
  const step = (msg) => emit("scan", { msg });
  const running = new Map();
  const folder = (sub) => { const d = path.join(ctx.getFolder(), sub); fs.mkdirSync(d, { recursive: true }); return d; };
  function uniquePath(dir, base, ext) {
    let p = path.join(dir, base + ext), i = 2;
    while (fs.existsSync(p) || fs.existsSync(p + ".part")) p = path.join(dir, base + " (" + i++ + ")" + ext);
    return p;
  }

  // ================================================================ yt-dlp
  function ytPath() {
    const user = path.join(app.getPath("userData"), "bin", "yt-dlp"), bundled = path.join(__dirname, "bin", "yt-dlp");
    try {
      if (fs.existsSync(bundled) && (!fs.existsSync(user) || fs.statSync(bundled).mtimeMs > fs.statSync(user).mtimeMs)) {
        fs.mkdirSync(path.dirname(user), { recursive: true }); fs.copyFileSync(bundled, user); fs.chmodSync(user, 0o755);
      }
    } catch (e) {}
    for (const p of [user, bundled, "/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp", process.env.FTV_YTDLP || ""]) if (p && fs.existsSync(p)) return p;
    return null;
  }
  // YouTube's full format list (1080p, 4K…) needs a JavaScript engine; FreeTV ships Deno for that
  function denoPath() { for (const p of [path.join(__dirname, "bin", "deno"), process.env.FTV_DENO || "", "/opt/homebrew/bin/deno", "/usr/local/bin/deno"]) if (p && fs.existsSync(p)) return p; return null; }
  const jsArgs = () => { const d = denoPath(); return d ? ["--js-runtimes", "deno:" + d] : []; };
  function runYt(args, timeout = 90000) {
    return new Promise((resolve) => {
      const p = spawn(ytPath(), [...jsArgs(), ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = ""; const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, timeout);
      p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err = (err + d).slice(-6000); });
      p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
      p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out: "", err: e.message }); });
    });
  }
  function ytError(err) {
    const e = new Error("extractor failed"); const s = String(err || "");
    if (/DRM/i.test(s)) { e.drm = true; e.userMsg = "This video is DRM-protected. Protected streams can't be downloaded."; }
    else if (/sign in|log ?in|cookies|members-only|private video|account/i.test(s)) e.userMsg = "This page needs a sign-in. FreeTV only works with media that is openly accessible.";
    else if (/Unsupported URL/i.test(s)) e.unsupported = true;
    else if (/Unable to connect|timed out|getaddrinfo|Temporary failure|Network is unreachable/i.test(s)) e.userMsg = "Couldn't reach this site. Check your internet connection.";
    else if (/geo|not available in your country/i.test(s)) e.userMsg = "This video isn't available in your country.";
    else e.detail = (s.split("\n").filter((l) => /ERROR/.test(l)).pop() || "").replace(/^ERROR:\s*/, "").slice(0, 200);
    return e;
  }
  const thumbOf = (info) => info.thumbnail || ((info.thumbnails || []).slice(-1)[0] || {}).url || "";
  function itemFromInfo(info, pageUrl) {
    const all = (info.formats || []).filter((f) => f.url || f.manifest_url || f.fragments);
    const usable = all.filter((f) => !f.has_drm);
    const vids = usable.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);
    const auds = usable.filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
    const sizeOf = (f) => (f ? f.filesize || f.filesize_approx || (f.tbr && info.duration ? f.tbr * 125 * info.duration : 0) : 0);
    const formats = [...new Set(vids.map((f) => f.height))].sort((a, b) => b - a).slice(0, 8).map((h) => {
      const c = vids.filter((f) => f.height === h).sort((a, b) => (b.tbr || 0) - (a.tbr || 0)); const pref = c.find((f) => /^avc/.test(f.vcodec)) || c[0];
      const muxed = pref.acodec && pref.acodec !== "none";
      return { id: "h" + h, kind: "ytdlp", label: h + "p" + (pref.fps > 30 ? " " + Math.round(pref.fps) + " fps" : ""), height: h, ext: "mp4", size: Math.round(sizeOf(pref) + (muxed ? 0 : sizeOf(auds[0]))),
        sel: `bv*[height<=${h}]+ba/b[height<=${h}]/b`, sort: `res:${h},vcodec:h264,acodec:m4a`, note: String(pref.vcodec || "").split(".")[0] };
    });
    if (!formats.length && usable.length) formats.push({ id: "best", kind: "ytdlp", label: "Best available", ext: info.ext || "mp4", size: Math.round(sizeOf(usable[usable.length - 1])), sel: "b/bv*+ba" });
    if (usable.some((f) => f.acodec && f.acodec !== "none")) {
      const asz = Math.round(sizeOf(auds[0]) || (info.duration ? info.duration * 16000 : 0));
      formats.push({ id: "mp3", kind: "ytdlp", audio: "mp3", label: "Audio only · MP3", ext: "mp3", size: asz }, { id: "m4a", kind: "ytdlp", audio: "m4a", label: "Audio only · M4A", ext: "m4a", size: asz });
    }
    const prev = usable.filter((f) => f.vcodec !== "none" && f.acodec && f.acodec !== "none" && f.url && (f.height || 0) <= 720).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
      || usable.filter((f) => f.url && f.vcodec !== "none").sort((a, b) => (a.height || 0) - (b.height || 0))[0] || usable.find((f) => f.url);
    return { id: "y" + (info.id || Math.random().toString(36).slice(2)), source: "extractor", site: info.extractor_key || info.extractor || "", title: info.title || "Video", description: (info.description || "").slice(0, 600),
      thumbnail: thumbOf(info), duration: info.duration || 0, pageUrl: info.webpage_url || pageUrl, live: !!info.is_live, drm: !!info._has_drm || (all.length > 0 && !usable.length),
      formats, previewUrl: prev ? prev.url : "", previewHeaders: prev ? prev.http_headers || null : null };
  }
  async function analyzeYt(url, flat = true) {
    const r = await runYt(["-J", "--no-warnings", ...(flat ? ["--flat-playlist", "--playlist-end", "60"] : ["--no-playlist"]), "--socket-timeout", "15", url]);
    if (r.code !== 0 || !r.out.trim()) throw ytError(r.err);
    let info; try { info = JSON.parse(r.out); } catch (e) { throw ytError("bad json"); }
    if (info.entries) {
      return info.entries.filter(Boolean).map((e, i) => (e.formats ? itemFromInfo(e, url) : { id: "y" + (e.id || i), source: "extractor", site: e.ie_key || info.extractor_key || "", title: e.title || "Video " + (i + 1),
        thumbnail: thumbOf(e), duration: e.duration || 0, pageUrl: e.url || e.webpage_url, needsFormats: true, formats: [] })).filter((x) => x.pageUrl);
    }
    return [itemFromInfo(info, url)];
  }

  // ================================================================ page scan
  async function fetchText(url, headers, max = 3e6, timeout = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.8", ...(headers || {}) }, signal: ctl.signal, redirect: "follow" });
      const type = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) throw new Error("the site answered " + r.status);
      if (/^(video|audio)\//.test(type) || /octet-stream/.test(type)) { try { await r.body.cancel(); } catch (e) {} return { text: "", type, url: r.url, size: +r.headers.get("content-length") || 0 }; }
      let text = "", n = 0; const dec = new TextDecoder();
      for await (const c of Readable.fromWeb(r.body)) { n += c.length; text += dec.decode(c, { stream: true }); if (n > max) break; }
      return { text, type, url: r.url, size: 0 };
    } finally { clearTimeout(t); }
  }
  const iso = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
  const unesc = (s) => s.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&");
  const DRM_RE = /SAMPLE-AES|streamingkeydelivery|widevine|playready|urn:uuid:edef8ba9|urn:uuid:9a04f079|com\.apple\.fps/i;

  // many players ship their setup as a "packed" script (eval(function(p,a,c,k,e,d)…)); unpack it so the stream link inside can be read
  function unpackScripts(html) {
    let extra = "";
    const num = (w, base) => { if (base <= 36) return parseInt(w, base); let n = 0; for (const ch of w) { const c = ch.charCodeAt(0); n = n * base + (c >= 97 ? c - 87 : c >= 65 ? c - 29 : c - 48); } return n; };
    for (const m of html.matchAll(/\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g)) {
      try { const base = +m[2], words = m[4].split("|"); if (base < 2 || base > 62) continue;
        extra += "\n" + m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (w) => { const i = num(w, base); return words[i] || w; }); } catch (e) {}
    }
    for (const m of html.matchAll(/["']((?:aHR0c|Ly9)[A-Za-z0-9+/=]{16,})["']/g)) { try { extra += "\n\"" + Buffer.from(m[1], "base64").toString("utf8") + "\""; } catch (e) {} }
    return extra;
  }
  async function inspectHls(url, headers) {
    const out = { variants: [], duration: 0, live: false, drm: false };
    const { text } = await fetchText(url, headers, 2e6, 12000);
    if (!text.includes("#EXTM3U")) throw new Error("not a playlist");
    if (DRM_RE.test(text)) out.drm = true;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]), bw = /[^-]BANDWIDTH=(\d+)/.exec(lines[i]) || /BANDWIDTH=(\d+)/.exec(lines[i]);
        let j = i + 1; while (j < lines.length && (!lines[j].trim() || lines[j].startsWith("#"))) j++;
        if (lines[j]) out.variants.push({ height: res ? +res[2] : 0, bandwidth: bw ? +bw[1] : 0, url: new URL(lines[j].trim(), url).toString() });
      }
    }
    const media = async (t) => { let d = 0; for (const m of t.matchAll(/#EXTINF:([\d.]+)/g)) d += +m[1]; return { d, live: !t.includes("#EXT-X-ENDLIST") }; };
    if (out.variants.length) {
      out.variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
      try { const v = await fetchText(out.variants[0].url, headers, 2e6, 12000); if (DRM_RE.test(v.text)) out.drm = true; const m = await media(v.text); out.duration = m.d; out.live = m.live; } catch (e) {}
    } else { const m = await media(text); out.duration = m.d; out.live = m.live; }
    return out;
  }
  async function itemFromMedia(url, meta = {}) {
    const ext = extOf(url) || meta.ext || "";
    const headers = meta.headers || (meta.pageUrl && meta.pageUrl !== url ? { Referer: meta.pageUrl } : null);
    const base = { id: "m" + Buffer.from(url).toString("base64").slice(-24), source: meta.source || "page", site: (() => { try { return new URL(meta.pageUrl || url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })(),
      title: meta.title || decodeURIComponent(url.split("/").pop().split("?")[0]) || "Video", description: meta.description || "", thumbnail: meta.thumbnail || "", duration: meta.duration || 0,
      pageUrl: meta.pageUrl || url, formats: [], previewUrl: url, previewHeaders: headers, drm: false, live: false };
    if (ext === "m3u8") {
      const h = await inspectHls(url, headers);
      base.drm = h.drm; base.live = h.live; base.variants = h.variants.map((v) => v.url); base.duration = base.duration || Math.round(h.duration);
      if (!h.drm && !h.live) {
        const vs = h.variants.length ? h.variants : [{ height: 0, bandwidth: 0, url }];
        const seen = new Set();
        for (const v of vs) { const k = v.height || v.bandwidth; if (seen.has(k)) continue; seen.add(k);
          base.formats.push({ id: "hls" + k, kind: "hls", label: v.height ? v.height + "p" : "Stream", height: v.height, ext: "mp4", url: v.url, headers, size: Math.round((v.bandwidth / 8) * h.duration) }); }
        base.formats.push({ id: "mp3", kind: "hls", audio: "mp3", label: "Audio only · MP3", ext: "mp3", url: vs[vs.length - 1].url, headers, size: Math.round(h.duration * 16000) });
      }
    } else if (ext === "mpd") {
      const { text } = await fetchText(url, headers, 2e6, 12000);
      base.drm = /ContentProtection/i.test(text) && DRM_RE.test(text) || /cenc:default_KID/i.test(text);
      base.live = /type="dynamic"/.test(text); base.duration = base.duration || iso((/mediaPresentationDuration="([^"]+)"/.exec(text) || [])[1]);
      const hs = [...new Set([...text.matchAll(/<Representation[^>]*height="(\d+)"/g)].map((m) => +m[1]))].sort((a, b) => b - a);
      if (!base.drm && !base.live) base.formats.push({ id: "dash", kind: "dash", label: hs[0] ? hs[0] + "p (best)" : "Stream", height: hs[0] || 0, ext: "mp4", url, headers, size: 0 });
    } else {
      let size = meta.size || 0, type = "";
      if (!size) try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA, ...(headers || {}) }, signal: ctl.signal }); clearTimeout(tm);
        size = +r.headers.get("content-length") || 0; type = r.headers.get("content-type") || "";
        if (r.ok && /text\/html/.test(type)) return null;
      } catch (e) {}
      const audio = AUDIO_EXT.includes(ext);
      base.formats.push({ id: "file", kind: "direct", label: (ext || "file").toUpperCase() + (audio ? " audio" : ""), ext: ext || "mp4", url, headers, size });
    }
    return base;
  }
  async function scanPage(url, depth = 2, seen = new Set(), referer = "") {
    if (seen.has(url)) return []; seen.add(url);
    let page; try { page = await fetchText(url, referer ? { Referer: referer } : null); } catch (e) { return []; }
    if (!page.text) return [await itemFromMedia(page.url, { size: page.size, pageUrl: url })].filter(Boolean);
    if (page.text.trimStart().startsWith("#EXTM3U")) return [await itemFromMedia(url, { ext: "m3u8", pageUrl: url })].filter(Boolean);
    const base = page.url, html = page.text + unpackScripts(page.text);
    const meta = (p) => { const m = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, "i").exec(html) || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, "i").exec(html); return m ? unesc(m[1]) : ""; };
    const abs = (u) => { if (!u) return ""; try { return new URL(unesc(u), base).toString(); } catch (e) { return ""; } };
    const pageTitle = meta("og:title") || ((/<title[^>]*>([^<]+)</i.exec(html) || [])[1] || "").trim() || new URL(base).hostname;
    const pageThumb = abs(meta("og:image") || ""), pageDesc = meta("og:description") || meta("description");
    const found = new Map();                                   // url → meta
    const addU = (u, m = {}) => { u = abs(u); if (!u || !/^https?:/.test(u)) return; if (!MEDIA_RE.test(u.split("#")[0]) && !m.force) return; if (!found.has(u)) found.set(u, m); else Object.assign(found.get(u), { ...m, ...found.get(u) }); };
    // structured data
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk);
        if (/VideoObject|AudioObject/i.test(String(o["@type"]))) { const th = Array.isArray(o.thumbnailUrl) ? o.thumbnailUrl[0] : o.thumbnailUrl;
          if (o.contentUrl) addU(o.contentUrl, { title: o.name, thumbnail: th && abs(th), duration: iso(o.duration), description: o.description, force: true }); }
        Object.values(o).forEach(walk); }; walk(JSON.parse(m[1])); } catch (e) {}
    }
    for (const p of ["og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream", "og:audio"]) { const v = meta(p); if (v) addU(v); }
    for (const m of html.matchAll(/<(?:video|audio)\b([^>]*)>/gi)) { const s = /\bsrc=["']([^"']+)["']/i.exec(m[1]), po = /\bposter=["']([^"']+)["']/i.exec(m[1]); if (s) addU(s[1], { thumbnail: po && abs(po[1]), force: /^(?!blob:)/.test(s[1]) && /\.(mp4|webm|m3u8|mp3)/i.test(s[1]) }); }
    for (const m of html.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) addU(m[1]);
    for (const m of unesc(html).matchAll(/https?:\/\/[^\s"'<>\\)]+?\.(?:m3u8|mpd|mp4|webm|mov|m4v|mkv|mp3|m4a|flac|wav|ogg)(?:\?[^\s"'<>\\)]*)?/gi)) addU(m[0]);
    for (const m of unesc(html).matchAll(/["'](\/[^"'\s<>]+?\.(?:m3u8|mpd|mp4|webm|m4v|mp3)(?:\?[^"'\s<>]*)?)["']/gi)) addU(m[1]);
    const items = [];
    const list = [...found.entries()].filter(([u]) => !/\.(ts|m4s)(\?|$)/i.test(u)).slice(0, 40);
    let k = 0;
    await Promise.all(list.map(async ([u, m], i) => {
      try { const it = await itemFromMedia(u, { pageUrl: base, title: m.title || pageTitle + (list.length > 1 ? " (" + (i + 1) + ")" : ""), thumbnail: m.thumbnail || pageThumb, duration: m.duration, description: m.description || pageDesc });
        if (it) { it.order = i; items.push(it); } } catch (e) {}
      step("Checking media " + ++k + " of " + list.length + "…");
    }));
    if (depth > 0) {
      const frames = [...html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => abs(m[1])).filter((u) => /^https?:/.test(u)).slice(0, 6);
      for (const f of frames) { step("Looking inside an embedded player…"); for (const it of await scanPage(f, depth - 1, seen, base)) { if (!it.thumbnail) it.thumbnail = pageThumb; if (/^[\w.-]+$/.test(it.title) || !it.title) it.title = pageTitle; it.pageUrl = f; items.push(it); } }
    }
    return items.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  // ================================================================ deep scan (hidden browser window, watches the network like a download manager)
  function deepScan(url) {
    return new Promise((resolve) => {
      const { BrowserWindow, session } = ctx;
      if (!BrowserWindow || !session) return resolve({ hits: [], title: "" });
      const hits = new Map(); let w, done = false, early = 0;
      // a private, empty browser profile that lives only for this scan: no cookies, no logins, nothing from the user's own browsers
      const ses = session.fromPartition("sniff-" + Date.now() + Math.random());
      const finish = () => { if (done) return; done = true; let title = ""; try { title = w.webContents.getTitle(); } catch (e) {} try { w.destroy(); } catch (e) {}
        try { ses.clearStorageData(); ses.clearCache(); } catch (e) {}
        resolve({ hits: [...hits.entries()].map(([u, h]) => ({ url: u, ...h })), title }); };
      try {
        watchSession(ses, (u, h) => { if (hits.has(u)) return; hits.set(u, { ext: h.ext, headers: h.headers });
          step("Found a stream – checking for more…"); if (!early) early = setTimeout(finish, h.playlist ? 3500 : 5000); });
        w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } });
        w.webContents.setAudioMuted(true); w.webContents.setUserAgent(UA);
        w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));                       // no pop-ups
        let loaded = false; w.webContents.on("will-navigate", (e) => { if (loaded) e.preventDefault(); });   // no redirects to ad pages after the page is open
        ses.setPermissionRequestHandler((_, __, cb) => cb(false)); w.webContents.session.on("will-download", (e) => e.preventDefault());
        const PRESS = `(()=>{try{document.querySelectorAll('video,audio').forEach(v=>{try{v.muted=true;const p=v.play();p&&p.catch(()=>{})}catch(e){}});
          for(const s of ['.vjs-big-play-button','.jw-icon-display','.jw-display-icon-container','.plyr__control--overlaid','.ytp-large-play-button','[aria-label="Play" i]','button[title="Play" i]','.play-button','.btn-play','#play','.play','[class*="play" i]']){const b=document.querySelector(s);if(b){try{b.click()}catch(e){}}}
          try{if(window.jwplayer){const p=jwplayer();p&&p.setMute&&p.setMute(true);p&&p.play&&p.play()}}catch(e){}
          const v=document.querySelector('video');if(v){const r=v.getBoundingClientRect();const el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);el&&el.click&&el.click()}}catch(e){}})()`;
        const press = () => { if (done) return; try { for (const f of w.webContents.mainFrame.framesInSubtree) f.executeJavaScript(PRESS, true).catch(() => {}); } catch (e) {} };
        w.webContents.on("did-finish-load", () => { loaded = true; [700, 2500, 5000, 8000].forEach((t) => setTimeout(press, t)); });
        w.webContents.on("did-fail-load", (_, code, __, ___, main) => { if (main && code !== -3) setTimeout(finish, 300); });
        w.loadURL(url).catch(() => {});
        setTimeout(finish, 16000);
      } catch (e) { finish(); }
    });
  }

  // what counts as media in a page's network traffic (shared by the deep scan and the in-app browser)
  function watchSession(ses, onHit) {
    const sent = new Map();
    ses.webRequest.onBeforeSendHeaders((d, cb) => { try { const h = d.requestHeaders || {}; sent.set(d.url, { Referer: h.Referer || h.referer || "", Origin: h.Origin || h.origin || "" }); if (sent.size > 4000) sent.clear(); } catch (e) {} cb({}); });
    ses.webRequest.onHeadersReceived((d, cb) => {
      try { const h = d.responseHeaders || {}; const ct = String((h["content-type"] || h["Content-Type"] || [""])[0]).toLowerCase(); const u = d.url, bare = u.split("#")[0].split("?")[0];
        const playlist = /mpegurl|dash\+xml/.test(ct) || /\.(m3u8|mpd)$/i.test(bare);
        const file = !/\.(ts|m4s|aac|jpe?g|png|gif|webp|svg|css|js|woff2?|ico|vtt|srt|json)$/i.test(bare) && (/^(video|audio)\//.test(ct) && !/mp2t/.test(ct) || /\.(mp4|webm|mov|m4v|mkv|mp3|m4a|flac)$/i.test(bare));
        if ((playlist || file) && d.statusCode < 400) { const rq = sent.get(u) || {}; const hd = {}; if (rq.Referer) hd.Referer = rq.Referer; if (rq.Origin) hd.Origin = rq.Origin;
          onHit(u, { playlist, key: playlist ? u : bare, ext: playlist ? (/dash|\.mpd$/i.test(ct + bare) ? "mpd" : "m3u8") : "", headers: Object.keys(hd).length ? hd : null }); }
      } catch (e) {}
      cb({});
    });
  }
  const isGeneric = (items) => items.every((i) => /^(generic|html5)/i.test(i.site || "generic"));
  // a master playlist and its own quality variants are one video, not several
  function tidy(items) { const inner = new Set(items.flatMap((i) => i.variants || [])); items = items.filter((i) => !(i.source !== "extractor" && inner.has(i.previewUrl))); items.forEach((i) => delete i.variants); return items; }

  // ================================================================ in-app browser (the "Browse" tab): a private window inside FreeTV, watched the same way
  const UA_B = UA; let bses = null, bwc = null, bview = null; const bhits = new Map();
  const pageKey = (u) => String(u || "").split("#")[0];
  function browseInit() {
    if (bses || !ctx.session) return !!bses;
    bses = ctx.session.fromPartition("sniffbrowse");             // in-memory profile: nothing shared with Safari/Chrome, gone when FreeTV quits
    bses.setUserAgent(UA_B);
    watchSession(bses, (u, h) => { if (bhits.size < 60 && ![...bhits.values()].some((x) => x.key === h.key)) { bhits.set(u, h); emit("browse", { count: bhits.size }); } });
    bses.setPermissionRequestHandler((_, __, cb) => cb(false));
    bses.on("will-download", (e, item) => { e.preventDefault(); const u = item.getURL(), name = item.getFilename() || "";
      if (/^https?:/.test(u) && (MEDIA_RE.test(u.split("#")[0]) || /^(video|audio)\//.test(item.getMimeType() || ""))) { addDownload({ title: name.replace(/\.\w+$/, "") || "Download", pageUrl: u, format: { id: "file", kind: "direct", ext: (name.split(".").pop() || extOf(u) || "mp4").toLowerCase(), url: u, size: item.getTotalBytes() || 0 } }); emit("toast", { msg: "Added to downloads" }); } });
    return true;
  }
  // the page itself is a native view laid over the FreeTV window (more reliable on macOS than an embedded <webview>)
  function browseView() {
    if (bview) return bview;
    browseInit();
    const V = ctx.WebContentsView || ctx.BrowserView; const win = ctx.getWin(); if (!V || !win) return null;
    const wp = { partition: "sniffbrowse", sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false };
    bview = new V({ webPreferences: wp });
    if (win.contentView && ctx.WebContentsView) win.contentView.addChildView(bview); else win.addBrowserView(bview);
    try { bview.setBorderRadius && bview.setBorderRadius(14); } catch (e) {}
    try { bview.setBackgroundColor && bview.setBackgroundColor("#ffffff"); } catch (e) {}
    bview.setVisible ? bview.setVisible(false) : bview.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    const wc = bwc = bview.webContents; wc.setUserAgent(UA_B); let cur = "", lastClick = 0;
    const host = (u) => { try { return new URL(u).hostname.split(".").slice(-2).join("."); } catch (e) { return ""; } };
    const nav = (extra = {}) => { if (wc.isDestroyed()) return; const nh = wc.navigationHistory;
      emit("bnav", { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: nh ? nh.canGoBack() : wc.canGoBack(), canFwd: nh ? nh.canGoForward() : wc.canGoForward(), ...extra }); };
    const moved = (u) => { if (pageKey(u) !== cur) { cur = pageKey(u); bhits.clear(); emit("browse", { count: 0 }); } };
    // new windows never open (that is where pop-up ads live). A same-site link the user clicked that wants a new tab opens here instead.
    wc.setWindowOpenHandler(({ url, disposition, features }) => { if (/^https?:/.test(url) && !features && disposition === "foreground-tab" && host(url) && host(url) === host(wc.getURL()) && Date.now() - lastClick < 1500) setImmediate(() => { try { wc.loadURL(url); } catch (e) {} }); return { action: "deny" }; });
    wc.on("input-event", (_, e) => { if (e.type === "mouseUp" || e.type === "keyUp") lastClick = Date.now(); });
    wc.on("did-start-navigation", (e, url, inPage, isMain) => { const d = e && e.url ? e : { url, isSameDocument: inPage, isMainFrame: isMain }; if (d.isMainFrame && !d.isSameDocument) moved(d.url); });
    wc.on("did-navigate-in-page", (e, url, isMain) => { if (isMain) moved(url); nav({ ok: true }); });
    wc.on("did-navigate", (e, url, code) => nav({ ok: true, code }));
    for (const ev of ["did-start-loading", "did-stop-loading", "page-title-updated"]) wc.on(ev, () => nav());
    wc.on("did-fail-load", (_, code, desc, url, isMain) => { if (isMain && code !== -3) nav({ error: ({ ERR_NAME_NOT_RESOLVED: "This site wasn't found. Check the address.", ERR_INTERNET_DISCONNECTED: "No internet connection.", ERR_CONNECTION_REFUSED: "The site didn't answer.", ERR_CONNECTION_TIMED_OUT: "The site didn't answer.", ERR_TIMED_OUT: "The site didn't answer.", ERR_CERT_AUTHORITY_INVALID: "This site's security certificate isn't valid.", ERR_BLOCKED_BY_RESPONSE: "This site doesn't allow being opened here." })[desc] || desc || "This page couldn't be opened", failedUrl: url }); });
    wc.on("render-process-gone", () => nav({ error: "The page stopped working. Press ↻ to reload it." }));
    return bview;
  }
  function browseCmd({ cmd, url, x, y, w, h, show }) {
    const v = browseView(); if (!v) return { error: "The browser isn't available" }; const wc = v.webContents, nh = wc.navigationHistory;
    if (cmd === "place") {
      if (!show || w < 20 || h < 20) { v.setVisible ? v.setVisible(false) : v.setBounds({ x: 0, y: 0, width: 0, height: 0 }); return {}; }
      const z = ctx.getWin().webContents.getZoomFactor() || 1;
      v.setBounds({ x: Math.round(x * z), y: Math.round(y * z), width: Math.round(w * z), height: Math.round(h * z) }); if (v.setVisible) v.setVisible(true);
      return {};
    }
    if (cmd === "go" && /^https?:\/\//i.test(url || "")) wc.loadURL(url).catch(() => {});
    if (cmd === "back") nh ? nh.canGoBack() && nh.goBack() : wc.canGoBack() && wc.goBack();
    if (cmd === "fwd") nh ? nh.canGoForward() && nh.goForward() : wc.canGoForward() && wc.goForward();
    if (cmd === "reload") wc.reload(); if (cmd === "stop") wc.stop();
    if (cmd === "pause") wc.executeJavaScript("document.querySelectorAll('video,audio').forEach(v=>v.pause())", true).catch(() => {});
    if (cmd === "state") return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading() };
    return {};
  }
  async function browseItems() {
    if (!bwc || bwc.isDestroyed()) return { items: [], notes: [] };
    const url = bwc.getURL(), title = bwc.getTitle(); let items = [], thumb = ""; const notes = [];
    try { thumb = await bwc.executeJavaScript(`(document.querySelector('meta[property="og:image"]')||{}).content||''`); } catch (e) {}
    if (ytPath() && /^https?:/.test(url)) { try { const y = await analyzeYt(url); if (y.length && !isGeneric(y)) items = y; } catch (e) { if (e.drm) notes.push(e.userMsg); } }
    if (!items.length) for (const [u, h] of [...bhits].slice(0, 25)) { try { const it = await itemFromMedia(u, { pageUrl: url, title, thumbnail: thumb, source: "network", ext: h.ext || extOf(u), headers: h.headers }); if (it) items.push(it); } catch (e) {} }
    // nothing played yet: read the page itself as well (video tags, player scripts, embedded players)
    if (!items.length && /^https?:/.test(url)) { try { items = await scanPage(url); } catch (e) {} }
    items = tidy(items);
    if (items.some((i) => i.drm)) notes.push("Some media on this page is DRM-protected and can't be downloaded.");
    return { url, items, notes };
  }

  // ================================================================ analyze
  async function analyze({ url, deep }) {
    url = String(url || "").trim(); if (!url) throw new Error("Paste a link first");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch (e) { throw new Error("That doesn't look like a web address"); }
    const notes = []; let items = [];
    step("Checking the link…");
    if (MEDIA_RE.test(url.split("#")[0])) { try { const it = await itemFromMedia(url, { source: "direct" }); if (it) items = [it]; } catch (e) {} }
    if (!items.length && ytPath()) {
      step("Asking the media extractor…");
      try { items = await analyzeYt(url); } catch (e) { if (e.userMsg) notes.push(e.userMsg); else if (!e.unsupported && e.detail) notes.push(e.detail); }
    }
    // the extractor's "generic" mode only reports the first thing it sees – our own page scan is more complete there
    const generic = items.length > 0 && isGeneric(items);
    if (!items.length || generic) { step("Scanning the page for media…"); try { const found = await scanPage(url); if (found.length) items = found; } catch (e) { notes.push("Couldn't read the page: " + e.message); } }
    if (!items.length || deep) {
      step("Deep scan – loading the page like a browser…");
      const d = await deepScan(url); const have = new Set(items.flatMap((i) => [i.previewUrl, ...i.formats.map((f) => f.url)]));
      for (const h of d.hits.slice(0, 20)) { if (have.has(h.url)) continue; step("Checking what the page loaded…");
        try { const it = await itemFromMedia(h.url, { pageUrl: url, title: d.title || undefined, source: "network", ext: h.ext || extOf(h.url), headers: h.headers }); if (it) items.push(it); } catch (e) {} }
    }
    items = tidy(items);
    if (items.some((i) => i.drm)) notes.push("Some media on this page is DRM-protected and can't be downloaded.");
    if (!items.length && !notes.length) notes.push("No downloadable media was found on this page.");
    return { url, items, notes: [...new Set(notes)], extractor: !!ytPath() };
  }

  // ================================================================ download manager
  const job = (id) => st.jobs.find((j) => j.id === id);
  function addDownload(o) {
    const f = o.format || {};
    const sig = [o.pageUrl, f.id, f.kind, f.url || "", f.audio || ""].join("|");
    const dup = st.jobs.find((j) => j.sig === sig && j.state !== "canceled" && j.state !== "failed");
    if (dup && !o.force) return { duplicate: true, id: dup.id, state: dup.state };
    const useYt = f.kind === "ytdlp" || ((f.kind === "hls" || f.kind === "dash") && !!ytPath());
    const ext = "." + (f.audio || f.ext || "mp4");
    const dir = folder(AUDIO_EXT.includes(ext.slice(1)) ? path.join("Web", "Audio") : "Web");
    const file = uniquePath(dir, safe(o.title) + (f.height && !f.audio ? " " + f.height + "p" : ""), ext);
    const j = { id: "w" + Date.now() + Math.floor(Math.random() * 999), sig, title: o.title, thumbnail: o.thumbnail || "", pageUrl: o.pageUrl, site: o.site || "", label: f.label || "",
      engine: useYt ? "ytdlp" : f.kind === "direct" ? "direct" : "ffmpeg", url: f.kind === "ytdlp" ? o.pageUrl : f.url, headers: f.headers || null, sel: f.sel || "", sort: f.sort || "", audio: f.audio || "",
      duration: o.duration || 0, file, state: "queued", size: 0, total: f.size || 0, speed: 0, eta: 0, tries: 0, created: Date.now(), error: "" };
    st.jobs.unshift(j); pushJobs(); pump();
    return { id: j.id };
  }
  function pump() {
    let active = st.jobs.filter((j) => j.state === "downloading").length;
    for (const j of st.jobs.filter((x) => x.state === "queued").reverse()) { if (active >= st.settings.maxActive) break; active++; start(j); }
  }
  async function start(j) {
    j.state = "downloading"; j.error = ""; j.want = ""; pushJobs();
    try {
      await (j.engine === "direct" ? runDirect(j) : j.engine === "ytdlp" ? runYtJob(j) : runFfmpegJob(j));
      try { j.size = j.total = fs.statSync(j.file).size; } catch (e) {}
      Object.assign(j, { state: "done", speed: 0, eta: 0, ended: Date.now(), parts: undefined });
    } catch (e) {
      running.delete(j.id);
      if (j.want === "pause") Object.assign(j, { state: "paused", speed: 0 });
      else if (j.want === "cancel") { j.state = "canceled"; cleanup(j); }
      else if (!/answered 4\d\d|DRM|sign-in|country/.test(String(e.message)) && ++j.tries <= 4) {                             // automatic retry after an interruption
        j.error = "Retrying (" + j.tries + "/4)…"; j.speed = 0; pushJobs(); await sleep(2000 * j.tries);
        if (j.state === "downloading" && !j.want) return start(j);
        if (j.want === "pause") j.state = "paused"; else if (j.want === "cancel") { j.state = "canceled"; cleanup(j); }
      } else Object.assign(j, { state: "failed", speed: 0, error: String(e.message || e).slice(0, 220) });
    }
    running.delete(j.id); pushJobs(); pump();
  }
  function cleanup(j) {
    try { const dir = path.dirname(j.file), b = path.basename(j.file, path.extname(j.file));
      for (const f of fs.readdirSync(dir)) if (f.startsWith(b + ".") && (/\.(part|ytdl)$/.test(f) || /\.part-Frag\d+/.test(f) || /\.f\d+\.\w+$/.test(f) || f === path.basename(j.file) + ".part")) try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
    } catch (e) {}
  }
  // --- direct files: several connections at once, each fetching its own byte range (resumable)
  async function runDirect(j) {
    const ctl = new AbortController(); running.set(j.id, { stop: () => ctl.abort() });
    const H = { "User-Agent": UA, ...(j.headers || {}) }; const tmp = j.file + ".part";
    if (!j.parts || !fs.existsSync(tmp)) {
      const r = await fetch(j.url, { headers: { ...H, Range: "bytes=0-0" }, signal: ctl.signal });
      const cr = r.headers.get("content-range"); let total = 0, ranges = false;
      if (r.status === 206 && cr) { total = +cr.split("/")[1] || 0; ranges = total > 0; } else if (r.ok) total = +r.headers.get("content-length") || 0; else throw new Error("the server answered " + r.status);
      try { await r.body.cancel(); } catch (e) {}
      const n = ranges && total > 4 * 1048576 ? Math.max(1, Math.min(st.settings.connections, Math.ceil(total / (2 * 1048576)))) : 1, sz = Math.ceil(total / n);
      j.total = total; j.ranges = ranges; j.parts = [];
      for (let i = 0; i < n; i++) j.parts.push({ s: i * sz, e: total ? Math.min(total - 1, (i + 1) * sz - 1) : -1, d: 0 });
      fs.writeFileSync(tmp, "");
    }
    if (!j.ranges) j.parts[0].d = 0;                        // server can't resume → start again
    const fd = fs.openSync(tmp, "r+");
    const one = async (p) => {
      if (p.e >= 0 && p.s + p.d > p.e) return;
      const h = { ...H }; if (j.ranges) h.Range = `bytes=${p.s + p.d}-${p.e}`;
      const r = await fetch(j.url, { headers: h, signal: ctl.signal });
      if (!r.ok) throw new Error("the server answered " + r.status);
      if (j.ranges && r.status !== 206) throw new Error("the server stopped supporting resume");
      for await (const c of Readable.fromWeb(r.body)) {
        await new Promise((res, rej) => fs.write(fd, c, 0, c.length, p.s + p.d, (e) => (e ? rej(e) : res())));
        p.d += c.length; j.size = j.parts.reduce((a, x) => a + x.d, 0);
      }
      if (p.e >= 0 && p.s + p.d <= p.e) throw new Error("connection closed early");
    };
    try { await Promise.all(j.parts.map(one)); } catch (e) { ctl.abort(); await sleep(50); try { fs.closeSync(fd); } catch (x) {} throw e; }
    fs.closeSync(fd); fs.renameSync(tmp, j.file);
  }
  // --- sites and streams: yt-dlp (parallel fragments, resume, merge with ffmpeg)
  function runYtJob(j) {
    return new Promise((resolve, reject) => {
      const tpl = j.file.slice(0, -path.extname(j.file).length) + ".%(ext)s";
      const args = [...jsArgs(), "--no-warnings", "--newline", "--progress", "--no-playlist", "--no-mtime", "--continue", "--ffmpeg-location", ctx.ffmpegPath(), "-N", String(st.settings.connections), "--retries", "10", "--fragment-retries", "10",
        "--progress-template", "download:FTVP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s", "--print", "after_move:FTVF|%(filepath)s", "-o", tpl];
      if (j.audio) args.push("-f", "ba/b", "-x", "--audio-format", j.audio, "--audio-quality", "0");
      else { args.push("-f", j.sel || "bv*+ba/b"); if (j.sort) args.push("-S", j.sort); args.push("--merge-output-format", "mp4"); }
      for (const [k, v] of Object.entries(j.headers || {})) args.push("--add-header", k + ":" + v);
      args.push(j.url);
      const p = spawn(ytPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
      running.set(j.id, { stop: () => { try { p.kill("SIGTERM"); } catch (e) {} } });
      let err = "", buf = "", base = 0, last = 0, finalFile = "";
      p.stdout.on("data", (d) => {
        buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
        for (const l of lines) {
          if (l.startsWith("FTVF|")) finalFile = l.slice(5).trim();
          else if (l.startsWith("FTVP|")) { const [, dn, tot, est, sp, eta] = l.split("|"); const dl = +dn || 0;
            if (dl + 65536 < last) base += last; last = dl;         // next stream (video, then audio) started
            j.size = base + dl; const t = +tot || +est || 0; if (t) j.total = Math.max(j.total || 0, base + t); j.speed = +sp || 0; j.eta = +eta || 0; j.error = ""; }
        }
      });
      p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
      p.on("error", (e) => reject(e));
      p.on("close", (code) => {
        if (code === 0) { if (finalFile && fs.existsSync(finalFile)) j.file = finalFile; return resolve(); }
        const e = ytError(err); reject(new Error(e.userMsg || e.detail || "download stopped (" + code + ")"));
      });
    });
  }
  // --- HLS / DASH without yt-dlp: ffmpeg copies the stream into one file
  function runFfmpegJob(j) {
    return new Promise((resolve, reject) => {
      const tmp = j.file + ".part"; const h = { ...(j.headers || {}) };
      const args = ["-hide_banner", "-nostdin", "-y", "-user_agent", UA];
      if (Object.keys(h).length) args.push("-headers", Object.entries(h).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n");
      args.push("-i", j.url);
      if (j.audio === "mp3") args.push("-vn", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3"); else args.push("-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4");
      args.push(tmp);
      const p = spawn(ctx.ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
      running.set(j.id, { stop: () => { try { p.kill("SIGKILL"); } catch (e) {} } });
      let err = "", t0 = Date.now();
      p.stderr.on("data", (d) => { err = (err + d).slice(-3000); const m = [...String(d).matchAll(/time=(\d+):(\d\d):(\d\d)/g)].pop(), s = [...String(d).matchAll(/size=\s*(\d+)\s*Ki?B/gi)].pop();
        if (s) j.size = +s[1] * 1024; if (m && j.duration) { const done = (+m[1] * 3600 + +m[2] * 60 + +m[3]) / j.duration; if (done > 0.01) { j.total = Math.round(j.size / done); j.eta = Math.round(((Date.now() - t0) / 1000) * (1 - done) / done); } } });
      p.on("error", reject);
      p.on("close", (code) => { if (code === 0) { fs.renameSync(tmp, j.file); resolve(); } else { try { fs.unlinkSync(tmp); } catch (e) {} reject(new Error((err.split("\n").filter((l) => /error|invalid|forbidden|denied/i.test(l)).pop() || "stream download failed").slice(0, 200))); } });
    });
  }
  // speed / time-left for direct downloads, and one UI update per second while anything is active
  const lastSize = new Map();
  setInterval(() => {
    const act = st.jobs.filter((j) => j.state === "downloading"); if (!act.length) return;
    for (const j of act) if (j.engine === "direct") { const prev = lastSize.get(j.id) ?? j.size; const sp = Math.max(0, j.size - prev); j.speed = Math.round(j.speed ? j.speed * 0.6 + sp * 0.4 : sp); lastSize.set(j.id, j.size);
      j.eta = j.speed && j.total ? Math.round((j.total - j.size) / j.speed) : 0; }
    pushJobs();
  }, 1000).unref?.();

  // ================================================================ conversion studio
  const AUDIO_OUT = { mp3: ["libmp3lame", "mp3"], m4a: ["aac", "ipod"], aac: ["aac", "adts"], wav: ["pcm_s16le", "wav"], flac: ["flac", "flac"] };
  const VCODEC = { h264: "libx264", hevc: "libx265", vp9: "libvpx-vp9", mpeg4: "mpeg4" }, ACODEC = { aac: "aac", mp3: "libmp3lame", opus: "libopus", flac: "flac" };
  const CRF = { h264: [18, 23, 28], hevc: [22, 27, 31], vp9: [28, 33, 38], mpeg4: [3, 6, 10] };
  function convArgs(input, output, o) {
    const fmt = o.format, a = ["-hide_banner", "-nostdin", "-y", "-i", input];
    if (AUDIO_OUT[fmt]) { a.push("-vn", "-c:a", AUDIO_OUT[fmt][0]); if (fmt === "mp3" || fmt === "m4a" || fmt === "aac") a.push("-b:a", (o.abitrate || 192) + "k"); a.push("-f", AUDIO_OUT[fmt][1]); }
    else {
      let vc = o.vcodec || "auto", ac = o.acodec || "auto";
      if (vc === "auto") vc = fmt === "webm" ? "vp9" : fmt === "avi" ? "mpeg4" : "h264";
      if (fmt === "webm" && vc !== "vp9" ) vc = "vp9"; if (fmt === "avi" && (vc === "vp9" || vc === "hevc")) vc = "mpeg4";
      if (ac === "auto") ac = fmt === "webm" ? "opus" : fmt === "avi" ? "mp3" : "aac";
      if (fmt === "webm" && ac !== "opus" && ac !== "copy") ac = "opus"; if ((fmt === "mp4" || fmt === "mov") && ac === "opus") ac = "aac";
      const changes = (o.height && o.height !== "orig") || (o.fps && o.fps !== "orig");
      if (vc === "copy" && changes) vc = "h264";
      a.push("-map", "0:v:0?", "-map", "0:a:0?");
      if (vc === "copy") a.push("-c:v", "copy");
      else {
        a.push("-c:v", VCODEC[vc], "-pix_fmt", "yuv420p");
        if (o.vbitrate) a.push("-b:v", o.vbitrate + "k"); else { const q = CRF[vc][{ high: 0, medium: 1, low: 2 }[o.quality || "high"]]; if (vc === "mpeg4") a.push("-q:v", String(q)); else a.push("-crf", String(q)); if (vc === "vp9") a.push("-b:v", "0"); }
        if (vc === "h264" || vc === "hevc") a.push("-preset", "medium"); if (vc === "vp9") a.push("-row-mt", "1", "-cpu-used", "3");
        if (vc === "hevc" && (fmt === "mp4" || fmt === "mov")) a.push("-tag:v", "hvc1");
        if (o.height && o.height !== "orig") a.push("-vf", `scale=-2:${+o.height}`);
        if (o.fps && o.fps !== "orig") a.push("-r", String(+o.fps));
      }
      if (ac === "copy") a.push("-c:a", "copy"); else { a.push("-c:a", ACODEC[ac]); if (ac !== "flac") a.push("-b:a", (o.abitrate || 192) + "k"); }
      if (fmt === "mp4" || fmt === "mov") a.push("-movflags", "+faststart");
      a.push("-f", { mp4: "mp4", mov: "mov", mkv: "matroska", avi: "avi", webm: "webm" }[fmt] || "mp4");
    }
    a.push("-progress", "pipe:1", "-nostats", output);
    return a;
  }
  function addConvert({ inputs, opts }) {
    for (const input of inputs || []) {
      if (!fs.existsSync(input)) continue;
      const out = uniquePath(folder("Converted"), safe(path.basename(input, path.extname(input))), "." + opts.format);
      st.conv.unshift({ id: "c" + Date.now() + Math.floor(Math.random() * 999), input, name: path.basename(input), file: out, opts, state: "queued", progress: 0, error: "", created: Date.now() });
    }
    pushConv(); pumpConv();
  }
  function pumpConv() {
    if (st.conv.some((c) => c.state === "converting")) return;
    const c = st.conv.filter((x) => x.state === "queued").pop(); if (!c) return;
    c.state = "converting"; pushConv();
    const tmp = c.file + ".part"; const p = spawn(ctx.ffmpegPath(), convArgs(c.input, tmp, c.opts), { stdio: ["ignore", "pipe", "pipe"] });
    running.set(c.id, { stop: () => { c.want = "cancel"; try { p.kill("SIGKILL"); } catch (e) {} } });
    let err = "", dur = 0, lastPush = 0;
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); if (!dur) { const m = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(err); if (m) dur = +m[1] * 3600 + +m[2] * 60 + +m[3]; } });
    p.stdout.on("data", (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m && dur) { c.progress = Math.min(0.999, +m[1] / 1e6 / dur); if (Date.now() - lastPush > 700) { lastPush = Date.now(); pushConv(); } } });
    p.on("close", (code) => {
      running.delete(c.id);
      if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, c.file); Object.assign(c, { state: "done", progress: 1, size: fs.statSync(c.file).size }); }
      else { try { fs.unlinkSync(tmp); } catch (e) {} Object.assign(c, { state: c.want === "cancel" ? "canceled" : "failed", error: c.want === "cancel" ? "" : (err.split("\n").filter((l) => /error|invalid|unknown|not supported|unable/i.test(l)).pop() || "conversion failed").slice(0, 220) }); }
      pushConv(); pumpConv();
    });
    p.on("error", (e) => { running.delete(c.id); Object.assign(c, { state: "failed", error: e.message }); pushConv(); pumpConv(); });
  }

  // ================================================================ IPC
  const H = (name, fn) => ipcMain.handle("sn:" + name, async (_, arg) => { try { return await fn(arg || {}); } catch (e) { return { error: String(e.message || e) }; } });
  H("state", async () => ({ jobs: st.jobs, conv: st.conv, settings: st.settings, extractor: !!ytPath(), js: !!denoPath() }));
  H("analyze", analyze);
  H("browseInit", async () => ({ ok: browseInit() }));
  H("browseItems", browseItems);
  H("browse", browseCmd);
  H("formats", async ({ url }) => { const items = await analyzeYt(url, false).catch((e) => { throw new Error(e.userMsg || e.detail || "Couldn't read this video"); }); return items[0]; });
  H("download", async (o) => addDownload(o));
  H("pause", async ({ id }) => { const j = job(id); if (!j) return {}; j.want = "pause"; const r = running.get(id); if (r) r.stop(); else if (j.state === "queued") { j.state = "paused"; pushJobs(); } return {}; });
  H("resume", async ({ id }) => { const j = job(id); if (j && ["paused", "failed", "canceled"].includes(j.state)) { j.state = "queued"; j.tries = 0; j.error = ""; j.want = ""; pushJobs(); pump(); } return {}; });
  H("cancel", async ({ id }) => { const j = job(id); if (!j) return {}; j.want = "cancel"; const r = running.get(id); if (r) r.stop(); else { j.state = "canceled"; cleanup(j); pushJobs(); } return {}; });
  H("remove", async ({ id, deleteFile }) => { const j = job(id); if (!j) return {}; const r = running.get(id); if (r) { j.want = "cancel"; r.stop(); } cleanup(j); if (deleteFile) try { fs.unlinkSync(j.file); } catch (e) {}
    st.jobs = st.jobs.filter((x) => x.id !== id); pushJobs(); return {}; });
  H("clear", async () => { st.jobs = st.jobs.filter((j) => !["done", "canceled", "failed"].includes(j.state)); pushJobs(); return {}; });
  H("settings", async (s) => { if (s.maxActive) st.settings.maxActive = Math.max(1, Math.min(6, +s.maxActive)); if (s.connections) st.settings.connections = Math.max(1, Math.min(12, +s.connections)); save(); pump(); return st.settings; });
  H("pickFiles", async () => { const r = await dialog.showOpenDialog(ctx.getWin(), { title: "Choose media files to convert", defaultPath: ctx.getFolder(), properties: ["openFile", "multiSelections"],
    filters: [{ name: "Media", extensions: ["mp4", "mkv", "mov", "avi", "webm", "ts", "m4v", "flv", "wmv", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"] }] }); return { files: r.canceled ? [] : r.filePaths }; });
  H("convert", async (o) => { addConvert(o); return {}; });
  H("convStop", async ({ id }) => { const r = running.get(id); if (r) r.stop(); else { const c = st.conv.find((x) => x.id === id); if (c && c.state === "queued") { c.state = "canceled"; pushConv(); } } return {}; });
  H("convRemove", async ({ id }) => { const r = running.get(id); if (r) r.stop(); st.conv = st.conv.filter((x) => x.id !== id); pushConv(); return {}; });
  H("updateExtractor", async () => { if (!ytPath()) return { error: "The extractor isn't installed" }; const r = await runYt(["-U"], 120000); return { text: (r.out + r.err).trim().split("\n").pop() }; });
  return { stopAll: () => { try { if (bview) bview.webContents.close(); } catch (e) {} for (const r of running.values()) try { r.stop(); } catch (e) {} }, _test: { itemFromInfo, analyze, addDownload, st, convArgs, addConvert } };
};
