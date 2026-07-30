#!/usr/bin/env node
'use strict'

// Dependency-free renderer for benchmark aggregates. It deliberately accepts a
// broad JSON shape so a benchmark runner can evolve without coupling release
// evidence to a charting package.
const fs = require('node:fs')
const path = require('node:path')

function usage(message) {
  if (message) process.stderr.write(`${message}\n`)
  process.stderr.write('Usage: node benchmarks/render-report.cjs --input aggregate.json [--runtime runtime.json] --output-dir directory\n')
  process.exit(message ? 1 : 0)
}

function args(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage()
    if (!['--input', '--runtime', '--output-dir'].includes(arg)) usage(`Unknown option: ${arg}`)
    if (!argv[i + 1]) usage(`Missing value for ${arg}`)
    options[arg.slice(2)] = argv[++i]
  }
  if (!options.input || !options['output-dir']) usage('--input and --output-dir are required')
  return options
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read JSON from ${file}: ${error.message}`)
  }
}

function numberAt(object, paths) {
  for (const candidate of paths) {
    let value = object
    for (const key of candidate.split('.')) value = value && value[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function firstText(object, keys) {
  for (const key of keys) {
    const value = object && object[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function metric(record, names) {
  const direct = names.flatMap(name => [name, `${name}Microseconds`, `${name}Us`, `${name}_us`])
  const nested = names.flatMap(name => [`metrics.${name}`, `stats.${name}`, `summary.${name}`, `percentiles.${name}`])
  return numberAt(record, [...direct, ...nested])
}

function recordsFrom(input) {
  if (Array.isArray(input?.aggregate?.summaries)) {
    const pairedRatios = new Map((input.aggregate.ratios || []).map(record => [record.key, record.ratio]))
    return input.aggregate.summaries.map(record => ({
      workload: `${record.suite}: ${record.workload}`,
      suite: record.suite,
      workloadId: record.workload,
      implementation: record.library,
      median: record.p50Ns / 1_000,
      p95: record.p95Ns / 1_000,
      trials: record.trials,
      comparability: record.note,
      comparable: record.comparable !== false,
      pairedRatio: record.library === 'chronicle' ? 1 : pairedRatios.get(record.key),
    }))
  }
  const found = []
  const seen = new Set()
  function visit(value, context, depth) {
    if (!value || typeof value !== 'object' || depth > 10) return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, context, depth + 1))
      return
    }
    const median = metric(value, ['median', 'p50', 'q50'])
    const p95 = metric(value, ['p95', 'q95'])
    const implementation = firstText(value, ['implementation', 'library', 'subject', 'candidate', 'name', 'label']) || context.implementation
    const workload = firstText(value, ['workload', 'operation', 'benchmark', 'scenario', 'case', 'expression']) || context.workload || 'Unspecified workload'
    if (median !== null && implementation) {
      found.push({
        workload,
        implementation,
        median,
        p95,
        trials: numberAt(value, ['trials', 'runs', 'sampleSize', 'n', 'samples']) || numberAt(value.summary || {}, ['trials', 'runs', 'n']),
        iterations: numberAt(value, ['iterations', 'operations', 'measuredIterations']),
        comparability: firstText(value, ['comparability', 'caveat', 'notes']),
      })
      return
    }
    const next = {
      implementation: firstText(value, ['implementation', 'library', 'subject']) || context.implementation,
      workload: firstText(value, ['workload', 'operation', 'benchmark', 'scenario', 'case', 'expression']) || context.workload,
    }
    Object.values(value).forEach(child => visit(child, next, depth + 1))
  }
  visit(input, {}, 0)
  return found
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))
}

function short(value, length = 42) {
  const text = String(value)
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function fmt(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function ratioFmt(value) {
  if (value > 0 && value < 0.01) return value.toExponential(1)
  return fmt(value)
}

function environment(input, runtime) {
  const sources = [runtime, input].filter(Boolean)
  const get = keys => {
    for (const source of sources) {
      const value = firstText(source, keys)
      if (value) return value
      for (const nested of ['environment', 'metadata', 'runtime', 'machine']) {
        const nestedValue = firstText(source[nested], keys)
        if (nestedValue) return nestedValue
      }
    }
    return null
  }
  const entries = [
    ['Platform', get(['platform', 'os', 'system'])],
    ['CPU', get(['cpu', 'cpuModel', 'processor'])],
    ['Node', get(['node', 'nodeVersion'])],
    ['V8', get(['v8', 'v8Version'])],
    ['Git', get(['gitSha', 'commit', 'sha', 'tag'])],
    ['Generated', get(['generatedAt', 'timestamp', 'measuredAt'])],
  ].filter(([, value]) => value)
  return entries
}

function group(records) {
  const groups = new Map()
  for (const record of records) {
    if (!groups.has(record.workload)) groups.set(record.workload, [])
    groups.get(record.workload).push(record)
  }
  return [...groups.entries()]
}

function svgHeader(width, height, title, description) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc><style>text{font-family:ui-sans-serif,system-ui,sans-serif;fill:#172033}.muted{fill:#526078}.grid{stroke:#d8dee9;stroke-width:1}.axis{stroke:#526078;stroke-width:1}.bar{fill:#2563eb}.bar-p95{fill:#60a5fa}.ratio{fill:#7c3aed}.baseline{stroke:#dc2626;stroke-width:2}.small{font-size:12px}.label{font-size:13px;font-weight:600}.title{font-size:18px;font-weight:700}</style>`
}

function absolutePlot(records, caveat) {
  const width = 1280; const left = 370; const right = 70; const top = 78; const row = 40; const bottom = 94
  const height = top + records.length * row + bottom
  const values = records.flatMap(record => [record.median, record.p95]).filter(Boolean)
  const min = Math.max(Math.min(...values), 0.001)
  const max = Math.max(...values) * 1.25
  const logMin = Math.floor(Math.log10(min)); const logMax = Math.ceil(Math.log10(max))
  const chart = width - left - right
  const x = value => left + ((Math.log10(value) - logMin) / Math.max(1, logMax - logMin)) * chart
  const ticks = []
  for (let power = logMin; power <= logMax; power += 1) ticks.push(10 ** power)
  let body = svgHeader(width, height, 'Absolute latency by workload and implementation', 'Log-scale absolute latency in microseconds. Lower is better.')
  body += `<text x="${left}" y="30" class="title">Absolute latency — log scale (lower is better)</text><text x="${left}" y="52" class="small muted">Median bars are dark; p95 extensions are light. Unit: microseconds (µs).</text>`
  for (const tick of ticks) {
    const tickX = x(tick)
    body += `<line x1="${tickX}" y1="${top - 12}" x2="${tickX}" y2="${height - bottom + 4}" class="grid"/><text x="${tickX}" y="${height - bottom + 24}" text-anchor="middle" class="small muted">${fmt(tick)} µs</text>`
  }
  records.forEach((record, index) => {
    const y = top + index * row
    const label = `${record.workload} — ${record.implementation}`
    body += `<text x="${left - 12}" y="${y + 17}" text-anchor="end" class="label">${escapeXml(short(label, 52))}</text>`
    body += `<rect x="${left}" y="${y + 5}" width="${Math.max(1, x(record.median) - left)}" height="13" class="bar"/><text x="${Math.min(width - 4, x(record.median) + 6)}" y="${y + 16}" class="small">p50 ${fmt(record.median)}</text>`
    if (record.p95) body += `<rect x="${left}" y="${y + 21}" width="${Math.max(1, x(record.p95) - left)}" height="8" class="bar-p95"/><text x="${Math.min(width - 4, x(record.p95) + 6)}" y="${y + 29}" class="small muted">p95 ${fmt(record.p95)}</text>`
  })
  body += `<text x="${left}" y="${height - 28}" class="small muted">Shared task workloads use UTC. Absolute values are medians across fresh-process trials.</text></svg>`
  return body
}

function ratioPlot(groups, caveat) {
  const rows = groups.flatMap(([workload, records]) => {
    const baseline = records.find(record => /chronicle/i.test(record.implementation)) || records[0]
    const comparisons = records.filter(record => record !== baseline)
    return (comparisons.length ? comparisons : [baseline]).map(record => ({ workload, baseline, record, ratio: record.pairedRatio ?? record.median / baseline.median }))
  })
  const width = 1280; const left = 370; const right = 70; const top = 78; const row = 32; const bottom = 94
  const height = top + rows.length * row + bottom
  const span = Math.max(1, ...rows.map(rowItem => Math.abs(Math.log2(rowItem.ratio))))
  const chart = width - left - right; const center = left + chart / 2
  const x = ratio => center + (Math.log2(ratio) / span) * (chart / 2)
  let body = svgHeader(width, height, 'Median Chronicle speed ratio by workload', 'Node-cron median divided by Chronicle median on a symmetric log scale. Right of one favors Chronicle; left favors node-cron.')
  body += `<text x="${left}" y="30" class="title">Median speed ratio — Chronicle baseline at 1×</text><text x="${left}" y="52" class="small muted">node-cron p50 / Chronicle p50: right favors Chronicle; left favors node-cron.</text>`
  const powers = []
  const tickStep = Math.max(1, Math.ceil((Math.ceil(span) * 2 + 1) / 10))
  for (let power = -Math.ceil(span); power <= Math.ceil(span); power += tickStep) powers.push(2 ** power)
  if (!powers.includes(1)) powers.push(1)
  powers.sort((left, right) => left - right)
  for (const ratio of powers) {
    const tickX = x(ratio); const css = ratio === 1 ? 'baseline' : 'grid'
    body += `<line x1="${tickX}" y1="${top - 12}" x2="${tickX}" y2="${height - bottom + 4}" class="${css}"/><text x="${tickX}" y="${height - bottom + 24}" text-anchor="middle" class="small muted">${ratioFmt(ratio)}×</text>`
  }
  rows.forEach((rowItem, index) => {
    const y = top + index * row
    const label = `${rowItem.workload} — ${rowItem.record.implementation}`
    body += `<text x="${left - 12}" y="${y + 17}" text-anchor="end" class="label">${escapeXml(short(label, 52))}</text>`
    const start = Math.min(center, x(rowItem.ratio)); const end = Math.max(center, x(rowItem.ratio))
    body += `<rect x="${start}" y="${y + 5}" width="${Math.max(1, end - start)}" height="14" class="ratio"/><circle cx="${x(rowItem.ratio)}" cy="${y + 12}" r="4" fill="#4c1d95"/><text x="${Math.min(width - 5, x(rowItem.ratio) + 7)}" y="${y + 17}" class="small">${ratioFmt(rowItem.ratio)}×</text>`
  })
  body += `<text x="${left}" y="${height - 28}" class="small muted">Shared task workloads use UTC. Warm next-run uses the live clock; API internals differ.</text></svg>`
  return body
}

function heatmap(input, caveat) {
  const ratios = input?.aggregate?.ratios
  if (!Array.isArray(ratios) || !ratios.length) return null
  const parsed = ratios.map(item => {
    const separator = item.key.indexOf(':')
    return { suite: item.key.slice(0, separator), workload: item.key.slice(separator + 1), ratio: item.ratio }
  })
  const suites = [...new Set(parsed.map(item => item.suite))]
  const workloads = [...new Set(parsed.map(item => item.workload))]
  const cellWidth = 60; const cellHeight = 31; const left = 225; const top = 180; const right = 35; const bottom = 80
  const width = left + workloads.length * cellWidth + right
  const height = top + suites.length * cellHeight + bottom
  const color = ratio => {
    const strength = Math.min(1, Math.abs(Math.log2(Math.max(ratio, 1e-9))) / 12)
    if (ratio >= 1) return `rgb(${Math.round(225 - 145 * strength)},${Math.round(245 - 65 * strength)},${Math.round(232 - 125 * strength)})`
    return `rgb(${Math.round(254 - 20 * strength)},${Math.round(226 - 125 * strength)},${Math.round(226 - 115 * strength)})`
  }
  let body = svgHeader(width, height, 'Chronicle speed ratio heatmap across all comparable workloads', 'Each cell is node-cron median divided by Chronicle median. Green above one favors Chronicle; red below one favors node-cron.')
  body += `<text x="${left}" y="30" class="title">All comparable workloads — median speed ratio</text><text x="${left}" y="52" class="small muted">node-cron p50 / Chronicle p50: green &gt;1 favors Chronicle; red &lt;1 favors node-cron.</text>`
  workloads.forEach((workload, index) => {
    const x = left + index * cellWidth + cellWidth / 2
    body += `<text x="${x}" y="${top - 10}" transform="rotate(-55 ${x} ${top - 10})" text-anchor="start" class="small">${escapeXml(short(workload, 22))}</text>`
  })
  suites.forEach((suite, row) => {
    const y = top + row * cellHeight
    body += `<text x="${left - 10}" y="${y + 20}" text-anchor="end" class="label">${escapeXml(short(suite, 30))}</text>`
    workloads.forEach((workload, column) => {
      const item = parsed.find(candidate => candidate.suite === suite && candidate.workload === workload)
      const x = left + column * cellWidth
      if (!item) {
        body += `<rect x="${x + 1}" y="${y + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="#f1f5f9"/>`
        return
      }
      body += `<rect x="${x + 1}" y="${y + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="${color(item.ratio)}"/><text x="${x + cellWidth / 2}" y="${y + 20}" text-anchor="middle" class="small">${item.ratio < 0.01 ? item.ratio.toExponential(1) : fmt(item.ratio)}×</text>`
    })
  })
  body += `<text x="${left}" y="${height - 28}" class="small muted">Green means Chronicle was faster; red means node-cron was faster. See summary.md for methodology.</text></svg>`
  return body
}

function markdown(records, groups, env, caveat) {
  const lines = ['# Benchmark evidence', '', '> Lower latency is better. This report is generated from release benchmark JSON; do not compare values across different runner classes without noting the environment.', '']
  if (env.length) {
    lines.push('## Environment', '')
    env.forEach(([key, value]) => lines.push(`- **${key}:** ${value}`))
    lines.push('')
  }
  lines.push('## Results', '', '| Workload | Implementation | Trials (n) | Median (µs) | p95 (µs) | Ratio to workload baseline |', '| --- | --- | ---: | ---: | ---: | ---: |')
  for (const [workload, list] of groups) {
    const baseline = list.find(record => /chronicle/i.test(record.implementation)) || list[0]
    for (const record of list) lines.push(`| ${workload} | ${record.implementation} | ${record.trials || '—'} | ${fmt(record.median)} | ${record.p95 ? fmt(record.p95) : '—'} | ${ratioFmt(record.pairedRatio ?? record.median / baseline.median)}× |`)
  }
  lines.push('', '## Comparability caveat', '', caveat, '', 'Artifacts: `latency-log.svg` shows absolute p50/p95 values on a log scale. `latency-ratio.svg` centers the selected baseline at 1× on a symmetric log scale.')
  return `${lines.join('\n')}\n`
}

function main() {
  const options = args(process.argv.slice(2))
  const input = readJson(options.input)
  const runtime = options.runtime ? readJson(options.runtime) : null
  const records = recordsFrom(input)
  if (!records.length) throw new Error('No benchmark records found. Expected records with an implementation/name and median or p50 latency.')
  const comparableRecords = records.filter(record => record.comparable !== false)
  const headlineRecords = comparableRecords.some(record => record.suite === 'getNextRun-warm')
    ? comparableRecords.filter(record => record.suite === 'getNextRun-warm')
    : comparableRecords
  const groups = group(headlineRecords)
  const env = environment(input, runtime)
  const caveat = (Array.isArray(input.caveats) ? input.caveats.join(' ') : firstText(input, ['comparability', 'caveat', 'notes'])) || 'Ratios compare measured public operations. API shape and lifecycle work can differ; interpret each workload label before drawing a product-wide conclusion.'
  fs.mkdirSync(options['output-dir'], { recursive: true })
  fs.writeFileSync(path.join(options['output-dir'], 'summary.md'), markdown(headlineRecords, groups, env, caveat))
  fs.writeFileSync(path.join(options['output-dir'], 'latency-log.svg'), absolutePlot(headlineRecords, caveat))
  fs.writeFileSync(path.join(options['output-dir'], 'latency-ratio.svg'), ratioPlot(groups, caveat))
  const matrix = heatmap(input, caveat)
  if (matrix) fs.writeFileSync(path.join(options['output-dir'], 'ratio-heatmap.svg'), matrix)
  process.stdout.write(JSON.stringify({ records: records.length, headlineRecords: headlineRecords.length, outputDir: path.resolve(options['output-dir']) }) + '\n')
}

try { main() } catch (error) { process.stderr.write(`render-report: ${error.message}\n`); process.exitCode = 1 }
