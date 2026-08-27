import { DAY } from './engine'
import type { Event, Task } from './types'

/**
 * Debug workshop. It exists only to watch in ten seconds what would otherwise
 * take days: deadlines, broken streaks, counter resets, scheduled reminders.
 *
 * The time offset lives in `localStorage`, not in the settings: it is a
 * device-level tool, it has no business in a backup nor in the batch-3 sync.
 */
const KEY = 'debugOffset'
const KEY_OUVERT = 'debugOuvert'

export const timeOffset = (): number => Number(localStorage.getItem(KEY)) || 0

/**
 * The workshop stays open until it is closed: tapping seven times on every visit
 * to the settings would be tedious. Like the time offset, this lives in
 * `localStorage` — it belongs to the device, not to the database.
 */
export const atelierOuvert = (): boolean => localStorage.getItem(KEY_OUVERT) === '1'

export function setAtelierOuvert(ouvert: boolean): void {
  if (ouvert) localStorage.setItem(KEY_OUVERT, '1')
  else localStorage.removeItem(KEY_OUVERT)
}

/** The time the app sees. Without an offset, plain `Date.now()`. */
export const now = (): number => Date.now() + timeOffset()

/**
 * A reload is enough to set everything straight again: nothing derived is
 * stored, balance and cycles are recomputed from the log on read.
 */
export function setTimeOffset(ms: number): void {
  if (ms) localStorage.setItem(KEY, String(ms))
  else localStorage.removeItem(KEY)
  location.reload()
}

/** Manufactured events are recognised by their id, so they can be taken back. */
export const PREFIX = 'dbg-'
export const isDebugEvent = (id: string) => id.startsWith(PREFIX)

/**
 * `n` completions in a row, one per cycle, the last one just now.
 * These are real events: the streak they produce is computed by the engine like
 * any other, otherwise the simulation would prove nothing.
 */
export function fakeStreak(task: Task, n: number, at = now()): Event[] {
  const every = Math.max(1, task.repeat?.everyDays ?? 1)
  return Array.from({ length: Math.max(1, n) }, (_, i) => ({
    id: `${PREFIX}${task.id}-${i}-${at}`,
    ts: at - (n - 1 - i) * every * DAY,
    kind: 'complete' as const,
    taskId: task.id,
    baseReward: task.reward,
    penaltyFactor: 1,
    penaltyFlat: 0,
    repeat: task.repeat,
    streak: task.streak,
  }))
}

/**
 * Everything needed to undo what the workshop left behind: what it manufactured,
 * and what was completed while the clock was shifted — those events carry a
 * future date, which no real gesture can produce.
 *
 * Nothing is erased from the log, `undo` events are stacked instead, exactly
 * like the undo button: the balance comes back to the cent and the golden rule
 * holds.
 */
export function undoDebugEvents(events: Event[], at = Date.now()): Event[] {
  const annules = new Set(events.filter((e) => e.kind === 'undo').map((e) => e.targetId))
  return events
    // Undo events carry the same prefix: without this guard, every click would
    // undo the previous undos and the log would swell without end.
    .filter((e) => e.kind !== 'undo' && (isDebugEvent(e.id) || e.ts > at) && !annules.has(e.id))
    .map((e, i) => ({ id: `${PREFIX}undo-${at}-${i}`, ts: at, kind: 'undo' as const, targetId: e.id }))
}
