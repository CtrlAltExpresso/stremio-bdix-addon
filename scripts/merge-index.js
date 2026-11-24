#!/usr/bin/env node
'use strict'

// Merge a freshly crawled index (new roots) into an existing index without
// re-crawling the original roots. Items are deduplicated by their stable ID.
//
// Usage:
//   node scripts/merge-index.js data/index.json /tmp/circle-index.json data/index.json

const fs = require('node:fs')
const path = require('node:path')

const [basePath, extraPath, outputPath = basePath] = process.argv.slice(2)
if (!basePath || !extraPath) {
    console.error('Usage: node scripts/merge-index.js <base.json> <extra.json> [output.json]')
    process.exit(1)
}

function load(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const base = load(basePath)
const extra = load(extraPath)

const byId = new Map()
for (const item of [...base.items, ...extra.items]) {
    if (!byId.has(item.id)) byId.set(item.id, item)
}

const items = [...byId.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'movie' ? -1 : 1
    return a.name.localeCompare(b.name)
})

const merged = {
    generatedAt: new Date().toISOString(),
    stats: {
        roots: (base.stats?.roots || 0) + (extra.stats?.roots || 0),
        directories: (base.stats?.directories || 0) + (extra.stats?.directories || 0),
        titles: items.length,
        movies: items.filter((item) => item.type === 'movie').length,
        series: items.filter((item) => item.type === 'series').length,
        errors: (base.stats?.errors || 0) + (extra.stats?.errors || 0)
    },
    errors: [...(base.errors || []), ...(extra.errors || [])].slice(0, 100),
    items
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
const tmp = `${outputPath}.tmp`
fs.writeFileSync(tmp, JSON.stringify(merged, null, 2))
fs.renameSync(tmp, outputPath)

console.log(JSON.stringify(merged.stats, null, 2))
console.log(`[merge] wrote ${outputPath}`)
