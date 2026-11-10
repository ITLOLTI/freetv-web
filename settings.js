/* FreeTV settings – the same categories and options as the Android TV app.
 * Loaded before app.js. Values live in localStorage ("ftv.set.<key>"). */
"use strict";

const PALETTES = [
  { name: "Night blue", bg: "#0A0E14", p1: "#111821", p2: "#17212D", p3: "#22344A", text: "#E8EDF3", dim: "#8B97A8" },
  { name: "Pure black (OLED)", bg: "#000000", p1: "#0B0B0B", p2: "#161616", p3: "#2A2A2A", text: "#F2F2F2", dim: "#8E8E8E" },
  { name: "Graphite", bg: "#15171A", p1: "#1D2024", p2: "#262A2F", p3: "#363C44", text: "#ECEEF0", dim: "#979DA5" },
  { name: "Deep purple", bg: "#100C18", p1: "#181224", p2: "#211A31", p3: "#33284A", text: "#EFEAF7", dim: "#9C93AE" },
  { name: "Forest", bg: "#0B110E", p1: "#111A15", p2: "#18241D", p3: "#24372C", text: "#E9F1EC", dim: "#8FA398" },
  { name: "Warm brown", bg: "#14100C", p1: "#1D1712", p2: "#271F18", p3: "#3A2E23", text: "#F3ECE5", dim: "#A59886" },
];
const ACCENTS = [["Blue", "#4FA3FF"], ["Teal", "#2EC4B6"], ["Green", "#4CC38A"], ["Orange", "#FF9F43"], ["Red", "#FF5D5D"], ["Pink", "#FF6FB5"], ["Purple", "#A78BFA"], ["Yellow", "#FFD43B"]];
const LANGS = [["", "Device default"], ["sq", "Albanian"], ["en", "English"], ["de", "German"], ["fr", "French"], ["it", "Italian"], ["es", "Spanish"], ["pt", "Portuguese"],
  ["tr", "Turkish"], ["sr", "Serbian"], ["hr", "Croatian"], ["bs", "Bosnian"], ["mk", "Macedonian"], ["el", "Greek"], ["ar", "Arabic"]];
const LANG3 = { sq: ["sq", "sqi", "alb"], en: ["en", "eng"], de: ["de", "deu", "ger"], fr: ["fr", "fra", "fre"], it: ["it", "ita"], es: ["es", "spa"], pt: ["pt", "por"], tr: ["tr", "tur"],
  sr: ["sr", "srp"], hr: ["hr", "hrv"], bs: ["bs", "bos"], mk: ["mk", "mkd", "mac"], el: ["el", "ell", "gre"], ar: ["ar", "ara"] };

/** Every setting: default value. Choices are stored as an index, toggles as true/false, sliders as 0–100. */
const SETTINGS_DEFAULTS = {
  refresh: 1, aspect: 0, audioLang: 1, autoPlayLast: false, invertZap: false, zapOsd: true, osd: 1, resumeVod: true, autoReconnect: true, customUa: "",
  quality: 0, buffer: 1, liveFmt: 0, convert: 0, macEngine: 0, selfHeal: true,
  subsOn: true, subsLang: 1, subsSize: 1, subsColor: 0, subsBg: 1, subsEdge: 1, subsPos: 1,
  theme: 0, accent: 0, uiScale: 2, textScale: 1,
  glassOn: true, gIntensity: 10, gTransparency: 45, gBlur: 30, gDensity: 25, gReflection: 35, gMotion: 35,
  chStyle: 0, showNumbers: true, showEpg: true, clock24: true, start: 0, rememberGroup: true,
};
const OPT = {
  refresh: ["Every time the app opens", "Every 8 hours (recommended)", "Once a day", "Only when I press Reload"],
  refreshMs: [0, 8 * 3600e3, 24 * 3600e3, Infinity],
  aspect: ["Fit (whole picture)", "Fill (crop to screen)", "Stretch"], aspectCls: ["", "fill", "stretch"],
  osd: ["3 seconds", "5 seconds", "8 seconds", "12 seconds"], osdS: [3, 5, 8, 12],
  quality: ["Auto (best available)", "Up to 4K (2160p)", "Up to 2K (1440p)", "Up to Full HD (1080p)", "Up to HD (720p)", "Up to SD (480p) – saves data"], qualityH: [99999, 2160, 1440, 1080, 720, 480],
  buffer: ["Low latency – fastest zapping", "Balanced (recommended)", "Large – 4K & unstable connections"],
  liveFmt: ["HLS (.m3u8)", "MPEG-TS (.ts)"],
  convert: ["Automatic – only when needed (recommended)", "Always convert the picture", "Never convert"],
  macEngine: ["Mac video player (recommended)", "JavaScript player (mpegts.js)"],
  subsSize: ["Small", "Normal", "Large", "Extra large"], subsSizeEm: [0.85, 1, 1.25, 1.55],
  subsColor: ["White", "Yellow", "Green", "Cyan"], subsColorV: ["#FFFFFF", "#FFE14D", "#7CFC7C", "#66E0FF"],
  subsBg: ["None", "Semi-transparent", "Solid black"], subsBgV: ["transparent", "rgba(0,0,0,.6)", "#000"],
  subsEdge: ["None", "Outline", "Drop shadow"],
  subsPos: ["Very low", "Low (default)", "Middle", "High"], subsPosPx: [0, -4, -14, -26],
  uiScale: ["85%", "92%", "100% (default)", "110%", "120%"], uiScaleV: [0.85, 0.92, 1, 1.1, 1.2],
  textScale: ["Small", "Normal", "Large", "Extra large"], textScaleV: [0.9, 1, 1.15, 1.3],
  chStyle: ["List with programme info", "Compact list", "Logo grid"],
  start: ["Home", "Live TV", "Movies", "Series", "Favourites", "Last screen used"], startTab: ["home", "live", "movies", "series", "fav", "last"],
};
function cfg(k) { const v = store.get("set." + k, undefined); return v === undefined ? SETTINGS_DEFAULTS[k] : v; }
function setCfg(k, v) { store.set("set." + k, v); applyLook(); }
const clockFmt = (ms) => { const d = new Date(ms); if (cfg("clock24")) return pad(d.getHours()) + ":" + pad(d.getMinutes()); const h = d.getHours() % 12 || 12; return h + ":" + pad(d.getMinutes()) + (d.getHours() < 12 ? " AM" : " PM"); };

/** Applies theme, accent, sizes, glass and subtitle style to the whole app. */
function applyLook() {
  const pal = PALETTES[cfg("theme")] || PALETTES[0];
  const acc = (ACCENTS[cfg("accent")] || ACCENTS[0])[1];
  const r = document.documentElement.style;
  const glass = cfg("glassOn");
  const tr_ = cfg("gTransparency") / 100, dens = cfg("gDensity") / 100, refl = cfg("gReflection") / 100, inten = cfg("gIntensity") / 100;
  r.setProperty("--bg", pal.bg); r.setProperty("--text", pal.text); r.setProperty("--dim", pal.dim); r.setProperty("--acc", acc);
  r.setProperty("--panel", pal.p2);
  if (glass) {
    r.setProperty("--glass", "rgba(255,255,255," + (0.03 + (1 - tr_) * 0.10 + dens * 0.05).toFixed(3) + ")");
    r.setProperty("--glass2", "rgba(255,255,255," + (0.06 + (1 - tr_) * 0.12 + dens * 0.05).toFixed(3) + ")");
    r.setProperty("--edge", "rgba(255,255,255," + (0.05 + refl * 0.22).toFixed(3) + ")");
    r.setProperty("--blur", "blur(" + Math.round(6 + cfg("gBlur") * 0.5) + "px) saturate(" + (1.1 + inten * 0.6).toFixed(2) + ")");
    r.setProperty("--lights", (0.35 + inten * 0.65 + refl * 0.4).toFixed(2));
  } else {
    r.setProperty("--glass", pal.p1); r.setProperty("--glass2", pal.p2); r.setProperty("--edge", "rgba(255,255,255,.06)"); r.setProperty("--blur", "none"); r.setProperty("--lights", "0");
  }
  r.setProperty("--motion", (cfg("gMotion") / 35).toFixed(2));
  document.body.classList.toggle("noglass", !glass);
  document.body.classList.toggle("nomotion", cfg("gMotion") === 0);
  document.body.classList.toggle("nonum", !cfg("showNumbers"));
  r.zoom = OPT.uiScaleV[cfg("uiScale")];
  r.fontSize = (15 * OPT.textScaleV[cfg("textScale")]) + "px";
  // subtitles
  let st = document.getElementById("cuecss");
  if (!st) { st = document.createElement("style"); st.id = "cuecss"; document.head.appendChild(st); }
  const edge = ["none", "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000", "2px 2px 4px rgba(0,0,0,.9)"][cfg("subsEdge")];
  st.textContent = "video::cue{font-size:" + OPT.subsSizeEm[cfg("subsSize")] + "em;color:" + OPT.subsColorV[cfg("subsColor")] + ";background:" + OPT.subsBgV[cfg("subsBg")] + ";text-shadow:" + edge + "}" +
    "video::-webkit-media-text-track-container{transform:translateY(" + OPT.subsPosPx[cfg("subsPos")] + "vh)}";
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = pal.bg;
}

// ---------------- the Settings screen
const SET_CATS = [["playlists", "Playlists"], ["playback", "Playback"], ["video", "Video & performance"], ["subtitles", "Subtitles"], ["appearance", "Appearance"],
  ["glass", "Glass effect"], ["interface", "Interface"], ["about", "Data & about"]];
let setCat = "playlists";

function renderSettings(v) {
  const rowT = (k, title, sub) => '<button class="item" data-tog="' + k + '"><div class="it"><div>' + tr(title) + "</div>" + (sub ? '<div class="small dim">' + tr(sub) + "</div>" : "") +
    '</div><span class="sw ' + (cfg(k) ? "on" : "") + '"></span></button>';
  const rowC = (k, title, opts, sub, sw) => '<button class="item" data-ch="' + k + '" data-opts="' + esc(JSON.stringify(opts)) + '" data-title="' + esc(title) + '"' + (sw ? ' data-sw="' + esc(JSON.stringify(sw)) + '"' : "") +
    '><div class="it"><div>' + tr(title) + "</div>" + (sub ? '<div class="small dim">' + tr(sub) + "</div>" : "") + '</div><span class="v">' + (sw ? '<i class="swatch" style="background:' + sw[cfg(k)] + '"></i>' : "") + esc(tr(opts[cfg(k)] || "")) + "</span></button>";
  const rowS = (k, title, sub) => '<div class="item" style="display:block"><div class="row"><div>' + tr(title) + '</div><span class="sp"></span><b data-sv="' + k + '">' + cfg(k) + '%</b></div>' +
    (sub ? '<div class="small dim">' + tr(sub) + "</div>" : "") + '<input type="range" min="0" max="100" value="' + cfg(k) + '" data-sl="' + k + '" style="width:100%;accent-color:var(--acc)"></div>';
  const rowA = (id, title, sub, val) => '<button class="item" id="' + id + '"><div class="it"><div>' + tr(title) + "</div>" + (sub ? '<div class="small dim">' + tr(sub) + "</div>" : "") + "</div>" + (val != null ? '<span class="v">' + esc(val) + "</span>" : "") + "</button>";
  const list = (inner) => '<div class="list">' + inner + "</div>";
  const r = relay(); const a = S.account;
  let body = "";
  if (setCat === "playlists") {
    body = list(S.playlists.map((p) => '<div class="item"><div class="it"><div style="font-weight:600">' + esc(p.name) + '</div><div class="small dim">' + ({ m3u: "M3U", xtream: "Xtream Codes", mac: "MAC portal" }[p.type]) +
      (p.id === S.activeId ? " · " + S.live.length + " " + tr("channels") + " · " + S.movies.length + " " + tr("movies") + " · " + S.series.length + " " + tr("series") : "") + "</div></div><span class=sp></span>" +
      (p.id === S.activeId ? '<span class="small" style="color:var(--acc)">' + tr("Active") + "</span>" : '<button class="btn" data-use="' + p.id + '">' + tr("Use") + "</button>") + '<button class="btn" data-edit="' + p.id + '">' + tr("Edit") + "</button></div>").join("") +
      '<button class="item" id="addPl" style="color:var(--acc)">＋ ' + tr("Add playlist") + "</button>") +
      (a && a.exp_date ? '<div class="small dim" style="margin:8px 4px">' + tr("Subscription") + " " + tr("expires") + ": " + new Date(a.exp_date * 1000).toLocaleDateString() + " · " + Math.ceil((a.exp_date * 1000 - Date.now()) / 864e5) + " " + tr("days left") + "</div>" : "") +
      '<div style="height:14px"></div>' + list(rowA("reload", "Reload playlist & TV guide", "Downloads everything fresh from your provider") +
        rowC("refresh", "Update playlist automatically", OPT.refresh, "The saved copy opens instantly; updates happen in the background")) +
      (DESK ? "<h2>" + tr("Recordings & downloads") + "</h2>" + list('<div class="item"><div class="it"><div>' + tr("Folder") + '</div><div class="small dim" style="word-break:break-all">' + esc(DCFG ? DCFG.folder : "") + "</div></div></div>" +
          rowA("chf", "Choose folder…") + rowA("opf", "Open folder"))
        : "<h2>" + tr("Relay") + '</h2><div class="glass" style="padding:14px 16px"><div class="small dim">' + tr("Needed for most IPTV servers (http:// links, MAC portals). See the setup guide in the README.") + "</div>" +
          '<label class="f">' + tr("Relay URL") + '</label><input class="in" id="rurl" placeholder="https://freetv-relay.yourname.workers.dev" value="' + esc(r.url) + '" autocapitalize="off">' +
          '<label class="f">' + tr("Relay key") + '</label><input class="in" id="rkey" value="' + esc(r.key) + '" autocapitalize="off"><div class="row" style="margin-top:12px"><button class="btn primary" id="rsave">' + tr("Save") + '</button><span class="small dim" id="rstat"></span></div></div>');
  } else if (setCat === "playback") {
    body = list(rowC("aspect", "Default aspect ratio", OPT.aspect) + rowC("audioLang", "Preferred audio language", LANGS.map((l) => l[1]), "Used when a channel or movie has several audio tracks") +
      rowT("autoPlayLast", "Play last channel on start-up") + rowT("invertZap", "Invert channel up/down") + rowT("zapOsd", "Show info bar when switching channels") +
      rowC("osd", "Hide info bar & controls after", OPT.osd) + rowT("resumeVod", "Resume movies & episodes where you stopped") + rowT("autoReconnect", "Reconnect automatically when a stream drops") +
      rowA("ua", "Custom User-Agent", "Some providers require a specific one", cfg("customUa") || tr("Default")));
  } else if (setCat === "video") {
    body = list(rowC("quality", "Maximum video quality", OPT.quality, "For streams with several qualities") + rowC("buffer", "Buffer size", OPT.buffer, "Large buffers smooth out 4K and weak connections; low latency switches channels faster.") +
      rowC("liveFmt", "Xtream live stream format", OPT.liveFmt, "If a channel stutters or freezes, try the other format (reload the playlist afterwards)") +
      (DESK ? rowC("macEngine", "Video decoder", OPT.macEngine, "The Mac video player decodes in hardware and is the smoothest. Try the other one if a channel misbehaves.") : "") +
      (DESK ? rowC("convert", "Picture conversion (ffmpeg)", OPT.convert, "The Mac passes the picture through untouched and converts only the sound. Channels in old formats (MPEG-2) are converted automatically.") : "") +
      rowT("selfHeal", "Self-healing playback", "Detects frozen pictures and dead connections and restarts the stream"));
  } else if (setCat === "subtitles") {
    body = list(rowT("subsOn", "Show subtitles when available", "You can also switch them on from the player options") + rowC("subsLang", "Preferred subtitle language", LANGS.map((l) => l[1])) +
      rowC("subsSize", "Text size", OPT.subsSize) + rowC("subsColor", "Text colour", OPT.subsColor, null, OPT.subsColorV) + rowC("subsBg", "Background", OPT.subsBg) +
      rowC("subsEdge", "Text edge", OPT.subsEdge) + rowC("subsPos", "Position", OPT.subsPos)) +
      '<div class="subprev"><span style="font-size:' + OPT.subsSizeEm[cfg("subsSize")] * 22 + "px;color:" + OPT.subsColorV[cfg("subsColor")] + ";background:" + OPT.subsBgV[cfg("subsBg")] + ";text-shadow:" +
      ["none", "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000", "2px 2px 4px #000"][cfg("subsEdge")] + '">' + tr("This is how subtitles will look") + "</span></div>";
  } else if (setCat === "appearance") {
    body = list(rowC("lang", "Language", ["English", "Shqip"], "Language of the whole app") +
      rowC("theme", "Theme", PALETTES.map((p) => p.name), null, PALETTES.map((p) => p.p3)) + rowC("accent", "Accent colour", ACCENTS.map((x) => x[0]), null, ACCENTS.map((x) => x[1])) +
      rowC("uiScale", "Interface size", OPT.uiScale, "Makes everything bigger or smaller") + rowC("textScale", "Text size", OPT.textScale));
  } else if (setCat === "glass") {
    body = '<div class="glass" style="height:110px;margin-bottom:12px;display:flex;align-items:center;justify-content:center"><b>' + tr("Glass preview") + "</b></div>" +
      list(rowT("glassOn", "Glass effect", "Off = standard solid interface, no glass, no background lights") +
        (cfg("glassOn") ? rowS("gIntensity", "Glass intensity", "Overall strength of the glass look") + rowS("gTransparency", "Transparency", "Higher = clearer glass, lower = more frosted and solid") +
          rowS("gBlur", "Blur", "How soft and diffused the light behind the glass is") + rowS("gDensity", "Glass density", "Thickness and tint of the glass") +
          rowS("gReflection", "Reflection intensity", "Brightness of edges and background lights") + rowS("gMotion", "Animation intensity", "Speed of animations. 0% = no motion.") : "") +
        rowA("greset", "Reset glass settings", "Back to the default look"));
  } else if (setCat === "interface") {
    body = list(rowC("chStyle", "Channel list style", OPT.chStyle) + rowT("showNumbers", "Show channel numbers") + rowT("showEpg", "Show programme info in the channel list") +
      rowT("clock24", "24-hour clock") + rowC("start", "Start screen", OPT.start) + rowT("rememberGroup", "Remember last channel group"));
  } else {
    const nf = [...favs()].length, nr = store.get("recent." + S.activeId, []).length, np = Object.keys(positions()).length;
    body = list(rowA("cfav", "Clear favourites", null, String(nf)) + rowA("crec", "Clear recently watched", null, String(nr)) + rowA("cpos", "Clear continue watching", null, String(np)) +
      rowA("clear", "Clear saved data", "Playlists stay; channel lists and TV guide are downloaded again")) +
      '<div class="small dim" style="text-align:center;margin:24px">FreeTV ' + (DESK ? "for Mac" : "web") + " 1.2</div>";
  }
  v.innerHTML = "<h1>" + tr("Settings") + '</h1><div class="setlayout"><div class="setcats">' + SET_CATS.map(([k, l]) => '<button class="' + (k === setCat ? "on" : "") + '" data-cat="' + k + '">' + tr(l) + "</button>").join("") +
    '</div><div class="setbody">' + body + "</div></div>";

  $$("[data-cat]", v).forEach((b) => b.onclick = () => { setCat = b.dataset.cat; renderSettings(v); });
  $$("[data-tog]", v).forEach((b) => b.onclick = () => { setCfg(b.dataset.tog, !cfg(b.dataset.tog)); renderSettings(v); });
  $$("[data-ch]", v).forEach((b) => b.onclick = () => {
    const k = b.dataset.ch, opts = JSON.parse(b.dataset.opts), sw = b.dataset.sw ? JSON.parse(b.dataset.sw) : null;
    const cur = k === "lang" ? (LANG === "sq" ? 1 : 0) : cfg(k);
    sheet("<h3>" + tr(b.dataset.title) + '</h3><div class="list">' + opts.map((o, i) => '<button class="item ' + (i === cur ? "on" : "") + '" data-i="' + i + '">' + (sw ? '<i class="swatch" style="background:' + sw[i] + '"></i>' : "") +
      esc(tr(o)) + (i === cur ? '<span class="v">✓</span>' : "") + "</button>").join("") + "</div>");
    $$("#sheet [data-i]").forEach((x) => x.onclick = () => {
      const i = +x.dataset.i; closeSheet();
      if (k === "lang") { LANG = i ? "sq" : "en"; store.set("lang", LANG); render(); return; }
      setCfg(k, i);
      if (k === "liveFmt") { store.set("liveFmt", i ? "ts" : "m3u8"); toast("Saved – reload the playlist to apply"); }
      render();
    });
  });
  $$("[data-sl]", v).forEach((s) => { s.oninput = () => { store.set("set." + s.dataset.sl, +s.value); $('[data-sv="' + s.dataset.sl + '"]').textContent = s.value + "%"; applyLook(); }; });
  const on = (id, f) => { const el = $("#" + id); if (el) el.onclick = f; };
  on("addPl", () => editPlaylist());
  $$("[data-use]", v).forEach((b) => b.onclick = () => { S.activeId = b.dataset.use; store.set("active", S.activeId); loadActive(); go("home"); });
  $$("[data-edit]", v).forEach((b) => b.onclick = () => editPlaylist(S.playlists.find((p) => p.id === b.dataset.edit)));
  on("reload", () => { loadActive(true); go("home"); });
  on("chf", async () => { const f = await DESK.chooseFolder(); if (DCFG) DCFG.folder = f; renderSettings(v); });
  on("opf", () => DESK.open());
  on("rsave", async () => {
    store.set("relayUrl", $("#rurl").value.trim()); store.set("relayKey", $("#rkey").value.trim());
    const st = $("#rstat"); st.textContent = "Testing…";
    try { const res = await fetch(relay().url + "/"); st.textContent = res.ok ? "✓ Relay works" : "Relay answered " + res.status; } catch (e) { st.textContent = "✗ Can't reach the relay"; }
  });
  on("ua", () => {
    sheet("<h3>" + tr("Custom User-Agent") + '</h3><input class="in" id="uain" value="' + esc(cfg("customUa")) + '" placeholder="' + tr("Default") + '" autocapitalize="off"><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" id="uaclr">' +
      tr("Default") + '</button><button class="btn primary" id="uaok">' + tr("Save") + "</button></div>");
    $("#uaok").onclick = () => { setCfg("customUa", $("#uain").value.trim()); closeSheet(); renderSettings(v); };
    $("#uaclr").onclick = () => { setCfg("customUa", ""); closeSheet(); renderSettings(v); };
  });
  on("greset", () => { ["glassOn", "gIntensity", "gTransparency", "gBlur", "gDensity", "gReflection", "gMotion"].forEach((k) => store.del("set." + k)); applyLook(); renderSettings(v); });
  on("cfav", () => { store.set(favKey(), []); toast("Done"); renderSettings(v); });
  on("crec", () => { store.set("recent." + S.activeId, []); toast("Done"); renderSettings(v); });
  on("cpos", () => { store.set("pos", {}); toast("Done"); renderSettings(v); });
  on("clear", async () => { await idb.clear(); toast("Saved data cleared"); loadActive(true); });
}
