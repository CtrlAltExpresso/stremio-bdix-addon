#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const config = require('./lib/config')
const { safeDecode, streamFor, formatBytes, normalizeTitle } = require('./lib/util')

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
async function resolveImdb(type, imdbId) {
    const key = `${type}:${imdbId}`
    if (imdbCache.has(key)) return imdbCache.get(key)

    let item = null
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
                const candidates = state.byTitle.get(`${type}:${normalizeTitle(meta.name)}`) || []
                const year = Number.parseInt(String(meta.year || meta.releaseInfo || '').slice(0, 4), 10)
                if (candidates.length) {
                    item = (year && candidates.find((candidate) =>
                        Math.abs((candidate.year || 0) - year) <= 1
                    )) || candidates[0]
                }
            }
        }
    } catch (error) {
        console.error(`[imdb] ${type}/${imdbId}: ${error.message}`)
    }

    imdbCache.set(key, item)
    return item
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
    meta.videos = (item.videos || []).map((video) => ({
        id: video.id,
        title: video.title,
        ...(video.season ? { season: video.season } : {}),
        ...(video.episode ? { episode: video.episode } : {}),
        ...(video.released ? { released: video.released } : {}),
        streams: [streamFor(video.url, { name: video.name, size: video.size, filename: video.filename })],
        available: true
    }))
    if (item.type === 'movie' && !meta.videos.length) {
        meta.videos = [{
            id: item.id,
            title: item.name,
            streams: [streamFor(item.url, { size: item.size })],
            available: true
        }]
    }
    return meta
}

const manifest = {
    id: 'org.sakib.bdix',
    version: '1.2.0',
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

builder.defineCatalogHandler(async ({ type, extra }) => {
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

builder.defineMetaHandler(async ({ type, id }) => {
    const item = state.byId.get(id)
    if (!item || item.type !== type) return { meta: {} }
    return { meta: metaOf(item), cacheMaxAge: 86400 }
})

builder.defineStreamHandler(async ({ type, id }) => {
    if (typeof id !== 'string') return { streams: [], cacheMaxAge: 3600 }

    if (state.byId.has(id)) {
        const item = state.byId.get(id)
        if (item.type === 'series') return { streams: [], cacheMaxAge: 3600 }
        return {
            streams: [streamFor(item.url, { size: item.size })],
            cacheMaxAge: 86400
        }
    }

    if (state.byUrl.has(id)) {
        const hit = state.byUrl.get(id)
        const url = hit.url || (hit.video && hit.video.url)
        if (!url) return { streams: [], cacheMaxAge: 3600 }
        return {
            streams: [streamFor(url, {
                name: hit.video && hit.video.title,
                size: (hit.video && hit.video.size) || (hit.item && hit.item.size),
                filename: hit.video && hit.video.filename
            })],
            cacheMaxAge: 86400
        }
    }

    // Normal Stremio detail pages use IMDb IDs (tt1234567:season:episode).
    const imdb = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/)
    if (!imdb) return { streams: [], cacheMaxAge: 3600 }

    const item = await resolveImdb(type, imdb[1])
    if (!item) return { streams: [], cacheMaxAge: 3600 }

    let streams = []
    if (item.type === 'movie') {
        streams = [streamFor(item.url, { size: item.size })]
    } else {
        const season = imdb[2] ? Number(imdb[2]) : null
        const episode = imdb[3] ? Number(imdb[3]) : null
        streams = (item.videos || [])
            .filter((video) => season === null ||
                (video.season === season && (episode === null || video.episode === episode)))
            .map((video) => streamFor(video.url, {
                name: video.title,
                size: video.size,
                filename: video.filename
            }))
    }

    return { streams, cacheMaxAge: streams.length ? 86400 : 3600 }
})

if (!fs.existsSync(config.PUBLIC_PATH)) fs.mkdirSync(config.PUBLIC_PATH, { recursive: true })

serveHTTP(builder.getInterface(), {
    port: config.PORT,
    cacheMaxAge: 3600,
    static: config.PUBLIC_DIR
})
