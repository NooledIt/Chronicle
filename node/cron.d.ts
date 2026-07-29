import { EventEmitter } from 'node:events'

export interface TaskOptions { timezone?: string; name?: string; noOverlap?: boolean; maxExecutions?: number; maxRandomDelay?: number; unref?: boolean; dstPolicy?: 'wallClockOnce' | 'wallClockTwice'; distributed?: never }
export interface TaskContext { date: Date; dateLocalIso: string; task: ScheduledTask; execution?: unknown; triggeredAt: Date }
export interface ScheduledTask extends EventEmitter { id: string; name: string; start(): this; stop(): this; destroy(): this; execute(): Promise<unknown>; getStatus(): string; getPattern(): string; getNextRun(): Date | null; getNextRuns(count: number): Date[]; match(date: Date): boolean; msToNext(): number | null; isBusy(): boolean; runsLeft(): number | undefined; lastRun(): { date: Date; result?: unknown; error?: Error } | null; ref(): this; unref(): this }
export function schedule(expression: string, callback: (context: TaskContext) => unknown, options?: TaskOptions): ScheduledTask
export function createTask(expression: string, callback: (context: TaskContext) => unknown, options?: TaskOptions): ScheduledTask
export function validate(expression: string): boolean
export function validateDetailed(expression: string): { valid: boolean; errors: Array<{ field: string; value?: string; message: string }>; fields?: Record<string, number[]> }
export function parse(expression: string): Record<string, number[]>
export function getTasks(): Map<string, ScheduledTask>
export function getTask(id: string): ScheduledTask | undefined
export function shutdown(timeout?: number): Promise<void>
export function setLogger(logger: Pick<Console, 'error'>): void
export function setRunCoordinator(coordinator: never): void
export function solvePath(filePath: string): string
export function nextOccurrence(expression: string, after: string, options?: { timezone?: string; dstPolicy?: 'wallClockOnce' | 'wallClockTwice' }): string
declare const api: { schedule: typeof schedule; createTask: typeof createTask; validate: typeof validate; validateDetailed: typeof validateDetailed; parse: typeof parse; getTasks: typeof getTasks; getTask: typeof getTask; shutdown: typeof shutdown; setLogger: typeof setLogger; setRunCoordinator: typeof setRunCoordinator; solvePath: typeof solvePath; nextOccurrence: typeof nextOccurrence }
export default api
