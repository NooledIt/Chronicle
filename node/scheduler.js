const { EventEmitter } = require('node:events')
const { nextOccurrence } = require('./index.js')

class ChronicleTask extends EventEmitter {
  #expression
  #callback
  #options
  #timer = null
  #running = false
  #destroyed = false
  #executions = 0

  constructor(expression, callback, options = {}) {
    super()
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    this.#expression = expression
    this.#callback = callback
    this.#options = { noOverlap: false, maxExecutions: Infinity, maxRandomDelay: 0, ...options }
    this.name = options.name ?? `chronicle-${Math.random().toString(36).slice(2, 10)}`
  }

  getStatus() {
    if (this.#destroyed) return 'destroyed'
    if (this.#running) return 'running'
    return this.#timer ? 'idle' : 'stopped'
  }

  getNextRun() {
    if (this.#destroyed) return null
    return new Date(nextOccurrence(this.#expression, new Date().toISOString(), this.#nativeOptions()))
  }

  start() {
    if (this.#destroyed) throw new Error('cannot start a destroyed task')
    if (!this.#timer) this.#arm()
    return this
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    return this
  }

  destroy() {
    this.stop()
    this.#destroyed = true
    this.emit('destroyed', { name: this.name, executions: this.#executions })
  }

  async execute() {
    if (this.#destroyed) return false
    if (this.#options.noOverlap && this.#running) {
      this.emit('overlap', { name: this.name })
      return false
    }
    if (this.#executions >= this.#options.maxExecutions) {
      this.destroy()
      return false
    }
    this.#running = true
    try {
      const delay = this.#options.maxRandomDelay > 0
        ? Math.floor(Math.random() * (this.#options.maxRandomDelay + 1))
        : 0
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      await this.#callback()
      this.#executions += 1
      this.emit('executed', { name: this.name, executions: this.#executions })
      if (this.#executions >= this.#options.maxExecutions) this.destroy()
      return true
    } catch (error) {
      this.emit('error', error)
      throw error
    } finally {
      this.#running = false
    }
  }

  #arm() {
    const next = this.getNextRun()
    const delay = Math.max(0, next.getTime() - Date.now())
    this.#timer = setTimeout(async () => {
      this.#timer = null
      await this.execute()
      if (!this.#destroyed) this.#arm()
    }, delay)
    if (this.#options.unref) this.#timer.unref()
  }

  #nativeOptions() {
    const options = {}
    if (this.#options.timezone) options.timezone = this.#options.timezone
    if (this.#options.dstPolicy) options.dstPolicy = this.#options.dstPolicy
    return options
  }
}

function createTask(expression, callback, options) {
  return new ChronicleTask(expression, callback, options)
}

function schedule(expression, callback, options) {
  return createTask(expression, callback, options).start()
}

module.exports = { ChronicleTask, createTask, schedule }
