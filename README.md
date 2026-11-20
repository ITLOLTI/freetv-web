# FreeTV web

FreeTV in the browser – for iPhone, Android phones, tablets and computers.

- **Playlists:** Xtream Codes, M3U (link or file) and MAC / Stalker portals
- **Live TV:** groups (Albanian groups pinned on top), favourites, recent channels, now/next programme, swipe to change channel
- **Movies & Series:** categories, recently added, My list, continue watching, seasons and episodes, resume where you stopped
- **Player:** compact glass card, channel row that slides up, aspect ratio, audio tracks, subtitles, quality, multiview (2 channels), picture-in-picture, fullscreen
- **Search** across channels, movies and series (Albanian channels first)
- English / Shqip, subscription expiry (Xtream), everything saved on your device only

## FreeTV for Mac

The same app as a real Mac app – **no relay needed**, plus:

- **Record live channels** – while watching: Options ⚙ → *Record now* or *Record this programme* (stops by itself when the programme ends). Saved as `.ts` with no quality loss.
- **Download movies and episodes** – *Download* on a movie, the ⬇ button on an episode, or *Download season*. Downloads can be paused and resumed.
- **Library** tab: everything recorded and downloaded – play it in FreeTV, open it in QuickTime/VLC, or show it in Finder.
- **Destination folder:** Settings → *Recordings & downloads → Choose folder…* (default: `Movies/FreeTV`).

**Get it:** GitHub → **Actions** → the latest *Build FreeTV for Mac* run → download **FreeTV-Mac-AppleSilicon** (M1/M2/M3/M4 Macs) or **FreeTV-Mac-Intel** → unzip → open the `.dmg` → drag FreeTV into Applications.

**First launch:** the app isn't from the App Store, so macOS asks once. Right-click FreeTV in Applications → **Open** → **Open**. If macOS says the app is *damaged*, open Terminal and run:
`xattr -cr /Applications/FreeTV.app` – then open it again.

### Web Sniffer (Mac app, since 1.3.0)

A separate screen next to the IPTV tabs:

- **Discover** – paste a page or video link, press *Analyze*. FreeTV lists the media it finds (title, thumbnail, length, qualities, size). Three engines: a site extractor (yt-dlp), FreeTV's own page scan (video tags, JSON-LD, HLS/DASH playlists, embedded players) and an optional *Deep scan* that loads the page in a hidden window and watches what it loads.
- **MEGA links** – paste a public mega.nz file or folder link (with its key after `#`). FreeTV downloads and decrypts it like MEGA's website does, and can turn videos into MP4 or MP3 on the way. MEGA's free transfer limits apply.
- **Browse** – a private browser window inside FreeTV (shares nothing with Safari or Chrome, forgotten when FreeTV quits, pop-ups blocked). Play a video on any page and the *Video found* button lights up; pick a quality to download.
- **Trim** (since 1.8.0) – in the download window choose *Only a part*: drag the two handles on the strip of pictures from the video, type the times, or use *First 5 min* / *Last 10 min*. Only that part is downloaded. *Fast cut* keeps the original quality (it may start a second or two early); *Exact cut* starts on the exact second.
- **Compress to a size I choose** (since 1.8.0, optional, off by default) – slide from the smallest file to the best quality and FreeTV shows how many MB the video will be and at which picture size, or type the MB yourself. FreeTV downloads it and compresses it to that size (H.264 MP4, two-pass, so it lands close to the number you picked). Works together with Trim.
- **Clips** (since 1.9.0, own tab) – turn a long video (stream, gameplay, podcast) into short clips. *Find moments* listens for loud reactions and sudden excitement and watches for fast action and cuts, then suggests the best parts (how many, how long – or automatic 15–60 s – and what to look for). Start and end land in a pause in the sound. Fix the times, add your own, give each clip a title. Export as vertical 9:16 (Shorts, Reels, TikTok), square 1:1 or horizontal 16:9 with a blurred background, crop or black bars; your PNG logo in any corner (kept clear of the Shorts/Reels buttons) with size and opacity; a title on top and *Part 1, Part 2…*; subtitles from an .srt file; fades; phone-loud sound (-14 LUFS); 1080p or 720p, 30/60 fps. Live preview shows how it will look. Downloaded videos have a *Make clips* button. The analysis of a video is remembered, so finding again is instant.
- **Clips: split into parts, text style, music** (since 1.10.0) – *Split into parts* cuts the whole video (or a stretch of it) back to back into parts of 1, 2, 3, 5, 10 minutes or any length; the short last part can be kept, added to the part before or left out; optional overlap of a few seconds. Parts are saved in their own folder as *Part 01.mp4, Part 02.mp4 …* (the word can be changed, e.g. *Pjesa*), numbered *Part 3 / 46*, *Part 3* or *3/46*, with an optional *Part 4 →* in the last 3 seconds. Text: any Mac font (or your own font file), size, text and outline colours, a coloured box behind it, and its position – drag it in the preview. Background colour instead of black bars. Subtitles: height and colour. **Music**: add a song under the clips with its own volume and the video's own volume; the music goes quieter while someone talks; choose where in the song to start; it repeats if the clip is longer.
- **Faster after-download steps** (since 1.8.1) – making a video play on Mac or compressing it no longer holds up the next download: it starts right away while up to 2 videos convert in the background. Converting also reads the video with the Mac's video chip (H.264, HEVC, VP9) and runs the encoder in its speed mode.
- **Downloads** – several downloads at once, several connections per file, pause / resume, automatic retry, speed and time left, duplicate warning, history. Files go to `FreeTV/Web`.
- **Converter** (its own tab since 1.7.0) – drop any video or audio file. Video: MP4, MOV, MKV, AVI, WebM, M4V, WMV, FLV, MPEG, TS, 3GP, OGV, ProRes. Audio: MP3, M4A, AAC, WAV, FLAC, AIFF, OGG, Opus, WMA, AC3. Also GIF, animated WebP, a photo (JPG), photos every few seconds (PNG) and subtitles (SRT). Options: resolution, codecs, quality, target file size, bitrate, frame rate, cut from/to, remove sound, quick presets. Files go to `FreeTV/Converted`.

DRM-protected streams and videos that need a sign-in are shown as protected and are **not** downloaded – FreeTV does not bypass DRM, logins or other access controls. Live streams can be previewed only. Only save media you have the right to download.

## Open it

`https://itlolti.github.io/freetv-web/`

On iPhone: open in **Safari** → Share → **Add to Home Screen**. It then opens full-screen like an app.

## The relay (needed for most IPTV servers)

Browsers don't let a web page read `http://` servers or servers that don't allow web access – most IPTV servers. The relay is a tiny free Cloudflare Worker that fetches the server for the app over `https`.

1. Create a free account at **dash.cloudflare.com**.
2. **Workers & Pages → Create → Create Worker** → name it `freetv-relay` → **Deploy**.
3. **Edit code** → delete everything → paste the contents of [`worker.js`](worker.js).
4. On the line `const KEY = "change-me-to-a-secret-word";` replace the word with your own secret word → **Deploy**.
5. Copy the worker address (like `https://freetv-relay.yourname.workers.dev`).
6. In FreeTV → **Settings → Relay**: paste the address, type the same secret word as the key → **Save**. It shows "✓ Relay works".

The secret word stops other people from using your relay. Cloudflare's free plan allows 100 000 requests a day – plenty for one household (one hour of live TV is roughly 600–1 000 requests).

## Notes

- iPhone plays **HLS (.m3u8)** streams. Keep *Settings → Live stream format* on HLS for Xtream.
- Movies in **.mkv** usually don't play in Safari on iPhone (they do in Chrome on Android/PC).
- Some providers block web players or data-centre addresses; then a channel may not play through the relay even though it works in the TV app.
