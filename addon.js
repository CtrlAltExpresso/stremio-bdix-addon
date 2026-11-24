#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const config = require('./lib/config')
const { safeDecode, streamFor, formatBytes, normalizeTitle, decodeId, qualityOf } = require('./lib/util')

function loadIndex() {
    if (!fs.existsSync(config.INDEX_FILE)) {
        throw new Error(`No index at ${config.INDEX_FILE}. Run: npm run index`)
    }
    const raw = JSON.parse(fs.readFileSync(config.INDEX_FILE, 'utf8'))
    const byId = new Map()
    const byUrl = new Map()
    const byTitle = new Map()
    const byType = { movie: [], series: [] }

    for (const item of raw.items || []) {
        byId.set(item.id, item)
        if (item.url) byUrl.set(item.url, item)
        for (const video of item.videos || []) {
            byUrl.set(video.url, { item, video })
        }
        if (byType[item.type]) byType[item.type].push(item)
        const titleKey = `${item.type}:${normalizeTitle(item.name)}`
        if (!byTitle.has(titleKey)) byTitle.set(titleKey, [])
        byTitle.get(titleKey).push(item)
    }

    const mtime = fs.statSync(config.INDEX_FILE).mtimeMs
    console.error(`[addon] loaded ${raw.items.length} titles (${raw.generatedAt})`)
    return { raw, byId, byUrl, byTitle, byType, mtime }
}

let state = loadIndex()
const imdbCache = new Map()

// Cinemeta owns IMDb metadata. Resolve an IMDb ID to a title/year, then match
// that title against our local index so BDIX streams appear on normal Stremio
// detail pages (the same pages where Torrentio shows up).
function titleTokens(name) {
    return normalizeTitle(name).split(' ').filter((token) => token.length >= 4)
}

// Folder names and Cinemeta titles often differ by one letter (for example
// "Abrahaminte" vs "Abhrahaminte"). Dice coefficient over character bigrams
// catches that without matching unrelated titles.
function tokenSimilarity(a, b) {
    if (a === b) return 1
    if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 2) return 0
    const counts = new Map()
    for (let i = 0; i < a.length - 1; i += 1) {
        const gram = a.slice(i, i + 2)
        counts.set(gram, (counts.get(gram) || 0) + 1)
    }
    let shared = 0
    for (let i = 0; i < b.length - 1; i += 1) {
        const gram = b.slice(i, i + 2)
        const left = counts.get(gram) || 0
        if (left) {
            counts.set(gram, left - 1)
            shared += 1
        }
    }
    return (2 * shared) / (a.length + b.length - 2)
}

function hasToken(tokens, wanted) {
    if (!wanted) return false
    return tokens.some((token) => tokenSimilarity(wanted, token) >= 0.78)
}

// Cinemeta sometimes uses a localized title ("Kamisama Kiss") while the folder
// uses the original one ("Kamisama Hajimemashita") or a near-homonym. Require
// the same year plus enough shared/fuzzy tokens so unrelated titles are skipped.
function matchByAlias(type, name, year) {
    const wanted = titleTokens(name)
    if (!wanted.length) return null

    let best = null
    let bestScore = 0
    for (const item of state.byType[type] || []) {
        if (year && Math.abs((item.year || 0) - year) > 1) continue
        const tokens = titleTokens(item.name)
        if (!tokens.length) continue
        const shared = wanted.filter((token) => hasToken(tokens, token)).length
        const leading = (hasToken(tokens, wanted[0]) || hasToken(wanted, tokens[0])) ? 2 : 0
        const score = shared + leading
        if (score > bestScore) {
            bestScore = score
            best = item
        }
    }
    return bestScore >= 3 ? best : null
}

// One IMDb title can exist on several BDIX hosts and at several qualities.
// Return every matching local item so the source picker offers all copies.
async function resolveImdb(type, imdbId) {
    const key = `${type}:${imdbId}`
    if (imdbCache.has(key)) return imdbCache.get(key)

    let items = []
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        let response
        try {
            response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
                signal: controller.signal
            })
        } finally {
            clearTimeout(timer)
        }
        if (response.ok) {
            const meta = (await response.json()).meta
            if (meta && meta.name) {
                const year = Number.parseInt(String(meta.year || meta.releaseInfo || '').slice(0, 4), 10)
                const candidates = (state.byTitle.get(`${type}:${normalizeTitle(meta.name)}`) || [])
                    .filter((candidate) => !year || Math.abs((candidate.year || 0) - year) <= 1)
                const alias = matchByAlias(type, meta.name, year)
                items = candidates.length ? candidates : (alias ? [alias] : [])
                if (items.length) {
                    console.error(`[imdb] ${type}/${imdbId} -> ${
                        items.map((item) => `${item.name} (${item.year})`).join('; ')
                    }`)
                }
            }
        }
    } catch (error) {
        console.error(`[imdb] ${type}/${imdbId}: ${error.message}`)
    }

    imdbCache.set(key, items)
    return items
}

function qualityRank(value) {
    const text = String(value || '')
        .match(/\b(2160p|4k|1080p|720p|480p)\b/i)?.[0]
        ?.toLowerCase()
    return ({ '2160p': 4, '4k': 4, '1080p': 3, '720p': 2, '480p': 1 })[text] || 0
}

function hostOf(url) {
    try {
        return new URL(url).hostname
    } catch {
        return 'BDIX'
    }
}

function labelFor(name, url) {
    const quality = qualityOf(url)
    const base = name || quality
    const label = base.toLowerCase().includes(quality.toLowerCase())
        ? base
        : `${base} · ${quality}`
    return `${label} · ${hostOf(url)}`
}

function finishStreams(streams) {
    const seen = new Set()
    return streams
        .filter((stream) => {
            if (!stream.url || seen.has(stream.url)) return false
            seen.add(stream.url)
            return true
        })
        .sort((a, b) =>
            qualityRank(`${b.name} ${b.description}`) - qualityRank(`${a.name} ${a.description}`) ||
            (b.behaviorHints.videoSize || 0) - (a.behaviorHints.videoSize || 0)
        )
        .slice(0, 100)
}

setInterval(() => {
    try {
        const mtime = fs.statSync(config.INDEX_FILE).mtimeMs
        if (mtime !== state.mtime) {
            state = loadIndex()
            imdbCache.clear()
        }
    } catch (error) {
        console.error(`[addon] index reload failed: ${error.message}`)
    }
}, 15000).unref()

function previewOf(item) {
    const preview = {
        id: item.id,
        type: item.type,
        name: item.name,
        poster: item.poster || config.FALLBACK_POSTER,
        posterShape: 'poster',
        releaseInfo: item.releaseInfo || undefined,
        description: [item.category, item.year ? String(item.year) : '', formatBytes(item.size)]
            .filter(Boolean)
            .join(' · ')
    }
    if (item.background) preview.background = item.background
    return preview
}

function metaOf(item) {
    const meta = previewOf(item)
    meta.description = `${item.originalName || item.name} — ${item.category}${
        item.size ? ` · ${formatBytes(item.size)}` : ''
    }`
    if (item.year) meta.released = `${item.year}-01-01`
    // Do NOT embed video.streams here: per the SDK docs that makes Stremio skip
    // the stream resource for this video entirely (no source picker, no other addons).
    meta.videos = (item.videos || []).map((video) => ({
        id: video.id,
        title: video.title,
        ...(video.season ? { season: video.season } : {}),
        ...(video.episode ? { episode: video.episode } : {}),
        ...(video.released ? { released: video.released } : {})
    }))
    if (item.type === 'movie' && !meta.videos.length) {
        meta.videos = [{ id: item.id, title: item.name }]
    }
    return meta
}

const manifest = {
    // Bumped ID: Stremio caches the manifest by addon ID + transport URL, so a
    // re-install from the same URL with the same ID keeps the old (v1.1.0)
    // manifest whose idPrefixes omitted "tt". A new ID forces a fresh fetch.
    id: 'org.sakib.bdix.v2',
    version: '1.2.6',
    name: 'Stremio BDIX Addon',
    description: 'BDIX media library (LAN h5ai + main.circleftp.net) with direct HTTP streams.',
    resources: [
        'catalog',
        { name: 'meta', types: ['movie', 'series'], idPrefixes: ['df1:'] },
        // "tt" makes the addon appear alongside Torrentio on IMDb-based pages.
        { name: 'stream', types: ['movie', 'series'], idPrefixes: ['df1:', 'tt'] }
    ],
    types: ['movie', 'series'],
    idPrefixes: ['df1:', 'tt'],
    catalogs: [
        {
            type: 'movie',
            id: 'bdix_movies',
            name: 'BDIX Movies',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'bdix_series',
            name: 'BDIX Series',
            extra: [{ name: 'search', isRequired: false }]
        }
    ],
    behaviorHints: {
        adult: false,
        p2p: false
    }
}

const builder = new addonBuilder(manifest)

function logCall(resource, args) {
    const line = `${new Date().toISOString()} ${resource} type=${args.type || '-'} id=${args.id || '-'} extra=${JSON.stringify(args.extra || {})}\n`
    console.error(line.trim())
    try {
        fs.appendFileSync('/tmp/opencode/addon-requests.log', line)
    } catch {
        // logging must never break a request
    }
}

builder.defineCatalogHandler(async (args) => {
    logCall('catalog', args)
    const { type, extra } = args
    let items = state.byType[type] || []
    const search = extra && (extra.search || extra.query)
    if (search) {
        const needle = safeDecode(String(search)).toLowerCase()
        items = items.filter((item) =>
            item.name.toLowerCase().includes(needle) ||
            (item.originalName || '').toLowerCase().includes(needle) ||
            (item.category || '').toLowerCase().includes(needle)
        )
    }
    return { metas: items.slice(0, 3000).map(previewOf), cacheMaxAge: 300 }
})

builder.defineMetaHandler(async (args) => {
    logCall('meta', args)
    const { type, id } = args
    const item = state.byId.get(id)
    if (!item || item.type !== type) return { meta: {} }
    return { meta: metaOf(item), cacheMaxAge: 86400 }
})

builder.defineStreamHandler(async (args) => {
    logCall('stream', args)
    const { type, id } = args
    if (typeof id !== 'string') return { streams: [], cacheMaxAge: 3600 }

    if (state.byId.has(id)) {
        const item = state.byId.get(id)
        if (item.type === 'series') return { streams: [], cacheMaxAge: 3600 }
        const streams = (item.videos || []).map((video) => streamFor(video.url, {
            name: labelFor(video.title, video.url),
            size: video.size,
            filename: video.filename
        }))
        if (!streams.length && item.url) {
            streams.push(streamFor(item.url, { name: labelFor(null, item.url), size: item.size }))
        }
        const resolved = finishStreams(streams)
        return { streams: resolved, cacheMaxAge: resolved.length ? 86400 : 3600 }
    }

    // Episode IDs are "df1:" + base64url(file URL). Decode them before lookup;
    // otherwise every series episode stream request would return zero streams.
    const decodedUrl = decodeId(id)
    const hit = state.byUrl.get(decodedUrl || id)
    if (hit) {
        const video = hit.video
        const url = video ? video.url : (hit.item && hit.item.type === 'movie' ? hit.item.url : null)
        if (!url) return { streams: [], cacheMaxAge: 3600 }
        return {
            streams: [streamFor(url, {
                name: video && video.title,
                size: (video && video.size) || (hit.item && hit.item.size),
                filename: video && video.filename
            })],
            cacheMaxAge: 86400
        }
    }

    // Normal Stremio detail pages use IMDb IDs (tt1234567:season:episode).
    const imdb = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/)
    if (!imdb) return { streams: [], cacheMaxAge: 3600 }

    const items = await resolveImdb(type, imdb[1])
    if (!items.length) return { streams: [], cacheMaxAge: 3600 }

    const season = imdb[2] ? Number(imdb[2]) : null
    const episode = imdb[3] ? Number(imdb[3]) : null
    const streams = []

    for (const item of items) {
        if (item.type === 'movie') {
            const videos = (item.videos || []).length
                ? item.videos
                : [{ url: item.url, size: item.size, filename: item.url }]
            for (const video of videos) {
                streams.push(streamFor(video.url, {
                    name: labelFor(video.title, video.url),
                    size: video.size,
                    filename: video.filename
                }))
            }
            continue
        }
        for (const video of item.videos || []) {
            if (season !== null && (video.season !== season ||
                (episode !== null && video.episode !== episode))) continue
            streams.push(streamFor(video.url, {
                name: labelFor(video.title, video.url),
                size: video.size,
                filename: video.filename
            }))
        }
    }

    const resolved = finishStreams(streams)
    return { streams: resolved, cacheMaxAge: resolved.length ? 86400 : 3600 }
})

if (!fs.existsSync(config.PUBLIC_PATH)) fs.mkdirSync(config.PUBLIC_PATH, { recursive: true })

serveHTTP(builder.getInterface(), {
    port: config.PORT,
    cacheMaxAge: 3600,
    static: config.PUBLIC_DIR
})
