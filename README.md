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
