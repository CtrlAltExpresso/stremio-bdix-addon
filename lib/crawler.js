'use strict'

const config = require('./config')
const {
    safeDecode,
    pathnameOf,
    baseName,
    encodeId,
    isVideo,
    isImage,
    parseSize,
    formatBytes,
    parseTitle,
    parseEpisode,
    parseSeason,
    pickPoster,
    pickBackground,
    isSeriesPath
} = require('./util')

const H5AI_ROW_RE = /<tr>\s*<td class="fb-i">[\s\S]*?<\/td>\s*<td class="fb-n"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/td>\s*<td class="fb-d">([\s\S]*?)<\/td>\s*<td class="fb-s">([\s\S]*?)<\/td>\s*<\/tr>/gi
const GENERIC_LINK_RE = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi

async function fetchDir(url, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs || config.FETCH_TIMEOUT_MS)
    let response
    try {
        response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'stremio-bdix-addon/1.0' }
        })
    } finally {
        clearTimeout(timer)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const html = await response.text()
    return parseListing(html, url)
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            try { return String.fromCodePoint(Number.parseInt(hex, 16)) } catch { return _ }
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            try { return String.fromCodePoint(Number(dec)) } catch { return _ }
        })
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
}

function normalizeHref(href, baseUrl) {
    if (!href || href === '..' || href.startsWith('#') || href.startsWith('?')) return null
    href = decodeHtml(href)
    if (/^(javascript|mailto):/i.test(href)) return null
    try {
        const parsed = new URL(href, baseUrl)
        if (parsed.origin !== new URL(baseUrl).origin) return null
        if (parsed.pathname.includes('/_h5ai/')) return null
        return parsed.href
    } catch {
        return null
    }
}

function parseListing(html, baseUrl) {
    const entries = []
    const seen = new Set()
    let match

    while ((match = H5AI_ROW_RE.exec(html)) !== null) {
        const url = normalizeHref(match[1], baseUrl)
        if (!url || seen.has(url)) continue
        seen.add(url)
        const name = decodeHtml(safeDecode(match[2]).replace(/<[^>]+>/g, '')).trim()
        entries.push({
            url,
            name,
            isDir: match[1].endsWith('/'),
            size: parseSize(match[4])
        })
    }

    if (!entries.length) {
        while ((match = GENERIC_LINK_RE.exec(html)) !== null) {
            const url = normalizeHref(match[1], baseUrl)
            if (!url || seen.has(url)) continue
            seen.add(url)
            entries.push({
                url,
                name: decodeHtml(safeDecode(match[2])).trim(),
                isDir: match[1].endsWith('/'),
                size: 0
            })
        }
    }

    return entries
}

function pad(number, length = 2) {
    return String(number).padStart(length, '0')
}

function episodeTitle(file) {
    const parsed = parseTitle(baseName(file.url))
    let name = parsed.name
    if (name && /^\d/.test(name)) name = name.replace(/^\d+\s*[.\-_]\s*/, '')
    return name && name.length > 2 ? name : baseName(file.url)
}

function buildVideos(files, fallbackYear, fallbackSeason) {
    const episodeCounters = new Map()
    return files
        .filter((file) => isVideo(file.name))
        .map((file) => {
            const episode = parseEpisode(file.name)
            const season = episode ? episode.season : (fallbackSeason || file.seasonHint || null)
            let number = episode ? episode.episode : null
            if (season && !number) {
                // Some release names have no SxxExx tag; number them in listing order.
                const key = String(season)
                number = (episodeCounters.get(key) || 0) + 1
                episodeCounters.set(key, number)
            }
            const title = season && number
                ? `S${pad(season)}E${pad(number, number > 99 ? 3 : 2)} · ${episodeTitle(file)}`
                : episodeTitle(file)
            return {
                id: encodeId(file.url),
                title,
                ...(season ? { season } : {}),
                ...(number ? { episode: number } : {}),
                ...(fallbackYear ? { released: `${fallbackYear}-01-01` } : {}),
                url: file.url,
                size: file.size || 0,
                filename: baseName(file.url)
            }
        })
        .sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || a.title.localeCompare(b.title))
}

function makeItem(context) {
    const { root, dirUrl, type, source, videos, images, year, releaseInfo } = context
    const parsed = parseTitle(source)
    const name = parsed.name || source
    const poster = pickPoster(images) || config.FALLBACK_POSTER
    const background = pickBackground(images) || poster
    const size = videos.reduce((sum, video) => sum + (video.size || 0), 0)
    const normalizedVideos = type === 'movie'
        ? videos.map((video) => ({ ...video, title: name }))
        : videos
    // Keep the largest video as the movie's primary ID so existing library
    // links stay valid, while videos[] still carries every available copy.
    const primaryMovieVideo = type === 'movie'
        ? [...normalizedVideos].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
        : null
    const mainUrl = type === 'series' ? dirUrl : (primaryMovieVideo && primaryMovieVideo.url) || dirUrl

    return {
        id: encodeId(mainUrl),
        type,
        name,
        originalName: parsed.original,
        year: year || parsed.year || null,
        releaseInfo: releaseInfo || parsed.releaseInfo || (year ? String(year) : null),
        poster,
        background,
        url: mainUrl,
        folderUrl: dirUrl,
        category: root.category,
        root: root.url,
        size,
        videos: normalizedVideos,
        added: Date.now()
    }
}

async function processDirectory(entry, crawler) {
    const { url, depth, root } = entry
    if (crawler.visited.has(url)) return []
    crawler.visited.add(url)

    // Season/Specials folders are collected by their parent series folder, never indexed alone.
    const currentName = baseName(url)
    if (parseSeason(currentName) !== null || /^specials?$/i.test(currentName)) return []

    let entries
    try {
        entries = await fetchDir(url)
    } catch (error) {
        crawler.errors.push(`${error.message}`)
        return []
    }

    crawler.processed += 1
    if (crawler.processed % 100 === 0) {
        console.error(`[crawl] ${crawler.processed} directories, ${crawler.items.length} titles`)
    }

    const subdirs = entries.filter((item) => item.isDir && !item.name.startsWith('.'))
    const files = entries.filter((item) => !item.isDir)
    const videos = files.filter((item) => isVideo(item.name))
    const images = files.filter((item) => isImage(item.name))
    const seasonDirs = subdirs.filter((item) =>
        parseSeason(item.name) !== null || /^specials?$/i.test(item.name)
    )

    const looksLikeSeries = seasonDirs.length > 0 ||
        (isSeriesPath(url) && videos.some((video) => parseEpisode(video.name)))

    if (looksLikeSeries) {
        const seasonFiles = []
        for (const seasonDir of seasonDirs) {
            crawler.visited.add(seasonDir.url)
            try {
                const seasonListing = await fetchDir(seasonDir.url)
                const seasonNumber = parseSeason(seasonDir.name)
                for (const file of seasonListing.filter((item) => !item.isDir && isVideo(item.name))) {
                    seasonFiles.push({ ...file, seasonHint: seasonNumber })
                }
                const seasonImages = seasonListing.filter((item) => !item.isDir && isImage(item.name))
                images.push(...seasonImages)
            } catch (error) {
                crawler.errors.push(`${error.message}`)
            }
        }

        const allFiles = seasonFiles.length ? seasonFiles : videos
        const episodeVideos = buildVideos(allFiles, parseTitle(baseName(url)).year, null)

        if (episodeVideos.length) {
            return [makeItem({
                root,
                dirUrl: url,
                type: 'series',
                source: baseName(url),
                videos: episodeVideos,
                images,
                year: parseTitle(baseName(url)).year
            })]
        }
    }

    if (!videos.length) {
        if (depth < config.CRAWL_MAX_DEPTH) {
            for (const subdir of subdirs) {
                if (seasonDirs.includes(subdir)) continue
                crawler.queue.push({ url: subdir.url, depth: depth + 1, root })
            }
        }
        return []
    }

    // A movie folder often holds several copies (720p/1080p, dual audio, etc.).
    // Index every video so the source picker can offer all of them.
    const parsed = parseTitle(baseName(url))
    return [makeItem({
        root,
        dirUrl: url,
        type: 'movie',
        source: baseName(url),
        videos: buildVideos(videos, parsed.year, null),
        images,
        year: parsed.year
    })]
}

async function crawlRoot(root, crawler) {
    crawler.queue.push({ url: root.url, depth: 0, root })

    while (crawler.queue.length) {
        if (config.CRAWL_MAX_ITEMS && crawler.items.length >= config.CRAWL_MAX_ITEMS) break
        const batch = crawler.queue.splice(0, config.CRAWL_CONCURRENCY)
        const results = await Promise.allSettled(batch.map((entry) => processDirectory(entry, crawler)))
        for (const result of results) {
            if (result.status === 'fulfilled') crawler.items.push(...result.value)
            else crawler.errors.push(String(result.reason))
        }
    }
}

async function buildIndex(roots = config.ROOTS) {
    const crawler = {
        queue: [],
        visited: new Set(),
        items: [],
        errors: [],
        processed: 0
    }

    for (const root of roots) {
        console.error(`[crawl] root ${root.category}: ${root.url}`)
        await crawlRoot(root, crawler)
        if (config.CRAWL_MAX_ITEMS && crawler.items.length >= config.CRAWL_MAX_ITEMS) break
    }

    const unique = []
    const ids = new Set()
    for (const item of crawler.items) {
        if (ids.has(item.id)) continue
        ids.add(item.id)
        unique.push(item)
    }

    unique.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'movie' ? -1 : 1
        return a.name.localeCompare(b.name)
    })

    return {
        generatedAt: new Date().toISOString(),
        stats: {
            roots: roots.length,
            directories: crawler.processed,
            titles: unique.length,
            movies: unique.filter((item) => item.type === 'movie').length,
            series: unique.filter((item) => item.type === 'series').length,
            errors: crawler.errors.length
        },
        errors: crawler.errors.slice(0, 100),
        items: unique
    }
}

module.exports = { buildIndex, fetchDir, parseListing, formatBytes, pathnameOf }
