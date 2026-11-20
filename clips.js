// ------------------------------------------------------------------ Clips (Mac app): turn a long video into short clips – best moments found automatically,
// vertical / square / horizontal, with your logo, a title, subtitles, fades and phone-loud sound. The work is done by desktop/clips.cjs.
const CL_DEF = { format: "vertical", fit: "blur", zoom: 100, cropPos: 50, logoOn: false, logo: "", corner: "br", logoSize: 14, logoOpacity: 100, titleOn: false, title: "", titleBox: false, numberOn: false,
  subsOn: false, srt: "", subsSize: "big", fade: true, loud: true, quality: "1080", fps: "same", folder: "", count: 5, length: "0", focus: "both",
  mode: "moments", partLen: 180, partWhole: true, partFrom: "", partTo: "", lastPart: "keep", overlap: 0,
  fontFile: "", titleSize: 100, titleX: 50, titleY: null, textColor: "#ffffff", outline: true, outlineColor: "#000000", boxColor: "#000000", boxOpacity: 60, numberStyle: "full", partWord: "Part", nextOn: true,
  bgColor: "#000000", subsPos: null, subsColor: "#ffffff", musicOn: false, music: "", musicName: "", musicDur: 0, musicVolume: 20, origVolume: 100, duck: true, musicStart: 0 };
const CL = { file: "", info: null, moments: [], parts: [], fonts: null, strip: [], key: "", busy: false, progress: 0, jobs: [], caps: null, stopAt: 0, mStart: "", mEnd: "", logoImg: null,
  o: (() => { try { return { ...CL_DEF, ...JSON.parse(localStorage.getItem("ftv.clips.o") || "{}") }; } catch (e) { return { ...CL_DEF }; } })() };
const clSave = () => { try { localStorage.setItem("ftv.clips.o", JSON.stringify(CL.o)); } catch (e) {} };
const clVisible = () => S.tab === "clips" && $("#player").classList.contains("hidden");
const clUrl = (f) => location.origin + "/local?p=" + encodeURIComponent(f);
const clName = (f) => String(f || "").split("/").pop();
// ------------------------------------------------------------ split into parts: the whole video (or a stretch of it) cut back to back
const clList = () => CL.o.mode === "split" ? CL.parts : CL.moments;
function clPlanParts() {
  const o = CL.o, d = (CL.info && CL.info.duration) || 0;
  const from = o.partWhole ? 0 : Math.max(0, snParseT(o.partFrom) || 0), to = o.partWhole ? d : Math.min(d, snParseT(o.partTo) || d);
  const L = Math.max(5, +o.partLen || 180), ov = Math.max(0, Math.min(L / 2, +o.overlap || 0)), out = [];
  if (!(to - from >= 1)) return { parts: out, from, to, L, rest: 0 };
  for (let s = from; s < to - 0.5; s += L) out.push({ start: Math.max(from, s - (out.length ? ov : 0)), end: Math.min(s + L, to) });
  const last = out[out.length - 1], rest = last && last.end - (last.start + (out.length > 1 ? ov : 0)) < L - 0.5 ? last.end - Math.max(from, last.end - ((to - from) % L || L)) : 0;
  if (rest && out.length > 1) { if (o.lastPart === "merge") { out.pop(); out[out.length - 1].end = to; } else if (o.lastPart === "drop") out.pop(); }
  return { parts: out, from, to, L, rest };
}
function clMakeParts() {
  const p = clPlanParts(), old = CL.parts;
  CL.parts = p.parts.map((x, k) => ({ ...x, n: k + 1, total: p.parts.length, part: true, on: old[k] ? old[k].on : true, title: old[k] ? old[k].title || "" : "" }));
  return p;
}
function clSplitHtml() {
  const o = CL.o, p = clMakeParts(), d = (CL.info && CL.info.duration) || 1;
  const chips = [[60, "1 min"], [120, "2 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"]];
  const n = CL.parts.length, full = CL.parts.filter((x) => Math.abs(x.end - x.start - p.L) < 0.6 || (o.overlap && Math.abs(x.end - x.start - p.L - o.overlap) < 0.6)).length;
  const lastLen = n ? CL.parts[n - 1].end - CL.parts[n - 1].start : 0;
  return '<div class="clp-find glass clp-split">' +
    '<div class="clp-srow"><span>' + tr("Each part") + "</span>" + chips.map(([s, l]) => '<button class="chip' + (+o.partLen === s ? " on" : "") + '" data-plen="' + s + '">' + tr(l) + "</button>").join("") +
    '<label class="small dim">' + tr("or exactly") + ' <input class="clp-t" id="clplen" value="' + fmtTime(+o.partLen || 180) + '"></label></div>' +
    '<div class="clp-srow"><span>' + tr("Which part") + '</span><label class="clp-chk"><input type="checkbox" id="clpwhole"' + (o.partWhole ? " checked" : "") + "> " + tr("Whole video") + "</label>" +
    '<span class="small dim">' + tr("or from") + '</span><input class="clp-t" id="clpfrom" value="' + esc(o.partWhole ? "0:00" : o.partFrom || "0:00") + '"' + (o.partWhole ? " disabled" : "") + '><span class="small dim">' + tr("to") +
    '</span><input class="clp-t" id="clpto" value="' + esc(o.partWhole ? fmtTime(d) : o.partTo || fmtTime(d)) + '"' + (o.partWhole ? " disabled" : "") + "></div>" +
    '<div class="clp-srow"><span>' + tr("Last part") + "</span>" + [["keep", "Keep it shorter"], ["merge", "Add it to the part before"], ["drop", "Leave it out"]].map(([v, l]) =>
      '<label class="clp-opt' + ((o.lastPart || "keep") === v ? " on" : "") + '"><input type="radio" name="cllast" value="' + v + '"' + ((o.lastPart || "keep") === v ? " checked" : "") + "> " + tr(l) + "</label>").join("") + "</div>" +
    '<div class="clp-srow"><span>' + tr("Overlap") + '</span><input type="range" id="clpov" min="0" max="10" value="' + (+o.overlap || 0) + '" style="width:180px;accent-color:#7C3AED"><b id="clpovv">' + (+o.overlap || 0) + ' s</b><span class="small dim">' +
      tr("each part starts with the last seconds of the one before") + "</span></div>" +
    '<div class="clp-parts" title="' + tr("Click a part to watch it") + '">' + CL.parts.map((x, k) => '<i data-pgo="' + k + '" class="' + (k % 2 ? "b" : "a") + (k === n - 1 && p.rest && o.lastPart !== "merge" && n > 1 && lastLen < p.L - 0.5 ? " last" : "") +
      '" style="left:' + (x.start / d * 100) + "%;width:" + Math.max(0.15, (x.end - x.start) / d * 100) + '%"></i>').join("") + "</div>" +
    '<div class="clp-sum"><b>' + (n ? n + " " + tr(n === 1 ? "part" : "parts") : tr("No parts")) + "</b>" + (n ? '<span class="dim">' + (full && full !== n ? full + " × " + fmtTime(p.L) + " + " + tr("a last part of") + " " + fmtTime(lastLen) : "× " + fmtTime(n === 1 ? lastLen : p.L)) + "</span>" : "") + "</div></div>";
}
function clWireSplit(box) {
  const o = CL.o, redo = () => { clSave(); clDrawMain(); };
  $$("[data-plen]", box).forEach((b) => b.onclick = () => { o.partLen = +b.dataset.plen; redo(); });
  const pl = $("#clplen"); if (pl) pl.onchange = () => { const v = snParseT(pl.value); if (v == null || v < 5) { toast("Write the time like 1:05:30"); pl.value = fmtTime(+o.partLen || 180); return; } o.partLen = v; redo(); };
  const w = $("#clpwhole"); if (w) w.onchange = () => { o.partWhole = w.checked; redo(); };
  const pf = $("#clpfrom"), pt = $("#clpto"); if (pf) pf.onchange = () => { o.partFrom = pf.value; redo(); }; if (pt) pt.onchange = () => { o.partTo = pt.value; redo(); };
  $$("[name=cllast]", box).forEach((r) => r.onchange = () => { o.lastPart = r.value; redo(); });
  const ov = $("#clpov"); if (ov) { ov.oninput = () => { $("#clpovv").textContent = ov.value + " s"; }; ov.onchange = () => { o.overlap = +ov.value; redo(); }; }
  $$("[data-pgo]", box).forEach((b) => b.onclick = () => { const m = CL.parts[+b.dataset.pgo], v = $("#clv"); if (v && m) { CL.cur = m; v.currentTime = m.start; CL.stopAt = m.end; v.play().catch(() => {}); } });
}

function clEvent(e) {
  if (e.type === "clipsProgress" && e.file === CL.file) { CL.progress = e.progress; const b = $("#clprog i"); if (b) b.style.width = Math.round(e.progress * 100) + "%"; const t = $("#clprogt"); if (t) t.textContent = Math.round(e.progress * 100) + "%"; }
  if (e.type === "clipsThumb" && e.key === CL.key && CL.moments[e.i]) { CL.moments[e.i].thumb = e.src; const im = $("#clth" + e.i); if (im) im.innerHTML = '<img src="' + e.src + '">'; }
  if (e.type === "clipsJobs") { CL.jobs = e.jobs || []; if (clVisible()) clDrawJobs(); }
}

async function renderClips(v) {
  await snInit();
  if (!CL.fonts) { const r = await snCall("clipsFonts"); CL.fonts = (r && r.fonts) || []; }
  if (!CL.caps) { CL.caps = (await snCall("clipsCaps")) || {}; const r = await snCall("clipsJobs"); CL.jobs = (r && r.jobs) || []; CL.defFolder = (r && r.folder) || ""; }
  if (S.tab !== "clips") return;
  if (CL.o.logo) snCall("clipsAllow", { file: CL.o.logo });
  v.innerHTML = '<div class="clp"><div class="row"><h1>' + tr("Clips") + '</h1><span class="small dim" style="margin-left:4px">' + tr("Long video → short clips for Shorts, Reels and TikTok") + '</span><span class="sp"></span><button class="btn" id="clopen">' + tr("Open folder") + "</button></div>" +
    '<div class="clp-grid"><div class="clp-main" id="clmain"></div><aside class="clp-side glass" id="clside"></aside></div><div id="cljobs"></div></div>';
  $("#clopen").onclick = () => { const f = CL.o.folder || CL.defFolder; DESK.open(f).then((e) => { if (e) DESK.open(); }); };
  clDrawMain(); clDrawSide(); clDrawJobs();
}

// ------------------------------------------------------------ left: the video, finding moments, the list of clips
function clDrawMain() {
  const box = $("#clmain"); if (!box) return;
  if (!CL.file) {
    const src = snSources();
    box.innerHTML = '<div id="cldrop" class="clp-drop"><div>' + tr("Drop a video here (your gameplay, your stream, or footage you have permission to use)") + '</div><button class="btn clp-primary" id="clpick">' + tr("Choose video") + "</button></div>" +
      (src.length ? '<div class="small dim" style="margin:16px 0 8px">' + tr("From FreeTV") + '</div><div class="cv-recent">' + src.map((x, i) => '<button class="chip" data-clr="' + i + '" title="' + esc(x.file) + '">+ ' + esc(x.name.slice(0, 40)) + ' <span class="dim">' + esc(tr(x.from)) + "</span></button>").join("") + "</div>" : "") +
      '<div class="clp-how small dim"><b>' + tr("How it works") + "</b><ol><li>" + tr("Choose a long video – a stream, gameplay, a podcast.") + "</li><li>" + tr("FreeTV listens for loud reactions and watches for fast action, then suggests the best moments.") + "</li><li>" +
      tr("Keep the ones you like, fix the start and end, add your logo and a title.") + "</li><li>" + tr("Export: ready-to-post clips in the Clips folder.") + "</li></ol></div>";
    $("#clpick").onclick = async () => { const r = await snCall("clipsPickVideo"); if (r && r.file) clOpen(r.file); };
    $$("[data-clr]", box).forEach((b) => b.onclick = () => clOpen(src[+b.dataset.clr].file));
    const d = $("#cldrop");
    d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove("over"); const f = [...e.dataTransfer.files][0]; if (f) clOpen(window.ftvDesktop.pathForFile(f)); };
    return;
  }
  const i = CL.info || {}, o = CL.o;
  const sel = (id, opts, val) => '<select id="' + id + '">' + opts.map(([k, l]) => '<option value="' + k + '"' + (String(k) === String(val) ? " selected" : "") + ">" + esc(tr(l)) + "</option>").join("") + "</select>";
  box.innerHTML = '<div class="row clp-file"><b class="sn-jt" style="flex:1">' + esc(clName(CL.file)) + '</b><span class="small dim">' + [fmtTime(i.duration || 0), i.width ? i.width + "×" + i.height : "", snSize(i.size)].filter(Boolean).join(" · ") +
    '</span><button class="btn" id="clchange">' + tr("Other video") + "</button></div>" +
    '<video id="clv" controls preload="auto" src="' + esc(clUrl(CL.file)) + '"></video><div id="clvnote" class="small dim hidden" style="margin-top:6px">' + tr("This video can't be shown here, but finding moments and exporting still work.") + "</div>" +
    '<div class="seg clp-mode" role="tablist"><button data-cmode="moments" class="' + (o.mode !== "split" ? "on" : "") + '">' + tr("Best moments") + '</button><button data-cmode="split" class="' + (o.mode === "split" ? "on" : "") + '">' + tr("Split into parts") + "</button></div>" +
    (o.mode === "split" ? clSplitHtml() : (    '<div class="row clp-manual"><label>' + tr("Start") + ' <input id="clms" placeholder="0:00" value="' + esc(CL.mStart) + '"></label><button class="btn" data-now="s">' + tr("Use current time") + "</button><label>" + tr("End") + ' <input id="clme" placeholder="0:00" value="' + esc(CL.mEnd) + '"></label><button class="btn" data-now="e">' + tr("Use current time") + '</button><button class="btn white" id="cladd">+ ' + tr("Add as clip") + "</button></div>" +
    '<div class="clp-find glass"><div class="row" style="gap:10px;flex-wrap:wrap"><b style="font-size:16px">' + tr("Find the best moments") + '</b><span class="sp"></span>' +
    '<label class="clp-f">' + tr("How many") + sel("cl_count", [[3, "3"], [5, "5"], [8, "8"], [10, "10"], [15, "15"]], o.count) + "</label>" +
    '<label class="clp-f">' + tr("Length") + sel("cl_length", [[0, "Automatic"], [15, "15 s"], [30, "30 s"], [45, "45 s"], [60, "60 s"]], o.length) + "</label>" +
    '<label class="clp-f">' + tr("Look for") + sel("cl_focus", [["both", "Reactions and action"], ["audio", "Loud reactions, laughs, shouting"], ["action", "Fast action, lots of movement"]], o.focus) + "</label>" +
    '<button class="btn clp-primary" id="clfind">' + (CL.moments.some((m) => m.auto) ? tr("Find again") : tr("Find moments")) + "</button></div>" +
    (CL.busy ? '<div class="row" style="gap:10px;margin-top:12px"><div class="prog" id="clprog" style="flex:1"><i style="width:' + Math.round(CL.progress * 100) + '%"></i></div><span class="small dim" id="clprogt">' + Math.round(CL.progress * 100) + '%</span><button class="btn" id="clstop">' + tr("Stop") + "</button></div><div class=\"small dim\" style=\"margin-top:6px\">" + tr("Listening and watching the whole video once. Next time it's instant.") + "</div>" : "") +
    (CL.strip.length ? '<div class="clp-heat" id="clheat" title="' + tr("Where the video gets exciting – click to jump there") + '">' + CL.strip.map((x) => '<i style="height:' + Math.round(8 + x * 92) + '%;opacity:' + (0.35 + x * 0.65).toFixed(2) + '"></i>').join("") +
      CL.moments.map((m) => '<b style="left:' + (m.start / i.duration * 100) + "%;width:" + Math.max(0.4, (m.end - m.start) / i.duration * 100) + '%"></b>').join("") + "</div>" : "") + "</div>")) +
    '<div id="clmoments"></div>';
  const vid = $("#clv");
  vid.onerror = () => $("#clvnote").classList.remove("hidden");
  vid.onloadeddata = vid.onseeked = () => clPreview();
  vid.ontimeupdate = () => { if (CL.stopAt && vid.currentTime >= CL.stopAt) { vid.pause(); CL.stopAt = 0; } };
  vid.onplay = () => { const loop = () => { if (vid.paused || !clVisible()) return; clPreview(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); };
  $("#clchange").onclick = () => { snCall("clipsCancel"); Object.assign(CL, { file: "", info: null, moments: [], parts: [], strip: [], busy: false }); clDrawMain(); clDrawSide(); };
  $$("[data-cmode]", box).forEach((b) => b.onclick = () => { CL.o.mode = b.dataset.cmode; clSave(); clDrawMain(); clDrawSide(); });
  if (o.mode === "split") clWireSplit(box); else {
  $$("[data-now]", box).forEach((b) => b.onclick = () => { const t = fmtTime(vid.currentTime || 0); if (b.dataset.now === "s") { CL.mStart = t; $("#clms").value = t; } else { CL.mEnd = t; $("#clme").value = t; } });
  $("#clms").oninput = (e) => { CL.mStart = e.target.value; }; $("#clme").oninput = (e) => { CL.mEnd = e.target.value; };
  $("#cladd").onclick = () => { const s = snParseT(CL.mStart), e = snParseT(CL.mEnd);
    if (s == null || e == null) return toast("Set the start and end first (e.g. 12:30)"); if (e - s < 1) return toast("The end must be after the start");
    CL.moments.push({ start: s, end: Math.min(e, i.duration || e), why: ["Added by you"], on: true, mine: true }); CL.mStart = CL.mEnd = ""; $("#clms").value = $("#clme").value = ""; clDrawMoments(); clThumbs(); toast("Clip added"); };
  ["count", "length", "focus"].forEach((k) => { $("#cl_" + k).onchange = (e) => { CL.o[k] = e.target.value; clSave(); }; });
  $("#clfind").onclick = clFind;
  const st = $("#clstop"); if (st) st.onclick = () => { snCall("clipsCancel"); CL.busy = false; clDrawMain(); };
  const heat = $("#clheat"); if (heat) heat.onclick = (e) => { const r = heat.getBoundingClientRect(); vid.currentTime = (e.clientX - r.left) / r.width * (i.duration || 0); };
  }
  clDrawMoments();
}
async function clOpen(file) {
  if (!file) return;
  const r = await snCall("clipsOpen", { file }); if (!r || r.error) return toast((r && r.error) || "This file can't be opened");
  if (!r.video) return toast("This file has no picture – choose a video");
  Object.assign(CL, { file, info: r, moments: [], parts: [], strip: [], key: "", busy: false, progress: 0, mStart: "", mEnd: "" });
  clDrawMain(); clDrawSide();
}
async function clFind() {
  if (CL.busy) return; CL.busy = true; CL.progress = 0; clDrawMain();
  const file = CL.file, r = await snCall("clipsAnalyze", { file, count: +CL.o.count, length: +CL.o.length, focus: CL.o.focus });
  if (CL.file !== file) return; CL.busy = false;
  if (!r || r.error) { if (r && r.error !== "cancelled") toast(r.error); clDrawMain(); return; }
  CL.key = r.key; CL.strip = r.strip || [];
  CL.moments = CL.moments.filter((m) => m.mine).concat((r.moments || []).map((m) => ({ ...m, on: true, auto: true })));
  if (!r.moments.length) toast("No moments stood out – try another setting or add clips yourself");
  else if (r.moments.length < +CL.o.count) toast(tr("Only") + " " + r.moments.length + " " + tr("moments really stood out – add more yourself if you like"));
  else if (r.focusUsed !== CL.o.focus && CL.o.focus !== "both") toast(r.focusUsed === "audio" ? "This video has no picture changes to look at – used the sound" : "This video is silent – used the picture");
  clDrawMain();
}
function clThumbs() { /* thumbnails for clips added by hand come from the video element */
  const vid = $("#clv"); if (!vid || !vid.videoWidth) return;
  CL.moments.forEach((m, i) => { if (m.thumb || !m.mine) return; const c = document.createElement("video"); c.muted = true; c.src = vid.src; c.currentTime = m.start + 0.5;
    c.onseeked = () => { const k = document.createElement("canvas"); k.height = 180; k.width = Math.round(180 * c.videoWidth / c.videoHeight); try { k.getContext("2d").drawImage(c, 0, 0, k.width, k.height); m.thumb = k.toDataURL("image/jpeg", 0.7); const im = $("#clth" + i); if (im) im.innerHTML = '<img src="' + m.thumb + '">'; } catch (e) {} c.removeAttribute("src"); }; });
}
function clDrawMoments() {
  const box = $("#clmoments"); if (!box) return;
  const L = clList(), split = CL.o.mode === "split", on = L.filter((m) => m.on).length;
  if (!L.length) { box.innerHTML = split ? "" : '<div class="small dim" style="margin:14px 2px">' + tr("No clips yet. Press “Find moments”, or set a start and end above and add it yourself.") + "</div>"; clExportLabel(); return; }
  box.innerHTML = '<div class="row" style="margin:18px 0 8px"><h2 style="margin:0">' + tr(split ? "Parts to export" : "Clips to export") + '</h2><span class="small dim" style="margin-left:10px">' + on + " / " + L.length + " " + tr("chosen") + '</span><span class="sp"></span><button class="btn" id="clall">' + tr(on === L.length ? "Choose none" : "Choose all") + "</button></div>" +
    '<div class="clp-moments">' + L.map((m, i) => '<div class="clp-m glass' + (m.on ? " on" : "") + '"><label class="clp-mchk"><input type="checkbox" data-mon="' + i + '"' + (m.on ? " checked" : "") + '></label><div class="clp-th" id="clth' + i + '">' + (m.thumb ? '<img src="' + m.thumb + '">' : "") +
      '<span class="clp-len">' + fmtTime(m.end - m.start) + "</span></div>" +
      '<div class="clp-mbody"><div class="row" style="gap:8px;flex-wrap:wrap"><b>' + (split ? esc(CL.o.partWord || "Part") + " " + m.n : "#" + (i + 1)) + '</b><input class="clp-t" data-ms="' + i + '" value="' + fmtTime(m.start) + '"><span class="dim">–</span><input class="clp-t" data-me="' + i + '" value="' + fmtTime(m.end) + '">' +
      '<button class="sn-nb" data-nudge="' + i + ':s:-1" title="' + tr("Start 1 s earlier") + '">−1s</button><button class="sn-nb" data-nudge="' + i + ':s:1" title="' + tr("Start 1 s later") + '">+1s</button><span class="dim small">' + tr("start") + "</span>" +
      '<button class="sn-nb" data-nudge="' + i + ':e:-1">−1s</button><button class="sn-nb" data-nudge="' + i + ':e:1">+1s</button><span class="dim small">' + tr("end") + "</span></div>" +
      '<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">' + (m.pct ? '<span class="clp-score" title="' + tr("How much it stands out") + '"><i style="width:' + m.pct + '%"></i></span>' : "") + (m.why || []).map((w) => '<span class="clp-why">' + esc(tr(w)) + "</span>").join("") + "</div>" +
      '<input class="clp-title" data-mt="' + i + '" placeholder="' + esc(tr(split ? "Title for this part (optional)" : "Title for this clip (optional)")) + '" value="' + esc(m.title || "") + '"></div>' +
      '<div class="clp-mbtn"><button class="btn" data-mplay="' + i + '">' + I.play + tr("Play") + '</button><button class="sn-nb" data-mdel="' + i + '" title="' + tr("Remove") + '">✕</button></div></div>').join("") + "</div>";
  const dur = (CL.info && CL.info.duration) || 0, fix = (m) => { m.start = Math.max(0, Math.min(m.start, dur - 1)); m.end = Math.max(m.start + 1, Math.min(m.end, dur)); };
  $("#clall").onclick = () => { const all = on !== L.length; L.forEach((m) => m.on = all); clDrawMoments(); };
  $$("[data-mon]", box).forEach((c) => c.onchange = () => { L[+c.dataset.mon].on = c.checked; c.closest(".clp-m").classList.toggle("on", c.checked); clExportLabel(); $("#clall").textContent = tr(L.every((m) => m.on) ? "Choose none" : "Choose all"); });
  $$("[data-ms],[data-me]", box).forEach((x) => x.onchange = () => { const m = L[+(x.dataset.ms || x.dataset.me)], v = snParseT(x.value);
    if (v == null) toast("Write the time like 1:05:30"); else if (x.dataset.ms) m.start = v; else m.end = v; fix(m); clDrawMoments(); });
  $$("[data-nudge]", box).forEach((b) => b.onclick = () => { const [k, w, d] = b.dataset.nudge.split(":"), m = L[+k]; if (w === "s") m.start += +d; else m.end += +d; fix(m); clDrawMoments();
    const v = $("#clv"); if (v) { v.currentTime = w === "s" ? m.start : Math.max(m.start, m.end - 2); } });
  $$("[data-mt]", box).forEach((x) => x.oninput = () => { L[+x.dataset.mt].title = x.value; clPreview(); });
  $$("[data-mplay]", box).forEach((b) => b.onclick = () => { const m = L[+b.dataset.mplay], v = $("#clv"); if (!v) return; CL.cur = m; v.currentTime = m.start; CL.stopAt = m.end; v.play().catch(() => {}); v.scrollIntoView({ behavior: "smooth", block: "center" }); });
  $$("[data-mdel]", box).forEach((b) => b.onclick = () => { L.splice(+b.dataset.mdel, 1); clDrawMoments(); });
  clExportLabel();
}

// ------------------------------------------------------------ right: format, background, logo, text, subtitles, music, finish, output
const clDefY = () => CL.o.format === "horizontal" ? 9 : CL.o.format === "square" ? 10 : 12;
const clFam = () => { const f = (CL.fonts || []).find((x) => x.file === CL.o.fontFile); return CL.o.fontFile && !f ? "ClipCustomFont" : f ? f.family : "Arial Black"; };
async function clLoadCustomFont() {
  if (!CL.o.fontFile || (CL.fonts || []).some((x) => x.file === CL.o.fontFile) || CL.customFont === CL.o.fontFile) return;
  try { await snCall("clipsAllow", { file: CL.o.fontFile }); const ff = new FontFace("ClipCustomFont", "url(" + JSON.stringify(clUrl(CL.o.fontFile)) + ")"); await ff.load(); document.fonts.add(ff); CL.customFont = CL.o.fontFile; clPreview(); } catch (e) {}
}
function clDrawSide() {
  const box = $("#clside"); if (!box) return;
  const o = CL.o, c = CL.caps || {}, fonts = CL.fonts || [];
  if (!fonts.some((x) => x.file === o.fontFile) && !o.fontFile && fonts.length) o.fontFile = (fonts.find((x) => x.name === "Arial Black") || fonts[0]).file;
  const radio = (name, val, label, sub) => '<label class="clp-radio"><input type="radio" name="' + name + '" value="' + val + '"' + (o[name] === val ? " checked" : "") + "><span>" + tr(label) + (sub ? ' <small class="dim">' + tr(sub) + "</small>" : "") + "</span></label>";
  const chk = (k, label, dis) => '<label class="clp-chk' + (dis ? " off" : "") + '"><input type="checkbox" data-ck="' + k + '"' + (o[k] && !dis ? " checked" : "") + (dis ? " disabled" : "") + "> <span>" + tr(label) + "</span></label>";
  const sel = (k, opts) => '<select data-sk="' + k + '">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(o[k]) === String(v) ? " selected" : "") + ">" + esc(tr(l)) + "</option>").join("") + "</select>";
  const range = (k, min, max, unit, val) => '<div class="clp-range"><input type="range" data-rk="' + k + '" min="' + min + '" max="' + max + '" value="' + (val != null ? val : o[k]) + '"><span id="clr_' + k + '">' + (val != null ? val : o[k]) + (unit == null ? "%" : unit) + "</span></div>";
  const color = (k, label) => '<label class="clp-color" title="' + esc(tr(label)) + '"><input type="color" data-colk="' + k + '" value="' + esc(o[k]) + '"><span>' + tr(label) + "</span></label>";
  const row = (label, inner) => '<div class="clp-row"><span>' + tr(label) + "</span>" + inner + "</div>";
  const split = o.mode === "split", custom = o.fontFile && !fonts.some((x) => x.file === o.fontFile);
  box.innerHTML = '<div class="clp-prevwrap"><canvas id="clprev" class="clp-prev ' + o.format + '"></canvas></div><div class="small dim" style="text-align:center;margin-top:4px">' + tr("Drag the title in the preview to move it") + "</div>" +
    "<h4>" + tr("Format") + "</h4>" + radio("format", "vertical", "Vertical 9:16", "Shorts, Reels, TikTok") + radio("format", "square", "Square 1:1", "Instagram feed") + radio("format", "horizontal", "Horizontal 16:9", "YouTube") +
    row("Fit", sel("fit", [["blur", "Blurred background"], ["fill", "Fill the screen (crop)"], ["bars", "Background colour"]])) +
    (o.fit === "fill" ? row("Crop", range("cropPos", 0, 100)) + '<div class="small dim clp-hint">' + tr("0 % keeps the left side, 100 % the right side – e.g. to keep a face cam.") + "</div>" : "") +
    (o.fit === "blur" ? row("Picture", range("zoom", 60, 160)) : "") +
    (o.fit === "bars" ? row("Colour", '<div class="clp-swatches">' + ["#000000", "#ffffff", "#7C3AED", "#2563EB", "#DC2626", "#F59E0B", "#16A34A", "#111827"].map((x) => '<button class="clp-sw' + (o.bgColor.toLowerCase() === x.toLowerCase() ? " on" : "") + '" data-bg="' + x + '" style="background:' + x + '" aria-label="' + x + '"></button>').join("") +
      '<input type="color" data-colk="bgColor" value="' + esc(o.bgColor) + '" aria-label="' + esc(tr("Other colour")) + '"></div>') : "") +
    "<h4>" + tr("Logo") + "</h4>" + chk("logoOn", "Add my logo") +
    '<div class="row" style="gap:10px;margin:8px 0"><button class="btn" id="cllogo">' + tr(o.logo ? "Change logo" : "Choose logo (PNG)") + "</button>" + (o.logo ? '<img class="clp-logo" src="' + esc(clUrl(o.logo)) + '" alt=""><span class="small dim sn-jt" style="max-width:120px">' + esc(clName(o.logo)) + "</span>" : "") + "</div>" +
    row("Corner", sel("corner", [["br", "Bottom right"], ["bl", "Bottom left"], ["tr", "Top right"], ["tl", "Top left"], ["tc", "Top centre"], ["bc", "Bottom centre"]])) +
    row("Size", range("logoSize", 4, 40)) + row("Opacity", range("logoOpacity", 10, 100)) +
    "<h4>" + tr("Text") + "</h4>" + chk("titleOn", "Title", !c.drawtext) + '<input class="clp-in" id="cltitle" placeholder="' + esc(tr("e.g. Wait for it…")) + '" value="' + esc(o.title) + '">' +
    chk("numberOn", split ? "Number the parts" : "Number the clips", !c.drawtext) +
    '<div class="clp-row clp-sub"><span></span>' + sel("numberStyle", [["full", partLabel(3, 46)], ["short", (o.partWord || "Part") + " 3"], ["slash", "3/46"]]) + '<input class="clp-in clp-word" data-tk="partWord" value="' + esc(o.partWord || "Part") + '" title="' + esc(tr("The word for part, e.g. Pjesa")) + '"></div>' +
    (split ? chk("nextOn", "Show the next part number at the end (e.g. “Part 4 →”)", !c.drawtext) : "") +
    row("Font", '<select id="clfont">' + fonts.map((x) => '<option value="' + esc(x.file) + '"' + (x.file === o.fontFile ? " selected" : "") + ' style="font-family:' + esc(JSON.stringify(x.family)) + '">' + esc(x.name) + "</option>").join("") +
      (custom ? '<option value="' + esc(o.fontFile) + '" selected>' + esc(clName(o.fontFile)) + "</option>" : "") + '<option value="__pick">' + esc(tr("Other font file…")) + "</option></select>") +
    row("Size", range("titleSize", 40, 250)) +
    '<div class="clp-row"><span>' + tr("Colours") + "</span>" + color("textColor", "Text") + color("outlineColor", "Outline") + "</div>" +
    chk("outline", "Outline around the letters") + chk("titleBox", "Box behind the text") +
    (o.titleBox ? '<div class="clp-row"><span>' + tr("Box") + "</span>" + color("boxColor", "") + range("boxOpacity", 10, 100) + "</div>" : "") +
    row("Sideways", range("titleX", 0, 100)) + row("Height", range("titleY", 0, 100, null, o.titleY == null ? clDefY() : o.titleY)) +
    '<div class="row" style="gap:8px;margin:2px 0 0 94px"><button class="chip" data-tpos="top">' + tr("Top") + '</button><button class="chip" data-tpos="mid">' + tr("Middle") + '</button><button class="chip" data-tpos="bot">' + tr("Bottom") + "</button></div>" +
    "<h4>" + tr("Subtitles") + "</h4>" + chk("subsOn", "Burn in subtitles from an .srt file", !c.subtitles) +
    '<div class="row" style="gap:10px;margin:8px 0"><button class="btn" id="clsrt"' + (c.subtitles ? "" : " disabled") + ">" + tr(o.srt ? "Change .srt" : "Choose .srt") + "</button>" + (o.srt ? '<span class="small dim sn-jt" style="max-width:170px">' + esc(clName(o.srt)) + "</span>" : "") + "</div>" +
    row("Size", sel("subsSize", [["big", "Big"], ["medium", "Medium"]])) + row("Height", range("subsPos", 2, 80, null, o.subsPos == null ? (o.format === "vertical" ? 20 : 8) : o.subsPos)) +
    '<div class="clp-row"><span>' + tr("Colour") + "</span>" + color("subsColor", "Letters") + "</div>" +
    "<h4>" + tr("Music") + "</h4>" + chk("musicOn", "Add music") +
    '<div class="row" style="gap:10px;margin:8px 0"><button class="btn" id="clmusic">' + tr(o.music ? "Change music" : "Choose music") + "</button>" +
      (o.music ? '<button class="sn-nb" id="clmplay" title="' + esc(tr("Listen")) + '">' + (CL.audio && !CL.audio.paused ? "❚❚" : "▶") + '</button><span class="small dim sn-jt" style="max-width:130px" title="' + esc(o.music) + '">' + esc(o.musicName || clName(o.music)) + "</span>" : "") + "</div>" +
    row("Music", range("musicVolume", 0, 100)) + row("Video sound", range("origVolume", 0, 150)) +
    chk("duck", "Lower the music when someone talks") +
    '<div class="clp-row"><span>' + tr("Song from") + '</span><input class="clp-t" id="clmstart" value="' + fmtTime(+o.musicStart || 0) + '"><span class="small dim">' + (o.musicDur ? tr("of") + " " + fmtTime(o.musicDur) + " · " : "") + tr("repeats if the clip is longer") + "</span></div>" +
    "<h4>" + tr("Finish") + "</h4>" + chk("fade", "Fade in and out") + chk("loud", "Louder, even sound for phones") +
    row("Quality", sel("quality", [["1080", "1080p (best)"], ["720", "720p (smaller)"]])) +
    row("Frame rate", sel("fps", [["same", "Same as the video"], ["30", "30 fps"], ["60", "60 fps"]])) +
    "<h4>" + tr("Output") + '</h4><div class="small dim sn-jt" style="margin-bottom:8px">' + esc((o.folder || CL.defFolder || "") + (split && CL.file ? "/" + clName(CL.file).replace(/\.[^.]+$/, "") + "/" : "")) + "</div>" +
    (split ? '<div class="small dim" style="margin:-4px 0 8px">' + esc((o.partWord || "Part") + " 01.mp4, " + (o.partWord || "Part") + " 02.mp4 …") + "</div>" : "") +
    '<div class="row" style="gap:8px"><button class="btn" id="clfolder">' + tr("Choose folder") + "</button>" + (o.folder ? '<button class="btn" id="clfolderdef">' + tr("Default") + "</button>" : "") + "</div>" +
    '<button class="btn clp-primary clp-export" id="clexport"></button>';
  const redraw = () => { clSave(); clDrawSide(); };
  $$('input[type=radio]', box).forEach((r) => r.onchange = () => { o[r.name] = r.value; if (r.name === "format") { o.titleY = null; o.subsPos = null; } redraw(); });
  $$("[data-ck]", box).forEach((x) => x.onchange = async () => { const k = x.dataset.ck; o[k] = x.checked; clSave();
    if (k === "logoOn" && x.checked && !o.logo) return clPickLogo();
    if (k === "subsOn" && x.checked && !o.srt) { const r = await snCall("clipsPickSrt"); if (r && r.file) o.srt = r.file; else o.subsOn = false; return redraw(); }
    if (k === "musicOn" && x.checked && !o.music) return clPickMusic();
    if (k === "titleBox") return redraw();
    clPreview(); });
  $$("[data-sk]", box).forEach((x) => x.onchange = () => { o[x.dataset.sk] = x.value; clSave(); if (x.dataset.sk === "fit") clDrawSide(); else clPreview(); });
  $$("[data-rk]", box).forEach((x) => x.oninput = () => { o[x.dataset.rk] = +x.value; $("#clr_" + x.dataset.rk).textContent = x.value + "%"; clSave(); clPreview(); if (x.dataset.rk === "musicVolume" && CL.audio) CL.audio.volume = Math.min(1, +x.value / 100); });
  $$("[data-colk]", box).forEach((x) => x.oninput = () => { o[x.dataset.colk] = x.value; clSave(); clPreview(); $$("[data-bg]", box).forEach((b) => b.classList.toggle("on", b.dataset.bg.toLowerCase() === o.bgColor.toLowerCase())); });
  $$("[data-bg]", box).forEach((b) => b.onclick = () => { o.bgColor = b.dataset.bg; redraw(); });
  $$("[data-tk]", box).forEach((x) => x.onchange = () => { o[x.dataset.tk] = x.value.trim() || "Part"; redraw(); if (CL.o.mode === "split") clDrawMoments(); });
  $$("[data-tpos]", box).forEach((b) => b.onclick = () => { o.titleY = { top: clDefY(), mid: 50, bot: o.format === "vertical" ? 70 : 82 }[b.dataset.tpos]; o.titleX = 50; redraw(); });
  $("#clfont").onchange = async (e) => { if (e.target.value === "__pick") { const r = await snCall("clipsPickFont"); if (r && r.file) o.fontFile = r.file; redraw(); clLoadCustomFont(); return; } o.fontFile = e.target.value; clSave(); clPreview(); };
  $("#cltitle").oninput = (e) => { o.title = e.target.value; if (e.target.value && !o.titleOn && c.drawtext) { o.titleOn = true; const k = $('[data-ck="titleOn"]', box); if (k) k.checked = true; } clSave(); clPreview(); };
  $("#cllogo").onclick = clPickLogo;
  $("#clsrt").onclick = async () => { const r = await snCall("clipsPickSrt"); if (r && r.file) { o.srt = r.file; o.subsOn = true; redraw(); } };
  $("#clmusic").onclick = clPickMusic;
  const mp = $("#clmplay"); if (mp) mp.onclick = () => { if (CL.audio && !CL.audio.paused) { CL.audio.pause(); mp.textContent = "▶"; return; }
    if (!CL.audio || CL.audio.dataset.src !== o.music) { if (CL.audio) CL.audio.pause(); CL.audio = new Audio(clUrl(o.music)); CL.audio.dataset.src = o.music; CL.audio.onended = () => { const b = $("#clmplay"); if (b) b.textContent = "▶"; }; }
    CL.audio.volume = Math.min(1, o.musicVolume / 100); CL.audio.currentTime = +o.musicStart || 0; CL.audio.play().catch(() => {}); mp.textContent = "❚❚"; };
  $("#clmstart").onchange = (e) => { const v = snParseT(e.target.value); if (v == null) toast("Write the time like 1:05:30"); else o.musicStart = v; e.target.value = fmtTime(+o.musicStart || 0); clSave(); };
  $("#clfolder").onclick = async () => { const r = await snCall("clipsPickFolder"); if (r && r.folder) { o.folder = r.folder; redraw(); } };
  const fd = $("#clfolderdef"); if (fd) fd.onclick = () => { o.folder = ""; redraw(); };
  $("#clexport").onclick = clExport;
  clWirePreview(); CL.logoImg = null; clLoadCustomFont(); clPreview(); clExportLabel();
}
const partLabel = (n, total) => { const o = CL.o, w = String(o.partWord || "Part").trim() || "Part"; return o.numberStyle === "short" ? w + " " + n : o.numberStyle === "slash" ? n + "/" + total : w + " " + n + " / " + total; };
async function clPickLogo() { const r = await snCall("clipsPickLogo"); if (r && r.file) { CL.o.logo = r.file; CL.o.logoOn = true; } else if (!CL.o.logo) CL.o.logoOn = false; clSave(); clDrawSide(); }
async function clPickMusic() { const r = await snCall("clipsPickMusic"); if (r && r.file) Object.assign(CL.o, { music: r.file, musicName: clName(r.file), musicDur: r.duration || 0, musicOn: true, musicStart: 0 }); else if (!CL.o.music) CL.o.musicOn = false; clSave(); clDrawSide(); }
function clExportLabel() { const b = $("#clexport"); if (!b) return; const n = clList().filter((m) => m.on).length, split = CL.o.mode === "split"; b.disabled = !CL.file || !n;
  b.textContent = !CL.file ? tr("Choose a video first") : !n ? tr(split ? "No parts chosen" : "No clips chosen") : tr("Export") + " " + n + " " + tr(split ? (n === 1 ? "part" : "parts") : (n === 1 ? "clip" : "clips")); }
async function clExport() {
  const split = CL.o.mode === "split", L = clList();
  const clips = L.map((m, i) => ({ ...m, n: split ? m.n : i + 1, total: split ? m.total : L.length })).filter((m) => m.on).map((m) => ({ start: m.start, end: m.end, n: m.n, total: m.total, title: m.title || "" }));
  if (!clips.length) return;
  if (CL.o.logoOn && !CL.o.logo) return toast("Choose your logo first");
  if (CL.o.musicOn && !CL.o.music) return toast("Choose the music first");
  if (CL.audio) CL.audio.pause();
  const r = await snCall("clipsExport", { file: CL.file, clips, o: { ...CL.o } });
  if (!r || r.error) return toast((r && r.error) || "Couldn't start the export");
  toast(tr("Exporting") + " " + clips.length + " " + tr(split ? (clips.length === 1 ? "part" : "parts") : (clips.length === 1 ? "clip" : "clips"))); const j = $("#cljobs"); if (j) j.scrollIntoView({ behavior: "smooth" });
}

// ------------------------------------------------------------ live preview: how the clip will look (same layout rules as the export); drag the text to move it
function clPreviewSize() { const o = CL.o; return o.format === "square" ? [360, 360] : o.format === "horizontal" ? [480, 270] : [270, 480]; }
function clWirePreview() {
  const cv = $("#clprev"); if (!cv) return; let drag = false;
  const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)), Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100))]; };
  cv.onpointerdown = (e) => { if (!CL.o.titleOn && !CL.o.numberOn) return; drag = true; cv.setPointerCapture(e.pointerId); const [x, y] = at(e); CL.o.titleX = Math.round(x); CL.o.titleY = Math.round(y); clPreview(); };
  cv.onpointermove = (e) => { if (!drag) return; const [x, y] = at(e); CL.o.titleX = Math.round(x); CL.o.titleY = Math.round(y); clPreview();
    const a = $('[data-rk="titleX"]'), b = $('[data-rk="titleY"]'); if (a) { a.value = CL.o.titleX; $("#clr_titleX").textContent = CL.o.titleX + "%"; } if (b) { b.value = CL.o.titleY; $("#clr_titleY").textContent = CL.o.titleY + "%"; } };
  cv.onpointerup = cv.onpointercancel = () => { if (drag) { drag = false; clSave(); } };
}
function clPreview() {
  const cv = $("#clprev"); if (!cv) return;
  const o = CL.o, [W, H] = clPreviewSize();
  if (cv.width !== W * 2) { cv.width = W * 2; cv.height = H * 2; }
  const g = cv.getContext("2d"); g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = o.fit === "bars" ? o.bgColor : "#0b0f15"; g.fillRect(0, 0, W, H);
  const v = $("#clv"), vw = v && v.videoWidth, vh = v && v.videoHeight;
  const vert = o.format === "vertical";
  if (vw) {
    const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
    try {
      if (o.fit === "fill") { const w = vw * cover, h = vh * cover; g.drawImage(v, (W - w) * (o.cropPos / 100), (H - h) / 2, w, h); }
      else if (o.fit === "bars") { const w = vw * contain, h = vh * contain; g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); }
      else { g.filter = "blur(10px) brightness(0.86) saturate(1.15)"; const w = vw * cover, h = vh * cover; g.drawImage(v, (W - w) / 2 - 10, (H - h) / 2 - 10, w + 20, h + 20); g.filter = "none";
        const z = o.zoom / 100, s = Math.min(W * z / vw, H * z / vh), w2 = vw * s, h2 = vh * s; g.drawImage(v, (W - w2) / 2, (H - h2) / 2, w2, h2); }
    } catch (e) {}
  } else { g.fillStyle = o.fit === "bars" && o.bgColor.toLowerCase() !== "#000000" ? "rgba(0,0,0,.6)" : "#8b97a8"; g.font = "600 13px -apple-system, system-ui"; g.textAlign = "center"; g.fillText(tr(CL.file ? "Preview" : "Choose a video"), W / 2, H / 2); }
  const L = clList(), m = CL.cur && L.includes(CL.cur) ? CL.cur : L.find((x) => x.on), split = o.mode === "split";
  const n = m ? (split ? m.n : L.indexOf(m) + 1) : 1, total = split ? (m ? m.total : 1) : Math.max(1, L.length);
  const font = (size) => "800 " + size + "px " + JSON.stringify(clFam()) + ", Arial, sans-serif";
  const drawLines = (lines, size, X, Y) => {
    g.font = font(size); g.textAlign = "center"; g.textBaseline = "top"; g.lineJoin = "round";
    const pad = W * 0.03, gap = size * 1.22, y0 = Math.max(pad, Math.min(H - pad - lines.length * gap, H * Y / 100 - lines.length * gap / 2));
    lines.forEach((t, k) => { const tw = g.measureText(t).width, x = Math.max(pad + tw / 2, Math.min(W - pad - tw / 2, W * X / 100)), y = y0 + k * gap;
      if (o.titleBox) { g.globalAlpha = o.boxOpacity / 100; g.fillStyle = o.boxColor; g.fillRect(x - tw / 2 - size * 0.3, y - size * 0.3, tw + size * 0.6, size * 1.6); g.globalAlpha = 1; }
      if (o.outline) { g.lineWidth = Math.max(2, size * 0.18); g.strokeStyle = o.outlineColor; g.strokeText(t, x, y); }
      g.fillStyle = o.textColor; g.fillText(t, x, y); });
  };
  const title = [o.titleOn ? ((m && m.title) || o.title) : "", o.numberOn ? partLabel(n, total) : ""].filter(Boolean);
  if (title.length && (CL.caps || {}).drawtext) {
    const size = Math.round(W * (vert ? 0.068 : 0.045) * o.titleSize / 100), maxc = Math.max(8, Math.floor(W * 0.92 / (size * 0.58))), out = [];
    title.forEach((t) => { let l = ""; for (const w of String(t).split(/\s+/)) { if ((l + " " + w).trim().length > maxc && l) { out.push(l); l = w; } else l = (l + " " + w).trim(); } if (l) out.push(l); });
    drawLines(out.slice(0, 5), size, o.titleX, o.titleY == null ? clDefY() : o.titleY);
  }
  if (split && o.nextOn && m && m.n < m.total) { g.globalAlpha = 0.55; drawLines([(o.partWord || "Part") + " " + (m.n + 1) + " →"], Math.round(W * (vert ? 0.06 : 0.04)), 50, vert ? 70 : 78); g.globalAlpha = 1; }
  if (o.subsOn && o.srt) { const size = Math.round(W * (vert ? (o.subsSize === "big" ? 0.065 : 0.05) : 0.04)); g.font = "800 " + size + "px " + JSON.stringify(clFam()) + ", Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    const y = H - H * (o.subsPos == null ? (vert ? 20 : 8) : o.subsPos) / 100; g.lineWidth = size * 0.16; g.strokeStyle = o.outlineColor; g.strokeText(tr("Subtitles appear here"), W / 2, y); g.fillStyle = o.subsColor; g.fillText(tr("Subtitles appear here"), W / 2, y); }
  if (o.logoOn && o.logo) {
    if (!CL.logoImg || CL.logoImg.dataset.src !== o.logo) { const im = new Image(); im.dataset.src = o.logo; im.onload = () => clPreview(); im.src = clUrl(o.logo); CL.logoImg = im; }
    const im = CL.logoImg; if (im.complete && im.naturalWidth) {
      const lw = W * o.logoSize / 100, lh = lw * im.naturalHeight / im.naturalWidth, mg = W * 0.045, top = vert ? H * 0.06 : mg, bot = vert ? H * 0.16 : mg;
      const p = { tl: [mg, top], tr: [W - lw - mg, top], bl: [mg, H - lh - bot], br: [W - lw - mg, H - lh - bot], tc: [(W - lw) / 2, top], bc: [(W - lw) / 2, H - lh - bot] }[o.corner] || [W - lw - mg, H - lh - bot];
      g.globalAlpha = o.logoOpacity / 100; g.drawImage(im, p[0], p[1], lw, lh); g.globalAlpha = 1; }
  }
  if (o.musicOn && o.music) { g.font = "600 11px -apple-system, system-ui"; g.textAlign = "left"; g.textBaseline = "top"; g.fillStyle = "rgba(0,0,0,.55)"; const t = "♪ " + (o.musicName || "").slice(0, 26); const tw = g.measureText(t).width; g.fillRect(6, 6, tw + 12, 20); g.fillStyle = "#fff"; g.fillText(t, 12, 10); }
  if (vert) { g.strokeStyle = "rgba(255,255,255,.18)"; g.setLineDash([4, 4]); g.strokeRect(W * 0.8, H * 0.45, W * 0.17, H * 0.38); g.strokeRect(W * 0.03, H * 0.86, W * 0.74, H * 0.11); g.setLineDash([]); }   // where Shorts / Reels put their buttons and caption
}

// ------------------------------------------------------------ exports
function clDrawJobs() {
  const box = $("#cljobs"); if (!box) return;
  if (!CL.jobs.length) { box.innerHTML = ""; return; }
  const btn = (a, l, j) => '<button class="btn" data-xa="' + a + '" data-xj="' + j.id + '">' + l + "</button>";
  box.innerHTML = '<div class="row" style="margin-top:24px"><h2 style="margin:0">' + tr("Exports") + '</h2></div><div class="list">' + CL.jobs.slice(0, 60).map((j) => { const pct = Math.round((j.progress || 0) * 100);
    const info = [j.state === "exporting" ? tr("Exporting") + " " + pct + "%" : j.state === "queued" ? tr("Waiting") : j.state === "done" ? snSize(j.size) : j.state === "canceled" ? tr("Cancelled") : tr("Failed"),
      fmtTime(j.start) + " – " + fmtTime(j.end), { vertical: "9:16", square: "1:1", horizontal: "16:9" }[j.o.format] || "", tr(j.error || "")].filter(Boolean).join(" · ");
    return '<div class="item sn-job"><div class="sn-jmain"><div class="sn-jt">' + esc(clName(j.out)) + '</div><div class="small dim"' + (j.state === "failed" ? ' style="color:var(--bad)"' : "") + ">" + esc(info) + "</div>" +
      (j.state === "exporting" || j.state === "queued" ? '<div class="prog sn-prog"><i style="width:' + pct + '%"></i></div>' : "") + '</div><div class="row sn-jbtn">' +
      (j.state === "done" ? btn("play", tr("Play"), j) + btn("show", tr("Show in Finder"), j) : "") + (j.state === "exporting" || j.state === "queued" ? btn("stop", tr("Cancel"), j) : btn("del", "✕", j)) + "</div></div>"; }).join("") + "</div>";
  box.onclick = (e) => { const x = e.target.closest("[data-xa]"); if (!x) return; const j = CL.jobs.find((y) => y.id === x.dataset.xj); if (!j) return; const a = x.dataset.xa;
    if (a === "stop") snCall("clipsStop", { id: j.id }); if (a === "del") snCall("clipsRemove", { id: j.id }); if (a === "show") DESK.show(j.out);
    if (a === "play") { snCall("clipsAllow", { file: j.out }).then(() => openPlayer({ kind: "movie", key: "clip:" + j.id, title: clName(j.out), url: clUrl(j.out), localFile: j.out, group: tr("Clips") })); } };
}
