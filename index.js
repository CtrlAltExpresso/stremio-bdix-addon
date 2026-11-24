#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const config = require('./lib/config')
const { buildIndex } = require('./lib/crawler')

async function main() {
    const args = process.argv.slice(2)
    const onlyIndex = args.indexOf('--only')
    let roots = config.ROOTS
    if (onlyIndex !== -1 && args[onlyIndex + 1]) {
        const needle = args[onlyIndex + 1].toLowerCase()
        roots = roots.filter((root) =>
            `${root.category} ${root.url}`.toLowerCase().includes(needle)
        )
        if (!roots.length) throw new Error(`No roots match --only ${args[onlyIndex + 1]}`)
    }

    const maxIndex = args.indexOf('--max-items')
    if (maxIndex !== -1) {
        const value = Number(args[maxIndex + 1])
        if (Number.isFinite(value) && value > 0) config.CRAWL_MAX_ITEMS = value
    }

    const index = await buildIndex(roots)
    fs.mkdirSync(path.dirname(config.INDEX_FILE), { recursive: true })
    const tmp = `${config.INDEX_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2))
    fs.renameSync(tmp, config.INDEX_FILE)

    console.error(`[index] wrote ${config.INDEX_FILE}`)
    console.log(JSON.stringify(index.stats, null, 2))
    if (index.errors.length) console.error(`[index] first errors:\n${index.errors.slice(0, 5).join('\n')}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
