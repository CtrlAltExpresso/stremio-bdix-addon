# Install on your phone

Stremio only accepts **plain HTTP addons from `127.0.0.1`**. A phone cannot use
`http://127.0.0.1:7000` (that means the phone itself), so the addon must be
reachable over **public HTTPS**. The media files stay on your BDIX servers; only
the small JSON addon goes through the tunnel.

## Fastest way — one command

On the machine that can reach `172.16.50.x`:

```bash
cd ~/stremio-bdix-addon
npm run phone
```

The script will:

1. Start `npm start` if the addon is not already running.
2. Download `cloudflared` if needed.
3. Open a Cloudflare quick tunnel to port 7000.
4. Print:
   - the HTTPS landing page URL,
   - the `stremio://...` deep link,
   - the manifest URL to paste manually.

Keep that terminal open. The URL changes every time you restart the tunnel.

### Then on your phone

1. Make sure the phone is on the **same WiFi/network** as the BDIX media servers.
2. Open the printed HTTPS URL in the phone browser. You will see the addon landing page.
3. Tap **INSTALL**.
4. Stremio should open and ask **"Do you want to add this addon?"** → confirm.

If the tap does not open Stremio:

- Install the Stremio app first.
- Or paste the manifest URL directly into **Stremio → Addons → Add addon URL**.
- Or long-press the INSTALL button and choose *Open link in Stremio*.

## Why the media must be on the same network

Your stream URLs look like:

```
http://172.16.50.7/DHAKA-FLIX-7/.../movie.mkv
```

`172.16.x.x` is a private LAN address. It works when the phone is on your WiFi,
but not over mobile data. The tunnel only exposes the addon JSON, not the media.

Items from the public `*.circleftp.net` hosts added through `main.circleftp.net`
have normal public URLs, so those play fine over mobile data without a VPN.

If you want to watch over mobile data, pick one:

- Run WireGuard/Tailscale on the phone so it can reach `172.16.50.x`.
- Put the media servers behind HTTPS too and point the addon at those URLs.
- Add a range-proxy route to the addon so streams go through the tunnel
  (works, but all video traffic flows through your desktop and Cloudflare).

## Permanent HTTPS (optional)

Quick tunnels are temporary. For a stable link:

- Cloudflare Named Tunnel with your own domain → point it at `127.0.0.1:7000`.
- BeamUp (Stremio's own host) → see the SDK deploying docs.
- Any VPS with nginx/Caddy reverse proxy → HTTPS to the addon port; run the
  crawler on a machine that can reach the BDIX servers and copy `data/index.json`.

In all cases set:

```bash
ADDON_BASE_URL=https://your-domain.example
PORT=7000
```

so the fallback poster uses the public origin.

## Checklist

- [ ] `npm run index` has been run at least once on a machine that can reach the media.
- [ ] `curl http://127.0.0.1:7000/manifest.json` returns JSON.
- [ ] Phone is on the same WiFi as `172.16.50.x`.
- [ ] You opened the HTTPS URL and tapped INSTALL.
- [ ] Stremio asked to add the addon and you confirmed.
