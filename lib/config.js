'use strict'

const path = require('node:path')

const PORT = Number(process.env.PORT || 7000)
const ADDON_BASE_URL = (process.env.ADDON_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')

function root(host, pathname, category) {
    return { url: host + encodeURI(pathname), category }
}

function circle(host, pathname, category) {
    return root(`http://${host}.circleftp.net`, pathname, `Circle ${category}`)
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
    root('http://172.16.50.10', '/DHAKA-FLIX-10/Awards & TV Shows/', 'Awards & Shows'),

    // Public h5ai hosts linked by http://main.circleftp.net/. ftp3, ftp4 and
    // ftp5 are omitted because they consistently time out from this network.
    circle('ftp6', '/FILE/English & Foreign TV Series/', 'Circle TV 6'),
    circle('ftp7', '/FILE/English & Foreign TV Series/', 'Circle TV 7'),
    circle('ftp8', '/FILE/Hindi Awards Shows/', 'Circle Hindi Awards'),
    circle('ftp8', '/FILE/Hindi TV Series/', 'Circle Hindi TV'),
    circle('ftp8', '/FILE/Indian TV Shows/', 'Circle Indian TV'),
    circle('ftp9', '/FILE/English & Foreign TV Series/', 'Circle TV 9'),
    circle('ftp10', '/FILE/File/English & Foreign TV Series/', 'Circle TV 10'),
    circle('ftp11', '/FILE/English & Foreign TV Series/', 'Circle TV 11'),
    circle('ftp12', '/FILE/English & Foreign TV Series/', 'Circle TV 12'),
    circle('ftp13', '/FILE/Tamil Telugu & Others/', 'Tamil & Telugu'),
    circle('ftp13', '/FILE/Tamil Telugu & Others Hindi Dubbed/', 'Tamil/Telugu Dubbed'),
    circle('ftp15', '/FILE/English & Foreign Anime Series/', 'Circle Anime 15'),
    circle('ftp16', '/FILE/Dubbed TV Series & Shows/', 'Circle Dubbed TV'),
    circle('ftp17', '/FILE/English & Foreign Anime Series/', 'Anime Series'),
    circle('ftp17', '/FILE/Tamil Telugu & Others/', 'Tamil & Telugu'),
    circle('ftp17', '/FILE/Tamil Telugu & Others Hindi Dubbed/', 'Tamil/Telugu Dubbed'),
    circle('index1', '/FILE/Hindi Movies/', 'Hindi Movies'),
    circle('index2', '/FILE/English & Foreign Dubbed Movies/', 'Foreign Dubbed'),
    circle('index2', '/FILE/English Movies/', 'English Movies'),
    circle('index', '/FILE/English & Foreign Dubbed Movies/', 'Foreign Dubbed'),
    circle('index', '/FILE/English Movies/', 'English Movies')
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
    INDEX_FILE: process.env.INDEX_FILE || path.join(__dirname, '..', 'data', 'index.json'),
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
