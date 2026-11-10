/* FreeTV web – M3U, Xtream Codes and MAC (Stalker) portals in the browser.
 * Everything is stored on this device only (localStorage + IndexedDB). */
"use strict";

// ============================================================ utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ":" + pad(m) : m) + ":" + pad(s % 60); };
const initials = (n) => String(n || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "TV";

const store = {
  get(k, d) { try { const v = localStorage.getItem("ftv." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ftv." + k, JSON.stringify(v)); } catch (e) { toast("Storage is full – some data was not saved"); } },
  del(k) { try { localStorage.removeItem("ftv." + k); } catch (e) {} },
};

// Big data (channel / movie lists) goes to IndexedDB so the app opens instantly next time.
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("freetv", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode); const q = fn(t.objectStore("kv")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return {
    get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => null),
    clear: () => tx("readwrite", (s) => s.clear()).catch(() => null),
  };
})();

let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = tr(msg); t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4"/></svg>',
  movie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/></svg>',
  series: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M6 3h12"/><path d="m10 11 5 3-5 3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 5-7 7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>',
  starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m6 15 6-6 6 6"/></svg>',
};

// ============================================================ network (direct, or through the relay)
const relay = () => ({ url: (store.get("relayUrl", "") || "").trim().replace(/\/+$/, ""), key: store.get("relayKey", "") || "" });
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function px(url, headers) {
  const r = relay();
  if (!r.url || !url) return url;
  let q = r.url + "/?u=" + encodeURIComponent(url) + "&k=" + encodeURIComponent(r.key);
  if (headers && Object.keys(headers).length) q += "&h=" + b64url(JSON.stringify(headers));
  return q;
}
/** Images: https ones load directly; http ones need the relay on an https page. */
function imgUrl(u) {
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (location.protocol === "https:" && u.startsWith("http:") && relay().url) return px(u);
  return u;
}
async function fetchText(url, { headers, timeout = 45000, forceRelay = false } = {}) {
  const r = relay();
  const viaRelay = !!r.url;
  const target = viaRelay ? px(url, headers) : url;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(target, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status + (res.status === 403 && viaRelay ? " (check the relay key)" : ""));
    if (/\.gz(\?|$)/i.test(url) && window.DecompressionStream) {
      const ds = res.body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(ds).text();
    }
    return await res.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("the server took too long");
    if (!viaRelay && e instanceof TypeError) throw new Error("the browser blocked it – set up the relay in Settings");
    throw e;
  } finally { clearTimeout(t); }
}
async function fetchJSON(url, opts) { const t = await fetchText(url, opts); try { return JSON.parse(t); } catch (e) { throw new Error("the server sent an unexpected answer"); } }

// ============================================================ Albanian detection (Live TV pins these groups on top)
const ALB = (() => {
  const strip = (s) => String(s || "").normalize("NFD").replace(/\p{Mn}+/gu, "").toUpperCase();
  const prefix = /^[\s\W]*(AL|ALB|SHQ|KS|XK|KOS)\s*[|:\-–—▎»/\])•.]/;
  const bracket = /[\[(|]\s*(AL|ALB|SHQ|KS|XK|KOS)\s*[\])|]/;
  const word = /\b(ALB|SHQ|SHQIP)\b/;
  const words = ["ALBANIA", "ALBANIAN", "ALBANIE", "ALBANIEN", "SHQIP", "SHQIPTAR", "SHQIPERI", "KOSOVA", "KOSOVO", "KOSOVE", "TIRANA", "PRISHTINA"];
  const chans = /\b(RTK|RTSH|KLAN|TOP CHANNEL|TOP NEWS|VIZION PLUS|ORA NEWS|DUKAGJINI|ARTMOTION|ALSAT|DIGITALB|TRING|KANAL 10|A2 CNN|SYRI|REPORT TV|KOHA|BALLKAN|T7|21 PLUS)\b/;
  const isName = (n) => { const s = strip(n); return prefix.test(s) || bracket.test(s) || word.test(s) || words.some((w) => s.includes(w)); };
  const isChan = (n) => isName(n) || chans.test(strip(n));
  return {
    isName, isChan,
    groupIsAlb(g, list) { if (isName(g)) return true; const s = (list || []).slice(0, 20); return s.length > 0 && s.filter((c) => isChan(c.name)).length * 2 >= s.length; },
  };
})();

// ============================================================ playlist sources
function parseM3U(text) {
  const live = [], movies = [], series = [];
  let info = null, epg = "";
  const head = text.slice(0, 600).match(/x-tvg-url="([^"]+)"|url-tvg="([^"]+)"/i);
  if (head) epg = (head[1] || head[2]).split(",")[0].trim();
  const lines = text.split(/\r?\n/);
  let opts = {};
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#EXTINF")) {
      const attr = (k) => { const m = l.match(new RegExp(k + '="([^"]*)"', "i")); return m ? m[1] : ""; };
      const c = l.lastIndexOf('",'), comma = c >= 0 ? c + 1 : l.lastIndexOf(",");
      info = { name: (comma >= 0 ? l.slice(comma + 1) : "").trim() || attr("tvg-name") || "Channel", logo: attr("tvg-logo"),
        group: (attr("group-title") || "Other").split(";")[0].trim() || "Other", epgId: attr("tvg-id"), num: +attr("tvg-chno") || 0 };
      opts = {};
    } else if (l.startsWith("#EXTVLCOPT")) {
      const m = l.match(/http-(user-agent|referrer|referer)=(.+)/i);
      if (m) opts[m[1].toLowerCase() === "user-agent" ? "User-Agent" : "Referer"] = m[2].trim();
    } else if (l.startsWith("#EXTGRP:") && info) { info.group = l.slice(8).trim() || info.group; }
    else if (!l.startsWith("#") && info) {
      info.url = l;
      if (Object.keys(opts).length) info.headers = opts;
      const g = info.group.toLowerCase();
      const isFile = /\.(mp4|mkv|avi|mov|m4v|wmv)(\?|$)/i.test(l);
      if (/\/series\//.test(l) || /series|serial|seriale/.test(g) && isFile) series.push(info);
      else if (/\/movie\//.test(l) || isFile || /\b(vod|movie|movies|film|filma)\b/.test(g)) movies.push(info);
      else live.push(info);
      info = null;
    }
  }
  live.forEach((c, i) => { c.id = "m" + i; c.num = c.num || i + 1; });
  movies.forEach((m, i) => { m.id = "v" + i; m.poster = m.logo; });
  // M3U series: group episodes by show name ("Show S01E02")
  const shows = new Map();
  series.forEach((e) => {
    const m = e.name.match(/^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})/i);
    const title = (m ? m[1] : e.name).trim() || e.name;
    if (!shows.has(title)) shows.set(title, { id: "s" + shows.size, name: title, poster: e.logo, group: e.group, episodes: [] });
    shows.get(title).episodes.push({ id: "e" + shows.get(title).episodes.length, title: e.name, season: m ? +m[2] : 1, episode: m ? +m[3] : shows.get(title).episodes.length + 1, url: e.url, image: e.logo });
  });
  return { live, movies, series: [...shows.values()], epgUrl: epg };
}

const Xtream = {
  base(p) { let s = p.server.trim().replace(/\/+$/, ""); if (!/^https?:\/\//i.test(s)) s = "http://" + s; return s.replace(/\/(player_api|get)\.php.*$/i, ""); },
  api(p, action, extra = "") { return this.base(p) + "/player_api.php?username=" + encodeURIComponent(p.user) + "&password=" + encodeURIComponent(p.pass) + (action ? "&action=" + action : "") + extra; },
  async account(p) { return fetchJSON(this.api(p, "")); },
  async load(p, progress) {
    progress("Loading channels…");
    const [lc, ls] = await Promise.all([fetchJSON(this.api(p, "get_live_categories")), fetchJSON(this.api(p, "get_live_streams"), { timeout: 120000 })]);
    const catName = new Map((lc || []).map((c) => [String(c.category_id), c.category_name]));
    const fmt = store.get("liveFmt", "m3u8");
    const live = (ls || []).map((s, i) => ({ id: "x" + s.stream_id, sid: s.stream_id, name: s.name, logo: s.stream_icon, group: catName.get(String(s.category_id)) || "Other",
      num: +s.num || i + 1, epgId: s.epg_channel_id, url: this.base(p) + "/live/" + p.user + "/" + p.pass + "/" + s.stream_id + "." + fmt, archive: +s.tv_archive || 0 }));
    return { live, movies: null, series: null };
  },
  async loadVod(p, progress) {
    progress("Loading movies & series…");
    const [vc, vs, sc, ss] = await Promise.all([
      fetchJSON(this.api(p, "get_vod_categories")).catch(() => []), fetchJSON(this.api(p, "get_vod_streams"), { timeout: 240000 }).catch(() => []),
      fetchJSON(this.api(p, "get_series_categories")).catch(() => []), fetchJSON(this.api(p, "get_series"), { timeout: 240000 }).catch(() => []),
    ]);
    const vcat = new Map((vc || []).map((c) => [String(c.category_id), c.category_name]));
    const scat = new Map((sc || []).map((c) => [String(c.category_id), c.category_name]));
    const movies = (Array.isArray(vs) ? vs : []).map((v) => ({ id: "xm" + v.stream_id, sid: v.stream_id, name: v.name, poster: v.stream_icon, group: vcat.get(String(v.category_id)) || "Other",
      rating: +v.rating || 0, added: +v.added || 0, ext: v.container_extension || "mp4" }));
    const series = (Array.isArray(ss) ? ss : []).map((s) => ({ id: "xs" + s.series_id, sid: s.series_id, name: s.name, poster: s.cover, group: scat.get(String(s.category_id)) || "Other",
      rating: +s.rating || 0, added: +s.last_modified || 0, plot: s.plot, genre: s.genre, year: s.releaseDate || s.release_date }));
    return { movies, series };
  },
  movieUrl(p, m) { return this.base(p) + "/movie/" + p.user + "/" + p.pass + "/" + m.sid + "." + (m.ext || "mp4"); },
  async movieInfo(p, m) { const j = await fetchJSON(this.api(p, "get_vod_info", "&vod_id=" + m.sid)); return j && j.info || {}; },
  async seriesInfo(p, s) {
    const j = await fetchJSON(this.api(p, "get_series_info", "&series_id=" + s.sid));
    const eps = [];
    for (const [season, list] of Object.entries(j.episodes || {})) for (const e of list) eps.push({ id: "xe" + e.id, title: e.title, season: +season, episode: +e.episode_num,
      url: this.base(p) + "/series/" + p.user + "/" + p.pass + "/" + e.id + "." + (e.container_extension || "mp4"), image: e.info && e.info.movie_image, plot: e.info && e.info.plot, dur: e.info && e.info.duration_secs });
    return { info: j.info || {}, episodes: eps };
  },
  async shortEpg(p, ch) {
    const j = await fetchJSON(this.api(p, "get_short_epg", "&stream_id=" + ch.sid + "&limit=6"), { timeout: 15000 });
    const dec = (s) => { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; } };
    return (j.epg_listings || []).map((e) => ({ s: (+e.start_timestamp) * 1000, e: (+e.stop_timestamp) * 1000, t: dec(e.title), d: dec(e.description) }));
  },
};

/** MAC / Stalker middleware portals. They need cookies, so they only work through the relay. */
class Stalker {
  constructor(p) { this.p = p; this.token = ""; this.endpoint = ""; }
  get mac() { return this.p.mac.trim().toUpperCase(); }
  headers() {
    const h = { "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi", Cookie: "mac=" + encodeURIComponent(this.mac) + "; stb_lang=en; timezone=Europe%2FBelgrade", Referer: this.base() + "/c/" };
    if (this.token) h.Authorization = "Bearer " + this.token;
    return h;
  }
  base() { let s = this.p.portal.trim().replace(/\/+$/, ""); if (!/^https?:\/\//i.test(s)) s = "http://" + s; return s.replace(/\/c$/i, "").replace(/\/(portal|server\/load)\.php.*$/i, ""); }
  async call(q) {
    if (!relay().url) throw new Error("MAC portals need the relay – set it up in Settings");
    const j = await fetchJSON(this.endpoint + "?" + q + "&JsHttpRequest=1-xml", { headers: this.headers(), timeout: 60000 });
    return j && j.js;
  }
  async connect() {
    const b = this.base();
    const cands = [b + "/portal.php", b + "/server/load.php", b + "/stalker_portal/server/load.php"];
    let lastErr;
    for (const c of cands) {
      try { this.endpoint = c; this.token = ""; const js = await this.call("type=stb&action=handshake&token="); if (js && js.token) { this.token = js.token; break; } }
      catch (e) { lastErr = e; }
    }
    if (!this.token) throw lastErr || new Error("the portal didn't accept this MAC address");
    await this.call("type=stb&action=get_profile&hd=1&ver=ImageDescription%3A%200.2.18-r23-250&num_banks=2&sn=&stb_type=MAG250&image_version=218&video_out=hdmi&device_id=&device_id2=&signature=&auth_second_step=1&hw_version=1.7-BD-00&not_valid_token=0").catch(() => null);
  }
  async load(progress) {
    progress("Connecting to portal…");
    await this.connect();
    progress("Loading channels…");
    const genres = await this.call("type=itv&action=get_genres") || [];
    const gname = new Map(genres.map((g) => [String(g.id), g.title]));
    const all = await this.call("type=itv&action=get_all_channels");
    const data = (all && all.data) || [];
    const live = data.map((c, i) => ({ id: "k" + c.id, sid: c.id, name: c.name, logo: c.logo, group: gname.get(String(c.tv_genre_id)) || "Other", num: +c.number || i + 1, cmd: c.cmd }));
    const vcats = await this.call("type=vod&action=get_categories").catch(() => []) || [];
    return { live, vodCats: vcats.filter((c) => c.id !== "*").map((c) => ({ id: c.id, title: c.title })) };
  }
  async link(type, cmd, extra = "") {
    if (!this.token) await this.connect();
    const js = await this.call("type=" + type + "&action=create_link&cmd=" + encodeURIComponent(cmd) + extra + "&forced_storage=undefined&disable_ad=0");
    let u = (js && js.cmd) || cmd;
    return u.replace(/^(ffmpeg|auto|ffrt\d?)\s+/i, "").trim();
  }
  async vodPage(cat, page) {
    if (!this.token) await this.connect();
    const js = await this.call("type=vod&action=get_ordered_list&category=" + encodeURIComponent(cat) + "&p=" + page + "&sortby=added");
    return { items: ((js && js.data) || []).map((v) => ({ id: "kv" + v.id, sid: v.id, name: v.name, poster: v.screenshot_uri, cmd: v.cmd, isSeries: v.is_series == 1, plot: v.description, year: v.year, rating: +v.rating_imdb || 0 })),
      total: +(js && js.total_items) || 0, per: +(js && js.max_page_items) || 14 };
  }
  async seasons(movieId) {
    const js = await this.call("type=vod&action=get_ordered_list&movie_id=" + movieId + "&season_id=0&episode_id=0");
    return ((js && js.data) || []).map((s) => ({ name: s.name, cmd: s.cmd, eps: (s.series || []).map(Number) }));
  }
  async shortEpg(ch) {
    const js = await this.call("type=itv&action=get_short_epg&ch_id=" + ch.sid + "&size=5").catch(() => null);
    return (Array.isArray(js) ? js : []).map((e) => ({ s: (+e.start_timestamp) * 1000, e: (+e.stop_timestamp) * 1000, t: e.name, d: e.descr }));
  }
}

/** XMLTV guide for M3U playlists – keeps only programmes around now to stay light on phones. */
async function loadXmltv(url, live) {
  const text = await fetchText(url, { timeout: 120000 });
  const want = new Map();
  live.forEach((c) => { if (c.epgId) want.set(c.epgId.toLowerCase(), c.id); want.set("n:" + c.name.toLowerCase(), c.id); });
  const names = new Map();
  for (const m of text.matchAll(/<channel id="([^"]+)">([\s\S]*?)<\/channel>/g)) {
    const dn = (m[2].match(/<display-name[^>]*>([^<]+)</) || [])[1];
    if (dn) names.set(m[1].toLowerCase(), dn.toLowerCase());
  }
  const parseT = (s) => { const m = s.match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-]\d{4})?/); if (!m) return 0;
    const tz = m[7] ? (m[7][0] === "-" ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) : 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - tz * 60000; };
  const from = Date.now() - 3 * 3600e3, to = Date.now() + 30 * 3600e3;
  const out = {};
  const unx = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  for (const m of text.matchAll(/<programme start="([^"]+)" stop="([^"]+)" channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g)) {
    const s = parseT(m[1]), e = parseT(m[2]);
    if (e < from || s > to) continue;
    const key = m[3].toLowerCase();
    const cid = want.get(key) || (names.has(key) && want.get("n:" + names.get(key)));
    if (!cid) continue;
    const t = (m[4].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
    const d = (m[4].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || "";
    (out[cid] = out[cid] || []).push({ s, e, t: unx(t), d: unx(d) });
  }
  for (const k in out) out[k].sort((a, b) => a.s - b.s);
  return out;
}

// ============================================================ state
const S = {
  playlists: store.get("playlists", []),
  activeId: store.get("active", null),
  live: [], movies: [], series: [], groups: [], albGroups: new Set(), byGroup: new Map(),
  vodCats: null, vodLoaded: false, vodLoading: false, vodError: "",
  loading: false, error: "", progress: "",
  epg: {}, epgShort: new Map(),
  tab: store.get("tab", "home"),
  liveGroup: null, groupChosen: false,
  account: null, stalker: null,
};
const active = () => S.playlists.find((p) => p.id === S.activeId) || null;
const favKey = () => "fav." + (S.activeId || "none");
const favs = () => new Set(store.get(favKey(), []));
const isFav = (k) => favs().has(k);
function toggleFav(k) { const f = favs(); f.has(k) ? f.delete(k) : f.add(k); store.set(favKey(), [...f]); return f.has(k); }
const positions = () => store.get("pos", {});
function savePos(key, t, d, meta) { const p = positions(); if (d > 0 && t / d > 0.95) delete p[key]; else p[key] = { t, d, at: Date.now(), ...meta }; store.set("pos", p); }
function addRecent(id) { const k = "recent." + S.activeId; const r = store.get(k, []).filter((x) => x !== id); r.unshift(id); store.set(k, r.slice(0, 20)); }

function indexLive() {
  S.byGroup = new Map();
  for (const c of S.live) { if (!S.byGroup.has(c.group)) S.byGroup.set(c.group, []); S.byGroup.get(c.group).push(c); }
  const gs = [...S.byGroup.keys()];
  S.albGroups = new Set(gs.filter((g) => ALB.groupIsAlb(g, S.byGroup.get(g))));
  S.groups = [...gs.filter((g) => S.albGroups.has(g)), ...gs.filter((g) => !S.albGroups.has(g))];
  if (!S.groupChosen || !S.byGroup.has(S.liveGroup)) S.liveGroup = S.groups.find((g) => S.albGroups.has(g)) || "__all";
}

async function loadActive(force = false) {
  const p = active();
  S.live = []; S.movies = []; S.series = []; S.vodLoaded = false; S.vodCats = null; S.epg = {}; S.epgShort.clear(); S.account = null; S.stalker = null; S.error = "";
  S.groupChosen = !!store.get("group." + S.activeId, null); S.liveGroup = store.get("group." + S.activeId, null);
  if (!p) { render(); return; }
  const cacheKey = "content." + p.id;
  S.loading = true; S.progress = tr("Loading…"); render();
  const cached = force ? null : await Promise.race([idb.get(cacheKey), sleep(2500).then(() => null)]);
  S.loading = false;
  if (cached) {
    Object.assign(S, { live: cached.live || [], movies: cached.movies || [], series: cached.series || [], vodLoaded: !!cached.vodLoaded, vodCats: cached.vodCats || null });
    indexLive(); render();
    S.epg = (await idb.get("epg." + p.id)) || {};
  }
  const age = cached ? Date.now() - (cached.at || 0) : Infinity;
  if (!force && age < 8 * 3600e3) { afterLoad(p); return; }
  S.loading = !cached; S.progress = tr("Loading…"); render();
  try {
    const prog = (m) => { S.progress = tr(m); if (S.loading) render(); };
    let data;
    if (p.type === "m3u") {
      prog("Loading playlist…");
      const text = p.url ? await fetchText(p.url, { timeout: 180000 }) : (p.fileText || await idb.get("file." + p.id) || "");
      const r = parseM3U(text);
      data = { live: r.live, movies: r.movies, series: r.series, vodLoaded: true };
      if (!p.epg && r.epgUrl) { p.epg = r.epgUrl; savePlaylists(); }
    } else if (p.type === "xtream") {
      const r = await Xtream.load(p, prog);
      data = { live: r.live, movies: S.movies, series: S.series, vodLoaded: S.vodLoaded };
    } else {
      S.stalker = new Stalker(p);
      const r = await S.stalker.load(prog);
      data = { live: r.live, movies: [], series: [], vodCats: r.vodCats, vodLoaded: true };
    }
    Object.assign(S, data);
    indexLive();
    S.loading = false; render();
    idb.set(cacheKey, { ...data, at: Date.now() });
    if (p.type === "xtream") loadXtreamVod(p, true);
  } catch (e) {
    S.loading = false;
    if (!cached) S.error = tr("Couldn't load") + ": " + e.message; else toast(tr("Couldn't load") + ": " + e.message);
    render();
  }
  afterLoad(p);
}
function afterLoad(p) {
  if (p.type === "xtream") {
    Xtream.account(p).then((a) => { S.account = a && a.user_info; if (S.tab === "home" || S.tab === "settings") render(); }).catch(() => {});
    if (!S.vodLoaded) loadXtreamVod(p, false);
  }
  if (p.epg && !Object.keys(S.epg).length) {
    loadXmltv(p.epg, S.live).then((g) => { S.epg = g; idb.set("epg." + p.id, g); if (S.tab === "live") render(); }).catch(() => {});
  }
}
async function loadXtreamVod(p, refresh) {
  if (S.vodLoading) return;
  S.vodLoading = true; S.vodError = "";
  if (S.tab === "movies" || S.tab === "series") render();
  try {
    const r = await Xtream.loadVod(p, () => {});
    if (p.id !== S.activeId) return;
    S.movies = r.movies; S.series = r.series; S.vodLoaded = true;
    const c = await idb.get("content." + p.id);
    idb.set("content." + p.id, { ...(c || { live: S.live }), movies: r.movies, series: r.series, vodLoaded: true, at: (c && c.at) || Date.now() });
  } catch (e) { S.vodError = e.message; }
  S.vodLoading = false;
  if (S.tab === "movies" || S.tab === "series" || S.tab === "search") render();
}
/** Playlist details go to localStorage; an opened M3U file can be large, so its text goes to IndexedDB. */
function savePlaylists() {
  store.set("playlists", S.playlists.map((p) => { const { fileText, ...rest } = p; if (fileText) { idb.set("file." + p.id, fileText); rest.hasFile = true; } return rest; }));
}

// now/next for a channel
function nowNext(c) {
  const list = S.epg[c.id] || S.epgShort.get(c.id) || [];
  const now = Date.now();
  const i = list.findIndex((x) => x.s <= now && x.e > now);
  return { now: i >= 0 ? list[i] : null, next: i >= 0 ? list[i + 1] : list.find((x) => x.s > now) || null, list };
}
const epgQueue = []; let epgBusy = 0;
function wantShortEpg(c) {
  const p = active(); if (!p || p.type === "m3u" || S.epgShort.has(c.id)) return;
  S.epgShort.set(c.id, []); epgQueue.push(c); pumpEpg();
}
async function pumpEpg() {
  while (epgBusy < 3 && epgQueue.length) {
    const c = epgQueue.shift(); epgBusy++;
    const p = active();
    (p.type === "xtream" ? Xtream.shortEpg(p, c) : S.stalker ? S.stalker.shortEpg(c) : Promise.resolve([]))
      .then((l) => { S.epgShort.set(c.id, l); updateEpgRow(c); }).catch(() => {}).finally(() => { epgBusy--; pumpEpg(); });
  }
}
function updateEpgRow(c) {
  const row = document.querySelector('.ch[data-id="' + CSS.escape(c.id) + '"] .np'); if (!row) return;
  const { now } = nowNext(c);
  row.innerHTML = now ? esc(clock(now.s) + " " + now.t) + '<div class="prog"><i style="width:' + Math.round((Date.now() - now.s) / (now.e - now.s) * 100) + '%"></i></div>' : "";
}

// ============================================================ rendering
const TABS = [["home", "Home", I.home], ["live", "Live TV", I.live], ["movies", "Movies", I.movie], ["series", "Series", I.series], ["search", "Search", I.search], ["settings", "Settings", I.settings]];
function renderNav() {
  const b = TABS.map(([k, l, ic]) => '<button data-tab="' + k + '" class="' + (S.tab === k ? "on" : "") + '">' + ic + "<span>" + tr(l) + "</span></button>").join("");
  $("#tabs").innerHTML = b;
  $("#rail").innerHTML = '<img class="logo" src="logo.png" alt="freetv">' + b;
  $$("[data-tab]").forEach((x) => x.onclick = () => go(x.dataset.tab));
}
function go(tab) { S.tab = tab; store.set("tab", tab); S.detail = null; render(); $("#view").scrollTop = 0; }
function render() {
  renderNav();
  const v = $("#view");
  if (S.detail) return renderDetail(v);
  const p = active();
  if (!p && S.tab !== "settings") { v.innerHTML = '<div class="empty"><img src="logo.png" style="width:180px"><h2>' + tr("No playlist yet") + "</h2><p>" + tr("Add your M3U, Xtream or MAC portal to start watching.") +
    '</p><button class="btn primary" id="addPl">' + tr("Add playlist") + "</button></div>"; $("#addPl").onclick = () => editPlaylist(); return; }
  if (S.loading && S.tab !== "settings") { v.innerHTML = '<div class="empty"><div class="spinner"></div>' + esc(S.progress) + "</div>"; return; }
  if (S.error && S.tab !== "settings") { v.innerHTML = '<div class="empty">' + esc(S.error) + '<br><br><button class="btn" id="retry">' + tr("Try again") + '</button> <button class="btn" id="toSet">' + tr("Settings") + "</button></div>";
    $("#retry").onclick = () => loadActive(true); $("#toSet").onclick = () => go("settings"); return; }
  ({ home: renderHome, live: renderLive, movies: (v) => renderVod(v, "movies"), series: (v) => renderVod(v, "series"), search: renderSearch, settings: renderSettings }[S.tab] || renderHome)(v);
}

function logoHtml(src, name, cover) {
  return src ? '<img loading="lazy" referrerpolicy="no-referrer" class="' + (cover ? "cover" : "") + '" src="' + esc(imgUrl(src)) + '" alt="" onerror="this.outerHTML=\'<span class=ph>' + esc(initials(name)) + '</span>\'">'
    : '<span class="ph">' + esc(initials(name)) + "</span>";
}
function chTile(c, cur) {
  const { now } = nowNext(c);
  return '<button class="tile' + (cur ? " cur" : "") + '" data-ch="' + esc(c.id) + '"><div class="th">' + logoHtml(c.logo, c.name) + '</div><div class="nm">' + esc(c.name) + '</div><div class="sub">' + esc(cur ? tr("Now watching") : now ? now.t : c.group) + "</div></button>";
}
function posterCard(it, kind) {
  const pos = positions()[(kind === "series" ? "s:" : "m:") + it.id];
  return '<button class="card" data-' + kind + '="' + esc(it.id) + '"><div class="pi">' + (it.poster ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(imgUrl(it.poster)) + '" alt="" onerror="this.outerHTML=\'<span class=ph>' + esc(it.name) + '</span>\'">' : '<span class="ph">' + esc(it.name) + "</span>") +
    "</div>" + (it.rating ? '<span class="rt">★ ' + (+it.rating).toFixed(1) + "</span>" : "") + (pos && pos.d ? '<div class="bar"><i style="width:' + Math.round(pos.t / pos.d * 100) + '%"></i></div>' : "") + '<div class="nm">' + esc(it.name) + "</div></button>";
}
function bindCards(root) {
  $$("[data-ch]", root).forEach((b) => b.onclick = () => { const c = S.live.find((x) => x.id === b.dataset.ch); if (c) playChannel(c, S.byGroup.get(c.group) || S.live); });
  $$("[data-movies]", root).forEach((b) => b.onclick = () => openDetail("movies", b.dataset.movies));
  $$("[data-series]", root).forEach((b) => b.onclick = () => openDetail("series", b.dataset.series));
}

// ---------------- Home
function renderHome(v) {
  const h = new Date().getHours();
  const greet = tr(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  const f = favs();
  const favCh = S.live.filter((c) => f.has("c:" + c.id));
  const recent = store.get("recent." + S.activeId, []).map((id) => S.live.find((c) => c.id === id)).filter(Boolean);
  const pos = positions();
  const cont = Object.entries(pos).filter(([k, x]) => x.pl === S.activeId).sort((a, b) => b[1].at - a[1].at).slice(0, 20);
  const last = recent[0];
  let exp = "";
  if (S.account && S.account.exp_date) { const days = Math.ceil((S.account.exp_date * 1000 - Date.now()) / 864e5);
    exp = '<div class="small ' + (days < 7 ? "" : "dim") + '" style="' + (days < 7 ? "color:var(--fav)" : "") + '">' + tr("Subscription") + ": " + days + " " + tr("days left") + "</div>"; }
  v.innerHTML = '<div class="row" style="margin-bottom:14px"><img class="hlogo" src="logo.png" alt="freetv"><span class="sp"></span>' + exp + "</div>" +
    '<div class="hero"><div class="glass clock"><div class="dim">' + greet + '</div><div class="t" id="hclock">' + clock(Date.now()) + "</div><div>" + new Date().toLocaleDateString(LANG === "sq" ? "sq" : "en-GB", { weekday: "long", day: "numeric", month: "long" }) + "</div></div>" +
    (last ? '<div class="glass cont"><div class="small dim">' + tr("Recently watched").toUpperCase() + '</div><div class="row"><div class="ch" style="background:none;border:0;padding:0"><div class="lg">' + logoHtml(last.logo, last.name) + '</div><div class="tx"><div class="nm">' + esc(last.name) + '</div><div class="np">' + esc(last.group) + '</div></div></div></div><button class="btn primary" data-ch="' + esc(last.id) + '">' + I.play + tr("Watch") + "</button></div>" : "") + "</div>" +
    (cont.length ? "<h2>" + tr("Continue watching") + '</h2><div class="rowscroll posterrow" id="contRow">' + cont.map(([k, x]) => '<button class="card" data-cont="' + esc(k) + '"><div class="pi">' + (x.poster ? '<img loading="lazy" src="' + esc(imgUrl(x.poster)) + '" alt="">' : '<span class="ph">' + esc(x.title) + "</span>") + '</div><div class="bar"><i style="width:' + Math.round(x.t / x.d * 100) + '%"></i></div><div class="nm">' + esc(x.title) + "</div></button>").join("") + "</div>" : "") +
    (favCh.length ? "<h2>" + tr("Favourites") + '</h2><div class="rowscroll">' + favCh.map((c) => chTile(c)).join("") + "</div>" : "") +
    (recent.length ? "<h2>" + tr("Recently watched") + '</h2><div class="rowscroll">' + recent.slice(0, 12).map((c) => chTile(c)).join("") + "</div>" : "");
  bindCards(v);
  $$("[data-cont]", v).forEach((b) => b.onclick = () => resumeFromHome(b.dataset.cont));
}
function resumeFromHome(key) {
  const x = positions()[key]; if (!x) return;
  if (x.kind === "movie") { const m = S.movies.find((m) => m.id === x.ref); if (m) return playMovie(m); }
  if (x.kind === "episode" && x.url) return openPlayer({ kind: "episode", key, title: x.title, poster: x.poster, url: x.url, group: x.group || "" });
  toast("Nothing here yet");
}

// ---------------- Live TV
let liveFilter = "";
function renderLive(v) {
  const f = favs();
  const recent = store.get("recent." + S.activeId, []);
  const groupList = [["__all", tr("All"), S.live.length], ["__fav", "★ " + tr("Favourites"), [...f].filter((k) => k.startsWith("c:")).length], ["__recent", tr("Recent"), recent.length],
    ...S.groups.map((g) => [g, (S.albGroups.has(g) ? "🇦🇱 " : "") + g, S.byGroup.get(g).length])];
  const g = S.liveGroup || "__all";
  let list = g === "__all" ? S.live : g === "__fav" ? S.live.filter((c) => f.has("c:" + c.id)) : g === "__recent" ? recent.map((id) => S.live.find((c) => c.id === id)).filter(Boolean) : (S.byGroup.get(g) || []);
  if (liveFilter) { const q = liveFilter.toLowerCase(); list = list.filter((c) => c.name.toLowerCase().includes(q)); }
  v.innerHTML = '<div class="row"><h1>' + tr("Live TV") + '</h1><span class="sp"></span><span class="dim small">' + list.length + " " + tr("channels") + "</span></div>" +
    '<input class="search" id="lq" type="search" placeholder="' + tr("Search") + '" value="' + esc(liveFilter) + '" style="margin-bottom:10px">' +
    '<div class="chips" id="gchips">' + groupList.map(([k, l, n]) => '<button class="chip ' + (k === g ? "on" : "") + '" data-g="' + esc(k) + '">' + esc(l) + '<span class="n">' + n + "</span></button>").join("") + "</div>" +
    '<div class="chlist" id="chl"></div><div id="more" style="height:40px"></div>';
  $$("[data-g]", v).forEach((b) => b.onclick = () => { S.liveGroup = b.dataset.g; S.groupChosen = true; store.set("group." + S.activeId, S.liveGroup); renderLive(v); });
  const on = $("#gchips .on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
  $("#lq").oninput = (e) => { liveFilter = e.target.value; const pos = e.target.selectionStart; renderLive(v); const q = $("#lq"); q.focus(); q.setSelectionRange(pos, pos); };
  incremental($("#chl"), $("#more"), list, (c) => {
    const { now } = nowNext(c); const fv = f.has("c:" + c.id);
    return '<div class="ch" data-id="' + esc(c.id) + '"><span class="num">' + c.num + '</span><div class="lg">' + logoHtml(c.logo, c.name) + '</div><div class="tx"><div class="nm">' + esc(c.name) + '</div><div class="np">' +
      (now ? esc(clock(now.s) + " " + now.t) + '<div class="prog"><i style="width:' + Math.round((Date.now() - now.s) / (now.e - now.s) * 100) + '%"></i></div>' : "") + '</div></div><button class="star ' + (fv ? "on" : "") + '" data-star>' + (fv ? "★" : "☆") + "</button></div>";
  }, (row, c) => {
    row.onclick = (e) => { if (e.target.closest("[data-star]")) { const on = toggleFav("c:" + c.id); e.target.textContent = on ? "★" : "☆"; e.target.classList.toggle("on", on); return; } playChannel(c, list); };
    wantShortEpg(c);
  });
}
/** Renders long lists in chunks as you scroll (50 000 movies stay smooth on a phone). */
function incremental(box, sentinel, list, html, bind, chunk = 80) {
  let i = 0;
  const step = () => {
    const part = list.slice(i, i + chunk); if (!part.length) return;
    const tmp = document.createElement("div"); tmp.innerHTML = part.map(html).join("");
    const kids = Array.from(tmp.children);
    kids.forEach((k, j) => { box.appendChild(k); if (bind) bind(k, part[j]); });
    i += chunk;
  };
  step();
  if (box._io) box._io.disconnect();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) step(); }, { root: $("#view"), rootMargin: "800px" });
  io.observe(sentinel); box._io = io;
}

// ---------------- Movies & Series
const vodSel = { movies: "b:all", series: "b:all" };
let stalkerVod = { cat: null, items: [], page: 0, total: 0, loading: false };
function renderVod(v, kind) {
  const p = active();
  if (p.type === "mac") return renderStalkerVod(v, kind);
  const all = kind === "movies" ? S.movies : S.series;
  if (!S.vodLoaded && (S.vodLoading || p.type === "xtream")) { v.innerHTML = "<h1>" + tr(kind === "movies" ? "Movies" : "Series") + '</h1><div class="empty"><div class="spinner"></div>' + tr("Loading…") + "</div>"; if (!S.vodLoading) loadXtreamVod(p); return; }
  if (S.vodError && !all.length) { v.innerHTML = "<h1>" + tr(kind === "movies" ? "Movies" : "Series") + '</h1><div class="empty">' + esc(tr("Couldn't load") + ": " + S.vodError) + '<br><br><button class="btn" id="rv">' + tr("Try again") + "</button></div>"; $("#rv").onclick = () => { S.vodLoaded = false; loadXtreamVod(p); }; return; }
  const f = favs(), pre = kind === "movies" ? "m:" : "s:";
  const groups = new Map(); all.forEach((x) => groups.set(x.group, (groups.get(x.group) || 0) + 1));
  const pos = positions();
  const entries = [["hd", tr("BROWSE")], ["b:all", tr("All"), all.length], ["b:recent", tr("Recently added")], ["b:mylist", tr("My list")]];
  if (kind === "movies") entries.push(["b:resume", tr("Continue watching")]);
  entries.push(["hd", tr("CATEGORIES")], ...[...groups].map(([g, n]) => ["g:" + g, g, n]));
  const sel = vodSel[kind];
  let list = sel === "b:all" ? all : sel === "b:recent" ? [...all].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 300)
    : sel === "b:mylist" ? all.filter((x) => f.has(pre + x.id)) : sel === "b:resume" ? all.filter((x) => pos["m:" + x.id]) : all.filter((x) => x.group === sel.slice(2));
  const label = (entries.find((e) => e[0] === sel) || [0, tr("All")])[1];
  v.innerHTML = "<h1>" + tr(kind === "movies" ? "Movies" : "Series") + '</h1><div class="vodlayout"><div class="vodside glass">' +
    entries.map((e) => e[0] === "hd" ? '<div class="hd">' + e[1] + "</div>" : '<button data-sel="' + esc(e[0]) + '" class="' + (e[0] === sel ? "on" : "") + '">' + esc(e[1]) + (e[2] != null ? '<span class="n">' + e[2] + "</span>" : "") + "</button>").join("") +
    '</div><div><div class="chips vodchips">' + entries.filter((e) => e[0] !== "hd").map((e) => '<button class="chip ' + (e[0] === sel ? "on" : "") + '" data-sel="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>" +
    '<div class="row" style="margin:4px 0 12px"><b style="font-size:18px">' + esc(label) + '</b><span class="sp"></span><span class="dim small">' + list.length + " " + tr("titles") + "</span></div>" +
    (list.length ? '<div class="posters" id="pg"></div><div id="more" style="height:40px"></div>' : '<div class="empty">' + tr("Nothing here yet") + "</div>") + "</div></div>";
  $$("[data-sel]", v).forEach((b) => b.onclick = () => { vodSel[kind] = b.dataset.sel; renderVod(v, kind); $("#view").scrollTop = 0; });
  const on = $(".vodchips .on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
  if (list.length) incremental($("#pg"), $("#more"), list, (x) => posterCard(x, kind), (el, x) => { el.onclick = () => openDetail(kind, x.id); }, 60);
}
async function renderStalkerVod(v, kind) {
  const cats = S.vodCats || [];
  if (kind === "series") { v.innerHTML = "<h1>" + tr("Series") + '</h1><div class="empty">' + tr("On MAC portals, series are listed inside Movies.") + "</div>"; return; }
  if (!stalkerVod.cat && cats.length) stalkerVod.cat = cats[0].id;
  v.innerHTML = "<h1>" + tr("Movies") + '</h1><div class="chips">' + cats.map((c) => '<button class="chip ' + (c.id === stalkerVod.cat ? "on" : "") + '" data-c="' + esc(c.id) + '">' + esc(c.title) + "</button>").join("") + '</div><div class="posters" id="pg"></div><div id="more" style="height:60px"></div>';
  $$("[data-c]", v).forEach((b) => b.onclick = () => { stalkerVod = { cat: b.dataset.c, items: [], page: 0, total: 0, loading: false }; renderStalkerVod(v, kind); });
  const box = $("#pg");
  const show = (items) => { const t = document.createElement("div"); t.innerHTML = items.map((x) => posterCard(x, "kvod")).join(""); Array.from(t.children).forEach((el, i) => { el.onclick = () => openStalkerItem(items[i]); box.appendChild(el); }); };
  show(stalkerVod.items);
  const more = async () => {
    if (stalkerVod.loading || (stalkerVod.page && stalkerVod.items.length >= stalkerVod.total)) return;
    stalkerVod.loading = true;
    try { const r = await S.stalker.vodPage(stalkerVod.cat, stalkerVod.page + 1); stalkerVod.page++; stalkerVod.total = r.total; stalkerVod.items.push(...r.items); if (S.tab === "movies") show(r.items); }
    catch (e) { toast(tr("Couldn't load") + ": " + e.message); }
    stalkerVod.loading = false;
  };
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { root: $("#view"), rootMargin: "600px" });
  io.observe($("#more"));
}
async function openStalkerItem(it) {
  if (!it.isSeries) return openPlayer({ kind: "movie", key: "m:" + it.id, title: it.name, poster: it.poster, getUrl: () => S.stalker.link("vod", it.cmd) });
  try {
    const seasons = await S.stalker.seasons(it.sid);
    sheet("<h3>" + esc(it.name) + "</h3>" + seasons.map((s, si) => '<div class="small dim" style="margin:12px 0 6px">' + esc(s.name) + '</div><div class="chips" style="flex-wrap:wrap">' + s.eps.map((n) => '<button class="chip" data-se="' + si + ":" + n + '">' + n + "</button>").join("") + "</div>").join(""));
    $$("[data-se]").forEach((b) => b.onclick = () => { const [si, n] = b.dataset.se.split(":"); const s = seasons[+si]; closeSheet();
      openPlayer({ kind: "episode", key: "e:" + it.id + ":" + si + ":" + n, title: it.name + " – " + s.name + " E" + n, poster: it.poster, getUrl: () => S.stalker.link("vod", s.cmd, "&series=" + n) }); });
  } catch (e) { toast(tr("Couldn't load") + ": " + e.message); }
}

// ---------------- details
function openDetail(kind, id) { S.detail = { kind, id }; render(); $("#view").scrollTop = 0; }
async function renderDetail(v) {
  const { kind, id } = S.detail; const p = active();
  const it = (kind === "movies" ? S.movies : S.series).find((x) => x.id === id);
  if (!it) { S.detail = null; return render(); }
  const key = (kind === "movies" ? "m:" : "s:") + it.id;
  const pos = positions()["m:" + it.id];
  v.innerHTML = '<div class="detail"><div class="bg" style="background-image:url(\'' + esc(imgUrl(it.poster)) + '\')"></div><button class="iconbtn" id="dback">' + I.back + '</button>' +
    '<div class="dtop" style="margin-top:14px"><div class="pi">' + (it.poster ? '<img src="' + esc(imgUrl(it.poster)) + '" alt="">' : "") + '</div><div style="flex:1;min-width:0"><h1 style="margin-top:0">' + esc(it.name) + '</h1><div class="dmeta" id="dmeta">' + esc([it.year, it.genre, it.rating ? "★ " + (+it.rating).toFixed(1) : ""].filter(Boolean).join(" · ")) + '</div>' +
    '<div class="row" style="flex-wrap:wrap">' + (kind === "movies" ? '<button class="btn white" id="dplay">' + I.play + (pos ? tr("Resume") + " " + fmtTime(pos.t) : tr("Play")) + "</button>" : "") +
    '<button class="btn" id="dfav">' + (isFav(key) ? "✓ " + tr("In My list") : "+ " + tr("Add to My list")) + '</button></div></div></div><div class="plot" id="dplot">' + esc(it.plot || "") + '</div><div id="deps"></div></div>';
  $("#dback").onclick = () => { S.detail = null; render(); };
  $("#dfav").onclick = () => { const on = toggleFav(key); $("#dfav").textContent = on ? "✓ " + tr("In My list") : "+ " + tr("Add to My list"); };
  if (kind === "movies") {
    $("#dplay").onclick = () => playMovie(it);
    if (p.type === "xtream") Xtream.movieInfo(p, it).then((info) => {
      if (!S.detail || S.detail.id !== id) return;
      if (info.plot) $("#dplot").textContent = info.plot;
      $("#dmeta").textContent = [info.releasedate || info.year, info.genre, info.duration, info.rating ? "★ " + info.rating : ""].filter(Boolean).join(" · ");
    }).catch(() => {});
    return;
  }
  // series
  const box = $("#deps"); box.innerHTML = '<div class="spinner"></div>';
  let eps = it.episodes;
  try { if (!eps && p.type === "xtream") { const r = await Xtream.seriesInfo(p, it); eps = r.episodes; if (r.info.plot) $("#dplot").textContent = r.info.plot; } }
  catch (e) { box.innerHTML = '<div class="empty">' + esc(tr("Couldn't load") + ": " + e.message) + "</div>"; return; }
  eps = eps || [];
  const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b);
  let cur = seasons[0];
  const draw = () => {
    const list = eps.filter((e) => e.season === cur).sort((a, b) => a.episode - b.episode);
    box.innerHTML = '<h2>' + tr("Episodes") + '</h2><div class="chips">' + seasons.map((s) => '<button class="chip ' + (s === cur ? "on" : "") + '" data-s="' + s + '">' + tr("Season") + " " + s + "</button>").join("") + '</div><div class="eps">' +
      list.map((e, i) => { const ps = positions()["e:" + e.id]; return '<button class="ep" data-e="' + i + '"><div class="im">' + (e.image ? '<img loading="lazy" src="' + esc(imgUrl(e.image)) + '" alt="">' : '<span class="ph">' + e.episode + "</span>") +
        '</div><div style="flex:1;min-width:0"><div style="font-weight:600">' + e.episode + ". " + esc(e.title) + '</div><div class="small dim" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(e.plot || "") + "</div>" +
        (ps && ps.d ? '<div class="prog"><i style="width:' + Math.round(ps.t / ps.d * 100) + '%"></i></div>' : "") + "</div></button>"; }).join("") + "</div>";
    $$("[data-s]", box).forEach((b) => b.onclick = () => { cur = +b.dataset.s; draw(); });
    $$("[data-e]", box).forEach((b) => b.onclick = () => { const e = list[+b.dataset.e];
      openPlayer({ kind: "episode", key: "e:" + e.id, title: it.name + " – S" + e.season + "E" + e.episode + " " + (e.title || ""), poster: it.poster, url: e.url, group: it.name,
        episodes: list, epIndex: +b.dataset.e, series: it }); });
  };
  if (seasons.length) draw(); else box.innerHTML = '<div class="empty">' + tr("Nothing here yet") + "</div>";
}
function playMovie(m) {
  const p = active();
  const url = m.url || (p.type === "xtream" ? Xtream.movieUrl(p, m) : null);
  openPlayer({ kind: "movie", key: "m:" + m.id, ref: m.id, title: m.name, poster: m.poster, url, group: m.group, headers: m.headers });
}

// ---------------- Search
let searchQ = "";
function renderSearch(v) {
  v.innerHTML = "<h1>" + tr("Search") + '</h1><input class="search" id="sq" type="search" autofocus placeholder="' + tr("Search channels, movies, series") + '" value="' + esc(searchQ) + '"><div id="sres" style="margin-top:14px"></div>';
  const run = () => {
    const q = searchQ.trim().toLowerCase(); const box = $("#sres");
    if (q.length < 2) { box.innerHTML = ""; return; }
    const ch = S.live.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 200);
    const alb = ch.filter((c) => S.albGroups.has(c.group) || ALB.isChan(c.name)), oth = ch.filter((c) => !alb.includes(c));
    const mv = S.movies.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 60);
    const se = S.series.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 60);
    const chRows = (l) => '<div class="chlist">' + l.map((c) => '<button class="ch" data-ch="' + esc(c.id) + '"><div class="lg">' + logoHtml(c.logo, c.name) + '</div><div class="tx"><div class="nm">' + esc(c.name) + '</div><div class="np">' + esc(c.group) + "</div></div></button>").join("") + "</div>";
    box.innerHTML = (alb.length ? '<h2>🇦🇱 ' + tr("Albanian") + " · " + alb.length + "</h2>" + chRows(alb) : "") +
      (oth.length ? "<h2>" + tr(alb.length ? "Other" : "Live TV") + " · " + oth.length + "</h2>" + chRows(oth) : "") +
      (mv.length ? "<h2>" + tr("Movies") + " · " + mv.length + '</h2><div class="rowscroll posterrow">' + mv.map((m) => posterCard(m, "movies")).join("") + "</div>" : "") +
      (se.length ? "<h2>" + tr("Series") + " · " + se.length + '</h2><div class="rowscroll posterrow">' + se.map((m) => posterCard(m, "series")).join("") + "</div>" : "") +
      (!ch.length && !mv.length && !se.length ? '<div class="empty">' + tr("Nothing here yet") + "</div>" : "");
    bindCards(box);
  };
  $("#sq").oninput = (e) => { searchQ = e.target.value; clearTimeout(run.t); run.t = setTimeout(run, 180); };
  run();
}

// ---------------- Settings & playlists
function renderSettings(v) {
  const r = relay();
  const a = S.account;
  v.innerHTML = "<h1>" + tr("Settings") + "</h1><h2>" + tr("Playlists") + '</h2><div class="list">' +
    S.playlists.map((p) => '<div class="item"><div><div style="font-weight:600">' + esc(p.name) + '</div><div class="small dim">' + ({ m3u: "M3U", xtream: "Xtream Codes", mac: "MAC portal" }[p.type]) + "</div></div><span class=sp></span>" +
      (p.id === S.activeId ? '<span class="small" style="color:var(--acc)">' + tr("Active") + "</span>" : '<button class="btn" data-use="' + p.id + '">' + tr("Use") + "</button>") + '<button class="btn" data-edit="' + p.id + '">' + tr("Edit") + "</button></div>").join("") +
    '<button class="item" id="addPl" style="color:var(--acc)">＋ ' + tr("Add playlist") + "</button></div>" +
    (a && a.exp_date ? '<div class="small dim" style="margin:8px 4px">' + tr("Subscription") + " " + tr("expires") + ": " + new Date(a.exp_date * 1000).toLocaleDateString() + " · " + Math.ceil((a.exp_date * 1000 - Date.now()) / 864e5) + " " + tr("days left") + "</div>" : "") +
    "<h2>" + tr("Relay") + '</h2><div class="glass" style="padding:14px 16px"><div class="small dim">Needed for most IPTV servers (http:// links, MAC portals). See the setup guide in the README.</div>' +
    '<label class="f">' + tr("Relay URL") + '</label><input class="in" id="rurl" placeholder="https://freetv-relay.yourname.workers.dev" value="' + esc(r.url) + '" autocapitalize="off">' +
    '<label class="f">' + tr("Relay key") + '</label><input class="in" id="rkey" value="' + esc(r.key) + '" autocapitalize="off"><div class="row" style="margin-top:12px"><button class="btn primary" id="rsave">' + tr("Save") + '</button><span class="small dim" id="rstat"></span></div></div>' +
    "<h2>" + tr("Language") + '</h2><div class="seg" id="lang"><button data-l="en" class="' + (LANG === "en" ? "on" : "") + '">English</button><button data-l="sq" class="' + (LANG === "sq" ? "on" : "") + '">Shqip</button></div>' +
    "<h2>" + tr("Live stream format") + '</h2><div class="seg" id="fmt"><button data-f="m3u8" class="' + (store.get("liveFmt", "m3u8") === "m3u8" ? "on" : "") + '">HLS (.m3u8)</button><button data-f="ts" class="' + (store.get("liveFmt", "m3u8") === "ts" ? "on" : "") + '">MPEG-TS (.ts)</button></div>' +
    '<div class="small dim" style="margin:6px 4px">iPhone needs HLS. Xtream only.</div>' +
    '<div class="list" style="margin-top:22px"><button class="item" id="reload">' + tr("Reload playlist") + '</button><button class="item" id="clear" style="color:var(--bad)">' + tr("Clear saved data") + "</button></div>" +
    '<div class="small dim" style="text-align:center;margin:24px">FreeTV web 1.0</div>';
  $("#addPl").onclick = () => editPlaylist();
  $$("[data-use]", v).forEach((b) => b.onclick = () => { S.activeId = b.dataset.use; store.set("active", S.activeId); loadActive(); go("home"); });
  $$("[data-edit]", v).forEach((b) => b.onclick = () => editPlaylist(S.playlists.find((p) => p.id === b.dataset.edit)));
  $("#rsave").onclick = async () => {
    store.set("relayUrl", $("#rurl").value.trim()); store.set("relayKey", $("#rkey").value.trim());
    const st = $("#rstat"); st.textContent = "Testing…";
    try { const res = await fetch(relay().url + "/"); st.textContent = res.ok ? "✓ Relay works" : "Relay answered " + res.status; } catch (e) { st.textContent = "✗ Can't reach the relay"; }
  };
  $$("#lang button").forEach((b) => b.onclick = () => { LANG = b.dataset.l; store.set("lang", LANG); render(); });
  $$("#fmt button").forEach((b) => b.onclick = () => { store.set("liveFmt", b.dataset.f); toast("Saved – reload the playlist to apply"); renderSettings(v); });
  $("#reload").onclick = () => { loadActive(true); go("home"); };
  $("#clear").onclick = async () => { await idb.clear(); toast("Saved data cleared"); loadActive(true); };
}
function editPlaylist(p) {
  const t = p ? p.type : "xtream";
  const isNew = !p; p = p || { id: "p" + Date.now(), type: t, name: "" };
  const form = (type) => '<h3>' + tr(isNew ? "Add playlist" : "Edit") + '</h3><div class="seg" id="ptype">' + [["xtream", "Xtream"], ["m3u", "M3U"], ["mac", "MAC"]].map(([k, l]) => '<button data-t="' + k + '" class="' + (k === type ? "on" : "") + '">' + l + "</button>").join("") + "</div>" +
    '<label class="f">' + tr("Name") + '</label><input class="in" id="pn" value="' + esc(p.name) + '">' +
    (type === "xtream" ? '<label class="f">' + tr("Server") + '</label><input class="in" id="ps" placeholder="http://example.com:8080" autocapitalize="off" value="' + esc(p.server || "") + '"><label class="f">' + tr("Username") + '</label><input class="in" id="pu" autocapitalize="off" value="' + esc(p.user || "") + '"><label class="f">' + tr("Password") + '</label><input class="in" id="pp" autocapitalize="off" value="' + esc(p.pass || "") + '">'
      : type === "m3u" ? '<label class="f">' + tr("Playlist URL") + '</label><input class="in" id="pl" type="url" autocapitalize="off" value="' + esc(p.url || "") + '"><label class="f">' + tr("Or open a file") + '</label><input type="file" id="pf" accept=".m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain">'
      : '<label class="f">' + tr("Portal URL") + '</label><input class="in" id="po" placeholder="http://example.com:8080/c/" autocapitalize="off" value="' + esc(p.portal || "") + '"><label class="f">' + tr("MAC address") + '</label><input class="in" id="pm" placeholder="00:1A:79:XX:XX:XX" autocapitalize="characters" value="' + esc(p.mac || "") + '">') +
    '<label class="f">' + tr("EPG URL (optional)") + '</label><input class="in" id="pe" autocapitalize="off" value="' + esc(p.epg || "") + '">' +
    '<div class="row" style="margin-top:16px">' + (isNew ? "" : '<button class="btn danger" id="pdel">' + tr("Delete") + "</button>") + '<span class="sp"></span><button class="btn" id="pc">' + tr("Cancel") + '</button><button class="btn primary" id="psave">' + tr("Save") + "</button></div>";
  let type = t, fileText = p.fileText || null;
  const draw = () => {
    sheet(form(type));
    $$("#ptype button").forEach((b) => b.onclick = () => { type = b.dataset.t; draw(); });
    $("#pc").onclick = closeSheet;
    if ($("#pf")) $("#pf").onchange = async (e) => { const f = e.target.files[0]; if (f) { fileText = await f.text(); if (!$("#pn").value) $("#pn").value = f.name.replace(/\.\w+$/, ""); toast("File loaded"); } };
    if ($("#pdel")) $("#pdel").onclick = () => { S.playlists = S.playlists.filter((x) => x.id !== p.id); savePlaylists(); if (S.activeId === p.id) { S.activeId = S.playlists[0] ? S.playlists[0].id : null; store.set("active", S.activeId); loadActive(); } closeSheet(); render(); };
    $("#psave").onclick = () => {
      const val = (id) => ($(id) ? $(id).value.trim() : "");
      const n = { id: p.id, type, name: val("#pn"), epg: val("#pe") };
      if (type === "xtream") Object.assign(n, { server: val("#ps"), user: val("#pu"), pass: val("#pp") });
      if (type === "m3u") Object.assign(n, { url: val("#pl"), fileText: val("#pl") ? null : fileText, hasFile: !val("#pl") && (!!fileText || p.hasFile) });
      if (type === "mac") Object.assign(n, { portal: val("#po"), mac: val("#pm") });
      if ((type === "xtream" && (!n.server || !n.user)) || (type === "m3u" && !n.url && !n.fileText && !n.hasFile) || (type === "mac" && (!n.portal || !n.mac))) { toast("Please fill in the details"); return; }
      n.name = n.name || ({ xtream: "Xtream", m3u: "M3U", mac: "MAC portal" }[type]);
      const i = S.playlists.findIndex((x) => x.id === p.id);
      if (i >= 0) S.playlists[i] = n; else S.playlists.push(n);
      savePlaylists(); S.activeId = n.id; store.set("active", n.id); closeSheet();
      idb.set("content." + n.id, null); loadActive(true); go("home");
    };
  };
  draw();
}
function sheet(html) { const s = $("#sheet"); s.innerHTML = '<div class="panel"><div class="grab"></div>' + html + "</div>"; s.classList.remove("hidden"); s.onclick = (e) => { if (e.target === s) closeSheet(); }; }
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheet").innerHTML = ""; }

// ============================================================ player
const P = { el: null, boxes: [], sel: 0, item: null, hideT: 0, expanded: false, saveT: 0 };
class Engine {
  constructor(video) { this.v = video; this.hls = null; this.ts = null; }
  destroy() { if (this.hls) { this.hls.destroy(); this.hls = null; } if (this.ts) { try { this.ts.destroy(); } catch (e) {} this.ts = null; } this.v.removeAttribute("src"); try { this.v.load(); } catch (e) {} }
  load(rawUrl, { live, headers, startAt } = {}) {
    this.destroy();
    const isHls = /\.m3u8?(\?|$)/i.test(rawUrl) || /m3u8/i.test(rawUrl);
    const isTs = /\.ts(\?|$)/i.test(rawUrl) || (/\/live\//.test(rawUrl) && !isHls);
    const needRelay = !!relay().url && (rawUrl.startsWith("http:") || headers);
    const url = needRelay ? px(rawUrl, headers) : rawUrl;
    const v = this.v;
    const nativeHls = v.canPlayType("application/vnd.apple.mpegurl");
    if (isHls && (isIOS || !window.Hls || !Hls.isSupported()) && nativeHls) { v.src = url; }
    else if (isHls && window.Hls && Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, maxBufferLength: live ? 20 : 40, liveSyncDurationCount: 3, startPosition: startAt || -1 });
      this.hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) { this.hls.startLoad(); this.onerr && this.onerr("network"); }
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) this.hls.recoverMediaError();
        else this.onerr && this.onerr(d.details);
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.onTracks && this.onTracks());
      this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.onTracks && this.onTracks());
      this.hls.loadSource(url); this.hls.attachMedia(v);
    } else if (isTs && window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
      this.ts = mpegts.createPlayer({ type: "mpegts", isLive: !!live, url }, { enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true });
      this.ts.on(mpegts.Events.ERROR, (t, d) => this.onerr && this.onerr(d || t));
      this.ts.attachMediaElement(v); this.ts.load();
    } else { v.src = url; }
    if (startAt && !this.hls) v.addEventListener("loadedmetadata", () => { try { v.currentTime = startAt; } catch (e) {} }, { once: true });
    v.play().catch(() => {});
  }
  audioTracks() {
    if (this.hls) return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || "Track " + (i + 1), on: i === this.hls.audioTrack }));
    const a = this.v.audioTracks; if (!a) return [];
    return Array.from(a).map((t, i) => ({ id: i, label: t.label || t.language || "Track " + (i + 1), on: t.enabled }));
  }
  setAudio(i) { if (this.hls) this.hls.audioTrack = i; else if (this.v.audioTracks) Array.from(this.v.audioTracks).forEach((t, j) => t.enabled = j === i); }
  subTracks() {
    if (this.hls) return this.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || "Sub " + (i + 1), on: i === this.hls.subtitleTrack }));
    return Array.from(this.v.textTracks || []).filter((t) => t.kind !== "metadata").map((t, i) => ({ id: i, label: t.label || t.language || "Sub " + (i + 1), on: t.mode === "showing" }));
  }
  setSub(i) {
    if (this.hls) { this.hls.subtitleTrack = i; this.hls.subtitleDisplay = i >= 0; return; }
    Array.from(this.v.textTracks || []).filter((t) => t.kind !== "metadata").forEach((t, j) => t.mode = j === i ? "showing" : "disabled");
  }
  levels() { return this.hls ? this.hls.levels.map((l, i) => ({ id: i, label: (l.height ? l.height + "p" : Math.round(l.bitrate / 1000) + " kbps"), on: this.hls.currentLevel === i })) : []; }
  setLevel(i) { if (this.hls) this.hls.currentLevel = i; }
}

function openPlayer(item, ctx = {}) {
  P.item = item; P.ctx = ctx; P.expanded = false;
  const pl = $("#player");
  if (!P.el) {
    pl.innerHTML = '<div class="stage"><div class="vbox"><video playsinline webkit-playsinline></video><div class="msg hidden"></div></div></div><div class="ui"></div>';
    P.el = pl; P.boxes = [{ box: $(".vbox", pl), video: $("video", pl), eng: null }]; P.boxes[0].eng = new Engine(P.boxes[0].video);
    wireVideo(P.boxes[0]);
    pl.addEventListener("click", (e) => { if (e.target.closest(".ui > *")) return; toggleUi(); });
    setupSwipe(pl);
  }
  pl.classList.remove("hidden");
  history.pushState({ player: 1 }, "");
  startItem(item, 0);
  drawUi(); showUi();
}
async function startItem(item, bi) {
  const b = P.boxes[bi]; b.item = item;
  msg(b, tr("Loading…"));
  clearTimeout(b.deadT); b.deadT = setTimeout(() => msg(b, tr("This channel isn't responding")), 20000);
  let url = item.url;
  try { if (!url && item.getUrl) url = await item.getUrl(); }
  catch (e) { msg(b, tr("Couldn't load") + ": " + e.message); return; }
  if (!url) { msg(b, tr("Couldn't load")); return; }
  b.eng.onerr = (d) => { if (d !== "network") msg(b, tr("Couldn't load") + " (" + d + ")"); };
  b.eng.onTracks = () => { if (P.sheetKind) {} };
  const pos = item.kind !== "live" ? positions()[item.key] : null;
  b.eng.load(url, { live: item.kind === "live", headers: item.headers, startAt: pos && pos.t > 10 ? pos.t - 3 : 0 });
  b.video.muted = bi !== P.sel;
  b.video.className = store.get("aspect", "fit") === "fit" ? "" : store.get("aspect");
}
function msg(b, t) { const m = $(".msg", b.box); if (!t) { m.classList.add("hidden"); return; } m.textContent = t; m.classList.remove("hidden"); }
function wireVideo(b) {
  const v = b.video;
  v.addEventListener("playing", () => { clearTimeout(b.deadT); msg(b, ""); drawControls(); });
  v.addEventListener("pause", drawControls);
  v.addEventListener("waiting", () => { clearTimeout(b.deadT); b.deadT = setTimeout(() => msg(b, tr("This channel isn't responding")), 20000); });
  v.addEventListener("error", () => { if (!b.eng.hls && !b.eng.ts) msg(b, tr("Couldn't load") + (isIOS ? " – iPhone can't play this format" : "")); });
  v.addEventListener("timeupdate", () => {
    if (P.boxes.indexOf(b) !== P.sel) return;
    const it = b.item; if (!it || it.kind === "live") return;
    const sk = $("#pseek"); if (sk && !sk._drag && v.duration) { sk.max = v.duration; sk.value = v.currentTime; $("#pt1").textContent = fmtTime(v.currentTime); $("#pt2").textContent = "-" + fmtTime(v.duration - v.currentTime); }
    if (Date.now() - (P.saveT || 0) > 5000 && v.duration) { P.saveT = Date.now(); savePos(it.key, v.currentTime, v.duration, { title: it.title, poster: it.poster, kind: it.kind, ref: it.ref, url: it.url, pl: S.activeId, group: it.group }); }
  });
  v.addEventListener("ended", () => { const it = b.item; if (it && it.episodes && it.epIndex + 1 < it.episodes.length) nextEpisode(); });
}
function nextEpisode() { const it = P.boxes[P.sel].item; const e = it.episodes[it.epIndex + 1]; if (!e) return;
  const n = { ...it, key: "e:" + e.id, title: it.series.name + " – S" + e.season + "E" + e.episode + " " + (e.title || ""), url: e.url, epIndex: it.epIndex + 1 }; P.item = n; startItem(n, P.sel); drawUi(); }
function closePlayer(fromPop) {
  const b0 = P.boxes[0]; const it = b0 && b0.item;
  if (it && it.kind !== "live" && b0.video.duration) savePos(it.key, b0.video.currentTime, b0.video.duration, { title: it.title, poster: it.poster, kind: it.kind, ref: it.ref, url: it.url, pl: S.activeId, group: it.group });
  P.boxes.forEach((b) => { clearTimeout(b.deadT); b.eng.destroy(); });
  if (P.boxes.length > 1) { P.boxes[1].box.remove(); P.boxes.length = 1; $(".stage").classList.remove("multi"); }
  P.sel = 0; $("#player").classList.add("hidden"); closeSheet();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!fromPop) history.back();
  if (S.tab === "home" || S.tab === "live" || S.detail) render();
}
window.addEventListener("popstate", () => {
  if ($("#player").classList.contains("hidden")) return;
  if (!$("#sheet").classList.contains("hidden")) { closeSheet(); history.pushState({ player: 1 }, ""); return; }
  closePlayer(true);
});

function playChannel(c, list) {
  addRecent(c.id);
  const idx = Math.max(0, list.indexOf(c));
  const item = chItem(c);
  if ($("#player").classList.contains("hidden")) openPlayer(item, { list, index: idx });
  else { P.ctx = { list, index: idx }; P.item = item; startItem(item, P.sel); drawUi(); showUi(); }
}
function chItem(c) {
  const p = active();
  return { kind: "live", key: "c:" + c.id, ch: c, title: c.name, logo: c.logo, group: c.group, num: c.num, url: p.type === "mac" ? null : c.url, headers: c.headers,
    getUrl: p.type === "mac" ? () => S.stalker.link("itv", c.cmd) : null };
}
function zap(d) {
  const ctx = P.ctx; if (!ctx || !ctx.list || !P.boxes[P.sel].item || P.boxes[P.sel].item.kind !== "live") return;
  ctx.index = (ctx.index + d + ctx.list.length) % ctx.list.length;
  const c = ctx.list[ctx.index]; addRecent(c.id); P.item = chItem(c); startItem(P.item, P.sel); drawUi(); showUi();
}
function setupSwipe(el) {
  let x0 = 0, y0 = 0, t0 = 0;
  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 > 600 || e.target.closest(".rowscroll, input")) return;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) zap(dx < 0 ? 1 : -1);
    else if (dy < -60 && Math.abs(dy) > Math.abs(dx)) setExpanded(true);
    else if (dy > 60 && Math.abs(dy) > Math.abs(dx)) setExpanded(false);
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if ($("#player").classList.contains("hidden")) return;
    if (e.key === "ArrowUp" || e.key === "PageUp") zap(-1); else if (e.key === "ArrowDown" || e.key === "PageDown") zap(1);
    else if (e.key === " ") { const v = P.boxes[P.sel].video; v.paused ? v.play() : v.pause(); } else if (e.key === "Escape") closePlayer();
    showUi();
  });
}
function showUi() { const u = $("#player .ui"); u.classList.remove("off"); clearTimeout(P.hideT); P.hideT = setTimeout(() => { if (!P.expanded && $("#sheet").classList.contains("hidden")) u.classList.add("off"); }, 4500); }
function toggleUi() { const u = $("#player .ui"); if (u.classList.contains("off")) showUi(); else { u.classList.add("off"); setExpanded(false); } }
function setExpanded(on) {
  const it = P.boxes[P.sel].item; if (!it || it.kind !== "live" || !P.ctx || !P.ctx.list) on = false;
  P.expanded = on;
  const card = $("#pcard"), strip = $("#pstrip"); if (!card || !strip) return;
  card.classList.toggle("gone", on);
  strip.style.transform = "translateX(-50%) translateY(" + (on ? "0" : "calc(100% - 64px)") + ")";
  if (on) { const cur = $(".tile.cur", strip); if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" }); }
  showUi();
}
function drawUi() {
  const u = $("#player .ui"); const b = P.boxes[P.sel]; const it = b.item || P.item;
  const live = it.kind === "live";
  const c = it.ch; const nn = c ? nowNext(c) : {};
  if (c) wantShortEpg(c);
  const hasStrip = live && P.ctx && P.ctx.list && P.ctx.list.length > 1;
  const bottom = "calc(var(--bot) + " + (hasStrip ? 64 + 18 : 14) + "px)";
  const fv = isFav(it.key);
  u.innerHTML = '<div class="ptop"><button class="iconbtn" id="pclose">' + I.back + '</button><span class="sp"></span>' +
    (live ? '<button class="iconbtn" id="pprev">' + I.prev + '</button><button class="iconbtn" id="pnext">' + I.next + "</button>" : "") +
    '<button class="iconbtn" id="pfull">' + I.full + "</button></div>" +
    '<div class="pcard" id="pcard" style="bottom:' + bottom + '"><div class="t1"><div class="lgbox">' + logoHtml(it.logo || it.poster, it.title, !live) + '</div><div class="tt"><div class="k">' + esc(live ? it.group : tr(it.kind === "movie" ? "Movies" : "Series")) + (live && it.num ? ' <span class="badge">' + it.num + "</span>" : "") + '</div><div class="n">' + esc(it.title) + "</div>" +
    (live ? '<div class="e">' + esc(nn.now ? clock(nn.now.s) + "–" + clock(nn.now.e) + "  " + nn.now.t : tr("No programme information")) + "</div>" : "") + '</div><div class="clk"><div class="row" style="justify-content:flex-end;gap:8px"><img src="logo.png" style="height:12px;opacity:.85" alt=""><button class="iconbtn" id="popts" style="width:32px;height:32px">' + I.gear + '</button></div><div class="c" id="pclk">' + clock(Date.now()) + '</div><div class="d">' + new Date().toLocaleDateString(LANG === "sq" ? "sq" : "en-GB", { weekday: "short", day: "numeric", month: "short" }) + "</div></div></div>" +
    '<div class="t2"><div class="seek">' + (live ? '<div class="prog" style="height:4px"><i style="width:' + (nn.now ? Math.round((Date.now() - nn.now.s) / (nn.now.e - nn.now.s) * 100) : 0) + '%"></i></div><div class="times"><span>' + (nn.now ? tr("Ends") + " " + clock(nn.now.e) : tr("Live")) + "</span><span>" + (nn.next ? esc(clock(nn.next.s) + " " + nn.next.t) : "") + "</span></div>"
      : '<input type="range" id="pseek" min="0" max="100" step="1" value="0"><div class="times"><span id="pt1">0:00</span><span id="pt2"></span></div>') + '</div><button class="pbig" id="pplay">' + (b.video.paused ? I.play : I.pause) + "</button>" +
    '<button class="iconbtn" id="pfav" style="color:' + (fv ? "var(--fav)" : "inherit") + '">' + (fv ? I.star : I.starO) + "</button></div></div>" +
    (hasStrip ? '<div class="strip" id="pstrip" style="bottom:calc(var(--bot) + 8px);transform:translateX(-50%) translateY(calc(100% - 64px))"><span class="handle" id="phandle"></span><div class="rowscroll">' +
      P.ctx.list.slice(Math.max(0, P.ctx.index - 30), P.ctx.index + 60).map((x) => chTile(x, x === P.ctx.list[P.ctx.index])).join("") + "</div></div>" : "");
  $("#pclose").onclick = () => closePlayer();
  if (live) { $("#pprev").onclick = () => zap(-1); $("#pnext").onclick = () => zap(1); }
  $("#pfull").onclick = fullscreen;
  $("#pplay").onclick = () => { const v = P.boxes[P.sel].video; v.paused ? v.play() : v.pause(); };
  $("#pfav").onclick = () => { toggleFav(it.key); drawUi(); };
  $("#popts").onclick = optionsSheet;
  const sk = $("#pseek");
  if (sk) { sk.oninput = () => { sk._drag = true; $("#pt1").textContent = fmtTime(+sk.value); }; sk.onchange = () => { sk._drag = false; P.boxes[P.sel].video.currentTime = +sk.value; }; }
  if (hasStrip) {
    $("#phandle").onclick = () => setExpanded(!P.expanded);
    $$("#pstrip [data-ch]").forEach((t) => t.onclick = () => { const c2 = P.ctx.list.find((x) => x.id === t.dataset.ch); if (c2) { P.ctx.index = P.ctx.list.indexOf(c2); addRecent(c2.id); P.item = chItem(c2); startItem(P.item, P.sel); drawUi(); setExpanded(false); } });
  }
}
function drawControls() { const b = $("#pplay"); if (b) b.innerHTML = P.boxes[P.sel].video.paused ? I.play : I.pause; }
function fullscreen() {
  const v = P.boxes[P.sel].video, el = $("#player");
  if (isIOS && v.webkitEnterFullscreen && P.boxes.length === 1) { try { v.webkitEnterFullscreen(); } catch (e) {} return; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).then(() => { try { screen.orientation.lock("landscape"); } catch (e) {} }).catch(() => {});
}
function optionsSheet() {
  const b = P.boxes[P.sel], eng = b.eng, it = b.item, live = it.kind === "live";
  const aud = eng.audioTracks(), subs = eng.subTracks(), lv = eng.levels(), asp = store.get("aspect", "fit");
  const row = (id, label, val) => '<button class="item" data-o="' + id + '">' + esc(label) + (val != null ? '<span class="v">' + esc(val) + "</span>" : "") + "</button>";
  sheet("<h3>" + tr("Options") + '</h3><div class="list">' +
    (live ? row("prev", tr("Previous channel")) + row("next", tr("Next channel")) + row("multi", P.boxes.length > 1 ? tr("Close second screen") : tr("Multiview – watch 2 channels")) : row("b10", tr("Back 10 s")) + row("f10", tr("Forward 10 s"))) +
    row("fav", isFav(it.key) ? tr("Remove from favourites") : tr("Add to favourites")) + "</div>" +
    '<div class="small dim" style="margin:14px 4px 6px">' + tr("Aspect ratio") + '</div><div class="seg" id="asp">' + [["fit", "Fit"], ["fill", "Fill"], ["stretch", "Stretch"]].map(([k, l]) => '<button data-a="' + k + '" class="' + (asp === k ? "on" : "") + '">' + tr(l) + "</button>").join("") + "</div>" +
    (aud.length > 1 ? '<div class="small dim" style="margin:14px 4px 6px">' + tr("Audio track") + '</div><div class="list">' + aud.map((a) => '<button class="item ' + (a.on ? "on" : "") + '" data-au="' + a.id + '">' + esc(a.label) + (a.on ? '<span class="v">✓</span>' : "") + "</button>").join("") + "</div>" : "") +
    (subs.length ? '<div class="small dim" style="margin:14px 4px 6px">' + tr("Subtitles") + '</div><div class="list"><button class="item" data-sb="-1">' + tr("Off") + "</button>" + subs.map((a) => '<button class="item ' + (a.on ? "on" : "") + '" data-sb="' + a.id + '">' + esc(a.label) + "</button>").join("") + "</div>" : "") +
    (lv.length > 1 ? '<div class="small dim" style="margin:14px 4px 6px">' + tr("Quality") + '</div><div class="list"><button class="item" data-lv="-1">' + tr("Auto") + "</button>" + lv.map((a) => '<button class="item ' + (a.on ? "on" : "") + '" data-lv="' + a.id + '">' + esc(a.label) + "</button>").join("") + "</div>" : "") +
    '<div class="list" style="margin-top:14px">' + row("reload", tr("Reload stream")) + row("pip", tr("Picture in picture")) + row("info", tr("Stream info")) + "</div><div id=\"sinfo\" class=\"small dim\" style=\"margin-top:10px\"></div>");
  const act = { prev: () => zap(-1), next: () => zap(1), b10: () => b.video.currentTime -= 10, f10: () => b.video.currentTime += 10, fav: () => { toggleFav(it.key); drawUi(); }, multi: toggleMulti,
    reload: () => startItem(it, P.sel), pip: () => { try { b.video.requestPictureInPicture ? b.video.requestPictureInPicture() : b.video.webkitSetPresentationMode("picture-in-picture"); } catch (e) { toast("Not supported here"); } },
    info: () => { $("#sinfo").textContent = (b.video.videoWidth ? b.video.videoWidth + "×" + b.video.videoHeight + " · " : "") + (eng.hls ? "HLS (hls.js)" : eng.ts ? "MPEG-TS (mpegts.js)" : "native") + (relay().url ? " · relay" : ""); return true; } };
  $$("[data-o]").forEach((x) => x.onclick = () => { const keep = act[x.dataset.o](); if (!keep) closeSheet(); });
  $$("#asp button").forEach((x) => x.onclick = () => { store.set("aspect", x.dataset.a); P.boxes.forEach((bb) => bb.video.className = x.dataset.a === "fit" ? "" : x.dataset.a); optionsSheet(); });
  $$("[data-au]").forEach((x) => x.onclick = () => { eng.setAudio(+x.dataset.au); closeSheet(); });
  $$("[data-sb]").forEach((x) => x.onclick = () => { eng.setSub(+x.dataset.sb); closeSheet(); });
  $$("[data-lv]").forEach((x) => x.onclick = () => { eng.setLevel(+x.dataset.lv); closeSheet(); });
}
function toggleMulti() {
  const stage = $(".stage");
  if (P.boxes.length > 1) { const b = P.boxes.pop(); b.eng.destroy(); b.box.remove(); stage.classList.remove("multi"); P.sel = 0; P.boxes[0].video.muted = false; P.boxes[0].box.classList.remove("sel"); drawUi(); return; }
  const list = (P.ctx && P.ctx.list) || S.live;
  setTimeout(() => {
    sheet("<h3>" + tr("Pick a channel for the second screen") + '</h3><input class="search" id="mq" placeholder="' + tr("Search") + '"><div class="chlist" id="ml" style="margin-top:10px"></div>');
    const draw = (q) => { $("#ml").innerHTML = list.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 150).map((c) => '<button class="ch" data-m="' + esc(c.id) + '"><div class="lg">' + logoHtml(c.logo, c.name) + '</div><div class="tx"><div class="nm">' + esc(c.name) + "</div></div></button>").join("");
      $$("[data-m]").forEach((x) => x.onclick = () => { const c = list.find((y) => y.id === x.dataset.m); closeSheet(); addSecond(c); }); };
    draw(""); $("#mq").oninput = (e) => draw(e.target.value.toLowerCase());
  }, 50);
}
function addSecond(c) {
  const stage = $(".stage"); stage.classList.add("multi");
  const box = document.createElement("div"); box.className = "vbox"; box.innerHTML = '<video playsinline webkit-playsinline muted></video><div class="msg hidden"></div>';
  stage.appendChild(box);
  const b = { box, video: $("video", box), eng: null }; b.eng = new Engine(b.video); wireVideo(b); P.boxes.push(b);
  P.boxes.forEach((bb, i) => bb.box.onclick = (e) => { if (P.boxes.length < 2) return; P.sel = i; P.boxes.forEach((x, j) => { x.video.muted = j !== i; x.box.classList.toggle("sel", j === i); }); drawUi(); });
  P.boxes[0].box.classList.add("sel");
  startItem(chItem(c), 1);
}

// ============================================================ boot
setInterval(() => { const c = clock(Date.now()); const a = $("#hclock"); if (a) a.textContent = c; const b = $("#pclk"); if (b) b.textContent = c; }, 15000);
(function boot() {
  renderNav();
  loadActive().catch((e) => console.error(e));
  // Saved lists open instantly; a first download shows its own progress, so the intro never waits for the network.
  setTimeout(() => $("#intro").classList.add("done"), 1600);
})();
