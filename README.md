# DhakaFlix BDIX — Stremio addon

Repository: https://github.com/CtrlAltExpresso/stremio-bdix-addon

Indexes the BDIX/DhakaFlix h5ai media servers and exposes them as Stremio catalogs
with **direct HTTP streams**. No FTP proxy is needed: the media is already served over
HTTP with `Accept-Ranges: bytes` (verified on `http://172.16.50.7/`), so seeking works.

## What was checked

| Endpoint | Result |
| --- | --- |
| `http://172.16.50.7/` | nginx + h5ai index, "DhakaFlix" portal |
| `http://172.16.50.7/DHAKA-FLIX-7/English Movies/(2024)/...` | per-title folders, `a_AL_.jpg` posters, direct `.mkv` files |
| Direct `.mkv` HEAD | `200`, `Content-Length`, `Accept-Ranges: bytes` |
| `http://main.circleftp.net/` | WordPress front-end listing the same library |

The crawler reads h5ai directory listings recursively, builds one catalog item per
movie folder, and one `series` item per series folder with `Season N` subfolders.

## Current index

Last full crawl: **39,603 titles** (34,135 movies + 5,468 series) from 39,952 directories across 17 roots.
2 directory fetches timed out; everything else indexed cleanly.

## One-click install on phone

Stremio needs an HTTPS addon URL on a phone. Start a public tunnel from the machine
that can reach the BDIX servers:

```bash
npm run phone
```

It prints an HTTPS URL and a `stremio://...` link. Open the HTTPS URL on your phone,
tap **INSTALL**, and Stremio will ask whether to add the addon. Full details are in
[docs/PHONE.md](docs/PHONE.md).

Current quick-tunnel link (changes whenever the tunnel restarts):

```
https://res-enclosure-retreat-gently.trycloudflare.com/
```

Tap-style deep link:

```
stremio://res-enclosure-retreat-gently.trycloudflare.com/manifest.json
```

The phone must be on the same WiFi as `172.16.50.x`; the tunnel exposes only the
small addon JSON, not the media files.

## Setup

```bash
cd ~/stremio-bdix-addon
npm install
npm run index          # crawl the library -> data/index.json
npm start              # serve the addon on http://127.0.0.1:7000
```

Then in Stremio: **Addons → Add addon URL** and paste:

```
http://127.0.0.1:7000/manifest.json
```

`npm start -- --install` installs it into the desktop app directly, and
`npm start -- --launch` opens Stremio Web with the addon installed.

## Configuration

All config is via environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7000` | Addon HTTP port |
| `ADDON_BASE_URL` | `http://127.0.0.1:$PORT` | Public base URL used for the fallback poster |
| `ROOTS` | built-in list | Override crawl roots: `host\|path\|category,host\|path\|category` |
| `CRAWL_CONCURRENCY` | `6` | Parallel directory requests |
| `CRAWL_MAX_DEPTH` | `10` | Max directory depth |
| `CRAWL_MAX_ITEMS` | `0` | Stop after N titles (0 = unlimited) |
| `FETCH_TIMEOUT_MS` | `20000` | Per-directory timeout |

Quick smoke test with one root:

```bash
ROOTS='http://172.16.50.7|/DHAKA-FLIX-7/English Movies/|English Movies' \
CRAWL_MAX_ITEMS=40 npm run index
npm start
```

## Useful endpoints

```
GET /manifest.json
GET /catalog/movie/bdix_movies.json
GET /catalog/series/bdix_series.json
GET /catalog/movie/bdix_movies/search=abigail.json
GET /meta/movie/<id>.json
GET /stream/movie/<id>.json
```

## How the IDs work

`df1:` + base64url of the media URL. The movie catalog/meta ID is the video URL;
series meta IDs are folder URLs and episode video IDs are file URLs. The stream
handler decodes the ID and returns a direct HTTP stream with `notWebReady: true`
(Stremio desktop uses its internal player for HTTP MKV files).

## Access from other devices

Stremio only accepts plain HTTP addons from `127.0.0.1`. If you want the addon on a
phone/TV on the same LAN, terminate HTTPS in front of it (Caddy/nginx + local CA,
or a tunnel) and set `ADDON_BASE_URL` to that HTTPS origin. Stream URLs themselves
point at the BDIX hosts and must also be HTTPS if Stremio Web is used in a strict
mixed-content context; the desktop app is unaffected.

## Re-indexing

`npm run index` rebuilds `data/index.json` atomically. The running addon reloads
the index automatically within ~15 seconds.
