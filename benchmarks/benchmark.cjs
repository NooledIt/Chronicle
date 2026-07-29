const { performance } = require('node:perf_hooks')
const cron = require('../node/node_modules/node-cron')
const { nextOccurrence } = require('../node')

const iterations = 2_000
const expression = '*/15 * * * *'
const after = '2026-01-15T09:01:00Z'

function summarize(name, operation) {
  for (let i = 0; i < 100; i += 1) operation()
  const samples = []
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now()
    operation()
    samples.push((performance.now() - started) * 1_000)
  }
  samples.sort((left, right) => left - right)
  const quantile = (fraction) => samples[Math.floor((samples.length - 1) * fraction)]
  return {
    name,
    iterations,
    medianMicroseconds: Number(quantile(0.5).toFixed(3)),
    p95Microseconds: Number(quantile(0.95).toFixed(3)),
  }
}

const chronicle = summarize('Chronicle nextOccurrence', () => nextOccurrence(expression, after))
const nodeCron = summarize('node-cron createTask/start/getNextRun/stop', () => {
  const task = cron.createTask(expression, () => {}, { timezone: 'UTC' })
  task.start()
  task.getNextRun()
  task.stop()
})

console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  expression,
  comparability: 'Chronicle evaluates a supplied instant. node-cron exposes next-run evaluation through a started task, so its public lifecycle overhead is included.',
  results: [chronicle, nodeCron],
}, null, 2))
