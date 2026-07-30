const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const cron = require('..')

test('exposes the common node-cron inline API from the package root', async () => {
  for (const name of ['schedule', 'createTask', 'validate', 'validateDetailed', 'parse', 'getTasks', 'getTask', 'shutdown']) {
    assert.equal(typeof cron[name], 'function', `${name} is exported`)
  }
  assert.equal(cron.validate('*/15 * * * *'), true)
  assert.equal(cron.validate('L * * * *'), false)
  assert.deepEqual(cron.parse('*/15 * * * *').minute, [0, 15, 30, 45])

  const task = cron.createTask('* * * * *', () => 'ok', { name: 'compatibility-check' })
  assert.equal(task.getStatus(), 'stopped')
  assert.equal(task.getNextRun(), null)
  task.start()
  assert.equal(task.getStatus(), 'idle')
  assert.ok(task.getNextRun() instanceof Date)
  assert.equal(cron.getTask(task.id), task)
  assert.equal(await task.execute(), 'ok')
  assert.equal(task.lastRun().result, 'ok')
  task.destroy()
  assert.equal(cron.getTask(task.id), undefined)
})

test('distributed execution requires an installed coordinator', () => {
  assert.throws(
    () => cron.createTask('* * * * *', () => {}, { distributed: true }),
    /requires options\.runCoordinator or a global coordinator/,
  )
})

test('advanced parse output matches node-cron', () => {
  const incumbent = require('node-cron')
  for (const expression of ['0 0 L * *', '0 0 L-3 * *', '0 0 15W * *', '0 0 LW * *', '0 0 ? * 2#3', '0 0 ? * 5L', '0 22-2 * * *']) {
    assert.deepEqual(cron.parse(expression), incumbent.parse(expression), expression)
  }
})

test('background paths resolve relative to the calling module', async () => {
  assert.equal(cron.solvePath('./fixtures/background-task.cjs'), path.join(__dirname, 'fixtures', 'background-task.cjs'))
  const task = cron.createTask('* * * * *', './fixtures/background-task.cjs')
  const result = await task.execute()
  assert.notEqual(result.pid, process.pid)
  task.destroy()
})
