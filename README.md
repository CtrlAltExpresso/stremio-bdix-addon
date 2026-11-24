# Stremio BDIX Addon

[**Install this addon in Stremio — one click**](stremio://res-enclosure-retreat-gently.trycloudflare.com/manifest.json)

If GitHub blocks that link, open https://res-enclosure-retreat-gently.trycloudflare.com/ and tap **INSTALL**.

Indexes BDIX h5ai media servers — both the LAN hosts and the public hosts linked by
`http://main.circleftp.net/` — and exposes them as Stremio catalogs with **direct HTTP
streams**. No FTP proxy is needed: the files already return `Accept-Ranges: bytes` and
`206` for range requests (verified on both the LAN and Circle hosts), so seeking works.

## What was checked

| Endpoint | Result |
| --- | --- |
| `http://172.16.50.7/` | nginx + h5ai media index |
| `http://172.16.50.7/DHAKA-FLIX-7/English Movies/(2024)/...` | per-title folders, `a_AL_.jpg` posters, direct `.mkv` files |
| Direct `.mkv` HEAD | `200`, `Content-Length`, `Accept-Ranges: bytes` |
| `http://main.circleftp.net/` | WordPress catalog; Play buttons call `vidSwap('http://...')` with direct `.mkv`/`.mp4` URLs |
| `ftp13 / ftp17 / index1 / index2 / index` `.circleftp.net` | Public h5ai v0.29.2 hosts, same `fb-i/fb-n/fb-d/fb-s` row format the crawler parses |
| Circle direct file | `HEAD 200`, `Accept-Ranges: bytes`, `Range: bytes=0-1023` → `206` |

The crawler reads h5ai directory listings recursively, builds one catalog item per
movie folder, and one `series` item per series folder with `Season N` subfolders.

## Current index

**62,577 titles** (56,950 movies + 5,627 series) from 63,374 directories across 27 roots:
17 LAN roots + 10 public roots from `main.circleftp.net`. 2 old LAN directory fetches
timed out; the Circle crawl had 0 errors. `ftp3` and `ftp5` were excluded because they
timed out from the crawl machine, but their paths can be added to `DEFAULT_ROOTS` later.

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

Items from `172.16.50.x` need the phone on the same WiFi — the tunnel exposes only the
small addon JSON, not those media files. Items from `*.circleftp.net` are on public
hostnames, so they also play over mobile data.

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

To add only the public Circle hosts and merge without re-crawling the LAN:

```bash
INDEX_FILE=/tmp/circle-index.json npm run index -- --only circleftp
node scripts/merge-index.js data/index.json /tmp/circle-index.json
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
| `INDEX_FILE` | `data/index.json` | Index path (useful for crawling extra roots separately) |

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

Two ID paths are supported:

- `df1:` + base64url of the media URL — used by this addon's own catalog. Movie
  catalog/meta IDs are video URLs; series meta IDs are folder URLs and episode
  video IDs are file URLs.
- `tt...` — normal IMDb IDs used by Cinemeta, Torrentio and the rest of Stremio.
  The manifest declares the `stream` resource for both prefixes, so this addon
  is called when you open a title from **any** addon, not just from its own
  catalog. For a `ttID:season:episode` request, the addon resolves the IMDb ID
  through Cinemeta (`https://v3-cinemeta.strem.io/meta/...`), matches the title
  and year against the local index, and returns the matching episode's direct
  stream. Results are cached in memory.

If Stremio still does not list this addon in a title's source picker, remove the
addon and re-add it from the install link so it picks up the updated manifest.
Matching is by normalized title + year; unusually named folders may not match.

Streams are returned with `notWebReady: true` for plain HTTP files (Stremio Web
cannot play them directly; desktop/mobile use their native player).

## Access from other devices

Stremio only accepts plain HTTP addons from `127.0.0.1`. If you want the addon on a
phone/TV on the same LAN, terminate HTTPS in front of it (Caddy/nginx + local CA,
or a tunnel) and set `ADDON_BASE_URL` to that HTTPS origin. Stream URLs themselves
point at the BDIX hosts and must also be HTTPS if Stremio Web is used in a strict
mixed-content context; the desktop app is unaffected.

## Re-indexing

`npm run index` rebuilds `data/index.json` atomically. The running addon reloads
the index automatically within ~15 seconds.
