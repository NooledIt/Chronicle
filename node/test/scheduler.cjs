const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createTask, setLogger, setRunCoordinator } = require('../scheduler')

test('lifecycle and maximum executions are explicit', async () => {
  let calls = 0
  const task = createTask('* * * * *', () => { calls += 1 }, { name: 'limited', maxExecutions: 1 })
  assert.equal(task.getStatus(), 'stopped')
  assert.equal(await task.execute(), undefined)
  assert.equal(calls, 1)
  assert.equal(task.getStatus(), 'destroyed')
  assert.equal(await task.execute(), false)
})

test('noOverlap skips concurrent manual execution', async () => {
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const task = createTask('* * * * *', async () => waiting, { noOverlap: true })
  const first = task.execute()
  assert.equal(await task.execute(), false)
  release()
  assert.equal(await first, undefined)
})

test('task exposes the native timezone-aware next run', () => {
  const task = createTask('30 1 * * *', () => {}, { timezone: 'America/New_York', dstPolicy: 'wallClockTwice' })
  task.start()
  assert.ok(task.getNextRun() instanceof Date)
  task.destroy()
})

test('background task paths execute in a persistent isolated child process', async () => {
  const modulePath = path.join(__dirname, 'fixtures', 'background-task.cjs')
  const task = createTask('* * * * *', modulePath, { name: 'background-check' })

  const first = await task.execute()
  const second = await task.execute()

  assert.notEqual(first.pid, process.pid)
  assert.equal(second.pid, first.pid)
  assert.equal(second.calls, 2)
  assert.deepEqual(first.task, { id: task.id, name: 'background-check' })
  assert.equal(first.dateIsDate, true)
  assert.equal(first.triggeredAtIsDate, true)
  assert.equal(task.lastRun().result.calls, 2)
  task.destroy()
})

test('background errors retain their message and code and follow task error lifecycle', async () => {
  const modulePath = path.join(__dirname, 'fixtures', 'background-error.cjs')
  const task = createTask('* * * * *', modulePath)
  let emitted
  task.on('error', (error) => { emitted = error })
  setLogger({ error() {} })

  await assert.rejects(task.execute(), (error) => {
    assert.equal(error.message, 'background boom')
    assert.equal(error.code, 'BACKGROUND_BOOM')
    return true
  })
  assert.equal(emitted?.code, 'BACKGROUND_BOOM')
  assert.equal(task.lastRun().error.code, 'BACKGROUND_BOOM')
  task.destroy()
  setLogger()
})

test('background task paths load named ESM task exports', async () => {
  const modulePath = path.join(__dirname, 'fixtures', 'background-esm.mjs')
  const task = createTask('* * * * *', modulePath)
  const result = await task.execute()
  assert.equal(result.format, 'esm')
  assert.equal(result.dateIsDate, true)
  assert.notEqual(result.pid, process.pid)
  task.destroy()
})

test('per-task coordinator skips unelected work and completes elected work', async () => {
  const decisions = [false, true]
  const elections = []
  const completions = []
  let calls = 0
  const coordinator = {
    shouldRun(key, ttlMs) {
      elections.push({ key, ttlMs })
      return decisions.shift()
    },
    onComplete(key) {
      completions.push(key)
    },
  }
  const task = createTask('* * * * *', () => { calls += 1; return 42 }, {
    name: 'singleton',
    runCoordinator: coordinator,
    distributed: true,
    distributedLease: 1234,
  })
  let skipped
  task.on('execution:skipped', (context) => { skipped = context.execution })

  assert.equal(await task.execute(), false)
  assert.equal(calls, 0)
  assert.equal(skipped.reason, 'not-elected')
  assert.equal(await task.execute(), 42)
  assert.equal(calls, 1)
  assert.equal(elections.length, 2)
  assert.ok(elections.every(({ key, ttlMs }) => key.startsWith('singleton:') && ttlMs === 1234))
  assert.equal(completions.length, 1)
  assert.ok(completions[0].startsWith('singleton:'))
  task.destroy()
})

test('distributed tasks use the global coordinator and release failed executions', async () => {
  const completed = []
  setRunCoordinator({
    shouldRun: async (key, ttlMs) => key.startsWith('global-job:') && ttlMs === 5000,
    onComplete: async (key) => completed.push(key),
  })
  const task = createTask('* * * * *', () => { throw new Error('inline boom') }, {
    distributed: true,
    name: 'global-job',
    distributedLease: 5000,
  })
  task.on('error', () => {})
  setLogger({ error() {} })

  await assert.rejects(task.execute(), /inline boom/)
  assert.equal(completed.length, 1)
  assert.ok(completed[0].startsWith('global-job:'))
  task.destroy()
  setRunCoordinator(undefined)
  setLogger()
})

test('coordinator failures skip execution fail-closed', async () => {
  let calls = 0
  const task = createTask('* * * * *', () => { calls += 1 }, {
    distributed: true,
    runCoordinator: { shouldRun() { throw new Error('coordinator unavailable') } },
  })
  let skipped
  task.on('execution:skipped', (context) => { skipped = context.execution })
  setLogger({ error() {} })
  assert.equal(await task.execute(), false)
  assert.equal(calls, 0)
  assert.equal(skipped.reason, 'coordinator-error')
  task.destroy()
  setLogger()
})
