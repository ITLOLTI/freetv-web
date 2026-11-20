// FreeTV Web Sniffer – media detection, download manager and conversion studio (Mac app only).
// A separate module: nothing here touches the IPTV code. Three detection engines, tried in order:
//   1. yt-dlp (site-specific extractors)   2. page scan (HTML, JSON-LD, players, playlists)
//   3. deep scan (loads the page in a hidden browser window and watches its network traffic)
// DRM-protected streams and pages that need a login are reported as such and are never bypassed.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const crypto = require("node:crypto");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MEDIA_RE = /\.(m3u8|mpd|mp4|webm|mov|m4v|mkv|mp3|m4a|aac|flac|wav|ogg|opus)(?=$|[?#])/i;
const AUDIO_EXT = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"];
const safe = (s) => String(s || "video").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || "video";
const extOf = (u) => { try { const m = MEDIA_RE.exec(new URL(u).pathname); return m ? m[1].toLowerCase() : ""; } catch (e) { return ""; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.init = function init(ctx) {
  const { app, ipcMain, dialog } = ctx;
  const stateFile = () => path.join(app.getPath("userData"), "freetv-sniffer.json");
  const st = { jobs: [], conv: [], settings: { maxActive: 3, connections: 6, apple: true } };
  try { Object.assign(st, JSON.parse(fs.readFileSync(stateFile(), "utf8"))); } catch (e) {}
  if (st.settings.apple === undefined) st.settings.apple = true;
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
    const taken = (x) => fs.existsSync(x) || fs.existsSync(x + ".part") || st.conv.some((c) => c.file === x && c.state !== "failed" && c.state !== "canceled") || st.jobs.some((j) => j.file === x && j.state !== "done" && j.state !== "failed" && j.state !== "canceled");
    while (taken(p)) p = path.join(dir, base + " (" + i++ + ")" + ext);
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
  async function fetchText(url, headers, max = 3e6, timeout = 15000, ses = null) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const opts = { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.8", ...(headers || {}) }, signal: ctl.signal, redirect: "follow" };
      let r;
      if (ses && ses.fetch) {
        try { r = await ses.fetch(url, { ...opts, credentials: "include", bypassCustomProtocolHandlers: true }); if (!r.ok) throw new Error("the site answered " + r.status); }
        catch (e) { let ck = ""; try { ck = (await ses.cookies.get({ url })).map((c) => c.name + "=" + c.value).join("; "); } catch (x) {}
          r = await fetch(url, { ...opts, headers: { ...opts.headers, ...(ck ? { Cookie: ck } : {}) } }); }
      } else r = await fetch(url, opts);
      const type = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) throw new Error("the site answered " + r.status);
      const playlistUrl = /\.(m3u8|mpd)(\?|$)/i.test(url) || /mpegurl|dash\+xml/.test(type);
      if (!playlistUrl && (/^(video|audio)\//.test(type) || /octet-stream/.test(type))) { try { await r.body.cancel(); } catch (e) {} return { text: "", type, url: r.url, size: +r.headers.get("content-length") || 0 }; }
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
  async function inspectHls(url, headers, ses) {
    const out = { variants: [], duration: 0, live: false, drm: false };
    const { text } = await fetchText(url, headers, 2e6, 12000, ses);
    if (!text.includes("#EXTM3U")) throw new Error("not a playlist");
    if (DRM_RE.test(text)) out.drm = true;
    const lines = text.split(/\r?\n/);
    out.renditions = [...text.matchAll(/#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF)[^\n]*URI="([^"]+)"/g)].map((m) => { try { return new URL(m[1], url).toString(); } catch (e) { return ""; } }).filter(Boolean);
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
      try { const v = await fetchText(out.variants[0].url, headers, 2e6, 12000, ses); if (DRM_RE.test(v.text)) out.drm = true; const m = await media(v.text); out.duration = m.d; out.live = m.live; } catch (e) {}
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
      const h = await inspectHls(url, headers, meta.ses);
      base.drm = h.drm; base.live = h.live; base.variants = [...h.variants.map((v) => v.url), ...(h.renditions || [])]; base.duration = base.duration || Math.round(h.duration);
      if (!h.drm && !h.live) {
        const vs = h.variants.length ? h.variants : [{ height: 0, bandwidth: 0, url }];
        const seen = new Set();
        for (const v of vs) { const k = v.height || v.bandwidth; if (seen.has(k)) continue; seen.add(k);
          base.formats.push({ id: "hls" + k, kind: "hls", label: v.height ? v.height + "p" + (v.height >= 2160 ? " 4K" : "") : "Stream", height: v.height, bandwidth: v.bandwidth, ext: "mp4", url: v.url, master: h.variants.length ? url : "", browse: !!meta.ses, headers, size: Math.round((v.bandwidth / 8) * h.duration) }); }
        base.formats.push({ id: "mp3", kind: "hls", audio: "mp3", label: "Audio only · MP3", ext: "mp3", url: vs[vs.length - 1].url, master: h.variants.length ? url : "", browse: !!meta.ses, headers, size: Math.round(h.duration * 16000) });
      }
    } else if (ext === "mpd") {
      const { text } = await fetchText(url, headers, 2e6, 12000, meta.ses);
      base.drm = /ContentProtection/i.test(text) && DRM_RE.test(text) || /cenc:default_KID/i.test(text);
      base.live = /type="dynamic"/.test(text); base.duration = base.duration || iso((/mediaPresentationDuration="([^"]+)"/.exec(text) || [])[1]);
      const hs = [...new Set([...text.matchAll(/<Representation[^>]*height="(\d+)"/g)].map((m) => +m[1]))].sort((a, b) => b - a);
      if (!base.drm && !base.live) base.formats.push({ id: "dash", kind: "dash", label: hs[0] ? hs[0] + "p (best)" : "Stream", height: hs[0] || 0, ext: "mp4", url, browse: !!meta.ses, headers, size: 0 });
    } else {
      let size = meta.size || 0, type = "";
      if (!size) try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA, ...(headers || {}) }, signal: ctl.signal }); clearTimeout(tm);
        size = +r.headers.get("content-length") || 0; type = r.headers.get("content-type") || "";
        if (r.ok && /text\/html/.test(type)) return null;
      } catch (e) {}
      const audio = AUDIO_EXT.includes(ext);
      base.formats.push({ id: "file", kind: "direct", browse: !!meta.ses, label: (ext || "file").toUpperCase() + (audio ? " audio" : ""), ext: ext || "mp4", url, headers, size });
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
    // remember the headers the page's own player sent (Referer, Origin, tokens like Authorization / X-…) so FreeTV can repeat the same request
    ses.webRequest.onBeforeSendHeaders((d, cb) => { try { const h = d.requestHeaders || {}, keep = {};
      for (const [k, v] of Object.entries(h)) if (/^(referer|origin|authorization|x-[\w-]+)$/i.test(k) && !/^x-client-data$/i.test(k)) keep[k.toLowerCase() === "referer" ? "Referer" : k.toLowerCase() === "origin" ? "Origin" : k] = v;
      sent.set(d.url, keep); if (sent.size > 4000) sent.clear(); } catch (e) {} cb({}); });
    ses.webRequest.onHeadersReceived((d, cb) => {
      try { const h = d.responseHeaders || {}; const ct = String((h["content-type"] || h["Content-Type"] || [""])[0]).toLowerCase(); const u = d.url, bare = u.split("#")[0].split("?")[0];
        const playlist = /mpegurl|dash\+xml/.test(ct) || /\.(m3u8|mpd)$/i.test(bare);
        const file = !/\.(ts|m4s|aac|jpe?g|png|gif|webp|svg|css|js|woff2?|ico|vtt|srt|json)$/i.test(bare) && (/^(video|audio)\//.test(ct) && !/mp2t/.test(ct) || /\.(mp4|webm|mov|m4v|mkv|mp3|m4a|flac)$/i.test(bare));
        if ((playlist || file) && d.statusCode < 400) { const hd = { ...(sent.get(u) || {}) };
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
    watchSession(bses, (u, h) => { if (bhits.size < 60 && ![...bhits.values()].some((x) => x.key === h.key)) { bhits.set(u, h); emit("browse", { count: bhits.size }); clearTimeout(btnTimer); btnTimer = setTimeout(() => showBtn(true), 300); } });
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
    const moved = (u) => { if (pageKey(u) !== cur) { cur = pageKey(u); bhits.clear(); emit("browse", { count: 0 }); showBtn(false); } };
    wc.on("console-message", (e, level, message) => { const m = (e && e.message) || message; if (m === "__ftv_dl_click__") emit("bclick", {}); });
    wc.on("did-frame-finish-load", () => { if (bhits.size) setTimeout(() => showBtn(true), 400); });
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
  // a small "Download" button laid over the video inside the page, like IDM's. It lives in a closed shadow root;
  // a click only asks FreeTV to open its own panel (via a console message), nothing else.
  let blabel = "Download", btnTimer = 0;
  const OVERLAY = (label) => `(()=>{try{const W=window;if(W.__ftvDl){W.__ftvDl.t=Date.now();return}
    const host=document.createElement('div');host.style.cssText='all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none';
    const sh=host.attachShadow({mode:'closed'});sh.innerHTML='<style>b{all:initial;display:flex;align-items:center;gap:6px;font:600 13px -apple-system,Helvetica,Arial,sans-serif;color:#000;background:#4aa3ff;padding:7px 12px 7px 10px;border-radius:10px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45);user-select:none;opacity:.94;transition:transform .15s,opacity .15s}b:hover{opacity:1;transform:scale(1.05)}svg{width:15px;height:15px}</style><b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M6.5 10.5 12 16l5.5-5.5M5 20h14"/></svg>${label.replace(/[<>&'"\\]/g,'')}</b>';
    const go=e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation&&e.stopImmediatePropagation();console.log('__ftv_dl_click__')};
    for(const ev of['click','mousedown','mouseup','pointerdown','pointerup'])sh.querySelector('b').addEventListener(ev,ev==='click'?go:(e=>{e.stopPropagation()}),true);
    const top=W===W.top;
    const place=()=>{const fs=document.fullscreenElement||document.webkitFullscreenElement;const root=fs||document.documentElement;if(host.parentNode!==root)root.appendChild(host);
      let best=null,area=0;for(const v of document.querySelectorAll('video')){const r=v.getBoundingClientRect();const a=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));if(r.width>=200&&r.height>=110&&a>area){area=a;best=r}}
      if(!best&&top){const big=[...document.querySelectorAll('iframe')].some(f=>{const r=f.getBoundingClientRect();return r.width>=300&&r.height>=170&&r.bottom>0&&r.top<innerHeight});if(!big)best={top:0,right:innerWidth,fixed:1}}
      if(!best){host.style.display='none';return}
      host.style.display='block';const bw=host.offsetWidth||110;host.style.top=Math.max(8,best.top+10)+'px';host.style.left=Math.max(8,Math.min(innerWidth-bw-8,best.right-bw-10))+'px'};
    W.__ftvDl={t:Date.now(),place,host};place();
    const iv=setInterval(()=>{if(!W.__ftvDl||Date.now()-W.__ftvDl.t>8000){host.remove();clearInterval(iv);delete W.__ftvDl;return}place()},400);
    addEventListener('scroll',place,true);addEventListener('resize',place);document.addEventListener('fullscreenchange',place)}catch(e){}})()`;
  const REMOVE = `(()=>{try{if(window.__ftvDl){window.__ftvDl.host.remove();window.__ftvDl.t=0}}catch(e){}})()`;
  function showBtn(on) {
    if (!bwc || bwc.isDestroyed()) return;
    try { for (const f of bwc.mainFrame.framesInSubtree) f.executeJavaScript(on ? OVERLAY(blabel) : REMOVE, false).catch(() => {}); } catch (e) {}
  }
  // keeps the button alive (players rebuild their DOM) while media was found on this page
  setInterval(() => { if (bhits.size && bview && bwc && !bwc.isDestroyed()) showBtn(true); }, 3000).unref?.();
  function browseCmd({ cmd, url, x, y, w, h, show, label }) {
    if (label) blabel = String(label).slice(0, 30);
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
    const failed = [];
    if (!items.length) for (const [u, h] of [...bhits].slice(0, 25)) { try { const it = await itemFromMedia(u, { pageUrl: url, title, thumbnail: thumb, source: "network", ext: h.ext || extOf(u), headers: h.headers, ses: bses }); if (it) items.push(it); } catch (e) { failed.push({ u, h, e }); } }
    // a stream the page played but FreeTV couldn't inspect: still offer it, the downloader picks the best quality itself
    const pl = failed.filter((f) => f.h.playlist);
    if (!items.some((i) => i.formats.length) && pl.length && ytPath()) {
      const f = pl.find((x) => /master|playlist|index|manifest/i.test(x.u)) || pl[0];
      items.push({ id: "f" + Date.now(), source: "network", site: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })(), title, thumbnail: thumb, duration: 0, pageUrl: url,
        previewUrl: f.u, previewHeaders: f.h.headers, drm: false, live: false,
        formats: [{ id: "best", kind: f.h.ext === "mpd" ? "dash" : "hls", label: "Best quality", ext: "mp4", url: f.u, master: f.u, browse: true, headers: f.h.headers, size: 0 },
                  { id: "mp3", kind: "hls", audio: "mp3", label: "Audio only · MP3", ext: "mp3", url: f.u, master: f.u, browse: true, headers: f.h.headers, size: 0 }] });
      notes.push("FreeTV couldn't read the quality list of this stream, so it will download the best quality available.");
    } else if (!items.length && failed.length) notes.push("A stream was found but couldn't be read: " + String(failed[0].e && failed[0].e.message || "").slice(0, 120));
    // nothing played yet: read the page itself as well (video tags, player scripts, embedded players)
    if (!items.length && /^https?:/.test(url)) { try { items = await scanPage(url); } catch (e) {} }
    items = tidy(items);
    if (items.some((i) => i.drm)) notes.push("Some media on this page is DRM-protected and can't be downloaded.");
    return { url, items, notes };
  }

  // ================================================================ MEGA public links
  // A public MEGA link carries its own key after the "#": the file is downloaded and decrypted exactly as
  // MEGA's website does it. Folder links are listed file by file. MEGA's transfer limits are respected.
  const MEGA_API = process.env.FTV_MEGA_API || "https://g.api.mega.co.nz/cs";
  const isMega = (u) => /^https?:\/\/(www\.)?mega\.(nz|co\.nz|io)\//i.test(u);
  const b64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/,/g, ""), "base64");
  function parseMega(u) {
    let m;
    if ((m = /\/(file|folder)\/([\w-]+)#([\w-]+)(?:\/(?:file|folder)\/([\w-]+))?/i.exec(u))) return { kind: m[1].toLowerCase(), id: m[2], key: m[3], sub: m[4] || "" };
    if ((m = /#(F?)!([\w-]+)!([\w-]+)/.exec(u))) return { kind: m[1] ? "folder" : "file", id: m[2], key: m[3], sub: "" };
    return null;
  }
  function megaKeys(raw) {           // 32-byte file key → AES key, CTR IV
    const k = Buffer.alloc(16); for (let i = 0; i < 16; i++) k[i] = raw[i] ^ raw[i + 16];
    const iv = Buffer.alloc(16); raw.copy(iv, 0, 16, 24);
    return { key: k, iv };
  }
  function megaAttrs(at, key) {
    try { const d = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16)); d.setAutoPadding(false);
      const buf = b64u(at), pad = Buffer.concat([buf, Buffer.alloc((16 - (buf.length % 16)) % 16)]);
      const t = Buffer.concat([d.update(pad), d.final()]).toString("utf8").replace(/\0+$/, "");
      return t.startsWith("MEGA{") ? JSON.parse(t.slice(4)) : {}; } catch (e) { return {}; }
  }
  const MEGA_ERR = { "-2": "MEGA rejected the request.", "-3": "MEGA is busy right now. Try again in a moment.", "-4": "MEGA's limit was reached. Try again later.", "-9": "This MEGA file or folder doesn't exist (any more).",
    "-11": "This MEGA link isn't public.", "-14": "The key in this MEGA link is wrong.", "-16": "MEGA has taken this file down.", "-17": "MEGA's free transfer limit is used up for now. Try again later.", "-18": "MEGA says this file is temporarily unavailable." };
  async function megaApi(body, folder) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(MEGA_API + "?id=" + Math.floor(Math.random() * 1e9) + (folder ? "&n=" + folder : ""), { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify([body]) });
      if (r.status === 509) throw new Error(MEGA_ERR["-17"]);
      const j = await r.json(); const v = Array.isArray(j) ? j[0] : j;
      if (v === -3 && attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
      if (typeof v === "number" && v < 0) throw new Error(MEGA_ERR[String(v)] || "MEGA answered with error " + v);
      if (typeof j === "number" && j < 0) throw new Error(MEGA_ERR[String(j)] || "MEGA answered with error " + j);
      return v;
    }
  }
  const VIDEO_EXT = ["mp4", "mkv", "avi", "mov", "m4v", "webm", "ts", "flv", "wmv", "mpg", "mpeg", "3gp"];
  function megaItem({ name, size, handle, folder, rawKey, pageUrl }) {
    const ext = (String(name).split(".").pop() || "").toLowerCase(), video = VIDEO_EXT.includes(ext), audio = AUDIO_EXT.includes(ext);
    const base = { kind: "mega", mega: { handle, folder: folder || "", key: rawKey.toString("base64") }, ext, size, url: "mega:" + (folder ? folder + "/" : "") + handle };
    const formats = [{ ...base, id: "orig", label: "Original file · " + (ext || "file").toUpperCase() }];
    if (video && ext !== "mp4") formats.push({ ...base, id: "mp4", label: "Download and convert to MP4", toMp4: true, out: "mp4" });
    if (video) formats.push({ ...base, id: "mp3", label: "Download and extract MP3", toMp3: true, out: "mp3" });
    return { id: "mg" + handle, source: "mega", site: "MEGA", title: name.replace(/\.[^.]+$/, "") || "MEGA file", fileName: name, description: "", thumbnail: "", duration: 0, pageUrl, formats, previewUrl: "", drm: false, live: false, video: video || audio };
  }
  async function megaItems(url) {
    const m = parseMega(url); if (!m) throw new Error("This MEGA link has no key. Copy the whole link, including the part after #.");
    const key = b64u(m.key);
    if (m.kind === "file") {
      if (key.length !== 32) throw new Error(MEGA_ERR["-14"]);
      step("Asking MEGA about the file…");
      const r = await megaApi({ a: "g", p: m.id, ssl: 2 });
      const { key: ak } = megaKeys(key); const at = megaAttrs(r.at, ak);
      if (!at.n) throw new Error(MEGA_ERR["-14"]);
      return [megaItem({ name: at.n, size: r.s, handle: m.id, rawKey: key, pageUrl: url })];
    }
    if (key.length !== 16) throw new Error(MEGA_ERR["-14"]);
    step("Reading the MEGA folder…");
    const r = await megaApi({ a: "f", c: 1, r: 1, ca: 1 }, m.id);
    const nodes = r.f || [], out = [], names = new Map();
    for (const n of nodes) {                                     // folder names for nicer titles
      if (n.t !== 1 || !n.k) continue;
      try { const ek = b64u(String(n.k).split(":").pop()); const d = crypto.createDecipheriv("aes-128-ecb", key, null); d.setAutoPadding(false); const fk = Buffer.concat([d.update(ek), d.final()]); names.set(n.h, megaAttrs(n.a, fk).n || ""); } catch (e) {}
    }
    for (const n of nodes) {
      if (n.t !== 0 || !n.k) continue;
      if (m.sub && n.h !== m.sub) continue;
      try { const ek = b64u(String(n.k).split(":").pop()); if (ek.length !== 32) continue;
        const d = crypto.createDecipheriv("aes-128-ecb", key, null); d.setAutoPadding(false); const fk = Buffer.concat([d.update(ek), d.final()]);
        const at = megaAttrs(n.a, megaKeys(fk).key); if (!at.n) continue;
        const it = megaItem({ name: at.n, size: n.s, handle: n.h, folder: m.id, rawKey: fk, pageUrl: url }); const dir = names.get(n.p); if (dir) it.description = dir; out.push(it);
      } catch (e) {}
    }
    if (!out.length) throw new Error("This MEGA folder has no files FreeTV can read.");
    return out.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true })).slice(0, 300);
  }
  async function megaUrl(j) {                                    // download links expire, so a fresh one is asked for each start
    const r = await megaApi(j.mega.folder ? { a: "g", g: 1, n: j.mega.handle, ssl: 2 } : { a: "g", g: 1, p: j.mega.handle, ssl: 2 }, j.mega.folder);
    if (!r.g) throw new Error(MEGA_ERR["-18"]);
    return r;
  }
  function megaDecipherAt(j, offset) {
    const { key, iv } = megaKeys(Buffer.from(j.mega.key, "base64"));
    const ctr = Buffer.from(iv); ctr.writeBigUInt64BE(BigInt(Math.floor(offset / 16)), 8);
    const d = crypto.createDecipheriv("aes-128-ctr", key, ctr); if (offset % 16) d.update(Buffer.alloc(offset % 16));
    return d;
  }

  // ================================================================ analyze
  async function analyze({ url, deep }) {
    url = String(url || "").trim(); if (!url) throw new Error("Paste a link first");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch (e) { throw new Error("That doesn't look like a web address"); }
    const notes = []; let items = [];
    step("Checking the link…");
    if (isMega(url)) { try { return { url, items: await megaItems(url), notes: [], extractor: !!ytPath() }; } catch (e) { return { url, items: [], notes: [e.message], extractor: !!ytPath() }; } }
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
    const D = o.duration || 0;
    let sec = o.section && f.kind !== "mega" && D ? { start: Math.max(0, Math.round(+o.section.start || 0)), end: Math.min(Math.round(D), Math.round(+o.section.end || D)), exact: !!o.section.exact } : null;
    if (sec && (sec.end - sec.start < 1 || (sec.start <= 0 && sec.end >= Math.round(D)))) sec = null;   // the whole video after all
    const comp = o.compress && +o.compress.bytes > 0 && !f.audio ? { bytes: Math.round(+o.compress.bytes), height: Math.max(144, +o.compress.height || 720), abr: Math.max(48, Math.min(192, +o.compress.abr || 128)) } : null;
    const sig = [o.pageUrl, f.id, f.kind, f.url || "", f.audio || "", sec ? sec.start + "-" + sec.end : "", comp ? comp.bytes : ""].join("|");
    const dup = st.jobs.find((j) => j.sig === sig && j.state !== "canceled" && j.state !== "failed");
    if (dup && !o.force) return { duplicate: true, id: dup.id, state: dup.state };
    const useYt = f.kind === "ytdlp" || ((f.kind === "hls" || f.kind === "dash") && !!ytPath());
    const hhmmss = (t) => [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60].map((x) => String(x).padStart(2, "0")).join("-").replace(/^00-/, "");
    const tag = (sec ? " (" + hhmmss(sec.start) + " to " + hhmmss(sec.end) + ")" : "") + (comp ? " (" + Math.max(1, Math.round(comp.bytes / 1e6)) + " MB)" : "");
    // an HLS quality is fetched from its master playlist, so separate audio tracks come along
    const hlsSel = f.kind === "hls" && useYt && f.master ? (f.audio ? "" : f.height ? `bv*[height<=${f.height}]+ba/b[height<=${f.height}]/bv*+ba/b` : "bv*+ba/b") : "";
    const ext = "." + (f.audio || f.ext || "mp4");
    const dir = folder(AUDIO_EXT.includes(ext.slice(1)) ? path.join("Web", "Audio") : "Web");
    const file = f.kind === "mega" ? uniquePath(folder(path.join("Web", "MEGA")), safe(o.title), "." + (f.ext || "bin")) : uniquePath(dir, safe(o.title) + (f.height && !f.audio && !comp ? " " + f.height + "p" : "") + tag, comp ? ".mp4" : ext);
    const j = { id: "w" + Date.now() + Math.floor(Math.random() * 999), sig, title: o.title, thumbnail: o.thumbnail || "", pageUrl: o.pageUrl, site: o.site || "", label: f.label || "",
      engine: f.kind === "mega" ? "mega" : useYt ? "ytdlp" : f.kind === "direct" && !sec ? "direct" : "ffmpeg", section: sec, compress: comp, mega: f.mega || null, after: f.toMp4 ? "mp4" : f.toMp3 ? "mp3" : "", url: f.kind === "ytdlp" ? o.pageUrl : (useYt && f.master) || f.url, headers: f.headers || null, browse: !!f.browse, sel: f.sel || hlsSel, sort: f.sort || (hlsSel && f.height ? `res:${f.height}` : ""), audio: f.audio || "",
      duration: o.duration || 0, file, state: "queued", size: 0, total: Math.round((f.size || 0) * (sec && D ? (sec.end - sec.start) / D : 1)), speed: 0, eta: 0, tries: 0, created: Date.now(), error: "" };
    st.jobs.unshift(j); pushJobs(); pump();
    return { id: j.id };
  }
  function pump() {
    let active = st.jobs.filter((j) => j.state === "downloading" && !j.post).length;        // jobs converting after download don't hold a download slot
    for (const j of st.jobs.filter((x) => x.state === "queued").reverse()) { if (active >= st.settings.maxActive) break; active++; start(j); }
  }
  async function start(j) {
    j.state = "downloading"; j.error = ""; j.want = ""; j.post = false; pushJobs();
    try {
      if (j.engine === "mega") { const r = await megaUrl(j); j.url = r.g; if (r.s) j.total = r.s; }
      await (j.engine === "direct" || j.engine === "mega" ? runDirect(j) : j.engine === "ytdlp" ? runYtJob(j) : runFfmpegJob(j));
      if (j.compress && !j.compressed) { await afterDownload(j, () => compressToSize(j)); if (j.want) throw new Error("stopped"); }
      else if (!j.audio && j.engine !== "mega" && !j.compressed) { await afterDownload(j, () => makeAppleFriendly(j)); if (j.want) throw new Error("stopped"); }
      try { j.size = j.total = fs.statSync(j.file).size; } catch (e) {}
      Object.assign(j, { state: "done", speed: 0, eta: 0, ended: Date.now(), parts: undefined });
      if (j.after === "mp4") addConvert({ inputs: [j.file], opts: { format: "mp4", vcodec: "smart", acodec: "smart", quality: "high", abitrate: 192 } });
      if (j.after === "mp3") addConvert({ inputs: [j.file], opts: { format: "mp3", abitrate: 256 } });
    } catch (e) {
      running.delete(j.id);
      if (j.want === "pause") Object.assign(j, { state: "paused", speed: 0 });
      else if (j.want === "cancel") { j.state = "canceled"; cleanup(j); }
      else if (!/answered 4\d\d|answered 509|DRM|sign-in|country|MEGA/.test(String(e.message)) && ++j.tries <= 4) {                             // automatic retry after an interruption
        j.error = "Retrying (" + j.tries + "/4)…"; j.speed = 0; pushJobs(); await sleep(2000 * j.tries);
        if (j.state === "downloading" && !j.want) return start(j);
        if (j.want === "pause") j.state = "paused"; else if (j.want === "cancel") { j.state = "canceled"; cleanup(j); }
      } else Object.assign(j, { state: "failed", speed: 0, error: String(e.message || e).slice(0, 220) });
    }
    running.delete(j.id); pushJobs(); pump();
  }
  // converting after download: frees the download slot right away so the next download starts, and runs at most 2 at a time (the Mac's video chip has a few encoders)
  let postBusy = 0; const postWait = [];
  async function afterDownload(j, fn) {
    j.post = true; j.speed = 0; j.eta = 0; pump();
    if (postBusy >= 2) { j.phase = "Waiting to convert"; j.phaseProgress = 0; pushJobs(); while (postBusy >= 2) await new Promise((r) => postWait.push(r)); }
    postBusy++;
    try { if (!j.want) return await fn(); }
    finally { postBusy--; j.post = false; if (j.phase === "Waiting to convert") j.phase = ""; const n = postWait.shift(); if (n) n(); }
  }
  function cleanup(j) {
    try { const dir = path.dirname(j.file), b = path.basename(j.file, path.extname(j.file));
      for (const f of fs.readdirSync(dir)) if (f.startsWith(b + ".") && (/\.(part|ytdl)$/.test(f) || /\.part-Frag\d+/.test(f) || /\.f\d+\.\w+$/.test(f) || f === path.basename(j.file) + ".part")) try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
    } catch (e) {}
  }
  async function browseCookies(j) {
    if (!j.browse || !bses) return [];
    const all = new Map();
    for (const u of [j.url, j.pageUrl]) { try { for (const c of await bses.cookies.get({ url: u })) all.set(c.domain + c.path + c.name, c); } catch (e) {} }
    return [...all.values()];
  }
  async function cookieHeader(j) { const c = await browseCookies(j); return c.length ? { Cookie: c.map((x) => x.name + "=" + x.value).join("; ") } : {}; }
  async function cookieFile(j) {
    const c = await browseCookies(j); if (!c.length) return null;
    const f = path.join(app.getPath("userData"), "cookies-" + j.id + ".txt");
    fs.writeFileSync(f, "# Netscape HTTP Cookie File\n" + c.map((x) => { const d = x.hostOnly ? x.domain.replace(/^\./, "") : (x.domain.startsWith(".") ? x.domain : "." + x.domain);
      return [d, x.hostOnly ? "FALSE" : "TRUE", x.path || "/", x.secure ? "TRUE" : "FALSE", Math.round(x.expirationDate || 0), x.name, x.value].join("\t"); }).join("\n") + "\n", { mode: 0o600 });
    return f;
  }
  // --- direct files: several connections at once, each fetching its own byte range (resumable)
  async function runDirect(j) {
    const ctl = new AbortController(); running.set(j.id, { stop: () => ctl.abort() });
    const H = { "User-Agent": UA, ...(j.headers || {}), ...(await cookieHeader(j)) }; const tmp = j.file + ".part";
    if (!j.parts || !fs.existsSync(tmp)) {
      const r = await fetch(j.url, { headers: { ...H, Range: "bytes=0-0" }, signal: ctl.signal });
      const cr = r.headers.get("content-range"); let total = 0, ranges = false;
      if (r.status === 206 && cr) { total = +cr.split("/")[1] || 0; ranges = total > 0; } else if (r.ok) total = +r.headers.get("content-length") || 0; else throw new Error(r.status === 509 && j.engine === "mega" ? MEGA_ERR["-17"] : "the server answered " + r.status);
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
      if (r.status === 509) throw new Error(MEGA_ERR["-17"]);
      if (!r.ok) throw new Error("the server answered " + r.status);
      if (j.ranges && r.status !== 206) throw new Error("the server stopped supporting resume");
      const dec = j.engine === "mega" ? megaDecipherAt(j, p.s + p.d) : null;
      for await (let c of Readable.fromWeb(r.body)) {
        if (dec) c = dec.update(c);
        await new Promise((res, rej) => fs.write(fd, c, 0, c.length, p.s + p.d, (e) => (e ? rej(e) : res())));
        p.d += c.length; j.size = j.parts.reduce((a, x) => a + x.d, 0);
      }
      if (p.e >= 0 && p.s + p.d <= p.e) throw new Error("connection closed early");
    };
    try { await Promise.all(j.parts.map(one)); } catch (e) { ctl.abort(); await sleep(50); try { fs.closeSync(fd); } catch (x) {} throw e; }
    fs.closeSync(fd); fs.renameSync(tmp, j.file);
  }
  // --- sites and streams: yt-dlp (parallel fragments, resume, merge with ffmpeg)
  async function runYtJob(j) {
    const ck = await cookieFile(j);
    try { await runYtJob2(j, ck); } finally { if (ck) try { fs.unlinkSync(ck); } catch (e) {} }
  }
  function runYtJob2(j, ck) {
    return new Promise((resolve, reject) => {
      const tpl = j.file.slice(0, -path.extname(j.file).length) + ".%(ext)s";
      const args = [...jsArgs(), "--no-warnings", "--newline", "--progress", "--no-playlist", "--no-mtime", "--continue", "--ffmpeg-location", ctx.ffmpegPath(), "-N", String(st.settings.connections), "--retries", "10", "--fragment-retries", "10",
        "--progress-template", "download:FTVP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s", "--print", "after_move:FTVF|%(filepath)s", "-o", tpl];
      if (j.audio) args.push("-f", "ba/b", "-x", "--audio-format", j.audio, "--audio-quality", "0");
      else { args.push("-f", j.sel || "bv*+ba/b"); if (j.sort) args.push("-S", j.sort); args.push("--merge-output-format", "mp4"); }
      for (const [k, v] of Object.entries(j.headers || {})) args.push("--add-header", k + ":" + v);
      if (ck) args.push("--cookies", ck);
      if (j.section) { args.push("--download-sections", "*" + j.section.start + "-" + j.section.end); if (j.section.exact) args.push("--force-keyframes-at-cuts"); }
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
      p.stderr.on("data", (d) => { err = (err + d).slice(-4000);
        if (j.section) { const m = [...String(d).matchAll(/time=(\d+):(\d\d):(\d\d)/g)].pop(); const len = j.section.end - j.section.start;     // only a part: ffmpeg does the cutting, so its clock is the progress
          if (m && len && j.total) { const done = Math.min(0.99, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / len); if (done * j.total > j.size) j.size = Math.round(done * j.total); } } });
      p.on("error", (e) => reject(e));
      p.on("close", (code) => {
        if (code === 0) { if (finalFile && fs.existsSync(finalFile)) j.file = finalFile; return resolve(); }
        const e = ytError(err); reject(new Error(e.userMsg || e.detail || "download stopped (" + code + ")"));
      });
    });
  }
  // --- HLS / DASH without yt-dlp: ffmpeg copies the stream into one file
  async function runFfmpegJob(j) { const ck = await cookieHeader(j); return runFfmpegJob2(j, ck); }
  function runFfmpegJob2(j, ck) {
    return new Promise((resolve, reject) => {
      const tmp = j.file + ".part"; const h = { ...(j.headers || {}), ...ck };
      const args = ["-hide_banner", "-nostdin", "-y", "-user_agent", UA];
      if (Object.keys(h).length) args.push("-headers", Object.entries(h).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n");
      const sec = j.section, len = sec ? sec.end - sec.start : j.duration;
      if (sec) args.push("-ss", String(sec.start));
      args.push("-i", j.url);
      if (sec) args.push("-t", String(len));
      const audioExt = /\.(m4a|aac|mp3|flac|wav|ogg|opus)$/i.exec(j.file);
      if (j.audio === "mp3" || (audioExt && /mp3/i.test(audioExt[1]))) args.push("-vn", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3");
      else if (audioExt) args.push("-vn", ...(sec && sec.exact ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]), "-f", ({ m4a: "ipod", aac: "adts" })[audioExt[1].toLowerCase()] || audioExt[1].toLowerCase());
      else if (sec && sec.exact) args.push("-map", "0:v:0?", "-map", "0:a:0?", ...(caps().has("libx264") ? ["-c:v", "libx264", "-preset", "fast", "-crf", "18"] : ["-c:v", "h264_videotoolbox", "-b:v", "8000k"]), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4");
      else args.push("-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4");
      args.push(tmp);
      const p = spawn(ctx.ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
      running.set(j.id, { stop: () => { try { p.kill("SIGKILL"); } catch (e) {} } });
      let err = "", t0 = Date.now();
      p.stderr.on("data", (d) => { err = (err + d).slice(-3000); const m = [...String(d).matchAll(/time=(\d+):(\d\d):(\d\d)/g)].pop(), s = [...String(d).matchAll(/size=\s*(\d+)\s*Ki?B/gi)].pop();
        if (s) j.size = +s[1] * 1024; if (m && len) { const done = (+m[1] * 3600 + +m[2] * 60 + +m[3]) / len; if (done > 0.01) { j.total = Math.round(j.size / done); j.eta = Math.round(((Date.now() - t0) / 1000) * (1 - done) / done); } } });
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
  // Every output FreeTV can make. vc/ac = default codecs, okV/okA = what that container accepts.
  const FORMATS = {
    mp4: { kind: "video", f: "mp4", vc: "h264", ac: "aac", okV: ["h264", "hevc"], okA: ["aac", "mp3"] },
    mov: { kind: "video", f: "mov", vc: "h264", ac: "aac", okV: ["h264", "hevc", "prores"], okA: ["aac", "mp3", "pcm"] },
    m4v: { kind: "video", f: "mp4", vc: "h264", ac: "aac", okV: ["h264", "hevc"], okA: ["aac"] },
    mkv: { kind: "video", f: "matroska", vc: "h264", ac: "aac", okV: ["h264", "hevc", "vp9", "mpeg4", "mpeg2"], okA: ["aac", "mp3", "opus", "flac", "ac3", "vorbis"], anyCopy: true },
    avi: { kind: "video", f: "avi", vc: "mpeg4", ac: "mp3", okV: ["mpeg4", "h264"], okA: ["mp3", "ac3"] },
    webm: { kind: "video", f: "webm", vc: "vp9", ac: "opus", okV: ["vp9"], okA: ["opus", "vorbis"] },
    flv: { kind: "video", f: "flv", vc: "h264", ac: "aac", okV: ["h264"], okA: ["aac", "mp3"] },
    wmv: { kind: "video", f: "asf", vc: "wmv2", ac: "wma", okV: ["wmv2"], okA: ["wma"] },
    mpg: { kind: "video", f: "mpeg", vc: "mpeg2", ac: "mp2", okV: ["mpeg2"], okA: ["mp2"] },
    ts: { kind: "video", f: "mpegts", vc: "h264", ac: "aac", okV: ["h264", "hevc", "mpeg2"], okA: ["aac", "mp3", "ac3", "mp2"] },
    "3gp": { kind: "video", f: "3gp", vc: "h264", ac: "aac", okV: ["h264"], okA: ["aac"] },
    ogv: { kind: "video", f: "ogg", vc: "theora", ac: "vorbis", okV: ["theora"], okA: ["vorbis", "opus"] },
    prores: { kind: "video", f: "mov", ext: "mov", vc: "prores", ac: "pcm", okV: ["prores"], okA: ["pcm"] },
    mp3: { kind: "audio", f: "mp3", ac: "mp3" }, m4a: { kind: "audio", f: "ipod", ac: "aac" }, aac: { kind: "audio", f: "adts", ac: "aac" },
    wav: { kind: "audio", f: "wav", ac: "pcm" }, flac: { kind: "audio", f: "flac", ac: "flac" }, ogg: { kind: "audio", f: "ogg", ac: "vorbis" },
    opus: { kind: "audio", f: "opus", ac: "opus" }, aiff: { kind: "audio", f: "aiff", ac: "pcmbe" }, wma: { kind: "audio", f: "asf", ac: "wma" }, ac3: { kind: "audio", f: "ac3", ac: "ac3" },
    gif: { kind: "gif" }, webp: { kind: "webp" }, jpg: { kind: "frame" }, png: { kind: "frames" }, srt: { kind: "subs" },
  };
  const VENC = { h264: "libx264", hevc: "libx265", vp9: "libvpx-vp9", mpeg4: "mpeg4", wmv2: "wmv2", mpeg2: "mpeg2video", theora: "libtheora", prores: "prores_ks" };
  const AENC = { aac: "aac", mp3: "libmp3lame", opus: "libopus", vorbis: "libvorbis", flac: "flac", pcm: "pcm_s16le", pcmbe: "pcm_s16be", wma: "wmav2", ac3: "ac3", mp2: "mp2" };
  const CRF = { h264: [18, 23, 28], hevc: [22, 27, 31], vp9: [28, 33, 38], mpeg4: [3, 6, 10], wmv2: [3, 6, 10], mpeg2: [3, 6, 10], theora: [9, 7, 5] };
  let encoders = null;
  function caps() {
    if (encoders) return encoders;
    try { const t = require("node:child_process").spawnSync(ctx.ffmpegPath(), ["-hide_banner", "-encoders"], { encoding: "utf8", timeout: 15000 }).stdout || ""; encoders = new Set([...t.matchAll(/^ [VAS.][F.][S.][X.][B.][D.] (\S+)/gm)].map((m) => m[1])); } catch (e) { encoders = new Set(); }
    return encoders;
  }
  const hasV = (vc) => caps().has(VENC[vc]), hasA = (ac) => caps().has(AENC[ac]);
  function formatsAvailable() {
    const out = {};
    for (const [k, f] of Object.entries(FORMATS)) out[k] = f.kind === "video" ? hasV(f.vc) && hasA(f.ac) : f.kind === "audio" ? hasA(f.ac) : f.kind === "gif" ? caps().has("gif") : f.kind === "webp" ? caps().has("libwebp_anim") || caps().has("libwebp") : f.kind === "frame" ? caps().has("mjpeg") : f.kind === "frames" ? caps().has("png") : caps().has("srt");
    return out;
  }
  const extOfFormat = (fmt) => (FORMATS[fmt] && FORMATS[fmt].ext) || fmt;
  function probe(file) {
    try { const r = require("node:child_process").spawnSync(ctx.ffmpegPath(), ["-hide_banner", "-i", file], { encoding: "utf8", timeout: 20000 }); const t = r.stderr || "";
      const vl = (/Stream #[^\n]*Video: [^\n]*/.exec(t) || [""])[0];
      let v = ((/Video: (\w+)/.exec(vl) || [])[1] || "").toLowerCase();
      if (v === "h264" && !/yuvj?420p(?![\w])|nv12/.test(vl)) v = "h264x";            // 4:4:4 / 10-bit H.264 won't play on Apple devices: re-encode
      if (v === "hevc" && !/yuv420p(10le)?(?![\w])/.test(vl)) v = "hevcx";
      if (/attached pic/.test(vl)) v = "";                                               // cover art in audio files isn't a video
      const d = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(t), wh = /, (\d{2,5})x(\d{2,5})[, ]/.exec(vl), br = /bitrate: (\d+) kb\/s/.exec(t);
      return { v, a: ((/Stream #[^\n]*Audio: (\w+)/.exec(t) || [])[1] || "").toLowerCase(), subs: (t.match(/Stream #[^\n]*Subtitle:/g) || []).length,
        duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, width: wh ? +wh[1] : 0, height: wh ? +wh[2] : 0, kbps: br ? +br[1] : 0, tenbit: /10le|p010/.test(vl) }; } catch (e) { return { v: "", a: "", subs: 0, duration: 0, width: 0, height: 0, kbps: 0, tenbit: false }; }
  }
  const secs = (t) => { if (t === undefined || t === null || t === "") return null; const p = String(t).trim().split(":").map(Number); if (p.some(isNaN)) return null; return p.reduce((a, x) => a * 60 + x, 0); };
  let vtSpeed = null;                                     // newer ffmpeg: -prio_speed 1 lets the Mac's video encoder favour speed
  function vtFast(enc) {
    if (vtSpeed === null) { try { vtSpeed = /prio_speed/.test(require("node:child_process").spawnSync(ctx.ffmpegPath(), ["-hide_banner", "-h", "encoder=hevc_videotoolbox"], { encoding: "utf8", timeout: 15000 }).stdout || ""); } catch (e) { vtSpeed = false; } }
    return vtSpeed && /videotoolbox/.test(enc) ? ["-prio_speed", "1"] : [];
  }
  // decode on the video chip too (H.264, HEVC, VP9, ProRes on Apple Silicon); ffmpeg falls back to the processor by itself when it can't
  const hwDec = () => process.platform === "darwin" ? ["-hwaccel", "videotoolbox"] : [];
  function appleVideoArgs(info) {
    const vt = caps().has("hevc_videotoolbox"), h = info.height || 1080;
    const floor = h >= 2000 ? 24000 : h >= 1400 ? 14000 : h >= 1000 ? 8000 : h >= 700 ? 4500 : 2500;
    const kb = Math.min(80000, Math.max(floor, Math.round((info.kbps || 0) * 1.4)));
    const a = vt ? ["-c:v", "hevc_videotoolbox", "-allow_sw", "1", ...vtFast("hevc_videotoolbox"), "-b:v", kb + "k", "-maxrate", Math.round(kb * 1.5) + "k", "-bufsize", kb * 2 + "k"] : ["-c:v", "libx265", "-preset", "fast", "-crf", "20", "-x265-params", "log-level=error"];
    a.push("-pix_fmt", info.tenbit ? (vt ? "p010le" : "yuv420p10le") : "yuv420p");
    if (info.tenbit && vt) a.push("-profile:v", "main10");
    a.push("-tag:v", "hvc1");
    return a;
  }
  // QuickTime / Finder / iPhone play H.264 and HEVC video with AAC/MP3/AC3 sound. Anything else gets fixed after download.
  const appleOk = (info) => (!info.v || /^(h264|hevc|mjpeg|prores)$/.test(info.v)) && (!info.a || /^(aac|mp3|alac|ac3|eac3)$/.test(info.a));
  function makeAppleFriendly(j, noHw) {
    return new Promise((resolve) => {
      if (!st.settings.apple || !/\.(mp4|m4v|mov|mkv|webm)$/i.test(j.file) || !fs.existsSync(j.file)) return resolve();
      const info = probe(j.file); if (appleOk(info)) return resolve();
      const out = j.file.replace(/\.(mkv|webm|mov|m4v)$/i, ".mp4"), tmp = out + ".mac.part";
      const okV = !info.v || /^(h264|hevc)$/.test(info.v);
      const args = ["-hide_banner", "-nostdin", "-y", ...(okV || noHw ? [] : hwDec()), "-i", j.file, "-map", "0:v:0?", "-map", "0:a:0?",
        ...(okV ? ["-c:v", "copy", ...(info.v === "hevc" ? ["-tag:v", "hvc1"] : [])] : appleVideoArgs(info)),
        ...(info.a && !/^(aac|mp3|alac|ac3|eac3)$/.test(info.a) ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]),
        "-movflags", "+faststart", "-f", "mp4", "-progress", "pipe:1", "-nostats", tmp];
      j.phase = "Making it play on Mac"; j.phaseProgress = 0; pushJobs();
      const p = spawn(ctx.ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
      running.set(j.id, { stop: () => { try { p.kill("SIGKILL"); } catch (e) {} } });
      let err = "";
      p.stderr.on("data", (d) => { err = (err + d).slice(-3000); });
      p.stdout.on("data", (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m && info.duration) j.phaseProgress = Math.min(0.999, +m[1] / 1e6 / info.duration); });
      p.on("close", (code) => {
        running.delete(j.id); j.phase = ""; j.phaseProgress = 0;
        if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) { try { if (out !== j.file) fs.unlinkSync(j.file); fs.renameSync(tmp, out); j.file = out; j.converted = okV ? "audio" : "hevc"; } catch (e) {} }
        else if (!okV && !noHw && hwDec().length && !j.want) { try { fs.unlinkSync(tmp); } catch (e) {} return makeAppleFriendly(j, true).then(resolve); }     // the video chip couldn't read it: try with the processor
        else { try { fs.unlinkSync(tmp); } catch (e) {} if (!j.want) j.note = "Kept the original: it may not play in QuickTime. " + ((err.split("\n").filter((l) => /error|invalid/i.test(l)).pop() || "").slice(0, 120)); }
        resolve();
      });
      p.on("error", () => { running.delete(j.id); j.phase = ""; resolve(); });
    });
  }
  function ffRun(args, onTime, j) {
    return new Promise((resolve) => {
      const p = spawn(ctx.ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
      running.set(j.id, { stop: () => { try { p.kill("SIGKILL"); } catch (e) {} } });
      let err = "";
      p.stderr.on("data", (d) => { err = (err + d).slice(-3000); });
      p.stdout.on("data", (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m) onTime(+m[1] / 1e6); });
      p.on("close", (code) => { running.delete(j.id); resolve({ code, err }); });
      p.on("error", (e) => { running.delete(j.id); resolve({ code: -1, err: e.message }); });
    });
  }
  async function compressToSize(j, noHw) {
    if (!fs.existsSync(j.file)) return;
    const info = probe(j.file), size = fs.statSync(j.file).size, len = info.duration || (j.section ? j.section.end - j.section.start : j.duration);
    if (!info.v || !len) return makeAppleFriendly(j);
    if (j.compress.bytes >= size * 0.97) { j.note = "Already smaller than the size you chose – kept as it is"; j.compressed = size; return makeAppleFriendly(j); }
    const abr = info.a ? j.compress.abr : 0;
    const vkb = Math.max(80, Math.floor(j.compress.bytes * 8 / 1000 / len * 0.97) - abr);         // ~3 % for the MP4 container
    const h = Math.min(j.compress.height, info.height || j.compress.height), vf = info.height && h < info.height ? ["-vf", "scale=-2:" + h] : [];
    const out = j.file.replace(/\.[^.\/]+$/, "") + ".mp4", tmp = out + ".small.part", log = path.join(app.getPath("temp"), "ftv-2pass-" + j.id);
    const x264 = caps().has("libx264");
    const venc = x264 ? ["-c:v", "libx264", "-preset", "fast", "-b:v", vkb + "k"] : ["-c:v", "h264_videotoolbox", ...vtFast("h264_videotoolbox"), "-b:v", vkb + "k", "-maxrate", Math.round(vkb * 1.3) + "k", "-bufsize", vkb * 2 + "k"];
    const base = ["-hide_banner", "-nostdin", "-y", ...(noHw ? [] : hwDec()), "-i", j.file, "-map", "0:v:0", ...vf, ...venc, "-pix_fmt", "yuv420p"];
    j.phase = "Compressing"; j.phaseProgress = 0; pushJobs();
    let r = { code: 0, err: "" };
    if (x264) {
      r = await ffRun([...base, "-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", "-progress", "pipe:1", "-nostats", "/dev/null"], (t) => { j.phaseProgress = Math.min(0.499, t / len / 2); }, j);
      if (j.want) return;
    }
    if (r.code === 0) r = await ffRun([...base, ...(x264 ? ["-pass", "2", "-passlogfile", log] : []), ...(info.a ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", abr + "k"] : ["-an"]),
      "-movflags", "+faststart", "-f", "mp4", "-progress", "pipe:1", "-nostats", tmp], (t) => { j.phaseProgress = Math.min(0.999, x264 ? 0.5 + t / len / 2 : t / len); }, j);
    for (const f of fs.readdirSync(path.dirname(log))) if (f.startsWith(path.basename(log))) try { fs.unlinkSync(path.join(path.dirname(log), f)); } catch (e) {}
    j.phase = ""; j.phaseProgress = 0;
    if (j.want) { try { fs.unlinkSync(tmp); } catch (e) {} return; }
    if (r.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) { try { if (out !== j.file) fs.unlinkSync(j.file); fs.renameSync(tmp, out); j.file = out; j.compressed = fs.statSync(out).size; } catch (e) {} }
    else if (!noHw && hwDec().length) { try { fs.unlinkSync(tmp); } catch (e) {} return compressToSize(j, true); }
    else { try { fs.unlinkSync(tmp); } catch (e) {} j.note = "Couldn't compress it – kept the original. " + ((r.err.split("\n").filter((l) => /error|invalid/i.test(l)).pop() || "").slice(0, 120)); await makeAppleFriendly(j); }
  }
  // --- small pictures along the trim timeline: one frame from each tenth of the video
  let framesKey = "", framesProcs = [];
  async function frames({ key, url, headers, duration, n }) {
    for (const p of framesProcs) try { p.kill("SIGKILL"); } catch (e) {}
    framesProcs = []; framesKey = key; n = Math.max(1, Math.min(20, +n || 10));
    if (!url || !duration) return {};
    const grab = (i) => new Promise((resolve) => {
      const t = Math.max(0, duration * (i + 0.5) / n);
      const a = ["-hide_banner", "-nostdin", "-loglevel", "error", "-user_agent", (headers && headers["User-Agent"]) || UA];
      const h = Object.entries(headers || {}).filter(([k]) => !/^user-agent$/i.test(k)); if (h.length) a.push("-headers", h.map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n");
      a.push("-ss", t.toFixed(1), "-i", url, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=-2:120", "-q:v", "6", "-f", "image2", "-c:v", "mjpeg", "pipe:1");
      const p = spawn(ctx.ffmpegPath(), a, { stdio: ["ignore", "pipe", "ignore"] }); framesProcs.push(p);
      const bufs = []; const tm = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, 20000);
      p.stdout.on("data", (d) => bufs.push(d));
      p.on("close", () => { clearTimeout(tm); const b = Buffer.concat(bufs); if (b.length > 200 && framesKey === key) emit("frame", { key, i, src: "data:image/jpeg;base64," + b.toString("base64") }); resolve(); });
      p.on("error", () => { clearTimeout(tm); resolve(); });
    });
    const order = Array.from({ length: n }, (_, i) => i); let next = 0;
    const worker = async () => { while (next < order.length && framesKey === key) await grab(order[next++]); };
    Promise.all([worker(), worker(), worker()]).catch(() => {});
    return { ok: true };
  }
  function convArgs(input, output, o, info) {
    const fmt = o.format, F = FORMATS[fmt]; if (!F) throw new Error("Unknown format");
    info = info || probe(input);
    let start = secs(o.start); const end = secs(o.end), a = ["-hide_banner", "-nostdin", "-y"];
    if (F.kind === "frame" && start == null && info.duration > 2) start = Math.round(info.duration * 0.1 * 10) / 10;   // a frame from early in the video, not the black first one
    if (start) a.push("-ss", String(start));
    a.push("-i", input);
    if (end && end > (start || 0)) a.push("-t", String(end - (start || 0)));
    const len = Math.max(1, (end || info.duration || 0) - (start || 0));
    const scale = (h) => h && h !== "orig" ? `scale=-2:${+h}` : "";
    if (F.kind === "subs") { if (!info.subs) throw new Error("This file has no subtitles to extract."); a.push("-map", "0:s:" + Math.max(0, (+o.subIndex || 1) - 1), "-c:s", "srt", "-f", "srt"); }
    else if (F.kind === "frame") { a.push("-map", "0:v:0", "-frames:v", "1", "-q:v", "2"); const vf = scale(o.height); if (vf) a.push("-vf", vf); a.push("-f", "image2"); }
    else if (F.kind === "frames") { a.push("-map", "0:v:0", "-vf", [`fps=1/${Math.max(1, +o.every || 10)}`, scale(o.height)].filter(Boolean).join(",")); a.push("-f", "image2"); }
    else if (F.kind === "gif") {
      const w = o.height && o.height !== "orig" ? `scale=-2:${Math.min(+o.height, 720)}:flags=lanczos` : `scale='min(480,iw)':-2:flags=lanczos`, fps = o.fps && o.fps !== "orig" ? Math.min(30, +o.fps) : 12;
      a.push("-an", "-filter_complex", `[0:v:0]fps=${fps},${w},split[x][y];[x]palettegen=stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0", "-f", "gif");
    } else if (F.kind === "webp") {
      const w = o.height && o.height !== "orig" ? `scale=-2:${Math.min(+o.height, 720)}` : `scale='min(480,iw)':-2`, fps = o.fps && o.fps !== "orig" ? Math.min(30, +o.fps) : 15;
      a.push("-an", "-vf", `fps=${fps},${w}`, "-c:v", caps().has("libwebp_anim") ? "libwebp_anim" : "libwebp", "-quality", { high: "80", medium: "65", low: "45" }[o.quality || "medium"], "-loop", "0", "-f", "webp");
    } else if (F.kind === "audio") {
      if (!info.a) throw new Error("This file has no sound to convert.");
      a.push("-map", "0:a:0", "-vn", "-c:a", AENC[F.ac]);
      if (["mp3", "aac", "opus", "vorbis", "wma", "ac3"].includes(F.ac)) a.push("-b:a", (o.abitrate || 192) + "k");
      if (F.ac === "opus") a.push("-ar", "48000"); if (F.ac === "ac3" || F.ac === "wma") a.push("-ac", "2");
      a.push("-f", F.f);
    } else {
      let vc = o.vcodec || "smart", ac = o.mute ? "none" : (o.acodec || "smart");
      const changes = (o.height && o.height !== "orig") || (o.fps && o.fps !== "orig") || !!o.targetMB || !!o.vbitrate || start != null || end != null;
      const vcopyOk = !changes && (F.anyCopy ? !!info.v && !/x$/.test(info.v) : F.okV.includes(info.v) && ["h264", "hevc"].includes(info.v));
      if (vc === "smart") vc = vcopyOk ? "copy" : (["mp4", "mov", "m4v"].includes(fmt) && (info.height > 1080 || info.tenbit) ? "apple" : "auto");
      if (vc === "copy" && !vcopyOk) vc = "auto";
      if (vc === "auto" || (vc !== "copy" && vc !== "apple" && (!F.okV.includes(vc) || !hasV(vc)))) vc = F.vc;
      const aname = { aac: "aac", mp3: "mp3", opus: "opus", vorbis: "vorbis", flac: "flac", ac3: "ac3", mp2: "mp2", wmav2: "wma" }[info.a] || "";
      const acopyOk = !!info.a && (F.anyCopy || F.okA.includes(aname)) && start == null;
      if (ac === "smart") ac = acopyOk ? "copy" : "auto";
      if (ac === "copy" && !acopyOk) ac = "auto";
      if (ac === "auto" || (ac !== "copy" && ac !== "none" && (!F.okA.includes(ac) || !hasA(ac)))) ac = F.ac;
      a.push("-map", "0:v:0");
      if (ac !== "none" && info.a) a.push("-map", "0:a:0");
      if (vc === "copy") { a.push("-c:v", "copy"); if (info.v === "hevc" && (F.f === "mp4" || F.f === "mov")) a.push("-tag:v", "hvc1"); }
      else if (vc === "apple") { a.push(...appleVideoArgs(info)); const vf = scale(o.height); if (vf) a.push("-vf", vf); if (o.fps && o.fps !== "orig") a.push("-r", String(+o.fps)); }
      else {
        a.push("-c:v", VENC[vc]);
        if (vc === "prores") a.push("-profile:v", { high: "3", medium: "2", low: "1" }[o.quality || "high"], "-pix_fmt", "yuv422p10le");
        else a.push("-pix_fmt", "yuv420p");
        let vb = +o.vbitrate || 0;
        if (o.targetMB) { const ab = ac === "none" || !info.a ? 0 : (+o.abitrate || 128); vb = Math.max(150, Math.floor((+o.targetMB * 8192 * 0.96) / len) - ab); }
        if (vc !== "prores") {
          if (vb) { a.push("-b:v", vb + "k"); if (o.targetMB) a.push("-maxrate", Math.round(vb * 1.5) + "k", "-bufsize", vb * 2 + "k"); }
          else { const q = CRF[vc][{ high: 0, medium: 1, low: 2 }[o.quality || "high"]]; if (["mpeg4", "wmv2", "mpeg2", "theora"].includes(vc)) a.push("-q:v", String(q)); else a.push("-crf", String(q)); if (vc === "vp9") a.push("-b:v", "0"); }
        }
        if (vc === "h264" || vc === "hevc") a.push("-preset", "medium"); if (vc === "vp9") a.push("-row-mt", "1", "-cpu-used", "3");
        if (vc === "h264" && F.f === "3gp") a.push("-profile:v", "baseline");
        if (vc === "hevc" && (F.f === "mp4" || F.f === "mov")) a.push("-tag:v", "hvc1");
        const vf = [scale(fmt === "3gp" && (!o.height || o.height === "orig") && info.height > 720 ? 480 : o.height), vc === "mpeg2" || vc === "wmv2" ? "" : ""].filter(Boolean).join(",");
        if (vf) a.push("-vf", vf);
        if (o.fps && o.fps !== "orig") a.push("-r", String(+o.fps)); else if (vc === "mpeg2") a.push("-r", "25");
      }
      if (ac === "none" || !info.a) a.push("-an");
      else if (ac === "copy") a.push("-c:a", "copy");
      else { a.push("-c:a", AENC[ac]); if (!["flac", "pcm", "pcmbe"].includes(ac)) a.push("-b:a", (o.abitrate || 192) + "k"); if (ac === "opus") a.push("-ar", "48000"); if (["ac3", "wma", "mp2"].includes(ac)) a.push("-ac", "2"); }
      if (F.f === "mp4" || F.f === "mov") a.push("-movflags", "+faststart");
      a.push("-f", F.f);
    }
    a.push("-progress", "pipe:1", "-nostats", output);
    return { args: a, len };
  }
  function addConvert({ inputs, opts }) {
    let n = 0;
    for (const input of inputs || []) {
      if (!fs.existsSync(input)) continue;
      const base = safe(path.basename(input, path.extname(input))) + (opts.start || opts.end ? " (clip)" : "");
      const out = opts.format === "png" ? uniquePath(folder("Converted"), base + " – frames", "") : uniquePath(folder("Converted"), base, "." + extOfFormat(opts.format));
      st.conv.unshift({ id: "c" + Date.now() + Math.floor(Math.random() * 999) + n++, input, name: path.basename(input), file: out, opts, state: "queued", progress: 0, error: "", created: Date.now() });
    }
    pushConv(); pumpConv(); return n;
  }
  function pumpConv() {
    if (st.conv.some((c) => c.state === "converting")) return;
    const c = st.conv.filter((x) => x.state === "queued").pop(); if (!c) return;
    c.state = "converting"; pushConv();
    const seq = c.opts.format === "png";
    let built; try { if (seq) fs.mkdirSync(c.file, { recursive: true }); built = convArgs(c.input, seq ? path.join(c.file, "frame_%04d.png") : c.file + ".part", c.opts); }
    catch (e) { Object.assign(c, { state: "failed", error: e.message }); pushConv(); return setImmediate(pumpConv); }
    const tmp = c.file + ".part"; const p = spawn(ctx.ffmpegPath(), built.args, { stdio: ["ignore", "pipe", "pipe"] });
    running.set(c.id, { stop: () => { c.want = "cancel"; try { p.kill("SIGKILL"); } catch (e) {} } });
    let err = "", lastPush = 0; const dur = built.len;
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.stdout.on("data", (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m && dur) { c.progress = Math.min(0.999, +m[1] / 1e6 / dur); if (Date.now() - lastPush > 700) { lastPush = Date.now(); pushConv(); } } });
    p.on("close", (code) => {
      running.delete(c.id);
      const ok = code === 0 && (seq ? fs.readdirSync(c.file).length > 0 : fs.existsSync(tmp) && fs.statSync(tmp).size > 0);
      if (ok) { if (!seq) fs.renameSync(tmp, c.file); Object.assign(c, { state: "done", progress: 1, size: seq ? fs.readdirSync(c.file).reduce((a, f) => a + fs.statSync(path.join(c.file, f)).size, 0) : fs.statSync(c.file).size, count: seq ? fs.readdirSync(c.file).length : undefined }); }
      else { try { if (seq) fs.rmSync(c.file, { recursive: true, force: true }); else fs.unlinkSync(tmp); } catch (e) {} Object.assign(c, { state: c.want === "cancel" ? "canceled" : "failed", error: c.want === "cancel" ? "" : (err.split("\n").filter((l) => /error|invalid|unknown|not supported|unable|does not contain|no such/i.test(l)).pop() || "conversion failed").slice(0, 220) }); }
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
  H("frames", frames);
  H("pause", async ({ id }) => { const j = job(id); if (!j) return {}; j.want = "pause"; const r = running.get(id); if (r) r.stop(); else if (j.state === "queued") { j.state = "paused"; pushJobs(); } return {}; });
  H("resume", async ({ id }) => { const j = job(id); if (j && ["paused", "failed", "canceled"].includes(j.state)) { j.state = "queued"; j.tries = 0; j.error = ""; j.want = ""; pushJobs(); pump(); } return {}; });
  H("cancel", async ({ id }) => { const j = job(id); if (!j) return {}; j.want = "cancel"; const r = running.get(id); if (r) r.stop(); else { j.state = "canceled"; cleanup(j); pushJobs(); } return {}; });
  H("remove", async ({ id, deleteFile }) => { const j = job(id); if (!j) return {}; const r = running.get(id); if (r) { j.want = "cancel"; r.stop(); } cleanup(j); if (deleteFile) try { fs.unlinkSync(j.file); } catch (e) {}
    st.jobs = st.jobs.filter((x) => x.id !== id); pushJobs(); return {}; });
  H("clear", async () => { st.jobs = st.jobs.filter((j) => !["done", "canceled", "failed"].includes(j.state)); pushJobs(); return {}; });
  H("settings", async (s) => { if (typeof s.apple === "boolean") st.settings.apple = s.apple; if (s.maxActive) st.settings.maxActive = Math.max(1, Math.min(6, +s.maxActive)); if (s.connections) st.settings.connections = Math.max(1, Math.min(12, +s.connections)); save(); pump(); return st.settings; });
  H("pickFiles", async () => { const r = await dialog.showOpenDialog(ctx.getWin(), { title: "Choose media files to convert", defaultPath: ctx.getFolder(), properties: ["openFile", "multiSelections"],
    filters: [{ name: "Media", extensions: ["mp4", "mkv", "mov", "avi", "webm", "ts", "mts", "m2ts", "m4v", "flv", "wmv", "mpg", "mpeg", "3gp", "ogv", "vob", "mxf", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif", "wma", "ac3", "amr", "gif"] }, { name: "All files", extensions: ["*"] }] }); return { files: r.canceled ? [] : r.filePaths }; });
  H("convert", async (o) => ({ added: addConvert(o) }));
  H("convCaps", async () => ({ formats: formatsAvailable() }));
  H("probe", async ({ file }) => ({ ...probe(file), size: (() => { try { return fs.statSync(file).size; } catch (e) { return 0; } })() }));
  H("convStop", async ({ id }) => { const r = running.get(id); if (r) r.stop(); else { const c = st.conv.find((x) => x.id === id); if (c && c.state === "queued") { c.state = "canceled"; pushConv(); } } return {}; });
  H("convRemove", async ({ id }) => { const r = running.get(id); if (r) r.stop(); st.conv = st.conv.filter((x) => x.id !== id); pushConv(); return {}; });
  H("updateExtractor", async () => { if (!ytPath()) return { error: "The extractor isn't installed" }; const r = await runYt(["-U"], 120000); return { text: (r.out + r.err).trim().split("\n").pop() }; });
  return { stopAll: () => { try { if (bview) bview.webContents.close(); } catch (e) {} for (const r of running.values()) try { r.stop(); } catch (e) {} }, _test: { makeAppleFriendly, probe, formatsAvailable, megaItems, parseMega, itemFromInfo, analyze, addDownload, st, convArgs, addConvert, compressToSize, frames } };
};
