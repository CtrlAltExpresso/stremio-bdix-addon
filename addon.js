#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const config = require('./lib/config')
const { safeDecode, streamFor, formatBytes } = require('./lib/util')

function loadIndex() {
    if (!fs.existsSync(config.INDEX_FILE)) {
        throw new Error(`No index at ${config.INDEX_FILE}. Run: npm run index`)
    }
    const raw = JSON.parse(fs.readFileSync(config.INDEX_FILE, 'utf8'))
    const byId = new Map()
    const byUrl = new Map()
    const byType = { movie: [], series: [] }

    for (const item of raw.items || []) {
        byId.set(item.id, item)
        if (item.url) byUrl.set(item.url, item)
        for (const video of item.videos || []) {
            byUrl.set(video.url, { item, video })
        }
        if (byType[item.type]) byType[item.type].push(item)
    }

    const mtime = fs.statSync(config.INDEX_FILE).mtimeMs
    console.error(`[addon] loaded ${raw.items.length} titles (${raw.generatedAt})`)
    return { raw, byId, byUrl, byType, mtime }
}

let state = loadIndex()

setInterval(() => {
    try {
        const mtime = fs.statSync(config.INDEX_FILE).mtimeMs
        if (mtime !== state.mtime) state = loadIndex()
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
    id: 'org.sakib.dhakaflix.bdix',
    version: '1.0.0',
    name: 'Stremio BDIX Addon',
    description: 'BDIX media library (LAN h5ai + main.circleftp.net) with direct HTTP streams.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['df1:'],
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

builder.defineStreamHandler(async ({ id }) => {
    let url = null
    let video = null
    let item = null

    if (state.byId.has(id)) {
        item = state.byId.get(id)
        if (item.type === 'series') return { streams: [], cacheMaxAge: 3600 }
        url = item.url
    } else if (state.byUrl.has(id)) {
        const hit = state.byUrl.get(id)
        url = hit.url || (hit.video && hit.video.url)
        item = hit.item || null
        video = hit.video || null
    }

    if (!url) return { streams: [], cacheMaxAge: 3600 }
    return {
        streams: [streamFor(url, {
            name: video && video.name,
            size: (video && video.size) || (item && item.size),
            filename: video && video.filename
        })],
        cacheMaxAge: 86400
    }
})

if (!fs.existsSync(config.PUBLIC_PATH)) fs.mkdirSync(config.PUBLIC_PATH, { recursive: true })

serveHTTP(builder.getInterface(), {
    port: config.PORT,
    cacheMaxAge: 3600,
    static: config.PUBLIC_DIR
})
