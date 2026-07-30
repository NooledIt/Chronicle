#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_RUNS = 7
const BUDGET_NS = 12_000_000n
const MIN_SAMPLES = 3
const MAX_SAMPLES = 200
let blackhole

const EXPRESSIONS = [
  { id: 'dense', expression: '* * * * * *', match: '2026-01-05T09:00:17Z' },
  { id: 'simple', expression: '0 9 * * *', match: '2026-01-05T09:00:00Z' },
  { id: 'stepped', expression: '*/15 * * * *', match: '2026-01-05T09:15:00Z' },
  { id: 'named', expression: '0 9-17/2 * Jan,Sep Mon-Fri', match: '2026-09-07T09:00:00Z' },
  { id: 'yearly', expression: '0 0 1 1 *', match: '2027-01-01T00:00:00Z' },
  { id: 'leap', expression: '0 0 29 2 *', match: '2028-02-29T00:00:00Z' },
  { id: 'wrapped', expression: '0 22-2 * Nov-Feb Fri-Mon', match: '2026-11-06T23:00:00Z' },
  { id: 'last-day', expression: '0 0 L * ?', match: '2028-02-29T00:00:00Z' },
  { id: 'last-offset', expression: '0 0 L-3 * ?', match: '2028-02-26T00:00:00Z' },
  { id: 'nearest-weekday', expression: '0 0 15W * ?', match: '2026-08-14T00:00:00Z' },
  { id: 'last-weekday', expression: '0 0 LW * ?', match: '2026-05-29T00:00:00Z' },
  { id: 'nth-weekday', expression: '0 0 ? * 2#3', match: '2026-01-20T00:00:00Z' },
  { id: 'weekday-last', expression: '0 0 ? * 5L', match: '2026-01-30T00:00:00Z' },
]

const INVALID_EXPRESSIONS = [
  { id: 'invalid-field-count', expression: '* * * *' },
  { id: 'invalid-range', expression: '61 * * * *' },
  { id: 'invalid-step', expression: '*/0 * * * *' },
  { id: 'impossible-date', expression: '0 0 31 2 *' },
  { id: 'invalid-last-offset', expression: '0 0 L-31 * ?' },
  { id: 'invalid-nth-weekday', expression: '0 0 ? * 2#6' },
]

const TIMEZONES = [
  { id: 'utc', timezone: 'UTC', match: '2026-07-15T09:00:00Z' },
  { id: 'new-york', timezone: 'America/New_York', match: '2026-07-15T13:00:00Z' },
  { id: 'berlin', timezone: 'Europe/Berlin', match: '2026-01-15T08:00:00Z' },
  { id: 'kathmandu', timezone: 'Asia/Kathmandu', match: '2026-01-15T03:15:00Z' },
  { id: 'lord-howe', timezone: 'Australia/Lord_Howe', match: '2026-01-14T22:00:00Z' },
]

function args() {
  const result = {}
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index]
    if (key.startsWith('--')) result[key.slice(2)] = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[++index] : true
  }
  return result
}

function quantile(sorted, fraction) {
  if (!sorted.length) return 0
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5)
}

function mad(values) {
  const center = median(values)
  return median(values.map((value) => Math.abs(value - center)))
}

function summarize(samples, iterations) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    samples: samples.length,
    iterations,
    p50Ns: Math.round(quantile(sorted, 0.5)),
    p95Ns: Math.round(quantile(sorted, 0.95)),
    madNs: Math.round(mad(samples)),
  }
}

function measureSync(operation) {
  const warmStart = process.hrtime.bigint()
  blackhole = operation()
  const firstWarmup = process.hrtime.bigint() - warmStart
  if (firstWarmup < 500_000n) {
    for (let index = 1; index < 20; index += 1) blackhole = operation()
  }
  let batch = 1
  let calibration = 0n
  while (batch < 65_536) {
    const start = process.hrtime.bigint()
    for (let index = 0; index < batch; index += 1) blackhole = operation()
    calibration = process.hrtime.bigint() - start
    if (calibration >= 250_000n) break
    batch *= 2
  }
  const samples = []
  let iterations = 0
  let elapsed = 0n
  const sampleFloor = calibration >= BUDGET_NS ? 1 : MIN_SAMPLES
  while (samples.length < MAX_SAMPLES && (samples.length < sampleFloor || elapsed < BUDGET_NS)) {
    const start = process.hrtime.bigint()
    for (let index = 0; index < batch; index += 1) blackhole = operation()
    const duration = process.hrtime.bigint() - start
    elapsed += duration
    iterations += batch
    samples.push(Number(duration) / batch)
  }
  return summarize(samples, iterations)
}

async function measureAsync(operation) {
  for (let index = 0; index < 3; index += 1) blackhole = await operation()
  const samples = []
  let elapsed = 0n
  while (samples.length < MAX_SAMPLES && (samples.length < MIN_SAMPLES || elapsed < BUDGET_NS)) {
    const start = process.hrtime.bigint()
    blackhole = await operation()
    const duration = process.hrtime.bigint() - start
    elapsed += duration
    samples.push(Number(duration))
  }
  return summarize(samples, samples.length)
}

function metric(library, suite, workload, measured, comparable = true, note) {
  return {
    key: `${suite}:${workload.id}`,
    library,
    suite,
    workload: workload.id,
    expression: workload.expression,
    options: workload.options,
    comparable,
    note,
    unit: 'nanoseconds/operation',
    ...measured,
  }
}

function loadLibrary(name) {
  if (name === 'chronicle') return require(path.join(ROOT, 'node', 'cron.js'))
  return require(path.join(ROOT, 'node', 'node_modules', 'node-cron'))
}

function quietLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

async function cleanup(task) {
  await Promise.resolve(task.stop())
  await Promise.resolve(task.destroy())
}

async function worker(library, trial) {
  const cron = loadLibrary(library)
  cron.setLogger?.(quietLogger())
  const results = []

  for (const workload of EXPRESSIONS) {
    results.push(metric(library, 'validate', workload, measureSync(() => cron.validate(workload.expression))))
    results.push(metric(library, 'validateDetailed', workload, measureSync(() => cron.validateDetailed(workload.expression))))
    results.push(metric(library, 'parse', workload, measureSync(() => cron.parse(workload.expression))))

    const matchTask = cron.createTask(workload.expression, () => {}, { timezone: 'UTC', unref: true })
    const matchDate = new Date(workload.match)
    if (!matchTask.match(matchDate)) throw new Error(`${library} did not match ${workload.id} at ${workload.match}`)
    results.push(metric(library, 'match-fixed', workload, measureSync(() => matchTask.match(matchDate))))
    await Promise.resolve(matchTask.destroy())

    const warmTask = cron.createTask(workload.expression, () => {}, { timezone: 'UTC', unref: true })
    await Promise.resolve(warmTask.start())
    results.push(metric(library, 'getNextRun-warm', workload, measureSync(() => warmTask.getNextRun())))
    results.push(metric(library, 'getNextRuns10-warm', workload, measureSync(() => warmTask.getNextRuns(10))))
    await cleanup(warmTask)

    results.push(metric(library, 'lifecycle-next-run', workload, measureSync(() => {
      const task = cron.createTask(workload.expression, () => {}, { timezone: 'UTC', unref: true })
      task.start()
      const next = task.getNextRun()
      task.stop()
      task.destroy()
      return next
    })))

    const executionTask = cron.createTask(workload.expression, () => 1, { timezone: 'UTC', unref: true })
    results.push(metric(library, 'execute-inline', workload, await measureAsync(() => executionTask.execute())))
    await Promise.resolve(executionTask.destroy())
  }

  for (const workload of INVALID_EXPRESSIONS) {
    if (cron.validate(workload.expression)) throw new Error(`${library} unexpectedly accepted ${workload.id}`)
    results.push(metric(library, 'validate-invalid', workload, measureSync(() => cron.validate(workload.expression))))
    results.push(metric(library, 'validateDetailed-invalid', workload, measureSync(() => cron.validateDetailed(workload.expression))))
    results.push(metric(library, 'parse-invalid', workload, measureSync(() => {
      try { cron.parse(workload.expression); return false } catch { return true }
    })))
  }

  for (const zone of TIMEZONES) {
    const workload = { id: zone.id, expression: '0 9 * * *', options: { timezone: zone.timezone } }
    const task = cron.createTask(workload.expression, () => {}, { ...workload.options, unref: true })
    const matchDate = new Date(zone.match)
    if (!task.match(matchDate)) throw new Error(`${library} timezone ${zone.id} did not match ${zone.match}`)
    results.push(metric(library, 'timezone-match-fixed', workload, measureSync(() => task.match(matchDate))))
    await Promise.resolve(task.start())
    results.push(metric(library, 'timezone-getNextRun-warm', workload, measureSync(() => task.getNextRun())))
    await cleanup(task)
  }

  if (library === 'chronicle') {
    const after = '2026-07-30T12:34:56Z'
    for (const workload of EXPRESSIONS) {
      results.push(metric(
        library,
        'nextOccurrence-fixed-after',
        workload,
        measureSync(() => cron.nextOccurrence(workload.expression, after, { timezone: 'UTC' })),
        false,
        'Chronicle-only parameterized fixed-after API; node-cron has no public equivalent.',
      ))
    }
    for (const zone of TIMEZONES) {
      const workload = { id: zone.id, expression: '0 9 * * *', options: { timezone: zone.timezone } }
      results.push(metric(
        library,
        'timezone-nextOccurrence-fixed-after',
        workload,
        measureSync(() => cron.nextOccurrence(workload.expression, after, workload.options)),
        false,
        'Chronicle-only parameterized fixed-after API; node-cron has no public equivalent.',
      ))
    }
  }

  return {
    library,
    trial,
    pid: process.pid,
    measuredAt: new Date().toISOString(),
    results,
  }
}

function hash(text) {
  let value = 2166136261
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0
  return value || 1
}

function random(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4_294_967_296
  }
}

function bootstrapMedianCI(values, seed, resamples = 2_000, round = true) {
  if (values.length === 1) return [values[0], values[0]]
  const rng = random(seed)
  const estimates = []
  for (let sample = 0; sample < resamples; sample += 1) {
    const draw = []
    for (let index = 0; index < values.length; index += 1) draw.push(values[Math.floor(rng() * values.length)])
    estimates.push(median(draw))
  }
  estimates.sort((a, b) => a - b)
  const interval = [quantile(estimates, 0.025), quantile(estimates, 0.975)]
  return round ? interval.map(Math.round) : interval
}

function aggregate(trials) {
  const groups = new Map()
  for (const trial of trials) {
    for (const result of trial.results) {
      const key = `${result.library}:${result.key}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(result)
    }
  }
  const summaries = []
  for (const [key, values] of groups) {
    const p50s = values.map((value) => value.p50Ns)
    const p95s = values.map((value) => value.p95Ns)
    const first = values[0]
    summaries.push({
      key: first.key,
      library: first.library,
      suite: first.suite,
      workload: first.workload,
      expression: first.expression,
      options: first.options,
      comparable: first.comparable,
      note: first.note,
      trials: values.length,
      p50Ns: Math.round(median(p50s)),
      p95Ns: Math.round(median(p95s)),
      madNs: Math.round(mad(p50s)),
      p50Bootstrap95CiNs: bootstrapMedianCI(p50s, hash(key)),
      trialP50Ns: p50s,
      trialP95Ns: p95s,
    })
  }
  summaries.sort((left, right) => `${left.key}:${left.library}`.localeCompare(`${right.key}:${right.library}`))

  const byKey = new Map(summaries.map((summary) => [`${summary.library}:${summary.key}`, summary]))
  const ratios = []
  for (const chronicle of summaries.filter((summary) => summary.library === 'chronicle' && summary.comparable)) {
    const nodeCron = byKey.get(`node-cron:${chronicle.key}`)
    if (!nodeCron) continue
    const count = Math.min(chronicle.trialP50Ns.length, nodeCron.trialP50Ns.length)
    const trialRatios = Array.from({ length: count }, (_, index) => nodeCron.trialP50Ns[index] / chronicle.trialP50Ns[index])
    ratios.push({
      key: chronicle.key,
      interpretation: 'node-cron p50 / Chronicle p50; values above 1 mean Chronicle was faster',
      ratio: Number(median(trialRatios).toFixed(6)),
      bootstrap95Ci: bootstrapMedianCI(trialRatios, hash(`ratio:${chronicle.key}`), 2_000, false).map((value) => Number(value.toFixed(6))),
      trialRatios: trialRatios.map((value) => Number(value.toFixed(6))),
    })
  }
  return { summaries, ratios }
}

function packageVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function runWorker(library, trial) {
  const child = spawnSync(process.execPath, [__filename, '--worker', library, '--trial', String(trial)], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (child.status !== 0) throw new Error(`${library} trial ${trial} failed:\n${child.stderr || child.stdout}`)
  return JSON.parse(child.stdout)
}

async function main() {
  const options = args()
  if (options.help || options.h) {
    process.stdout.write('Usage: node benchmarks/extensive.cjs [--runs N] [--output FILE]\n')
    return
  }
  if (options.worker) {
    process.stdout.write(JSON.stringify(await worker(options.worker, Number(options.trial))))
    return
  }

  const runs = options.runs === undefined ? DEFAULT_RUNS : Number(options.runs)
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
  const trials = []
  for (let trial = 0; trial < runs; trial += 1) {
    const order = trial % 2 === 0 ? ['chronicle', 'node-cron'] : ['node-cron', 'chronicle']
    for (const library of order) trials.push(runWorker(library, trial))
  }

  const cpu = os.cpus()[0]
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    metadata: {
      runs,
      processIsolation: 'one fresh child process per library per trial; library order alternates by trial',
      nativeBuildProfile: process.env.CHRONICLE_BENCHMARK_BUILD_PROFILE || 'unspecified',
      timing: 'process.hrtime.bigint, adaptive batches, 12ms minimum budget per workload with three-sample floor',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: cpu ? { model: cpu.model, speedMHz: cpu.speed } : null,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      gitRevision: gitRevision(),
      packages: {
        chronicle: packageVersion(path.join(ROOT, 'node', 'package.json')),
        nodeCron: packageVersion(path.join(ROOT, 'node', 'node_modules', 'node-cron', 'package.json')),
      },
    },
    caveats: [
      'All shared task workloads explicitly use UTC because node-cron otherwise uses host-local time while Chronicle defaults to UTC.',
      'Warm next-run APIs use the live clock; only task.match and Chronicle nextOccurrence receive fixed instants.',
      'Chronicle validation searches for an occurrence through its native evaluator; node-cron validation is conversion-oriented.',
      'Chronicle task.match evaluates nextOccurrence(date - 1ms); node-cron task.match invokes its matcher directly.',
      'Lifecycle measurements intentionally include task construction, timer setup, next-run calculation, teardown, and registry cleanup.',
      'Chronicle-only fixed-after metrics are marked non-comparable and excluded from ratios.',
    ],
    workloads: { expressions: EXPRESSIONS, invalidExpressions: INVALID_EXPRESSIONS, timezones: TIMEZONES },
    rawTrials: trials,
    aggregate: aggregate(trials),
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) fs.writeFileSync(path.resolve(options.output), json)
  else process.stdout.write(json)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
