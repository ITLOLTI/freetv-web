// Clips: finds the best moments of a long video (loud reactions, sudden excitement, fast action) and exports
// them as short clips – vertical 9:16 for Shorts / Reels / TikTok, square or horizontal – with your logo,
// a title, burned-in subtitles, fades and phone-loud sound.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

exports.init = (ctx) => {
  const ff = () => ctx.ffmpegPath();
  const emit = (type, data) => { const w = ctx.getWin && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send("sn:event", { type, ...data }); };
  const H = (name, fn) => ctx.ipcMain.handle("sn:" + name, async (_, arg) => { try { return await fn(arg || {}); } catch (e) { return { error: String(e.message || e) }; } });
  const allow = (p) => { try { if (ctx.allowLocal && p) ctx.allowLocal(p); } catch (e) {} };
  const hw = () => process.platform === "darwin" ? ["-hwaccel", "videotoolbox"] : [];
  const cacheDir = path.join(ctx.app.getPath("userData"), "clips-cache");

  // ------------------------------------------------------------ what this ffmpeg can do
  let capsC = null;
  function caps() {
    if (capsC) return capsC;
    const run = (a) => { try { return spawnSync(ff(), ["-hide_banner", ...a], { encoding: "utf8", timeout: 15000 }).stdout || ""; } catch (e) { return ""; } };
    const filters = run(["-filters"]), enc = run(["-encoders"]);
    const has = (t, n) => new RegExp("^ \\S+ " + n + " ", "m").test(t);
    capsC = { drawtext: has(filters, "drawtext") && !!font(), subtitles: has(filters, "subtitles"), ebur128: has(filters, "ebur128"),
      vt: / h264_videotoolbox /.test(enc), x264: / libx264 /.test(enc) };
    return capsC;
  }
  function font() {
    return ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Black.ttf", "/Library/Fonts/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"].find((f) => { try { return fs.existsSync(f); } catch (e) { return false; } }) || "";
  }
  function probe(file) {
    try {
      const t = spawnSync(ff(), ["-hide_banner", "-i", file], { encoding: "utf8", timeout: 20000 }).stderr || "";
      const d = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(t), vl = (/Stream #[^\n]*Video: (?![^\n]*attached pic)[^\n]*/.exec(t) || [""])[0], wh = /, (\d{2,5})x(\d{2,5})[, ]/.exec(vl);
      return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, video: !!vl, audio: /Stream #[^\n]*Audio:/.test(t), width: wh ? +wh[1] : 0, height: wh ? +wh[2] : 0 };
    } catch (e) { return { duration: 0, video: false, audio: false, width: 0, height: 0 }; }
  }

  // ------------------------------------------------------------ 1. measure the video: loudness every 0.1 s, picture change and cuts every second
  let an = null;                                            // the analysis running now
  function cancelAnalyze() { if (an) { an.cancelled = true; for (const p of an.procs) try { p.kill("SIGKILL"); } catch (e) {} an = null; } }
  function runFF(args, onOut, onErr, job) {
    return new Promise((resolve) => {
      const p = spawn(ff(), args, { stdio: ["ignore", "pipe", "pipe"] }); job.procs.push(p);
      let bo = "", be = "";
      p.stdout.on("data", (d) => { bo += d; const i = bo.lastIndexOf("\n"); if (i >= 0) { onOut && onOut(bo.slice(0, i)); bo = bo.slice(i + 1); } });
      p.stderr.on("data", (d) => { be += d; const i = be.lastIndexOf("\n"); if (i >= 0) { onErr && onErr(be.slice(0, i)); be = be.slice(i + 1); } });
      p.on("close", (code) => { if (bo && onOut) onOut(bo); if (be && onErr) onErr(be); resolve(code); });
      p.on("error", () => resolve(-1));
    });
  }
  async function measure(file, info) {
    const key = crypto.createHash("sha1").update(file + "|" + fs.statSync(file).mtimeMs + "|" + fs.statSync(file).size + "|v1").digest("hex").slice(0, 20);
    const cf = path.join(cacheDir, key + ".json");
    try { return JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) {}
    const dur = info.duration, N = Math.max(1, Math.ceil(dur));
    const lm = new Array(N * 10).fill(-70), mo = new Array(N).fill(0), mc = new Array(N).fill(0), cuts = new Array(N).fill(0);
    const job = { procs: [], cancelled: false }; an = job;
    let pa = info.audio ? 0 : 1, pv = info.video ? 0 : 1;
    const tell = () => emit("clipsProgress", { file, progress: Math.min(0.99, (pa + pv) / 2) });
    const tasks = [];
    if (info.audio && caps().ebur128) tasks.push(runFF(["-hide_banner", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-sn", "-af", "ebur128=framelog=info", "-f", "null", "-"], null, (txt) => {
      for (const m of txt.matchAll(/t:\s*([\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+|-inf|nan)/g)) {
        const t = +m[1], v = m[2] === "-inf" || m[2] === "nan" ? -70 : Math.max(-70, +m[2]); const i = Math.round(t * 10) - 1; if (i >= 0 && i < lm.length) lm[i] = v;
        pa = Math.min(1, t / dur); }
      tell(); }, job).then(() => { pa = 1; }));
    else pa = 1;
    if (info.video) {
      let t = 0;
      tasks.push(runFF(["-hide_banner", "-nostdin", ...hw(), "-i", file, "-map", "0:v:0", "-an", "-sn", "-vf", "fps=4,scale=128:-2,select=gte(scene\\,0),metadata=print:file=-", "-f", "null", "-"], (txt) => {
        for (const line of txt.split("\n")) {
          const a = /pts_time:([\d.]+)/.exec(line); if (a) { t = +a[1]; continue; }
          const b = /lavfi\.scene_score=([\d.]+)/.exec(line); if (b) { const s = Math.min(N - 1, Math.floor(t)), v = +b[1]; mo[s] += v; mc[s]++; if (v > 0.32) cuts[s]++; }
        }
        pv = Math.min(1, t / dur); tell(); }, null, job).then(() => { pv = 1; }));
    }
    await Promise.all(tasks);
    if (job.cancelled) throw new Error("cancelled");
    if (an === job) an = null;
    const res = { duration: dur, audio: info.audio, video: info.video, lm: lm.map((x) => Math.round(x * 10) / 10), mo: mo.map((x, i) => mc[i] ? Math.round(x / mc[i] * 1000) / 1000 : 0), cuts };
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(res)); } catch (e) {}
    return res;
  }

  // ------------------------------------------------------------ 2. score every second and pick the best, non-overlapping moments
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  function zs(a) { const m = avg(a), sd = Math.sqrt(avg(a.map((x) => (x - m) ** 2))) || 1; return a.map((x) => (x - m) / sd); }
  function pick(S, o) {
    const N = Math.max(1, Math.floor(S.duration)), n = Math.max(1, Math.min(20, +o.count || 5)), fixed = +o.length || 0;
    const L = Array.from({ length: N }, (_, s) => { const w = S.lm.slice(s * 10, s * 10 + 10); return w.length ? 10 * Math.log10(avg(w.map((x) => Math.pow(10, x / 10))) || 1e-7) : -70; }).map((x) => Math.max(-60, x));
    const hasA = S.audio && L.some((x) => x > -55), hasV = S.video && S.mo.some((x) => x > 0);
    const rise = L.map((x, i) => { const p = L.slice(Math.max(0, i - 8), Math.max(0, i - 1)); return p.length ? x - avg(p) : 0; });
    const zl = zs(L), zr = zs(rise).map((x) => Math.max(0, x)), zm = zs(S.mo.slice(0, N)), zc = zs(S.cuts.slice(0, N));
    let w = o.focus === "audio" ? [0.6, 0.4, 0, 0] : o.focus === "action" ? [0, 0, 0.6, 0.4] : [0.35, 0.25, 0.25, 0.15];
    if (!hasA) w = [0, 0, 0.6, 0.4]; else if (!hasV) w = [0.6, 0.4, 0, 0];
    const raw = L.map((x, i) => w[0] * zl[i] + w[1] * zr[i] + w[2] * (zm[i] || 0) + w[3] * (zc[i] || 0) - (hasA && x < -50 ? 1.5 : 0));
    const sm = raw.map((_, i) => avg(raw.slice(Math.max(0, i - 2), Math.min(N, i + 3))));             // 5-second smoothing: a moment, not a single bang
    const sorted = sm.slice().sort((a, b) => a - b), thr = sorted[Math.floor(sorted.length * 0.7)] || 0;
    const used = [], out = [];
    const order = sm.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const quiet = (from, to) => { let best = from, bv = 1e9; for (let k = Math.max(0, Math.round(from * 10)); k <= Math.min(S.lm.length - 1, Math.round(to * 10)); k++) if (S.lm[k] < bv) { bv = S.lm[k]; best = k / 10; } return best; };
    for (const [, p] of order) {
      if (out.length >= n) break;
      if (used.some(([a, b]) => p >= a - 4 && p <= b + 4)) continue;
      let s, e;
      if (fixed) { s = p - Math.round(fixed * 0.35); e = s + fixed; }
      else {                                                   // auto length: grow around the peak while it stays exciting, 15–60 s
        let a = p, b = p; while (a > 0 && p - a < 25 && sm[a - 1] > thr) a--; while (b < N - 1 && b - p < 45 && sm[b + 1] > thr) b++;
        s = a - 2; e = b + 2; const len = e - s;
        if (len < 15) { const add = 15 - len; s -= Math.round(add * 0.4); e += add - Math.round(add * 0.4); } if (e - s > 60) e = s + 60;
      }
      if (s < 0) { e -= s; s = 0; } if (e > S.duration) { s = Math.max(0, s - (e - S.duration)); e = S.duration; }
      if (used.some(([a, b]) => s < b && e > a)) {               // overlaps an earlier pick: slide it to the free side if there's room
        const prev = used.find(([a, b]) => s < b && e > a); const len = e - s;
        if (p > prev[1]) { s = prev[1] + 1; e = s + len; } else { e = prev[0] - 1; s = e - len; }
        if (s < 0 || e > S.duration || e - s < 8 || used.some(([a, b]) => s < b && e > a)) continue;
      }
      if (hasA) { s = quiet(Math.max(0, s - 1.5), Math.min(s + 1, p - 1)); e = quiet(Math.max(e - 1, p + 1), Math.min(S.duration, e + 2)); }   // start and end in a pause, not mid-word
      s = Math.max(0, Math.round(s * 10) / 10); e = Math.min(S.duration, Math.round(e * 10) / 10);
      for (const [a, b] of used) { if (s < b && e > b) s = b + 0.1; if (e > a && s < a) e = a - 0.1; }      // the pause search must not push it into a neighbour
      if (e - s < 3 || used.some(([a, b]) => s < b && e > a)) continue;
      const seg = (a) => a.slice(Math.floor(s), Math.ceil(e)), why = [];
      if (hasA && avg(seg(zl)) > 0.7) why.push("Loud moment"); if (hasA && Math.max(...seg(zr)) > 1.8) why.push("Sudden reaction");
      if (hasV && avg(seg(zm)) > 0.6) why.push("Fast action"); if (hasV && avg(seg(zc)) > 0.6) why.push("Lots of cuts");
      if (!why.length) { if (out.length && avg(seg(sm)) <= 0.05) continue; why.push("Stands out"); }     // not more exciting than the rest of the video: leave it out
      used.push([s, e]); out.push({ start: s, end: e, peak: p, score: avg(seg(sm)) + 0.5 * Math.max(...seg(sm)), why });
    }
    const top = Math.max(...out.map((m) => m.score), 0.001), low = Math.min(...out.map((m) => m.score), 0);
    out.forEach((m) => { m.pct = Math.round(55 + 45 * (m.score - low) / ((top - low) || 1)); });
    // a strip of the whole video for the renderer to draw (loudness + action, 0–1, at most 400 points)
    const pts = Math.min(400, N), strip = Array.from({ length: pts }, (_, i) => { const a = Math.floor(i * N / pts), b = Math.max(a + 1, Math.floor((i + 1) * N / pts)); return Math.max(...sm.slice(a, b)); });
    const mn = Math.min(...strip), mx = Math.max(...strip);
    return { moments: out, strip: strip.map((x) => Math.round((x - mn) / ((mx - mn) || 1) * 100) / 100), focusUsed: !hasA ? "action" : !hasV ? "audio" : o.focus || "both" };
  }
  function thumb(file, t, h) {
    return new Promise((resolve) => {
      const p = spawn(ff(), ["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", String(Math.max(0, t)), "-i", file, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=-2:" + (h || 180), "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
      const b = []; const tm = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, 15000);
      p.stdout.on("data", (d) => b.push(d)); p.on("close", () => { clearTimeout(tm); const x = Buffer.concat(b); resolve(x.length > 200 ? "data:image/jpeg;base64," + x.toString("base64") : ""); }); p.on("error", () => { clearTimeout(tm); resolve(""); });
    });
  }
  let lastS = null;
  async function analyze({ file, count, length, focus }) {
    if (!file || !fs.existsSync(file)) throw new Error("The video can't be found.");
    const info = probe(file); if (!info.duration) throw new Error("This file can't be read as a video.");
    if (info.duration < 20) throw new Error("This video is too short to find moments in – set the start and end yourself.");
    if (!lastS || lastS.file !== file) { cancelAnalyze(); lastS = { file, S: await measure(file, info) }; }
    const r = pick(lastS.S, { count, length, focus });
    const key = file + "|" + Date.now();
    (async () => { for (let i = 0; i < r.moments.length; i++) { const src = info.video ? await thumb(file, r.moments[i].peak) : ""; if (src) emit("clipsThumb", { key, i, src }); } })();
    return { ...r, key, duration: info.duration, width: info.width, height: info.height };
  }

  // ------------------------------------------------------------ 3. export
  const X = { jobs: [] }; let xBusy = 0; const running = new Map();
  const xFile = path.join(ctx.app.getPath("userData"), "clips-jobs.json");
  try { X.jobs = JSON.parse(fs.readFileSync(xFile, "utf8")).filter((j) => j.state === "done" || j.state === "failed" || j.state === "canceled"); } catch (e) {}
  let pushT = 0;
  const push = (now) => { const send = () => { pushT = 0; emit("clipsJobs", { jobs: X.jobs.slice(0, 80) }); try { fs.writeFileSync(xFile, JSON.stringify(X.jobs.slice(0, 200))); } catch (e) {} };
    if (now) { clearTimeout(pushT); send(); } else if (!pushT) pushT = setTimeout(send, 400); };
  const safe = (s) => String(s || "clip").replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "clip";
  const tcode = (t) => { t = Math.floor(t); return (t >= 3600 ? Math.floor(t / 3600) + "-" : "") + String(Math.floor(t % 3600 / 60)).padStart(t >= 3600 ? 2 : 1, "0") + "-" + String(t % 60).padStart(2, "0"); };
  function uniq(dir, base, ext) { let p = path.join(dir, base + ext), i = 2; while (fs.existsSync(p)) p = path.join(dir, base + " (" + i++ + ")" + ext); return p; }
  function addExport({ file, clips, o }) {
    if (!file || !fs.existsSync(file)) throw new Error("The video can't be found.");
    if (!clips || !clips.length) throw new Error("Choose at least one clip.");
    if (o.logo && o.logoOn && !fs.existsSync(o.logo)) throw new Error("The logo file can't be found.");
    if (o.srt && o.subsOn && !fs.existsSync(o.srt)) throw new Error("The subtitle file can't be found.");
    const dir = o.folder || path.join(ctx.getFolder(), "Clips"); fs.mkdirSync(dir, { recursive: true });
    const base = safe(path.basename(file, path.extname(file)));
    const added = [];
    clips.forEach((c, i) => {
      const s = Math.max(0, +c.start || 0), e = Math.max(s + 1, +c.end || 0);
      const out = uniq(dir, base + " – clip " + (c.n || i + 1) + " (" + tcode(s) + ")", ".mp4");
      const j = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), file, out, start: s, end: e, n: c.n || i + 1, title: c.title || "", o: { ...o }, state: "queued", progress: 0, created: Date.now() };
      X.jobs.unshift(j); added.push(j.id);
    });
    push(true); pumpX(); return { added };
  }
  function pumpX() { for (const j of X.jobs.slice().reverse()) { if (xBusy >= 2) break; if (j.state === "queued") { xBusy++; runExport(j).finally(() => { xBusy--; pumpX(); }); } } }
  function srtShift(src, from, to) {             // keep only the lines inside the clip and move them to start at 0
    const ts = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000, fmt = (t) => { t = Math.max(0, t); const ms = Math.round(t * 1000); return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((x) => String(x).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0"); };
    const blocks = String(src).replace(/\r/g, "").replace(/^\uFEFF/, "").split(/\n\s*\n/); let n = 0; const out = [];
    for (const b of blocks) { const m = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{1,3})/.exec(b); if (!m) continue;
      const a = ts(m[1], m[2], m[3], m[4].padEnd(3, "0")), z = ts(m[5], m[6], m[7], m[8].padEnd(3, "0")); if (z <= from || a >= to) continue;
      const text = b.slice(b.indexOf(m[0]) + m[0].length).trim(); if (!text) continue; out.push(++n + "\n" + fmt(a - from) + " --> " + fmt(Math.min(z, to) - from) + "\n" + text); }
    return out.join("\n\n") + "\n";
  }
  function wrap(text, max) { const words = String(text).trim().split(/\s+/), lines = []; let l = ""; for (const w of words) { if ((l + " " + w).trim().length > max && l) { lines.push(l); l = w; } else l = (l + " " + w).trim(); } if (l) lines.push(l); return lines.slice(0, 3).join("\n"); }
  const fq = (p) => "'" + String(p).replace(/'/g, "") + "'";            // paths here are our temp files and system fonts: no quotes or colons in them
  function exportArgs(j, info, tmpFiles) {
    const o = j.o, len = j.end - j.start, small = o.quality === "720";
    let [W, Ht] = o.format === "square" ? [1080, 1080] : o.format === "horizontal" ? [1920, 1080] : [1080, 1920];
    if (small) { W = Math.round(W * 2 / 3 / 2) * 2; Ht = Math.round(Ht * 2 / 3 / 2) * 2; }
    const vert = o.format !== "horizontal" && o.format !== "square", f = [], C = caps();
    const fps = o.fps === "30" || o.fps === "60" ? "fps=" + o.fps + "," : "";
    if (o.fit === "fill") { const pos = Math.max(0, Math.min(1, (+o.cropPos || 50) / 100)); f.push(`[0:v]${fps}scale=${W}:${Ht}:force_original_aspect_ratio=increase,crop=${W}:${Ht}:(iw-ow)*${pos}:(ih-oh)/2,setsar=1[v0]`); }
    else if (o.fit === "bars") f.push(`[0:v]${fps}scale=${W}:${Ht}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${Ht}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0]`);
    else { const bw = Math.round(W / 4 / 2) * 2, bh = Math.round(Ht / 4 / 2) * 2, zoom = Math.max(0.6, Math.min(1.6, (+o.zoom || 100) / 100));
      const fw = Math.round(W * zoom / 2) * 2, fh = Math.round(Ht * zoom / 2) * 2;
      f.push(`[0:v]${fps}split=2[bgs][fgs]`, `[bgs]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=10:2,scale=${W}:${Ht},eq=brightness=-0.07:saturation=1.15[bg]`,
        `[fgs]scale=${fw}:${fh}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg]`, `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`); }
    let cur = "v0"; const next = () => "v" + (f.length + 1);
    if (o.subsOn && o.srt && C.subtitles) {
      const body = srtShift(fs.readFileSync(o.srt, "utf8"), j.start, j.end);
      if (body.trim()) {                                       // no subtitle lines inside this clip: nothing to burn in
      const t = path.join(os.tmpdir(), "ftv-clip-" + j.id + ".srt"); fs.writeFileSync(t, body); tmpFiles.push(t);
      const big = o.subsSize === "big", fs1 = vert ? (big ? 17 : 13) : (big ? 22 : 17), mv = vert ? Math.round(288 * 0.2) : 22;
      const n1 = next(); f.push(`[${cur}]subtitles=filename=${fq(t)}:force_style='Fontname=Arial,Bold=1,Fontsize=${fs1},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2.2,Shadow=0,Alignment=2,MarginV=${mv}'[${n1}]`); cur = n1;
      }
    }
    const title = [o.titleOn && (j.title || o.title) ? (j.title || o.title) : "", o.numberOn ? "Part " + j.n : ""].filter(Boolean);
    if (title.length && C.drawtext) {
      const size = Math.round(W * (vert ? 0.068 : 0.045)), maxc = Math.max(10, Math.floor(W / (size * 0.58)));
      const lines = title.map((x) => wrap(x, maxc)).join("\n").split("\n"), gap = Math.round(size * 1.22), y0 = vert ? Math.round(Ht * 0.1) : Math.round(Ht * 0.06);
      lines.forEach((line, k) => {                             // one centred line each: drawtext alone would left-align a block of lines
        const t = path.join(os.tmpdir(), "ftv-clip-" + j.id + "-" + k + ".txt"); fs.writeFileSync(t, line); tmpFiles.push(t);
        const n1 = next(); f.push(`[${cur}]drawtext=fontfile=${fq(font())}:textfile=${fq(t)}:expansion=none:fontsize=${size}:fontcolor=white:borderw=${Math.max(2, Math.round(size * 0.09))}:bordercolor=black@0.9:x=(w-text_w)/2:y=${y0 + k * gap}${o.titleBox ? `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.3)}` : ""}[${n1}]`); cur = n1;
      });
    }
    let inputs = 1;
    if (o.logoOn && o.logo) {
      inputs++; const lw = Math.max(16, Math.round(W * Math.max(4, Math.min(40, +o.logoSize || 14)) / 100 / 2) * 2), op = Math.max(0.1, Math.min(1, (+o.logoOpacity || 100) / 100));
      const m = Math.round(W * 0.045), top = vert ? Math.round(Ht * 0.06) : m, bot = vert ? Math.round(Ht * 0.16) : m;   // vertical: stay clear of the Shorts / Reels buttons at the bottom
      const pos = { tl: [`${m}`, `${top}`], tr: [`W-w-${m}`, `${top}`], bl: [`${m}`, `H-h-${bot}`], br: [`W-w-${m}`, `H-h-${bot}`], tc: ["(W-w)/2", `${top}`], bc: ["(W-w)/2", `H-h-${bot}`] }[o.corner || "br"] || [`W-w-${m}`, `H-h-${bot}`];
      f.push(`[1:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[lg]`); const n1 = next(); f.push(`[${cur}][lg]overlay=${pos[0]}:${pos[1]}:format=auto[${n1}]`); cur = n1;
    }
    const fade = o.fade && len > 3, n2 = next();
    f.push(`[${cur}]${fade ? `fade=t=in:st=0:d=0.25,fade=t=out:st=${(len - 0.45).toFixed(2)}:d=0.45,` : ""}format=yuv420p[vout]`);
    const audio = info.audio;
    if (audio) f.push(`[0:a]${o.loud ? "loudnorm=I=-14:TP=-1.5:LRA=11," : ""}${fade ? `afade=t=in:st=0:d=0.2,afade=t=out:st=${(len - 0.45).toFixed(2)}:d=0.45,` : ""}aresample=48000[aout]`);
    void n2;
    const args = ["-hide_banner", "-nostdin", "-y", "-ss", String(j.start), "-t", String(len), ...hw(), "-i", j.file];
    if (inputs > 1) args.push("-i", o.logo);
    args.push("-filter_complex", f.join(";"), "-map", "[vout]", ...(audio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] : ["-an"]));
    const br = Math.round((W * Ht) / (1080 * 1920) * (o.fps === "60" ? 14000 : 10000));
    if (C.vt) args.push("-c:v", "h264_videotoolbox", "-b:v", br + "k", "-maxrate", Math.round(br * 1.4) + "k", "-bufsize", br * 2 + "k", "-profile:v", "high");
    else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high");
    args.push("-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "-f", "mp4", j.out + ".part");
    return args;
  }
  function runExport(j) {
    return new Promise((resolve) => {
      const info = probe(j.file); const tmp = [];
      let args; try { args = exportArgs(j, info, tmp); } catch (e) { Object.assign(j, { state: "failed", error: String(e.message || e) }); push(true); return resolve(); }
      j.state = "exporting"; j.progress = 0; j.error = ""; push(true);
      const p = spawn(ff(), args, { stdio: ["ignore", "pipe", "pipe"] }); running.set(j.id, p);
      let err = ""; const len = j.end - j.start;
      p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
      p.stdout.on("data", (d) => { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m) { j.progress = Math.min(0.99, +m[1] / 1e6 / len); push(); } });
      p.on("close", (code) => {
        running.delete(j.id); for (const t of tmp) try { fs.unlinkSync(t); } catch (e) {}
        if (j.state === "canceled") { try { fs.unlinkSync(j.out + ".part"); } catch (e) {} }
        else if (code === 0 && fs.existsSync(j.out + ".part")) { try { fs.renameSync(j.out + ".part", j.out); j.size = fs.statSync(j.out).size; } catch (e) {} Object.assign(j, { state: "done", progress: 1 }); }
        else { try { fs.unlinkSync(j.out + ".part"); } catch (e) {} Object.assign(j, { state: "failed", error: (err.split("\n").filter((l) => /error|invalid|no such|not found|unable/i.test(l)).pop() || "Export failed").slice(0, 200) }); }
        push(true); resolve();
      });
      p.on("error", (e) => { running.delete(j.id); Object.assign(j, { state: "failed", error: e.message }); push(true); resolve(); });
    });
  }

  // ------------------------------------------------------------ IPC
  const pick1 = async (title, filters, props) => { const r = await ctx.dialog.showOpenDialog(ctx.getWin(), { title, defaultPath: ctx.getFolder(), properties: props || ["openFile"], filters }); return r.canceled ? null : r.filePaths[0]; };
  H("clipsCaps", async () => caps());
  H("clipsOpen", async ({ file }) => { if (!file || !fs.existsSync(file)) throw new Error("The video can't be found."); allow(file); const i = probe(file); return { ...i, size: fs.statSync(file).size }; });
  H("clipsPickVideo", async () => { const f = await pick1("Choose a long video", [{ name: "Video", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "ts", "mts", "m2ts", "flv", "wmv", "mpg", "mpeg"] }, { name: "All files", extensions: ["*"] }]); if (f) allow(f); return { file: f }; });
  H("clipsPickLogo", async () => { const f = await pick1("Choose your logo", [{ name: "Image", extensions: ["png", "webp", "jpg", "jpeg"] }]); if (f) allow(f); return { file: f }; });
  H("clipsPickSrt", async () => ({ file: await pick1("Choose subtitles (.srt)", [{ name: "Subtitles", extensions: ["srt"] }]) }));
  H("clipsPickFolder", async () => ({ folder: await pick1("Where to save the clips", undefined, ["openDirectory", "createDirectory"]) }));
  H("clipsAllow", async ({ file }) => { if (file && fs.existsSync(file)) allow(file); return {}; });
  H("clipsAnalyze", analyze);
  H("clipsCancel", async () => { cancelAnalyze(); lastS = null; return {}; });
  H("clipsExport", async (a) => addExport(a));
  H("clipsJobs", async () => ({ jobs: X.jobs.slice(0, 80), folder: path.join(ctx.getFolder(), "Clips") }));
  H("clipsStop", async ({ id }) => { const j = X.jobs.find((x) => x.id === id); if (!j) return {}; const p = running.get(id); j.state = "canceled"; if (p) try { p.kill("SIGKILL"); } catch (e) {} push(true); return {}; });
  H("clipsRemove", async ({ id }) => { X.jobs = X.jobs.filter((x) => x.id !== id || running.has(id)); push(true); return {}; });
  return { stopAll: () => { cancelAnalyze(); for (const p of running.values()) try { p.kill("SIGKILL"); } catch (e) {} }, _test: { probe, measure, pick, exportArgs, addExport, X, caps, srtShift, analyze } };
};
