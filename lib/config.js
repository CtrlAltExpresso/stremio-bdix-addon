'use strict'

const path = require('node:path')

const PORT = Number(process.env.PORT || 7000)
const ADDON_BASE_URL = (process.env.ADDON_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')

function root(host, pathname, category) {
    return { url: host + encodeURI(pathname), category }
}

// Video-bearing h5ai roots discovered from http://172.16.50.7/ and
// http://main.circleftp.net/. Non-video roots (games/software) are skipped.
const DEFAULT_ROOTS = [
    root('http://172.16.50.7', '/DHAKA-FLIX-7/English Movies/', 'English Movies'),
    root('http://172.16.50.7', '/DHAKA-FLIX-7/Kolkata Bangla Movies/', 'Bangla Movies'),
    root('http://172.16.50.7', '/DHAKA-FLIX-7/Foreign Language Movies/', 'Foreign Movies'),
    root('http://172.16.50.7', '/DHAKA-FLIX-7/3D Movies/', '3D Movies'),

    root('http://172.16.50.14', '/DHAKA-FLIX-14/English Movies (1080p)/', 'English 1080p'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/Hindi Movies/', 'Hindi Movies'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/SOUTH INDIAN MOVIES/South Movies/', 'South Movies'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/SOUTH INDIAN MOVIES/Hindi Dubbed/', 'South Hindi Dubbed'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/Animation Movies/', 'Animation'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/Animation Movies (1080p)/', 'Animation 1080p'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/IMDb Top-250 Movies/', 'IMDb Top 250'),
    root('http://172.16.50.14', '/DHAKA-FLIX-14/KOREAN TV & WEB Series/', 'Korean Series'),

    root('http://172.16.50.12', '/DHAKA-FLIX-12/TV-WEB-Series/', 'TV & Web Series'),

    root('http://172.16.50.10', '/DHAKA-FLIX-10/Anime & Cartoon TV Series/', 'Anime & Cartoon'),
    root('http://172.16.50.10', '/DHAKA-FLIX-10/Documentary/', 'Documentary'),
    root('http://172.16.50.10', '/DHAKA-FLIX-10/WWE & AEW Wrestling/', 'Wrestling'),
    root('http://172.16.50.10', '/DHAKA-FLIX-10/Awards & TV Shows/', 'Awards & Shows')
]

function parseRoots() {
    if (!process.env.ROOTS) return DEFAULT_ROOTS
    return process.env.ROOTS.split(',').map((spec) => {
        const [host, pathname, category] = spec.split('|')
        if (!host || !pathname) throw new Error(`Bad ROOTS entry: ${spec}`)
        return root(host.replace(/\/$/, ''), pathname, category || 'BDIX Media')
    })
}

module.exports = {
    PORT,
    ADDON_BASE_URL,
    ROOTS: parseRoots(),
    INDEX_FILE: path.join(__dirname, '..', 'data', 'index.json'),
    // serveHTTP resolves opts.static against process.cwd() and uses it as the mount path;
    // the leading slash is required for Express to match /public/... requests.
    PUBLIC_DIR: '/public',
    PUBLIC_PATH: path.join(__dirname, '..', 'public'),
    CRAWL_CONCURRENCY: Number(process.env.CRAWL_CONCURRENCY || 6),
    CRAWL_MAX_DEPTH: Number(process.env.CRAWL_MAX_DEPTH || 10),
    CRAWL_MAX_ITEMS: Number(process.env.CRAWL_MAX_ITEMS || 0),
    FETCH_TIMEOUT_MS: Number(process.env.FETCH_TIMEOUT_MS || 20000),
    FALLBACK_POSTER: `${ADDON_BASE_URL}/public/poster.png`
}
