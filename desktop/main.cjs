// FreeTV for Mac – runs the FreeTV web app in its own window, with:
//  • a built-in relay on this computer (no Cloudflare needed),
//  • recording of live channels (ffmpeg, stream copy – no quality loss, little CPU),
//  • downloads of movies and episodes (resumable),
//  • a destination folder you choose.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");

const APP_DIR = path.join(__dirname, "app");

// If anything goes wrong at start-up, say so instead of silently quitting.
const LOG = path.join(os.homedir(), "Library", "Logs", "FreeTV.log");
function logErr(where, e) {
  const msg = new Date().toISOString() + " " + where + ": " + (e && e.stack || e) + "\n";
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, msg); } catch (x) {}
  return msg;
}
process.on("uncaughtException", (e) => { const m = logErr("crash", e); try { dialog.showErrorBox("FreeTV problem", m + "\nDetails: " + LOG); } catch (x) {} });
process.on("unhandledRejection", (e) => logErr("promise", e));

// The relay is the same code as the Cloudflare worker (worker.js), loaded here as plain JavaScript.
function loadRelay() {
  const src = fs.readFileSync(path.join(APP_DIR, "worker.js"), "utf8")
    .replace(/export const RELAY_KEY = KEY;/, "const RELAY_KEY = KEY;")
    .replace(/export default\s*\{/, "module.exports = { RELAY_KEY,");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports;
}
const worker = loadRelay();
const RELAY_KEY = worker.RELAY_KEY;
const PORT_FIRST = 47811;                 // fixed port → your saved playlists/favourites stay put between launches

// ---------------------------------------------------------------- settings & job list
const userDir = () => app.getPath("userData");
const cfgFile = () => path.join(userDir(), "freetv-mac.json");
let cfg = { folder: "", jobs: [] };
function loadCfg() { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch (e) {} if (!cfg.folder) cfg.folder = path.join(moviesDir(), "FreeTV"); }
// macOS "Movies" folder (Electron calls it "videos"); fall back to ~/Movies
function moviesDir() { try { return app.getPath("videos"); } catch (e) { return path.join(os.homedir(), "Movies"); } }
let saveT = 0;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 1)); } catch (e) {} }, 300); }
const running = new Map();               // id → { kill() }
let win = null;
function pushJobs() { if (win && !win.isDestroyed()) win.webContents.send("ftv:jobs", cfg.jobs); saveCfg(); }
function job(id) { return cfg.jobs.find((j) => j.id === id); }
function update(id, patch) { const j = job(id); if (j) Object.assign(j, patch); pushJobs(); }

const safe = (s) => String(s || "FreeTV").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "FreeTV";
function uniquePath(dir, base, ext) {
  fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, base + ext), i = 2;
  while (fs.existsSync(p) || fs.existsSync(p + ".part")) p = path.join(dir, base + " (" + i++ + ")" + ext);
  return p;
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + "." + z(d.getMinutes()); };

// ---------------------------------------------------------------- recording (ffmpeg)
function ffmpegPath() {
  let p = require("ffmpeg-static");
  return p && p.replace("app.asar", "app.asar.unpacked");
}
function startRecording({ name, url, headers, stopAt, title }) {
  const id = "r" + Date.now();
  const dir = path.join(cfg.folder, "Recordings");
  const file = uniquePath(dir, safe(name) + " – " + stamp() + (title ? " – " + safe(title) : ""), ".ts");
  const args = ["-hide_banner", "-loglevel", "error"];
  const h = { ...(headers || {}) };
  if (h["User-Agent"]) { args.push("-user_agent", h["User-Agent"]); delete h["User-Agent"]; }
  if (Object.keys(h).length) args.push("-headers", Object.entries(h).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n");
  if (/^https?:/i.test(url)) args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "10");
  args.push("-i", url, "-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy", "-f", "mpegts", file);
  const proc = spawn(ffmpegPath(), args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  proc.stderr.on("data", (d) => { err = (err + d).slice(-600); });
  const j = { id, type: "record", name, title: title || "", file, started: Date.now(), stopAt: stopAt || 0, state: "recording", size: 0 };
  cfg.jobs.unshift(j); pushJobs();
  const sizeT = setInterval(() => { try { update(id, { size: fs.statSync(file).size }); } catch (e) {} }, 2000);
  let stopT = stopAt ? setTimeout(() => stop(), Math.max(1000, stopAt - Date.now())) : 0;
  function stop() { try { proc.stdin.write("q"); } catch (e) {} setTimeout(() => { try { proc.kill("SIGINT"); } catch (e) {} }, 4000); }
  running.set(id, { kill: stop });
  proc.on("close", (code) => {
    clearInterval(sizeT); clearTimeout(stopT); running.delete(id);
    let size = 0; try { size = fs.statSync(file).size; } catch (e) {}
    update(id, { state: size > 0 ? "done" : "failed", size, ended: Date.now(), error: size > 0 ? "" : (err.trim() || "ffmpeg exited " + code) });
  });
  proc.on("error", (e) => update(id, { state: "failed", error: e.message }));
  return id;
}

// ---------------------------------------------------------------- downloads (resumable)
async function runDownload(id) {
  const j = job(id); if (!j) return;
  const ctl = new AbortController();
  running.set(id, { kill: () => ctl.abort() });
  update(id, { state: "downloading", error: "" });
  const part = j.file + ".part";
  let have = 0; try { have = fs.statSync(part).size; } catch (e) {}
  try {
    const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", ...(j.headers || {}) };
    if (have) headers.Range = "bytes=" + have + "-";
    const res = await fetch(j.url, { headers, signal: ctl.signal, redirect: "follow" });
    if (!res.ok && res.status !== 206) throw new Error("server answered " + res.status);
    if (have && res.status !== 206) have = 0;              // server ignored the resume – start over
    const total = Number(res.headers.get("content-length") || 0) + have;
    const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
    let got = have, last = 0;
    for await (const chunk of Readable.fromWeb(res.body)) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      got += chunk.length;
      if (Date.now() - last > 700) { last = Date.now(); update(id, { size: got, total }); }
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(part, j.file);
    update(id, { state: "done", size: got, total: total || got, ended: Date.now() });
  } catch (e) {
    const paused = e.name === "AbortError";
    update(id, { state: paused ? "paused" : "failed", error: paused ? "" : e.message });
  } finally { running.delete(id); }
}
function startDownload({ title, url, headers, sub, ext }) {
  const id = "d" + Date.now() + Math.floor(Math.random() * 1000);
  const dir = path.join(cfg.folder, sub ? path.join(...sub.map(safe)) : "Movies");
  const e = "." + String(ext || (url.match(/\.(\w{2,4})(\?|$)/) || [])[1] || "mp4").toLowerCase();
  const file = uniquePath(dir, safe(title), e);
  cfg.jobs.unshift({ id, type: "download", name: title, file, url, headers: headers || null, started: Date.now(), state: "queued", size: 0, total: 0 });
  pushJobs(); pump();
  return id;
}
// at most 2 downloads at once so live TV stays smooth
function pump() {
  const active = cfg.jobs.filter((j) => j.type === "download" && j.state === "downloading").length;
  const next = cfg.jobs.filter((j) => j.type === "download" && j.state === "queued").reverse();
  for (let i = 0; i < Math.min(next.length, 2 - active); i++) runDownload(next[i].id).then(pump);
}

// ---------------------------------------------------------------- playback through ffmpeg
// Chromium can't decode AC3/E-AC3/DTS/MP2 audio or MPEG-2 video – common in IPTV and MKV movies.
// ffmpeg passes the picture through untouched, turns the sound into AAC and sends MPEG-TS to the
// player. If the picture itself can't be shown, the app asks again with mode=transcode (H.264 via the
// Mac's hardware encoder). Seeking in a movie restarts ffmpeg at the new position (ss).
const sessions = new Map();               // sid → { proc, duration, video, audios, error }
let h264Enc = null;
function pickH264() {
  if (h264Enc) return h264Enc;
  try {
    const out = require("node:child_process").execFileSync(ffmpegPath(), ["-hide_banner", "-encoders"], { encoding: "utf8", timeout: 8000 });
    h264Enc = out.includes("h264_videotoolbox") ? "h264_videotoolbox" : "libx264";
  } catch (e) { h264Enc = "libx264"; }
  return h264Enc;
}
function headerArgs(headers) {
  const args = [], h = { ...(headers || {}) };
  args.push("-user_agent", h["User-Agent"] || "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
  delete h["User-Agent"];
  if (Object.keys(h).length) args.push("-headers", Object.entries(h).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n");
  return args;
}
function killSession(sid) {
  const s = sessions.get(sid);
  if (!s || !s.proc || s.proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    s.proc.once("close", resolve);
    try { s.proc.kill("SIGKILL"); } catch (e) { resolve(); }
    setTimeout(resolve, 800);
  });
}
async function play(req, res, u) {
  const sid = u.searchParams.get("sid") || "0";
  const url = u.searchParams.get("u");
  if (!url) { res.writeHead(400); return res.end(); }
  let headers = null;
  try { const h = u.searchParams.get("h"); if (h) headers = JSON.parse(Buffer.from(h.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch (e) {}
  const ss = +u.searchParams.get("ss") || 0;
  const mode = u.searchParams.get("mode") || "copy";
  const aIdx = u.searchParams.get("a");
  const live = u.searchParams.get("live") === "1";
  await killSession(sid);                  // providers often allow only one connection at a time
  const isHttp = /^https?:/i.test(url);
  const args = ["-hide_banner", "-nostdin", "-loglevel", "info", ...(isHttp ? headerArgs(headers) : [])];
  if (isHttp) args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5");
  args.push("-fflags", "+genpts+discardcorrupt", "-analyzeduration", "2500000", "-probesize", "2500000");
  if (ss > 0) args.push("-ss", String(ss));
  args.push("-i", url, "-map", "0:v:0?", "-map", aIdx != null ? "0:a:" + aIdx + "?" : "0:a:0?", "-sn", "-dn");
  if (mode === "transcode") {
    const enc = pickH264();
    args.push("-c:v", enc, "-pix_fmt", "yuv420p", ...(enc === "libx264" ? ["-preset", "veryfast", "-crf", "21", "-tune", "zerolatency"] : ["-b:v", "8M", "-realtime", "1"]), "-g", "50");
    args.push("-vf", "yadif=deint=interlaced");
  } else args.push("-c:v", "copy");
  args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000");
  const fmt = u.searchParams.get("fmt") || "mp4";
  args.push("-max_muxing_queue_size", "2048", "-avoid_negative_ts", "make_zero");
  // mp4: fragmented MP4 that the Mac's own video player plays directly (smoothest).
  // ts:  MPEG-TS for the JavaScript player (fallback engine).
  if (fmt === "ts") args.push("-f", "mpegts", "-mpegts_flags", "+resend_headers", "-muxdelay", "0", "-muxpreload", "0", "pipe:1");
  else args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", "pipe:1");
  const proc = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
  const s = { proc, duration: 0, video: "", audios: [], error: "", started: Date.now() };
  sessions.set(sid, s);
  let err = "";
  proc.stderr.on("data", (d) => {
    err = (err + d).slice(-20000);
    const dm = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(err);
    if (dm && !s.duration) s.duration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3];
    if (!s.video) { const vm = /Stream #0:\d+[^:]*: Video: (\w+)[^\n]*?(\d{3,4})x(\d{3,4})/.exec(err); if (vm) s.video = vm[1] + " " + vm[2] + "×" + vm[3]; }
    if (!s.audios.length && /Output #0/.test(err)) {
      const head = err.split("Output #0")[0];
      s.audios = [...head.matchAll(/Stream #0:\d+(?:\[[^\]]*\])?(?:\((\w+)\))?: Audio: (\w+)[^\n]*/g)].map((m, i) => ({ id: i, lang: m[1] || "", codec: m[2] }));
    }
  });
  proc.on("close", (code) => { if (code && !res.headersSent) { s.error = err.split("\n").filter((l) => /error|invalid|not|fail|refused|forbidden|denied/i.test(l)).slice(-3).join(" ") || "ffmpeg " + code; } });
  res.writeHead(200, { "Content-Type": fmt === "ts" ? "video/mp2t" : "video/mp4", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  proc.stdout.pipe(res);
  proc.on("close", () => { if (!s.error && err && proc.exitCode) s.error = err.split("\n").slice(-3).join(" "); res.end(); });
  res.on("close", () => { if (sessions.get(sid) === s) { try { proc.kill("SIGKILL"); } catch (e) {} } });
}

// ---------------------------------------------------------------- local web server: app files + relay + local files
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".ts": "video/mp2t", ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime" };
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("Not found"); }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) {
      const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": "bytes " + start + "-" + end + "/" + st.size, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
      fs.createReadStream(file).pipe(res);
    }
  });
}
async function handle(req, res, port) {
  const u = new URL(req.url, "http://127.0.0.1:" + port);
  if (u.pathname === "/relay" || u.pathname === "/relay/") {
    const headers = new Headers(); if (req.headers.range) headers.set("Range", req.headers.range);
    let body; if (req.method === "POST") { const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks); }
    const r = await worker.fetch(new Request(u.toString(), { method: req.method === "POST" ? "POST" : "GET", headers, body }));
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h);
    if (!r.body) return res.end();
    const s = Readable.fromWeb(r.body);
    res.on("close", () => s.destroy());                       // channel changed → stop pulling the old stream
    s.on("error", () => res.destroy());
    return s.pipe(res);
  }
  if (u.pathname === "/play") return play(req, res, u);
  if (u.pathname === "/info") {
    const s = sessions.get(u.searchParams.get("sid") || "0") || {};
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ duration: s.duration || 0, video: s.video || "", audios: s.audios || [], error: s.error || "", running: !!(s.proc && s.proc.exitCode === null) }));
  }
  if (u.pathname === "/local") {                             // play downloaded / recorded files
    const p = path.resolve(u.searchParams.get("p") || "");
    if (!p.startsWith(path.resolve(cfg.folder))) { res.writeHead(403); return res.end(); }
    return serveFile(req, res, p);
  }
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "");
  if (!p || p.endsWith("/")) p += "index.html";
  const file = path.join(APP_DIR, p);
  if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
  serveFile(req, res, file);
}
function startServer() {
  return new Promise((resolve) => {
    const tryPort = (port, n) => {
      const srv = http.createServer((req, res) => handle(req, res, port).catch((e) => { try { res.writeHead(500); res.end(String(e.message)); } catch (x) {} }));
      srv.once("error", () => (n > 0 ? tryPort(port + 1, n - 1) : resolve(0)));
      srv.listen(port, "127.0.0.1", () => resolve(port));
    };
    tryPort(PORT_FIRST, 20);
  });
}

// ---------------------------------------------------------------- app
ipcMain.handle("ftv:config", () => ({ key: RELAY_KEY, folder: cfg.folder, jobs: cfg.jobs, platform: process.platform }));
ipcMain.handle("ftv:chooseFolder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Where should FreeTV save recordings and downloads?", defaultPath: cfg.folder, properties: ["openDirectory", "createDirectory"] });
  if (!r.canceled && r.filePaths[0]) { cfg.folder = r.filePaths[0]; saveCfg(); }
  return cfg.folder;
});
ipcMain.handle("ftv:record", (_, o) => startRecording(o));
ipcMain.handle("ftv:download", (_, o) => startDownload(o));
ipcMain.handle("ftv:stop", (_, id) => { const r = running.get(id); if (r) r.kill(); else { const j = job(id); if (j && j.state === "queued") update(id, { state: "paused" }); } return true; });
ipcMain.handle("ftv:resume", (_, id) => { const j = job(id); if (j && j.type === "download" && j.state !== "done") { update(id, { state: "queued" }); pump(); } return true; });
ipcMain.handle("ftv:remove", (_, { id, deleteFile }) => {
  const r = running.get(id); if (r) r.kill();
  const j = job(id);
  if (j && deleteFile) for (const f of [j.file, j.file + ".part"]) { try { fs.unlinkSync(f); } catch (e) {} }
  cfg.jobs = cfg.jobs.filter((x) => x.id !== id); pushJobs(); return true;
});
ipcMain.handle("ftv:show", (_, file) => { if (fs.existsSync(file)) shell.showItemInFolder(file); else shell.openPath(cfg.folder); return true; });
ipcMain.handle("ftv:open", (_, file) => shell.openPath(file || cfg.folder));

// ---------------------------------------------------------------- Web Sniffer (separate module, see sniffer.cjs)
let sniffer = null;
try { sniffer = require("./sniffer.cjs").init({ app, ipcMain, dialog, shell, BrowserWindow, session, getWin: () => win, ffmpegPath, getFolder: () => cfg.folder }); } catch (e) { logErr("sniffer", e); }

app.whenReady().then(async () => { try {
  loadCfg();
  // anything that was running when the app closed: recordings end, downloads can be resumed
  cfg.jobs.forEach((j) => { if (j.state === "recording") j.state = "done"; if (j.state === "downloading" || j.state === "queued") j.state = "paused"; });
  const port = await startServer();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" }, { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] },
    { role: "windowMenu" },
  ]));
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#0A0E14", title: "FreeTV",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false, backgroundThrottling: false, webviewTag: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  // the Web Sniffer's in-app browser: web pages get no access to FreeTV or the Mac, only a plain sandboxed page
  win.webContents.on("will-attach-webview", (e, wp, params) => { delete wp.preload; wp.nodeIntegration = false; wp.contextIsolation = true; wp.sandbox = true; if (params.partition !== "sniffbrowse") e.preventDefault(); });
  if (!port) throw new Error("FreeTV could not start its local server (ports 47811-47831 are busy).");
  win.loadURL("http://127.0.0.1:" + port + "/");
} catch (e) { const m = logErr("start", e); dialog.showErrorBox("FreeTV could not start", m); app.quit(); } });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (sniffer) sniffer.stopAll(); for (const r of running.values()) try { r.kill(); } catch (e) {} for (const s of sessions.values()) try { s.proc.kill("SIGKILL"); } catch (e) {} saveCfg(); });
