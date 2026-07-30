const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { fork } = require('node:child_process')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { nextOccurrence } = require('./index.js')

const tasks = new Map()
let logger = console
let runCoordinator

const BACKGROUND_WORKER_FLAG = '--chronicle-background-worker'

function solvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath
  if (filePath.startsWith('file://')) return fileURLToPath(filePath)
  const caller = new Error().stack?.split('\n').slice(1).find((line) =>
    !line.includes(__filename) && !line.includes('node:internal'),
  )
  const match = caller?.match(/\(?((?:file:\/\/)?[^()]+):\d+:\d+\)?$/)
  if (!match) return path.resolve(filePath)
  const callerPath = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1]
  return path.resolve(path.dirname(callerPath), filePath)
}

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
    code: error?.code,
  }
}

function deserializeError(value) {
  const error = new Error(value?.message ?? 'Background task failed')
  error.name = value?.name ?? 'Error'
  if (value?.stack) error.stack = value.stack
  if (value?.code !== undefined) error.code = value.code
  return error
}

async function loadBackgroundHandler(modulePath) {
  const loaded = await import(pathToFileURL(modulePath).href)
  const handler = loaded.task ?? loaded.default?.task ?? loaded.default
  if (typeof handler !== 'function') {
    throw new TypeError(`Background task module must export a function or "task" function: ${modulePath}`)
  }
  return handler
}

function runBackgroundWorker(modulePath) {
  const handler = loadBackgroundHandler(modulePath)
  process.on('message', async (message) => {
    if (message?.type !== 'execute') return
    try {
      const context = message.context
      context.date = new Date(context.date)
      context.triggeredAt = new Date(context.triggeredAt)
      if (context.execution?.startedAt) context.execution.startedAt = new Date(context.execution.startedAt)
      const result = await (await handler)(context)
      process.send?.({ type: 'result', id: message.id, result }, (error) => {
        if (error) process.send?.({ type: 'result', id: message.id, error: serializeError(error) })
      })
    } catch (error) {
      process.send?.({ type: 'result', id: message.id, error: serializeError(error) })
    }
  })
}

class BackgroundTaskRunner {
  #modulePath
  #child = null
  #pending = new Map()
  #destroyed = false
  #unreferenced = false

  constructor(modulePath) {
    this.#modulePath = path.resolve(modulePath)
  }

  execute(context) {
    if (this.#destroyed) return Promise.reject(new Error('background task has been destroyed'))
    const child = this.#ensureChild()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      child.send({ type: 'execute', id, context }, (error) => {
        if (!error) return
        this.#pending.delete(id)
        reject(error)
      })
    })
  }

  destroy() {
    this.#destroyed = true
    const error = new Error('background task was destroyed')
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    this.#child?.kill()
    this.#child = null
  }

  ref() { this.#unreferenced = false; this.#child?.ref() }
  unref() { this.#unreferenced = true; this.#child?.unref() }

  #ensureChild() {
    if (this.#child?.connected) return this.#child
    const child = fork(__filename, [BACKGROUND_WORKER_FLAG, this.#modulePath], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    this.#child = child
    if (this.#unreferenced) child.unref()
    child.on('message', (message) => {
      if (message?.type !== 'result') return
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(deserializeError(message.error))
      else pending.resolve(message.result)
    })
    child.on('error', (error) => this.#rejectChild(child, error))
    child.on('exit', (code, signal) => {
      this.#rejectChild(child, new Error(`Background task process exited (${signal ?? code})`))
    })
    return child
  }

  #rejectChild(child, error) {
    if (this.#child !== child) return
    this.#child = null
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

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
  #backgroundRunner = null

  constructor(expression, callback, options = {}) {
    super()
    if (typeof callback !== 'function' && typeof callback !== 'string') {
      throw new TypeError('task must be a function or a background module path')
    }
    this.#expression = expression
    if (typeof callback === 'string') {
      this.#backgroundRunner = new BackgroundTaskRunner(callback)
      this.#callback = (context) => this.#backgroundRunner.execute({
        ...context,
        task: { id: this.id, name: this.name },
      })
    } else {
      this.#callback = callback
    }
    this.#options = { noOverlap: false, maxExecutions: Infinity, maxRandomDelay: 0, ...options }
    this.id = randomUUID()
    this.name = options.name ?? this.id
    if (this.#options.unref) this.#backgroundRunner?.unref()
    this.#validateCoordinator()
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
    this.#backgroundRunner?.destroy()
    tasks.delete(this.id)
    this.#emit('task:destroyed')
    this.emit('destroyed', { name: this.name, executions: this.#executions })
    return this
  }

  ref() { this.#timer?.ref(); this.#backgroundRunner?.ref(); return this }
  unref() { this.#timer?.unref(); this.#backgroundRunner?.unref(); return this }

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
    const coordinator = this.#coordinator()
    const coordinationKey = `${this.name}:${execution.startedAt.toISOString()}`
    let elected = false
    try {
      if (coordinator) {
        let decision
        try {
          decision = await coordinator.shouldRun(coordinationKey, this.#options.distributedLease ?? 60_000)
        } catch (error) {
          execution.reason = 'coordinator-error'
          execution.error = error
          execution.finishedAt = new Date()
          this.#emit('execution:skipped', execution)
          logger.error?.(`Chronicle coordinator failed for "${this.name}"; execution skipped`, error)
          return false
        }
        if (!decision) {
          execution.reason = 'not-elected'
          execution.finishedAt = new Date()
          this.#emit('execution:skipped', execution)
          this.emit('skipped', { name: this.name, key: coordinationKey, execution })
          return false
        }
        elected = true
      }
      this.#emit('execution:started', execution)
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
      if (elected && typeof coordinator.onComplete === 'function') {
        try { await coordinator.onComplete(coordinationKey) }
        catch (error) {
          this.#emit('coordination:failed', { ...execution, error })
          logger.error?.(`Chronicle coordinator completion for "${this.name}" failed`, error)
        }
      }
      this.#running = false
    }
  }

  #coordinator() {
    if (!this.#options.distributed) return undefined
    const candidate = this.#options.runCoordinator ?? runCoordinator
    if (typeof candidate === 'function') return { shouldRun: candidate }
    return candidate
  }

  #validateCoordinator() {
    const coordinator = this.#coordinator()
    if (this.#options.distributed && !coordinator) {
      throw new Error('Distributed execution requires options.runCoordinator or a global coordinator')
    }
    if (coordinator && typeof coordinator.shouldRun !== 'function') {
      throw new TypeError('runCoordinator must be a function or expose shouldRun(key, ttlMs)')
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
  if (typeof callback === 'string') callback = solvePath(callback)
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

if (process.argv[2] === BACKGROUND_WORKER_FLAG) {
  runBackgroundWorker(process.argv[3])
} else {
  module.exports = { ChronicleTask, createTask, schedule, getTasks, getTask, setLogger, setRunCoordinator, shutdown, solvePath }
}
