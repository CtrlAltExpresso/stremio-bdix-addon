'use strict'

const ID_PREFIX = 'df1:'

const VIDEO_RE = /\.(mkv|mp4|avi|mov|m4v|webm|ts|m2ts|flv|wmv|mpg|mpeg|3gp)$/i
const IMAGE_RE = /\.(jpe?g|png|webp)$/i

const NOISE_RE = /\b(720p|1080p|2160p|4k|web-?dl|webrip|web|amzn|nf|hdtc|hdts|hdcam|camrip|brrip|bluray|dvdrip|x264|x265|h264|hevc|10bit|6ch|esub|dd|dual[ -]?audio|multi[ -]?audio|hindi|english|tamil|telugu|malayalam|korean|japanese|aac|ac3|ddp5\.1|ddp5|dolby|imax|remux|proper|repack|extended|unrated|limited|complete|collection|filmography|series|season|episode|2 0|5 1|2\.0|5\.1|750mb|mkvcage|pahe|yts)\b/gi

// Circle hosts often name folders "Agatha.And.The.Truth.Of.Murder.2018.1080p...".
// Turn separator dots into spaces but keep decimals like AAC 2.0 / DDP5.1 intact.
function normalizeSeparators(text) {
    const decimals = []
    const masked = text.replace(/(?<!\d)\d\.\d(?!\d)/g, (value) => {
        decimals.push(value)
        return `\u0000${decimals.length - 1}\u0000`
    })
    return masked
        .replace(/\./g, ' ')
        .replace(/\u0000(\d+)\u0000/g, (_, index) => decimals[Number(index)])
        .replace(/\s+/g, ' ')
        .trim()
}

function safeDecode(value) {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function pathnameOf(url) {
    try {
        return new URL(url).pathname
    } catch {
        return String(url)
    }
}

function baseName(url) {
    const parts = pathnameOf(url).split('/').filter(Boolean)
    return safeDecode(parts[parts.length - 1] || '')
}

function encodeId(url) {
    return ID_PREFIX + Buffer.from(url, 'utf8').toString('base64url')
}

function decodeId(id) {
    if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) return null
    try {
        const url = Buffer.from(id.slice(ID_PREFIX.length), 'base64url').toString('utf8')
        const parsed = new URL(url)
        if (!/^https?:$/.test(parsed.protocol)) return null
        return url
    } catch {
        return null
    }
}

function isVideo(name) {
    return VIDEO_RE.test(name)
}

function isImage(name) {
    return IMAGE_RE.test(name)
}

function parseSize(text) {
    if (!text) return 0
    const match = String(text).trim().match(/^([\d.,]+)\s*(B|KIB|KB|MIB|MB|GIB|GB|TIB|TB)$/i)
    if (!match) return 0
    const value = Number(match[1].replace(/,/g, ''))
    const unit = match[2].toUpperCase()
    const factors = {
        B: 1,
        KB: 1000, KIB: 1024,
        MB: 1000 ** 2, MIB: 1024 ** 2,
        GB: 1000 ** 3, GIB: 1024 ** 3,
        TB: 1000 ** 4, TIB: 1024 ** 4
    }
    return Math.round(value * (factors[unit] || 1))
}

function formatBytes(bytes) {
    if (!bytes || bytes < 0) return ''
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    let i = 0
    let n = bytes
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024
        i += 1
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function parseTitle(raw) {
    const original = safeDecode(String(raw || '')).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    let text = original.replace(VIDEO_RE, '')

    const normalizedFull = normalizeSeparators(text)
    const withoutTags = text.replace(/[\[(][^\])]{0,100}[\])]/g, ' ')
    const normalized = normalizeSeparators(withoutTags)

    const years = normalizedFull.match(/\b(?:19|20)\d{2}\b/g) || []
    // Dotted release names start with the title year: "1922.2017.1080p...".
    const dottedTitleYear = normalizedFull.match(/^((?:19|20)\d{2})\s+((?:19|20)\d{2})\b/)
    const year = dottedTitleYear ? Number(dottedTitleYear[2]) : (years.length ? Number(years[0]) : null)
    let releaseInfo = null
    if (dottedTitleYear) {
        releaseInfo = dottedTitleYear[2]
    } else if (years.length >= 2) {
        releaseInfo = `${years[0]}-${years[years.length - 1]}`
    } else if (year) {
        releaseInfo = String(year)
    }

    let cleaned = normalized
        .replace(NOISE_RE, ' ')
        .replace(/[-–—:,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.\-–—]+|[\s.\-–—]+$/g, '')
    if (dottedTitleYear) {
        cleaned = cleaned.replace(new RegExp(`\\s+${dottedTitleYear[2]}\\b`), ' ')
    }
    const withoutYears = cleaned.replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim()

    // Keep a year-only title ("1923", "1899") instead of falling back to the raw folder name.
    text = (withoutYears || cleaned || original.replace(VIDEO_RE, '').slice(0, 100)).trim()

    return {
        name: text || original || 'Untitled',
        year,
        releaseInfo,
        original
    }
}

function parseEpisode(name) {
    const text = safeDecode(name)
    let match = text.match(/\b[Ss](\d{1,2})[\s._-]*[Ee](\d{2,4})\b/)
    if (!match) match = text.match(/Season\s*(\d+)\D+Episode\s*(\d+)/i)
    if (!match) match = text.match(/\b(\d{1,2})[xX](\d{2,3})\b/)
    // Bare episode numbers in release names: "..._-_01_(Dual Audio)..."
    if (!match) match = text.match(/[-–—]\s*(\d{1,3})\b/)
    if (!match) match = text.match(/_\s*0?(\d{1,3})\s*_/)
    if (!match) return null
    if (match[2] === undefined) return { season: null, episode: Number(match[1]) }
    return { season: Number(match[1]), episode: Number(match[2]) }
}

function parseSeason(name) {
    const match = safeDecode(name).match(/Season\s*(\d+)/i)
    return match ? Number(match[1]) : null
}

function normalizeTitle(name) {
    return String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/^(the|a|an)\s+/, '')
        .trim()
}

function qualityOf(name) {
    const text = safeDecode(name)
    const match = text.match(/\b(2160p|1080p|720p|480p|4K)\b/i)
    return match ? match[1].toUpperCase() : 'BDIX'
}

function pickPoster(images) {
    if (!images.length) return null
    const preferred = images.find((img) => /a_AL_|poster|cover|folder\.(jpg|png)/i.test(img.name))
    return (preferred || images[0]).url
}

function pickBackground(images) {
    if (!images.length) return null
    const preferred = images.find((img) => /a_VL_|fanart|backdrop|background/i.test(img.name))
    return (preferred || images[images.length - 1]).url
}

function isSeriesPath(url) {
    const decoded = safeDecode(pathnameOf(url))
    return /\b(series|tv-web|anime|cartoon|wrestling|documentary|awards|shows)\b/i.test(decoded)
}

function streamFor(url, options = {}) {
    const filename = options.filename || baseName(url)
    const size = Number(options.size) || 0
    return {
        url,
        name: options.name || qualityOf(filename),
        description: [formatBytes(size), filename].filter(Boolean).join(' · '),
        behaviorHints: {
            notWebReady: String(new URL(url).protocol).startsWith('http:'),
            ...(size ? { videoSize: size } : {}),
            filename
        }
    }
}

module.exports = {
    ID_PREFIX,
    VIDEO_RE,
    IMAGE_RE,
    safeDecode,
    pathnameOf,
    baseName,
    encodeId,
    decodeId,
    isVideo,
    isImage,
    parseSize,
    formatBytes,
    parseTitle,
    normalizeTitle,
    parseEpisode,
    parseSeason,
    qualityOf,
    pickPoster,
    pickBackground,
    isSeriesPath,
    streamFor
}
