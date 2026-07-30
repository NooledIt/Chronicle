'use strict'

const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LIBRARIES = ['chronicle', 'node-cron']
const BACKGROUND_FIXTURE = path.join(__dirname, 'fixtures', 'runtime-background.cjs')
const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} }

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function summarize(values, digits = 3) {
  const sorted = [...values].sort((left, right) => left - right)
  const round = (value) => value == null ? null : Number(value.toFixed(digits))
  return {
    count: sorted.length,
    min: round(sorted[0]),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1)),
  }
}

function loadLibrary(name) {
  const cron = name === 'chronicle' ? require('../node') : require('../node/node_modules/node-cron')
  cron.setLogger?.(SILENT_LOGGER)
  return cron
}

async function settle(method) {
  return Promise.resolve(method)
}

async function cleanup(cron, tasks) {
  for (const task of [...tasks].reverse()) {
    try { await settle(task.stop()) } catch {}
    try { await settle(task.destroy()) } catch {}
  }
  tasks.length = 0
  try { cron.setRunCoordinator?.(undefined) } catch {}
  try { await settle(cron.shutdown?.()) } catch {}
  await sleep(50)
}

async function alignedStart(startTasks, minimumLeadMs = 350) {
  const now = Date.now()
  let target = Math.floor(now / 1000) * 1000 + 1000
  if (target - now < minimumLeadMs) target += 1000
  await sleep(Math.max(0, target - Date.now() - 200))
  await startTasks()
  return target
}

function phaseLatency(timestamp) {
  return timestamp - Math.floor(timestamp / 1000) * 1000
}

async function boundaryScenario(cron, config, tasks) {
  const phases = []
  let callbacks = 0
  let target
  const startTasks = async () => {
    for (let index = 0; index < config.taskCount; index += 1) {
      const task = cron.createTask('* * * * * *', () => {
        const now = Date.now()
        if (now >= target && now < target + config.slots * 1000) {
          callbacks += 1
          phases.push(phaseLatency(now))
        }
      }, { timezone: 'UTC', name: `runtime-${index}`, logger: SILENT_LOGGER })
      tasks.push(task)
    }
    await Promise.all(tasks.map((task) => settle(task.start())))
  }
  const cpuStart = process.cpuUsage()
  const wallStart = performance.now()
  target = await alignedStart(startTasks)
  await sleep(Math.max(0, target + (config.slots - 1) * 1000 + 300 - Date.now()))
  for (const task of tasks) await settle(task.stop())
  const cpu = process.cpuUsage(cpuStart)
  const elapsedMs = performance.now() - wallStart
  const expected = config.taskCount * config.slots
  return {
    taskCount: config.taskCount,
    slots: config.slots,
    expectedCallbacks: expected,
    observedCallbacks: callbacks,
    deliveryRatio: Number((callbacks / expected).toFixed(6)),
    boundaryPhaseMilliseconds: summarize(phases),
    callbacksPerSecond: Number((callbacks / (config.slots || 1)).toFixed(3)),
    elapsedMs: Number(elapsedMs.toFixed(3)),
    cpuMilliseconds: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    rssBytes: process.memoryUsage().rss,
  }
}

async function inlineExecuteScenario(cron, config, tasks) {
  const task = cron.createTask('* * * * *', () => 1, { timezone: 'UTC', logger: SILENT_LOGGER })
  tasks.push(task)
  for (let index = 0; index < 50; index += 1) await task.execute()
  const samples = []
  const started = performance.now()
  for (let index = 0; index < config.iterations; index += 1) {
    const before = performance.now()
    await task.execute()
    samples.push((performance.now() - before) * 1000)
  }
  const elapsedMs = performance.now() - started
  return {
    iterations: config.iterations,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    operationsPerSecond: Number((config.iterations / (elapsedMs / 1000)).toFixed(3)),
    operationMicroseconds: summarize(samples),
  }
}

async function noOverlapScenario(cron, config, tasks) {
  const starts = []
  const finishes = []
  let active = 0
  let maximumConcurrency = 0
  let overlaps = 0
  let target
  const task = cron.createTask('* * * * * *', async () => {
    const started = Date.now()
    if (started >= target && started < target + config.slots * 1000) starts.push(started)
    active += 1
    maximumConcurrency = Math.max(maximumConcurrency, active)
    await sleep(config.callbackMs)
    active -= 1
    finishes.push(Date.now())
  }, { noOverlap: true, timezone: 'UTC', name: 'runtime-overlap', logger: SILENT_LOGGER })
  task.on('execution:overlap', () => { overlaps += 1 })
  tasks.push(task)
  target = await alignedStart(() => settle(task.start()))
  await sleep(Math.max(0, target + (config.slots - 1) * 1000 + 300 - Date.now()))
  await settle(task.stop())
  await sleep(config.callbackMs + 100)
  return {
    slots: config.slots,
    callbackMilliseconds: config.callbackMs,
    starts: starts.length,
    finishes: finishes.length,
    overlapEvents: overlaps,
    maximumConcurrency,
    startOffsetsMilliseconds: starts.map((value) => value - target),
  }
}

async function backgroundScenario(cron, config, tasks) {
  const cold = []
  for (let index = 0; index < config.coldIterations; index += 1) {
    const totalStart = performance.now()
    const createStart = performance.now()
    const task = cron.createTask('* * * * *', BACKGROUND_FIXTURE, {
      timezone: 'UTC', name: `runtime-background-cold-${index}`, logger: SILENT_LOGGER,
    })
    tasks.push(task)
    const created = performance.now()
    await settle(task.start())
    const started = performance.now()
    const result = await task.execute()
    const executed = performance.now()
    await settle(task.destroy())
    tasks.splice(tasks.indexOf(task), 1)
    cold.push({
      createMicroseconds: (created - createStart) * 1000,
      startMicroseconds: (started - created) * 1000,
      firstExecuteMicroseconds: (executed - started) * 1000,
      totalMicroseconds: (executed - totalStart) * 1000,
      isolated: result.pid !== process.pid,
    })
  }

  const warmTask = cron.createTask('* * * * *', BACKGROUND_FIXTURE, {
    timezone: 'UTC', name: 'runtime-background-warm', logger: SILENT_LOGGER,
  })
  tasks.push(warmTask)
  await settle(warmTask.start())
  await warmTask.execute()
  const warmSamples = []
  const warmStarted = performance.now()
  let childPid
  for (let index = 0; index < config.warmIterations; index += 1) {
    const before = performance.now()
    const result = await warmTask.execute()
    warmSamples.push((performance.now() - before) * 1000)
    childPid ??= result.pid
    if (result.pid !== childPid) throw new Error('background worker PID changed during warm benchmark')
  }
  const warmElapsedMs = performance.now() - warmStarted
  return {
    coldIterations: config.coldIterations,
    coldCreateMicroseconds: summarize(cold.map((value) => value.createMicroseconds)),
    coldStartMicroseconds: summarize(cold.map((value) => value.startMicroseconds)),
    coldFirstExecuteMicroseconds: summarize(cold.map((value) => value.firstExecuteMicroseconds)),
    coldTotalMicroseconds: summarize(cold.map((value) => value.totalMicroseconds)),
    coldExecutionsIsolated: cold.every((value) => value.isolated),
    warmIterations: config.warmIterations,
    warmOperationsPerSecond: Number((config.warmIterations / (warmElapsedMs / 1000)).toFixed(3)),
    warmRoundTripMicroseconds: summarize(warmSamples),
    stableChildPid: childPid,
  }
}

async function coordinatorScenario(cron, config, tasks) {
  let decisions = 0
  let completions = 0
  let skipped = 0
  let callbacks = 0
  const phases = []
  let target
  const coordinator = {
    shouldRun() { decisions += 1; return config.allow },
    onComplete() { completions += 1 },
  }
  const task = cron.createTask('* * * * * *', () => {
    const now = Date.now()
    if (now >= target && now < target + config.slots * 1000) {
      callbacks += 1
      phases.push(phaseLatency(now))
    }
  }, {
    distributed: true,
    distributedLease: 5000,
    runCoordinator: coordinator,
    timezone: 'UTC',
    name: `runtime-coordinator-${config.allow ? 'allow' : 'deny'}`,
    logger: SILENT_LOGGER,
  })
  task.on('execution:skipped', () => { skipped += 1 })
  tasks.push(task)
  target = await alignedStart(() => settle(task.start()))
  await sleep(Math.max(0, target + (config.slots - 1) * 1000 + 300 - Date.now()))
  await settle(task.stop())
  return {
    policy: config.allow ? 'allow' : 'deny',
    slots: config.slots,
    decisions,
    completions,
    skipped,
    callbacks,
    boundaryPhaseMilliseconds: summarize(phases),
  }
}

async function runWorker(library, scenario, config) {
  const cron = loadLibrary(library)
  const tasks = []
  const started = performance.now()
  try {
    let metrics
    if (scenario === 'boundary') metrics = await boundaryScenario(cron, config, tasks)
    else if (scenario === 'inline-execute') metrics = await inlineExecuteScenario(cron, config, tasks)
    else if (scenario === 'no-overlap') metrics = await noOverlapScenario(cron, config, tasks)
    else if (scenario === 'background') metrics = await backgroundScenario(cron, config, tasks)
    else if (scenario === 'coordinator') metrics = await coordinatorScenario(cron, config, tasks)
    else throw new Error(`unknown runtime benchmark scenario: ${scenario}`)
    return { library, scenario, config, metrics, workerElapsedMs: Number((performance.now() - started).toFixed(3)) }
  } finally {
    await cleanup(cron, tasks)
  }
}

function runIsolated(library, scenario, config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--worker', library, scenario, JSON.stringify(config)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TZ: 'UTC' },
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500).unref()
      reject(new Error(`${library}/${scenario} exceeded ${timeoutMs}ms watchdog`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(`${library}/${scenario} exited ${signal ?? code}: ${stderr || stdout}`))
      try { resolve(JSON.parse(stdout)) }
      catch (error) { reject(new Error(`${library}/${scenario} returned invalid JSON: ${error.message}\n${stdout}\n${stderr}`)) }
    })
  })
}

function scenarioPlan(quick) {
  const slots = quick ? 1 : 2
  return [
    ['boundary', { workload: 'single-task', taskCount: 1, slots }],
    ['boundary', { workload: 'fanout', taskCount: 1, slots }],
    ['boundary', { workload: 'fanout', taskCount: 10, slots }],
    ['boundary', { workload: 'fanout', taskCount: 100, slots }],
    ['inline-execute', { iterations: quick ? 250 : 5000 }],
    ['no-overlap', { slots: quick ? 3 : 5, callbackMs: 1500 }],
    ['background', { coldIterations: quick ? 1 : 5, warmIterations: quick ? 20 : 500 }],
    ['coordinator', { allow: true, slots }],
    ['coordinator', { allow: false, slots }],
  ]
}

async function main() {
  if (process.argv[2] === '--worker') {
    const result = await runWorker(process.argv[3], process.argv[4], JSON.parse(process.argv[5]))
    process.stdout.write(JSON.stringify(result))
    return
  }

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('Usage: node benchmarks/runtime.cjs [--quick] [--output FILE]\n')
    return
  }
  const quick = process.argv.includes('--quick')
  const outputIndex = process.argv.indexOf('--output')
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (outputIndex >= 0 && !output) throw new Error('--output requires a file path')
  const results = []
  const plan = scenarioPlan(quick)
  for (let index = 0; index < plan.length; index += 1) {
    const [scenario, config] = plan[index]
    const order = index % 2 === 0 ? LIBRARIES : [...LIBRARIES].reverse()
    for (const library of order) {
      const timeoutMs = scenario === 'no-overlap' ? 20_000 : 15_000
      results.push(await runIsolated(library, scenario, config, timeoutMs))
    }
  }

  const chroniclePackage = require('../node/package.json')
  const incumbentPackage = require('../node/node_modules/node-cron/package.json')
  const report = JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: quick ? 'quick-smoke' : 'default',
    metadata: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      chronicleVersion: chroniclePackage.version,
      nodeCronVersion: incumbentPackage.version,
    },
    comparability: [
      'Every library/scenario pair runs in a fresh Node process; cases run sequentially to avoid direct CPU contention.',
      'Second-boundary latency is wall-clock phase after the UTC second boundary, because Chronicle does not expose the logical scheduled slot in callback context.',
      'Inline execute measures public manual execution overhead and is separate from real timer scheduling.',
      'Background start models differ: node-cron starts its worker during start(), while Chronicle starts its worker on first execute; both component and combined cold costs are reported.',
      'noOverlap is a behavioral workload: callback count and overlap events must not be interpreted as raw speed.',
      'Coordinator allow/deny uses scheduled execution because node-cron does not coordinate manual execute(). It measures in-process coordinator overhead, not cross-host lease latency or contention correctness.',
      'Wall-clock scheduling results are sensitive to system load and power management; publish repeated runs and raw JSON rather than a single run alone.',
    ],
    results,
  }, null, 2) + '\n'
  if (output) fs.writeFileSync(path.resolve(output), report)
  else process.stdout.write(report)
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
