// FreeTV Web Sniffer – Mac app only. A separate screen: find media on a web page, download it, convert it.
// Uses the helpers of app.js ($, esc, tr, sheet, toast, openPlayer…) but none of the IPTV state.
"use strict";
const SN = { burl: "", bcount: 0, bres: null, bopen: false, bbusy: false, view: "discover", url: "", deep: false, scanning: false, step: "", result: null, jobs: [], conv: [], settings: { maxActive: 3, connections: 6 }, extractor: true, ready: false,
  picked: new Set(), extra: [], opts: { format: "mp4", height: "orig", vcodec: "auto", acodec: "auto", quality: "high", vbitrate: "", abitrate: 192, fps: "orig" } };
const snCall = (ch, arg) => window.ftvDesktop.sn(ch, arg);
const snSize = (b) => !b ? "" : b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
const snEta = (s) => !s ? "" : s >= 3600 ? Math.floor(s / 3600) + " h " + Math.round((s % 3600) / 60) + " min" : s >= 60 ? Math.round(s / 60) + " min" : Math.round(s) + " s";
const SN_AUDIO = ["mp3", "m4a", "aac", "wav", "flac"];
const snVisible = () => S.tab === "sniffer" && $("#player").classList.contains("hidden");

async function snInit() {
  if (SN.ready) return; SN.ready = true;
  window.ftvDesktop.onSn((e) => {
    if (e.type === "scan") { SN.step = e.msg; const el = $("#snstep"); if (el) el.textContent = tr(e.msg); }
    if (e.type === "jobs") { SN.jobs = e.jobs; if (snVisible()) { snBadge(); if (SN.view === "downloads") snDrawJobs(); } }
    if (e.type === "browse") { SN.bcount = e.count; if (!e.count) { SN.bres = null; SN.bopen = false; } if (snVisible() && SN.view === "browse") { snBrowseBtn(); if (!e.count) snBrowsePanel(); } }
    if (e.type === "toast") toast(e.msg);
    if (e.type === "conv") { SN.conv = e.conv; if (snVisible() && SN.view === "convert") snDrawConv(); }
  });
  const s = await snCall("state"); if (s && !s.error) { SN.jobs = s.jobs; SN.conv = s.conv; SN.settings = s.settings; SN.extractor = s.extractor; }
  if (snVisible()) renderSniffer($("#view"));
}
function snBadge() { const n = SN.jobs.filter((j) => j.state === "downloading" || j.state === "queued").length; const b = $("#snbadge"); if (b) { b.textContent = n; b.style.display = n ? "" : "none"; } }

function renderSniffer(v) {
  snInit();
  const act = SN.jobs.filter((j) => j.state === "downloading" || j.state === "queued").length;
  v.innerHTML = '<div class="sn"><div class="row"><h1>' + tr("Web Sniffer") + '</h1><span class="sp"></span><div class="seg sn-seg">' +
    [["discover", "Discover"], ["browse", "Browse"], ["downloads", "Downloads"], ["convert", "Converter"]].map(([k, l]) => '<button data-snv="' + k + '" class="' + (SN.view === k ? "on" : "") + '">' + tr(l) +
      (k === "downloads" ? ' <b id="snbadge" class="sn-badge" style="' + (act ? "" : "display:none") + '">' + act + "</b>" : "") + "</button>").join("") + '</div></div><div id="snbody"></div></div>';
  $$("[data-snv]", v).forEach((b) => b.onclick = () => { SN.view = b.dataset.snv; renderSniffer(v); });
  ({ discover: snDiscover, browse: snBrowse, downloads: snDownloads, convert: snConvert })[SN.view]($("#snbody"));
}

// ------------------------------------------------------------------ Discover
function snDiscover(b) {
  b.innerHTML = '<div class="sn-bar glass"><input id="snurl" type="text" spellcheck="false" placeholder="' + tr("Paste a page or video link…") + '" value="' + esc(SN.url) + '">' +
    '<button class="btn primary" id="sngo">' + I.search + tr("Analyze") + "</button></div>" +
    '<div class="row sn-sub"><label class="sn-check"><input type="checkbox" id="sndeep" ' + (SN.deep ? "checked" : "") + "> " + tr("Deep scan (loads the page like a browser – slower, finds more)") + '</label><span class="sp"></span>' +
    '<span class="small dim">' + tr("Only save media you have the right to download.") + '</span></div><div id="snres"></div>';
  const go = () => { SN.url = $("#snurl").value.trim(); if (SN.url) snAnalyze(); };
  $("#sngo").onclick = go; $("#snurl").onkeydown = (e) => { if (e.key === "Enter") go(); }; $("#snurl").oninput = (e) => { SN.url = e.target.value; };
  $("#sndeep").onchange = (e) => { SN.deep = e.target.checked; };
  snDrawResults();
  if (!SN.url && !SN.result) $("#snurl").focus();
}
async function snAnalyze() {
  if (SN.scanning) return;
  SN.scanning = true; SN.result = null; SN.step = "Checking the link…"; snDrawResults();
  const r = await snCall("analyze", { url: SN.url, deep: SN.deep });
  SN.scanning = false; SN.result = r && r.error ? { items: [], notes: [r.error] } : r;
  if (snVisible() && SN.view === "discover") snDrawResults();
}
function snBadges(it) {
  return (it.drm ? '<span class="sn-tag bad">' + tr("Protected (DRM)") + "</span>" : "") + (it.live ? '<span class="sn-tag live">' + tr("Live · preview only") + "</span>" : "") +
    (it.duration ? '<span class="sn-tag">' + fmtTime(it.duration) + "</span>" : "");
}
function snBest(it) { return (it.formats || []).find((f) => !f.audio) || (it.formats || [])[0]; }
function snDrawResults() {
  const box = $("#snres"); if (!box) return;
  $("#sngo").disabled = SN.scanning;
  if (SN.scanning) { box.innerHTML = '<div class="sn-scan glass"><div class="sn-radar"><i></i><i></i><i></i></div><div><div style="font-weight:600">' + tr("Scanning…") + '</div><div class="small dim" id="snstep">' + esc(tr(SN.step)) + '</div></div><div class="sn-sweep"></div></div>'; return; }
  const r = SN.result;
  if (!r) { box.innerHTML = '<div class="empty"><div class="sn-hero">' + I.sniff + "</div><h2>" + tr("Find the media on any page") + "</h2><p>" + tr("Paste a link to a video page, an embedded player or a direct file. FreeTV lists what it finds, with quality options.") +
    "</p><p class=\"small\">" + tr("DRM-protected and sign-in-only videos are shown as protected and can't be downloaded.") + "</p></div>"; return; }
  const dl = r.items.filter((i) => !i.drm && !i.live && (i.formats.length || i.needsFormats));
  box.innerHTML = (r.notes || []).map((n) => '<div class="sn-note glass">' + esc(tr(n)) + "</div>").join("") +
    (r.items.length ? '<div class="row sn-sub"><div class="dim">' + r.items.length + " " + tr(r.items.length === 1 ? "item found" : "items found") + '</div><span class="sp"></span>' +
      (dl.length > 1 ? '<button class="btn" id="snall">' + I.dl + tr("Download all") + " (" + dl.length + ")</button>" : "") + '</div><div class="sn-grid">' +
      r.items.map((it, i) => { const f = snBest(it);
        return '<button class="sn-card" data-i="' + i + '"><div class="sn-th">' + (it.thumbnail ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(it.thumbnail) + '" onerror="this.remove()">' : "") + '<div class="sn-ph">' + I.play + '</div><div class="sn-tags">' + snBadges(it) + "</div></div>" +
          '<div class="sn-t">' + esc(it.title) + '</div><div class="small dim">' + esc([it.site, f && !it.drm && !it.live ? f.label : "", f && !it.drm && !it.live ? snSize(f.size) : ""].filter(Boolean).join(" · ")) + "</div></button>"; }).join("") + "</div>" : "");
  $$(".sn-card", box).forEach((c) => c.onclick = () => snDetail(SN.result.items[+c.dataset.i]));
  const all = $("#snall"); if (all) all.onclick = () => snDownloadAll(dl);
}
async function snEnsureFormats(it) {
  if (!it.needsFormats) return true;
  const full = await snCall("formats", { url: it.pageUrl });
  if (!full || full.error) { toast(full && full.error || "Couldn't read this video"); return false; }
  Object.assign(it, full, { needsFormats: false, thumbnail: full.thumbnail || it.thumbnail }); return true;
}
function snPreview(it) {
  if (!it.previewUrl) return toast("This one can't be previewed");
  closeSheet();
  openPlayer({ kind: it.live ? "live" : "movie", key: "sn:" + it.id, title: it.title, url: it.previewUrl, headers: it.previewHeaders || undefined, group: tr("Web Sniffer"), logo: it.thumbnail });
}
async function snDetail(it) {
  const draw = () => {
    const blocked = it.drm ? tr("This stream is DRM-protected. It can't be downloaded.") : it.live ? tr("This is a live stream. It can be previewed, not downloaded.") : "";
    sheet('<div class="sn-detail"><div class="sn-dth">' + (it.thumbnail ? '<img referrerpolicy="no-referrer" src="' + esc(it.thumbnail) + '" onerror="this.remove()">' : "") + '<div class="sn-tags">' + snBadges(it) + "</div></div><h3>" + esc(it.title) + '</h3><div class="small dim">' + esc(it.site || "") + "</div>" +
      (it.description ? '<div class="small sn-desc">' + esc(it.description) + "</div>" : "") +
      '<div class="row" style="margin:12px 0 6px;gap:8px">' + (it.needsFormats ? "" : it.previewUrl && !it.drm ? '<button class="btn white" id="snprev">' + I.play + tr("Preview") + "</button>" : "") + "</div>" +
      (it.needsFormats ? '<div class="spinner"></div>' : blocked ? '<div class="sn-note glass">' + esc(blocked) + "</div>" :
        it.formats.length ? '<div class="small dim" style="margin:8px 0 6px">' + tr("Choose a quality to download") + '</div><div class="list">' + it.formats.map((f, i) => '<button class="item" data-f="' + i + '"><span style="flex:1;text-align:left">' + esc(tr(f.label)) +
          (f.note ? ' <span class="dim small">' + esc(f.note) + "</span>" : "") + '</span><span class="dim small">' + esc([(f.audio || f.ext || "").toUpperCase(), (f.size ? "~" : "") + snSize(f.size)].filter(Boolean).join(" · ")) + "</span>" + I.dl + "</button>").join("") + "</div>" :
          '<div class="sn-note glass">' + tr("Nothing downloadable was found for this item.") + "</div>") + "</div>");
    const p = $("#snprev"); if (p) p.onclick = () => snPreview(it);
    $$("#sheet [data-f]").forEach((b) => b.onclick = async () => { if (await snQueue(it, it.formats[+b.dataset.f])) closeSheet(); });
  };
  draw();
  if (it.needsFormats) { if (await snEnsureFormats(it)) { if (!$("#sheet").classList.contains("hidden")) draw(); } else closeSheet(); }
}
async function snQueue(it, f, force) {
  const r = await snCall("download", { title: it.title, thumbnail: it.thumbnail, pageUrl: it.pageUrl, site: it.site, duration: it.duration, format: f, force: !!force });
  if (r && r.duplicate) {
    return new Promise((res) => {
      sheet("<h3>" + tr("Already in your downloads") + '</h3><div class="small dim" style="margin-bottom:10px">' + esc(it.title) + '</div><div class="list"><button class="item" id="sndup1">' + tr("Download again") + '</button><button class="item" id="sndup2">' + tr("Show downloads") + '</button><button class="item" id="sndup3">' + tr("Cancel") + "</button></div>");
      $("#sndup1").onclick = async () => { closeSheet(); await snQueue(it, f, true); res(true); };
      $("#sndup2").onclick = () => { closeSheet(); SN.view = "downloads"; renderSniffer($("#view")); res(false); };
      $("#sndup3").onclick = () => { closeSheet(); res(false); };
    });
  }
  if (r && r.error) { toast(r.error); return false; }
  toast("Added to downloads"); return true;
}
async function snDownloadAll(list) {
  let n = 0;
  for (const it of list) { if (!(await snEnsureFormats(it))) continue; const f = snBest(it); if (!f || it.drm || it.live) continue;
    const r = await snCall("download", { title: it.title, thumbnail: it.thumbnail, pageUrl: it.pageUrl, site: it.site, duration: it.duration, format: f }); if (r && !r.error && !r.duplicate) n++; }
  toast(n ? n + " " + tr("added to downloads") : "Already in your downloads");
  if (n) { SN.view = "downloads"; renderSniffer($("#view")); }
}

// ------------------------------------------------------------------ Browse (a private browser window inside FreeTV)
function snBrowseUrl(t) {
  t = String(t || "").trim(); if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i.test(t)) return "http://" + t;
  if (/\s/.test(t) || !/^([^\s/]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(\/|:|$)/i.test(t)) return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
  return "https://" + t;
}
async function snBrowse(b) {
  await snCall("browseInit");
  if (!snVisible() || SN.view !== "browse") return;
  b.innerHTML = '<div class="sn-bbar glass"><button class="sn-nb" id="bback" title="' + tr("Back") + '">‹</button><button class="sn-nb" id="bfwd">›</button><button class="sn-nb" id="breload">↻</button>' +
    '<input id="baddr" type="text" spellcheck="false" placeholder="' + tr("Search or type a web address") + '" value="' + esc(SN.burl) + '"><span class="sn-priv" title="' + tr("Separate from Safari and Chrome. Sign-ins here are forgotten when FreeTV quits.") + '">● ' + tr("Private window") + "</span>" +
    '<button class="btn primary" id="bfound"></button></div><div class="sn-bwrap"><webview id="snweb" partition="sniffbrowse" allowpopups src="' + esc(SN.burl || "about:blank") + '"></webview>' +
    '<div id="bstart" class="empty' + (SN.burl ? " hidden" : "") + '"><div class="sn-hero">' + I.sniff + "</div><h2>" + tr("Browse inside FreeTV") + "</h2><p>" + tr("Open any site here and play a video. When FreeTV sees it, the button at the top right lights up.") +
    '</p><p class="small">' + tr("This window is private: it shares nothing with Safari or Chrome.") + '</p></div><div id="bpanel" class="hidden"></div></div>';
  const wv = $("#snweb"), addr = $("#baddr");
  const go = () => { const u = snBrowseUrl(addr.value); if (!u) return; SN.burl = u; addr.value = u; $("#bstart").classList.add("hidden"); wv.src = u; addr.blur(); };
  addr.onkeydown = (e) => { if (e.key === "Enter") go(); }; addr.onfocus = () => addr.select();
  const nav = (e) => { if (e.isMainFrame === false || !/^https?:/.test(e.url)) return; SN.burl = e.url; if (document.activeElement !== addr) addr.value = e.url; };
  wv.addEventListener("did-navigate", nav); wv.addEventListener("did-navigate-in-page", nav);
  wv.addEventListener("did-start-loading", () => { $("#breload").textContent = "✕"; }); wv.addEventListener("did-stop-loading", () => { const r = $("#breload"); if (r) r.textContent = "↻"; });
  $("#bback").onclick = () => { try { if (wv.canGoBack()) wv.goBack(); } catch (e) {} };
  $("#bfwd").onclick = () => { try { if (wv.canGoForward()) wv.goForward(); } catch (e) {} };
  $("#breload").onclick = () => { try { wv.isLoading() ? wv.stop() : wv.reload(); } catch (e) {} };
  $("#bfound").onclick = () => { SN.bopen = !SN.bopen; if (SN.bopen && !SN.bres) snBrowseLoad(); else snBrowsePanel(); };
  snBrowseBtn(); snBrowsePanel();
  if (!SN.burl) addr.focus();
}
function snBrowseBtn() {
  const b = $("#bfound"); if (!b) return;
  b.innerHTML = I.dl + (SN.bcount ? tr("Video found") + (SN.bres && SN.bres.items.length ? ' <b class="sn-cnt">' + SN.bres.items.length + "</b>" : "") : tr("Check this page"));
  b.classList.toggle("lit", SN.bcount > 0); b.classList.toggle("primary", SN.bcount > 0);
}
async function snBrowseLoad() {
  if (SN.bbusy) return; SN.bbusy = true; SN.bopen = true; snBrowsePanel();
  const r = await snCall("browseItems"); SN.bbusy = false; SN.bres = r && !r.error ? r : { items: [], notes: [r && r.error || ""] };
  if (snVisible() && SN.view === "browse") { snBrowsePanel(); snBrowseBtn(); }
}
function snBrowsePanel() {
  const p = $("#bpanel"); if (!p) return;
  p.classList.toggle("hidden", !SN.bopen); if (!SN.bopen) return;
  if (SN.bbusy) { p.innerHTML = '<div class="row" style="gap:14px"><div class="sn-radar" style="width:34px;height:34px"><i></i><i></i><i></i></div><div>' + tr("Checking this page…") + "</div></div>"; return; }
  const r = SN.bres || { items: [], notes: [] };
  p.innerHTML = '<div class="row"><h4>' + (r.items.length ? '<span class="sn-dot"></span>' + tr("Found on this page") : tr("Nothing found yet")) + '</h4><span class="sp"></span><button class="sn-nb" id="bref" title="' + tr("Check again") + '">↻</button><button class="sn-nb" id="bclose">✕</button></div>' +
    (r.notes || []).filter(Boolean).map((n) => '<div class="small dim" style="margin:4px 0 8px">' + esc(tr(n)) + "</div>").join("") +
    (r.items.length ? "" : '<div class="small dim">' + tr("Start the video on the page, then press ↻ here.") + "</div>") +
    r.items.map((it, i) => '<div class="sn-bitem"><div class="sn-pv"><div class="sn-jth">' + (it.thumbnail ? '<img referrerpolicy="no-referrer" src="' + esc(it.thumbnail) + '" onerror="this.remove()">' : "") + '</div><div style="min-width:0;flex:1"><div class="sn-t" style="margin:0 0 3px">' + esc(it.title) + '</div><div class="small dim">' +
        esc([it.duration ? fmtTime(it.duration) : "", it.site].filter(Boolean).join(" · ")) + "</div></div>" + (it.previewUrl && !it.drm && !it.needsFormats ? '<button class="sn-nb" data-bp="' + i + '" title="' + tr("Preview") + '">▶</button>' : "") + "</div>" +
      (it.drm ? '<div class="sn-q bad">' + tr("Protected (DRM)") + " – " + tr("can't be downloaded") + "</div>" : it.live ? '<div class="sn-q">' + tr("Live · preview only") + "</div>" :
        it.needsFormats ? '<button class="sn-q" data-bn="' + i + '"><span>' + tr("Show qualities") + "</span></button>" :
        it.formats.map((f, k) => '<button class="sn-q" data-bi="' + i + '" data-bf="' + k + '"><span>' + esc(tr(f.label)) + '</span><small>' + esc([(f.audio || f.ext || "").toUpperCase(), (f.size ? "~" : "") + snSize(f.size)].filter(Boolean).join(" · ")) + " ⬇</small></button>").join("")) + "</div>").join("");
  $("#bclose").onclick = () => { SN.bopen = false; snBrowsePanel(); };
  $("#bref").onclick = () => { SN.bres = null; snBrowseLoad(); };
  $$("[data-bf]", p).forEach((x) => x.onclick = () => { const it = r.items[+x.dataset.bi]; snQueue(it, it.formats[+x.dataset.bf]); });
  $$("[data-bn]", p).forEach((x) => x.onclick = async () => { x.textContent = "…"; if (await snEnsureFormats(r.items[+x.dataset.bn])) snBrowsePanel(); });
  $$("[data-bp]", p).forEach((x) => x.onclick = () => { try { $("#snweb").executeJavaScript("document.querySelectorAll('video,audio').forEach(v=>v.pause())"); } catch (e) {} snPreview(r.items[+x.dataset.bp]); });
}

// ------------------------------------------------------------------ Downloads
const snSel = (id, vals, cur) => '<select id="' + id + '">' + vals.map((x) => { const [val, l] = Array.isArray(x) ? x : [x, x]; return '<option value="' + val + '"' + (String(val) === String(cur) ? " selected" : "") + ">" + esc(tr(String(l))) + "</option>"; }).join("") + "</select>";
function snDownloads(b) {
  b.innerHTML = '<div class="row sn-sub sn-tools"><label>' + tr("At the same time") + " " + snSel("snmax", [1, 2, 3, 4, 5, 6], SN.settings.maxActive) + "</label><label>" + tr("Connections per download") + " " + snSel("sncon", [1, 2, 4, 6, 8, 12], SN.settings.connections) +
    '</label><span class="sp"></span><button class="btn" id="snupd">' + tr("Update extractor") + '</button><button class="btn" id="snfolder">' + tr("Open folder") + '</button><button class="btn" id="snclear">' + tr("Clear finished") + '</button></div>' +
    '<div class="small dim" style="margin-bottom:10px">' + esc(DCFG ? DCFG.folder + "/Web" : "") + ' · <a href="#" id="snchg">' + tr("Change folder") + '</a></div><div id="snlist"></div>';
  const setS = async () => { const s = await snCall("settings", { maxActive: +$("#snmax").value, connections: +$("#sncon").value }); if (s && !s.error) SN.settings = s; };
  $("#snmax").onchange = setS; $("#sncon").onchange = setS;
  $("#snfolder").onclick = () => DESK.open(DCFG.folder + "/Web").then((e) => { if (e) DESK.open(); });
  $("#snclear").onclick = () => snCall("clear");
  $("#snchg").onclick = async (e) => { e.preventDefault(); DCFG.folder = await DESK.chooseFolder(); snDownloads(b); };
  $("#snupd").onclick = async () => { $("#snupd").disabled = true; toast("Updating…"); const r = await snCall("updateExtractor"); toast(r.error || r.text || "Done"); const u = $("#snupd"); if (u) u.disabled = false; };
  $("#snlist").onclick = snJobClick;
  snDrawJobs();
}
function snDrawJobs() {
  const box = $("#snlist"); if (!box) return;
  if (!SN.jobs.length) { box.innerHTML = '<div class="empty">' + tr("No downloads yet. Analyze a page in Discover and pick a quality.") + "</div>"; return; }
  const groups = [["Active", (j) => j.state === "downloading" || j.state === "queued"], ["Paused", (j) => j.state === "paused"], ["Failed", (j) => j.state === "failed" || j.state === "canceled"], ["Completed", (j) => j.state === "done"]];
  const btn = (a, l, j, cls) => '<button class="btn ' + (cls || "") + '" data-sa="' + a + '" data-sj="' + j.id + '">' + l + "</button>";
  const row = (j) => {
    const pct = j.total ? Math.min(100, Math.round(j.size / j.total * 100)) : 0, active = j.state === "downloading";
    const info = j.state === "done" ? [snSize(j.size), j.label, j.site].filter(Boolean).join(" · ") :
      [j.state === "queued" ? tr("Waiting") : j.state === "paused" ? tr("Paused") : j.state === "failed" ? tr("Failed") : j.state === "canceled" ? tr("Cancelled") : "", j.total ? pct + "%" : "", snSize(j.size) + (j.total ? " / " + snSize(j.total) : ""),
        active && j.speed ? snSize(j.speed) + "/s" : "", active && j.eta ? snEta(j.eta) + " " + tr("left") : "", j.label, tr(j.error || "")].filter(Boolean).join(" · ");
    return '<div class="item sn-job"><div class="sn-jth">' + (j.thumbnail ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(j.thumbnail) + '" onerror="this.remove()">' : "") + '</div><div class="sn-jmain"><div class="sn-jt">' + esc(j.title) + '</div><div class="small ' + (j.state === "failed" ? "" : "dim") + '"' + (j.state === "failed" ? ' style="color:var(--bad)"' : "") + ">" + esc(info) + "</div>" +
      (j.state !== "done" && j.state !== "canceled" ? '<div class="prog sn-prog' + (active && !j.total ? " ind" : "") + '"><i style="width:' + pct + '%"></i></div>' : "") + '</div><div class="row sn-jbtn">' +
      (j.state === "done" ? btn("play", tr("Play"), j) + btn("conv", tr("Convert"), j) + btn("show", tr("Show in Finder"), j) : "") +
      (active || j.state === "queued" ? btn("pause", tr("Pause"), j) + btn("cancel", tr("Cancel"), j) : "") +
      (j.state === "paused" ? btn("resume", tr("Resume"), j) + btn("cancel", tr("Cancel"), j) : "") + (j.state === "failed" || j.state === "canceled" ? btn("resume", tr("Try again"), j) : "") + (j.state !== "downloading" ? btn("del", "✕", j) : "") + "</div></div>";
  };
  box.innerHTML = groups.map(([name, fn]) => { const l = SN.jobs.filter(fn); return l.length ? "<h2>" + tr(name) + ' <span class="dim small">' + l.length + '</span></h2><div class="list">' + l.map(row).join("") + "</div>" : ""; }).join("");
}
function snJobClick(e) {
  const b = e.target.closest("[data-sa]"); if (!b) return;
  const j = SN.jobs.find((x) => x.id === b.dataset.sj); if (!j) return; const a = b.dataset.sa;
  if (a === "pause" || a === "resume" || a === "cancel") snCall(a, { id: j.id });
  if (a === "show") DESK.show(j.file);
  if (a === "play") openPlayer({ kind: "movie", key: "f:" + j.id, title: j.title, url: location.origin + "/local?p=" + encodeURIComponent(j.file), localFile: j.file, group: tr("Web Sniffer") });
  if (a === "conv") { SN.picked = new Set([j.file]); SN.view = "convert"; renderSniffer($("#view")); }
  if (a === "del") {
    if (j.state !== "done") return snCall("remove", { id: j.id, deleteFile: false });
    sheet("<h3>" + esc(j.title) + '</h3><div class="list"><button class="item" id="dkeep">' + tr("Remove from list (keep the file)") + '</button><button class="item" id="dboth" style="color:var(--bad)">' + tr("Delete the file too") + "</button></div>");
    $("#dkeep").onclick = () => { snCall("remove", { id: j.id, deleteFile: false }); closeSheet(); };
    $("#dboth").onclick = () => { snCall("remove", { id: j.id, deleteFile: true }); closeSheet(); };
  }
}

// ------------------------------------------------------------------ Converter
function snSources() {
  const a = SN.jobs.filter((j) => j.state === "done").map((j) => ({ file: j.file, name: j.title, from: "Web" }));
  const b = (typeof JOBS !== "undefined" ? JOBS : []).filter((j) => j.state === "done" && j.file).map((j) => ({ file: j.file, name: j.name + (j.title ? " – " + j.title : ""), from: j.type === "record" ? "Recording" : "Download" }));
  const c = SN.extra.map((f) => ({ file: f, name: f.split("/").pop(), from: "File" }));
  const seen = new Set(); return [...c, ...a, ...b].filter((s) => !seen.has(s.file) && seen.add(s.file));
}
function snConvert(b) {
  const o = SN.opts, audio = SN_AUDIO.includes(o.format), src = snSources();
  const field = (l, h) => '<label class="sn-field"><span>' + tr(l) + "</span>" + h + "</label>";
  b.innerHTML = '<div class="sn-conv"><div class="sn-col"><div class="row"><h2 style="margin:0">' + tr("Files") + '</h2><span class="sp"></span><button class="btn" id="snadd">+ ' + tr("Add files…") + "</button></div>" +
    (src.length ? '<div class="list sn-src">' + src.map((s, i) => '<label class="item"><input type="checkbox" data-src="' + i + '" ' + (SN.picked.has(s.file) ? "checked" : "") + '><span style="flex:1;min-width:0"><div class="sn-jt">' + esc(s.name) + '</div><div class="small dim">' + tr(s.from) + " · " + esc((s.file.split(".").pop() || "").toUpperCase()) + "</div></span></label>").join("") + "</div>" :
      '<div class="small dim" style="margin-top:10px">' + tr("Finished downloads and recordings appear here. You can also add any media file from your Mac.") + "</div>") + "</div>" +
    '<div class="sn-col"><h2 style="margin:0 0 10px">' + tr("Output") + '</h2><div class="glass sn-form">' +
    field("Format", snSel("so_format", [["mp4", "MP4"], ["mov", "MOV"], ["mkv", "MKV"], ["avi", "AVI"], ["webm", "WebM"], ["mp3", "MP3 (audio)"], ["m4a", "M4A (audio)"], ["aac", "AAC (audio)"], ["wav", "WAV (audio)"], ["flac", "FLAC (audio)"]], o.format)) +
    (audio ? "" : field("Resolution", snSel("so_height", [["orig", "Same as source"], [2160, "4K (2160p)"], [1440, "1440p"], [1080, "1080p"], [720, "720p"], [480, "480p"], [360, "360p"]], o.height)) +
      field("Video codec", snSel("so_vcodec", [["auto", "Automatic"], ["copy", "Keep original (no quality loss, fastest)"], ["h264", "H.264"], ["hevc", "HEVC (H.265)"], ["vp9", "VP9"], ["mpeg4", "MPEG-4"]], o.vcodec)) +
      field("Quality", snSel("so_quality", [["high", "High (near original)"], ["medium", "Medium"], ["low", "Small file"]], o.quality)) +
      field("Video bitrate", snSel("so_vbitrate", [["", "Automatic (by quality)"], [1500, "1.5 Mbps"], [3000, "3 Mbps"], [5000, "5 Mbps"], [8000, "8 Mbps"], [12000, "12 Mbps"], [20000, "20 Mbps"]], o.vbitrate)) +
      field("Frame rate", snSel("so_fps", [["orig", "Same as source"], [24, "24"], [25, "25"], [30, "30"], [50, "50"], [60, "60"]], o.fps)) +
      field("Audio codec", snSel("so_acodec", [["auto", "Automatic"], ["copy", "Keep original"], ["aac", "AAC"], ["mp3", "MP3"], ["opus", "Opus"], ["flac", "FLAC"]], o.acodec))) +
    (o.format === "wav" || o.format === "flac" ? "" : field("Audio bitrate", snSel("so_abitrate", [[96, "96 kbps"], [128, "128 kbps"], [192, "192 kbps"], [256, "256 kbps"], [320, "320 kbps"]], o.abitrate))) +
    '</div><button class="btn primary" id="snrun" style="margin-top:12px;width:100%">' + tr("Convert") + (SN.picked.size ? " (" + SN.picked.size + ")" : "") + '</button><div class="small dim" style="margin-top:8px">' + tr("Saved to") + " " + esc(DCFG ? DCFG.folder + "/Converted" : "") + '</div></div></div><div id="sncjobs"></div>';
  $$("[data-src]", b).forEach((c) => c.onchange = () => { const f = src[+c.dataset.src].file; c.checked ? SN.picked.add(f) : SN.picked.delete(f); $("#snrun").textContent = tr("Convert") + (SN.picked.size ? " (" + SN.picked.size + ")" : ""); });
  $$("select[id^=so_]", b).forEach((s) => s.onchange = () => { o[s.id.slice(3)] = s.value; if (s.id === "so_format") snConvert(b); });
  $("#snadd").onclick = async () => { const r = await snCall("pickFiles"); for (const f of (r && r.files) || []) { if (!SN.extra.includes(f)) SN.extra.unshift(f); SN.picked.add(f); } snConvert(b); };
  $("#snrun").onclick = async () => {
    const inputs = src.map((s) => s.file).filter((f) => SN.picked.has(f)); if (!inputs.length) return toast("Choose at least one file");
    await snCall("convert", { inputs, opts: { ...o } }); SN.picked.clear(); toast("Conversion started"); snConvert(b);
  };
  $("#sncjobs").onclick = (e) => { const x = e.target.closest("[data-ca]"); if (!x) return; const c = SN.conv.find((y) => y.id === x.dataset.cj); if (!c) return; const a = x.dataset.ca;
    if (a === "stop") snCall("convStop", { id: c.id }); if (a === "del") snCall("convRemove", { id: c.id }); if (a === "show") DESK.show(c.file);
    if (a === "play") openPlayer({ kind: "movie", key: "f:" + c.id, title: c.name, url: location.origin + "/local?p=" + encodeURIComponent(c.file), localFile: c.file, group: tr("Converter") }); };
  snDrawConv();
}
function snDrawConv() {
  const box = $("#sncjobs"); if (!box) return;
  if (!SN.conv.length) { box.innerHTML = ""; return; }
  const btn = (a, l, c) => '<button class="btn" data-ca="' + a + '" data-cj="' + c.id + '">' + l + "</button>";
  box.innerHTML = "<h2>" + tr("Conversions") + '</h2><div class="list">' + SN.conv.map((c) => { const pct = Math.round((c.progress || 0) * 100);
    const info = [c.state === "converting" ? tr("Converting") + " " + pct + "%" : c.state === "queued" ? tr("Waiting") : c.state === "done" ? snSize(c.size) : c.state === "canceled" ? tr("Cancelled") : tr("Failed"), "→ " + c.opts.format.toUpperCase(), c.error].filter(Boolean).join(" · ");
    return '<div class="item sn-job"><div class="sn-jmain"><div class="sn-jt">' + esc(c.name) + '</div><div class="small dim"' + (c.state === "failed" ? ' style="color:var(--bad)"' : "") + ">" + esc(info) + "</div>" +
      (c.state === "converting" || c.state === "queued" ? '<div class="prog sn-prog"><i style="width:' + pct + '%"></i></div>' : "") + '</div><div class="row sn-jbtn">' +
      (c.state === "done" ? btn("play", tr("Play"), c) + btn("show", tr("Show in Finder"), c) : "") + (c.state === "converting" || c.state === "queued" ? btn("stop", tr("Cancel"), c) : btn("del", "✕", c)) + "</div></div>"; }).join("") + "</div>";
}
