// English → Albanian (Shqip). Missing entries fall back to English.
const SQ = {
  "Home": "Kreu", "Live TV": "TV Live", "Movies": "Filma", "Series": "Seriale", "Search": "Kërko", "Settings": "Cilësimet",
  "Good morning": "Mirëmëngjes", "Good afternoon": "Mirëdita", "Good evening": "Mirëmbrëma",
  "Continue watching": "Vazhdo shikimin", "Favourites": "Të preferuarat", "Recently watched": "Shikuar së fundi",
  "My list": "Lista ime", "All": "Të gjitha", "Recently added": "Shtuar së fundi", "Categories": "Kategoritë", "BROWSE": "SHFLETO", "CATEGORIES": "KATEGORITË",
  "channels": "kanale", "titles": "tituj", "Watch": "Shiko", "Resume": "Vazhdo", "Play": "Luaj", "Episodes": "Episodet", "Season": "Sezoni",
  "No programme information": "Pa informacion programi", "Now watching": "Po shikoni", "Ends": "Mbaron", "Live": "Live",
  "Search channels, movies, series": "Kërko kanale, filma, seriale", "Albanian": "Shqip", "Other": "Të tjera",
  "Playlists": "Listat", "Add playlist": "Shto listë", "Name": "Emri", "Server": "Serveri", "Username": "Përdoruesi", "Password": "Fjalëkalimi",
  "Portal URL": "Adresa e portalit", "MAC address": "Adresa MAC", "Playlist URL": "Adresa e listës", "EPG URL (optional)": "Adresa EPG (opsionale)",
  "Or open a file": "Ose hap një skedar", "Save": "Ruaj", "Cancel": "Anulo", "Delete": "Fshi", "Use": "Përdor", "Active": "Aktive", "Edit": "Ndrysho",
  "Relay": "Releja", "Relay URL": "Adresa e relesë", "Relay key": "Çelësi i relesë", "Language": "Gjuha", "Live stream format": "Formati i transmetimit live",
  "Reload playlist": "Ringarko listën", "Clear saved data": "Fshi të dhënat e ruajtura", "About": "Rreth", "Subscription": "Abonimi", "expires": "skadon",
  "days left": "ditë të mbetura", "Loading…": "Duke ngarkuar…", "Couldn't load": "Nuk u ngarkua", "Try again": "Provo përsëri",
  "Options": "Opsionet", "Aspect ratio": "Raporti i pamjes", "Fit": "Përshtat", "Fill": "Mbush", "Stretch": "Shtrij", "Audio track": "Gjurma e zërit",
  "Subtitles": "Titrat", "Off": "Joaktive", "Quality": "Cilësia", "Auto": "Automatike", "Multiview – watch 2 channels": "Multiview – shiko 2 kanale",
  "Close second screen": "Mbyll ekranin e dytë", "Reload stream": "Ringarko transmetimin", "Stream info": "Info e transmetimit",
  "Previous channel": "Kanali i mëparshëm", "Next channel": "Kanali tjetër", "Add to favourites": "Shto te të preferuarat", "Remove from favourites": "Hiq nga të preferuarat",
  "Add to My list": "Shto te Lista ime", "In My list": "Në Listën time", "This channel isn't responding": "Ky kanal nuk po përgjigjet",
  "Pick a channel for the second screen": "Zgjidh një kanal për ekranin e dytë", "No playlist yet": "Ende pa listë",
  "Add your M3U, Xtream or MAC portal to start watching.": "Shto listën tënde M3U, Xtream ose portal MAC për të filluar.",
  "Nothing here yet": "Ende asgjë këtu", "TV Guide": "Udhëzuesi TV", "Today": "Sot", "Back 10 s": "Prapa 10 s", "Forward 10 s": "Përpara 10 s",
  "Fullscreen": "Ekran i plotë", "Picture in picture": "Foto në foto", "Groups": "Grupet", "Recent": "Të fundit", "Detected": "U gjetën",
};
let LANG = (() => { try { return JSON.parse(localStorage.getItem("ftv.lang")) || "en"; } catch (e) { return "en"; } })();
function tr(s) { return LANG === "sq" ? (SQ[s] || s) : s; }
