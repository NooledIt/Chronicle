const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { nextOccurrence } = require('./index.js')

const tasks = new Map()
let logger = console
let runCoordinator

function nativeOptions(options) {
  const result = {}
  if (options.timezone) result.timezone = options.timezone
  if (options.dstPolicy) result.dstPolicy = options.dstPolicy
  return result
}

function nextDate(expression, after, options) {
  return new Date(nextOccurrence(expression, after.toISOString(), nativeOptions(options)))
}

class ChronicleTask extends EventEmitter {
  #expression
  #callback
  #options
  #timer = null
  #running = false
  #destroyed = false
  #executions = 0
  #lastRun = null

  constructor(expression, callback, options = {}) {
    super()
    if (typeof callback !== 'function') {
      throw new TypeError('Chronicle supports inline task functions only; background task paths are not implemented')
    }
    if (options.distributed || options.runCoordinator || runCoordinator) {
      throw new Error('Distributed coordination is not implemented by Chronicle')
    }
    this.#expression = expression
    this.#callback = callback
    this.#options = { noOverlap: false, maxExecutions: Infinity, maxRandomDelay: 0, ...options }
    this.id = randomUUID()
    this.name = options.name ?? this.id
    // Validate before task registration so callers get node-cron-like early feedback.
    nextDate(expression, new Date('2026-01-01T00:00:00Z'), this.#options)
  }

  getStatus() {
    if (this.#destroyed) return 'destroyed'
    if (this.#running) return 'running'
    return this.#timer ? 'idle' : 'stopped'
  }

  getPattern() { return this.#expression }
  isBusy() { return this.#running }
  runsLeft() { return Number.isFinite(this.#options.maxExecutions) ? Math.max(0, this.#options.maxExecutions - this.#executions) : undefined }
  lastRun() { return this.#lastRun }

  getNextRun() {
    if (this.#destroyed || !this.#timer) return null
    return nextDate(this.#expression, new Date(), this.#options)
  }

  getNextRuns(count) {
    if (!Number.isInteger(count) || count < 0) throw new TypeError('count must be a non-negative integer')
    if (this.#destroyed || !this.#timer) return []
    const values = []
    let after = new Date()
    for (let index = 0; index < count; index += 1) {
      after = nextDate(this.#expression, after, this.#options)
      values.push(after)
    }
    return values
  }

  match(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('date must be a valid Date')
    return nextDate(this.#expression, new Date(date.getTime() - 1), this.#options).getTime() === date.getTime()
  }

  msToNext() {
    const next = this.getNextRun()
    return next ? Math.max(0, next.getTime() - Date.now()) : null
  }

  start() {
    if (this.#destroyed) throw new Error('cannot start a destroyed task')
    if (!this.#timer) {
      this.#arm()
      this.#emit('task:started')
    }
    return this
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    if (!this.#destroyed) this.#emit('task:stopped')
    return this
  }

  destroy() {
    if (this.#destroyed) return this
    this.stop()
    this.#destroyed = true
    tasks.delete(this.id)
    this.#emit('task:destroyed')
    this.emit('destroyed', { name: this.name, executions: this.#executions })
    return this
  }

  ref() { this.#timer?.ref(); return this }
  unref() { this.#timer?.unref(); return this }

  async execute() {
    if (this.#destroyed) return false
    if (this.#options.noOverlap && this.#running) {
      this.#emit('execution:overlap')
      this.emit('overlap', { name: this.name })
      return false
    }
    if (this.#executions >= this.#options.maxExecutions) {
      this.#emit('execution:maxReached')
      this.destroy()
      return false
    }
    const execution = { id: randomUUID(), reason: 'invoked', startedAt: new Date() }
    this.#running = true
    this.#emit('execution:started', execution)
    try {
      const delay = this.#options.maxRandomDelay > 0 ? Math.floor(Math.random() * (this.#options.maxRandomDelay + 1)) : 0
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      const result = await this.#callback(this.#context(execution))
      execution.finishedAt = new Date()
      execution.result = result
      this.#lastRun = { date: execution.finishedAt, result }
      this.#executions += 1
      this.#emit('execution:finished', execution)
      this.emit('executed', { name: this.name, executions: this.#executions })
      if (this.#executions >= this.#options.maxExecutions) this.destroy()
      return result
    } catch (error) {
      execution.finishedAt = new Date()
      execution.error = error
      this.#lastRun = { date: execution.finishedAt, error }
      this.#emit('execution:failed', execution)
      this.emit('error', error)
      logger.error?.(`Chronicle task "${this.name}" failed`, error)
      throw error
    } finally {
      this.#running = false
    }
  }

  #arm() {
    const next = nextDate(this.#expression, new Date(), this.#options)
    this.#timer = setTimeout(async () => {
      this.#timer = null
      try { await this.execute() } catch { /* execution:failed already emitted */ }
      if (!this.#destroyed) this.#arm()
    }, Math.max(0, next.getTime() - Date.now()))
    if (this.#options.unref) this.#timer.unref()
  }

  #context(execution) {
    const date = new Date()
    return { date, dateLocalIso: date.toISOString(), task: this, execution, triggeredAt: date }
  }

  #emit(event, execution) {
    this.emit(event, this.#context(execution))
  }
}

function createTask(expression, callback, options) {
  const task = new ChronicleTask(expression, callback, options)
  tasks.set(task.id, task)
  return task
}

function schedule(expression, callback, options) { return createTask(expression, callback, options).start() }
function getTasks() { return tasks }
function getTask(id) { return tasks.get(id) }
function setLogger(nextLogger) { logger = nextLogger ?? console }
function setRunCoordinator(coordinator) { runCoordinator = coordinator }

async function shutdown() {
  for (const task of [...tasks.values()]) task.destroy()
}

module.exports = { ChronicleTask, createTask, schedule, getTasks, getTask, setLogger, setRunCoordinator, shutdown }
