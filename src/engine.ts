import type { Event, LedgerEntry, Pending, Task, TaskState } from './types'

export const DAY = 86_400_000

/**
 * Local day number, immune to daylight saving shifts.
 *
 * `dayStart` is an offset **in minutes**: at 270 (4:30 am), anything happening
 * before 4:30 am still counts for the day before. A counter filled late at night
 * therefore lands on the day one has in mind.
 */
export function dayNum(ts: number, dayStart = 0): number {
  const d = new Date(ts - dayStart * 60_000)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

/** Slice of `everyDays` days, aligned on the calendar. */
export function periodKey(ts: number, everyDays: number, dayStart = 0): number {
  return Math.floor(dayNum(ts, dayStart) / Math.max(1, everyDays))
}

/**
 * A counter's period: the window after which it resets to zero.
 *
 * Without a rhythm there is none — a one-shot counter keeps its progress until
 * it completes, it has no reason to empty itself on the stroke of midnight.
 * Otherwise it is the task's own cycle, so the reset happens on the due date and
 * not on some grid unrelated to it.
 */
export function counterPeriod(task: Task | undefined, ts: number, dayStart = 0): number {
  if (!task?.repeat) return 0
  // A rolling cycle has no grid until something is completed, and a counter
  // produces no completion: fall back on plain N-day slices.
  return rythme(task.repeat) === 'glissant'
    ? periodKey(ts, task.repeat.everyDays, dayStart)
    : firstCycleEnd(task, ts, dayStart)
}

const everyDaysOf = (task: Task | undefined) => Math.max(1, task?.repeat?.everyDays ?? 1)

/**
 * A repeating task's rhythm, derived from its fields rather than stored: a
 * single control on screen, hence no contradictory combination possible.
 */
export type Rythme = 'jour' | 'semaine' | 'mois' | 'glissant'

export function rythme(repeat: NonNullable<Task['repeat']>): Rythme {
  if (repeat.monthday != null) return 'mois'
  if (repeat.weekday != null) return 'semaine'
  // "Every 1 day after each completion" is not a thing: that is just daily.
  return repeat.everyDays > 1 ? 'glissant' : 'jour'
}

/** Time of day of the deadline. Without one, the cycle closes at end of day. */
function dueHm(task: Task): [number, number] {
  const d = task.due ? new Date(task.due.at) : null
  return d && !Number.isNaN(+d) ? [d.getHours(), d.getMinutes()] : [23, 59]
}

const atHm = (d: Date, [h, m]: [number, number]) => {
  const x = new Date(d)
  x.setHours(h, m, 0, 0)
  return +x
}

/** Day `md` of the given month, clamped to the last day when the month is short. */
function monthdayTs(y: number, month: number, md: number, hm: [number, number]): number {
  const last = new Date(y, month + 1, 0).getDate()
  return atHm(new Date(y, month, Math.min(md, last)), hm)
}

/** Midnight of the day `ts` belongs to, `dayStart` included. */
function startOfDay(ts: number, dayStart: number): number {
  const d = new Date(ts - dayStart * 60_000)
  d.setHours(0, 0, 0, 0)
  return +d + dayStart * 60_000
}

/** Next calendar deadline strictly after `after`. */
function nextBoundary(task: Task, after: number): number {
  const r = task.repeat!
  const hm = dueHm(task)
  const d = new Date(after)

  if (r.monthday != null) {
    const here = monthdayTs(d.getFullYear(), d.getMonth(), r.monthday, hm)
    return here > after ? here : monthdayTs(d.getFullYear(), d.getMonth() + 1, r.monthday, hm)
  }
  d.setHours(hm[0], hm[1], 0, 0)
  if (+d > after && (r.weekday == null || d.getDay() === r.weekday)) return +d
  do {
    d.setDate(d.getDate() + 1)
  } while (r.weekday != null && d.getDay() !== r.weekday)
  return +d
}

/** The deadline preceding `due` on the same grid. */
function prevBoundary(task: Task, due: number): number {
  const r = task.repeat!
  const d = new Date(due)
  if (r.monthday != null) {
    return monthdayTs(d.getFullYear(), d.getMonth() - 1, r.monthday, dueHm(task))
  }
  d.setDate(d.getDate() - (r.weekday != null ? 7 : 1))
  return +d
}

/**
 * Deadline of a task never completed yet: the next one on the calendar, today's
 * included. It therefore moves forward by one cycle instead of sitting in the
 * past — a brand new task is not late since the day it was created.
 */
function firstCycleEnd(task: Task, now: number, dayStart: number): number {
  if (rythme(task.repeat!) === 'glissant') return atHm(new Date(now), dueHm(task))
  return nextBoundary(task, startOfDay(now, dayStart) - 1)
}

/** Opening of the cycle closing at `end`: the day after the previous deadline. */
function cycleOpen(task: Task, end: number, dayStart: number): number {
  const d = new Date(prevBoundary(task, end))
  d.setDate(d.getDate() + 1)
  return startOfDay(+d, dayStart)
}

/**
 * The next deadline once `ts` has been completed.
 *
 * On a calendar rhythm, a completion fills the cycle **open at the time of the
 * tap**: doing it early does not pull the next deadline closer, and catching up
 * on a late one does not leave the task to be done again right away — it would
 * otherwise restart on the current cycle, which had just been done. A tap
 * landing in the gap between a missed deadline and the opening of the next cycle
 * does fill the missed one: that is a task done late, not early. On a rolling
 * rhythm the completion itself restarts the count — the whole point of it.
 */
function nextCycleEnd(task: Task, pending: number, ts: number, dayStart: number): number {
  const r = task.repeat!
  if (rythme(r) === 'glissant') {
    const d = new Date(ts)
    d.setDate(d.getDate() + Math.max(1, r.everyDays))
    return atHm(d, dueHm(task))
  }
  // `ts - 1`: a completion exactly on the deadline still belongs to its cycle.
  const end = nextBoundary(task, ts - 1)
  const rempli = ts >= cycleOpen(task, end, dayStart) ? nextBoundary(task, end) : end
  // A tap poured in late by a widget must never push the deadline backwards.
  return Math.max(pending, rempli)
}

export type Cycle = {
  /** Opening: before it, the task is already done for this round. */
  from: number
  /** Closing: after it, you are late. */
  end: number | null
}

/**
 * The cycle the next completion will fill. Availability and lateness both come
 * out of it, so they can no longer contradict each other.
 */
export function cycleFor(
  task: Task,
  s: TaskState | undefined,
  now = Date.now(),
  dayStart = 0,
): Cycle {
  if (!task.repeat) {
    const fixed = task.due ? Date.parse(task.due.at) : NaN
    return { from: -Infinity, end: Number.isNaN(fixed) ? null : fixed }
  }
  const end = s?.pendingDue ?? firstCycleEnd(task, now, dayStart)
  if (rythme(task.repeat) === 'glissant') return { from: startOfDay(end, dayStart), end }

  // A weekly task due on Sunday is done from Monday to Sunday, not from Sunday
  // 8 pm to Sunday 8 pm.
  return { from: cycleOpen(task, end, dayStart), end }
}

/** Deadline applying to the next completion, or null when there is none. */
export function dueTsFor(
  task: Task,
  s: TaskState | undefined,
  now = Date.now(),
  dayStart = 0,
): number | null {
  if (!task.due) return null
  return cycleFor(task, s, now, dayStart).end
}

/**
 * The next `n` deadlines, current one included.
 *
 * Used to schedule reminders several cycles ahead, so they keep firing without
 * having to open the app. It **assumes every cycle is met on time**:
 * `pendingDue` only moves forward on a completion, so there is no "next cycle"
 * as long as the current one is unfilled. A harmless assumption here — none of
 * this touches the balance, and the slightest visit to the app reschedules
 * everything on the real state.
 */
export function upcomingDues(
  task: Task,
  s: TaskState | undefined,
  now = Date.now(),
  dayStart = 0,
  n = 4,
): number[] {
  const first = dueTsFor(task, s, now, dayStart)
  if (first === null) return []
  if (!task.repeat) return [first]

  const dues = [first]
  while (dues.length < n)
    dues.push(nextCycleEnd(task, dues[dues.length - 1], dues[dues.length - 1], dayStart))
  return dues
}

/**
 * Late penalty, frozen onto the event at completion time.
 * `factor` scales the reward, `flat` subtracts a fixed amount from it.
 */
export function computePenalty(
  task: Task,
  ts: number,
  s: TaskState | undefined,
): { factor: number; flat: number } {
  return penaltyAt(task, ts, dueTsFor(task, s, ts))
}

function penaltyAt(task: Task, ts: number, due: number | null): { factor: number; flat: number } {
  const none = { factor: 1, flat: 0 }
  if (!task.due || due === null || ts <= due) return none

  const p = task.due.penalty
  switch (p.kind) {
    case 'flat':
      return { factor: 1, flat: Math.max(0, p.amount) }
    case 'percent':
      return { factor: clamp01(1 - p.percent / 100), flat: 0 }
    case 'decay': {
      // Being late costs at least one day of decay.
      const daysLate = Math.max(1, Math.ceil((ts - due) / DAY))
      return { factor: clamp01(1 - (p.percentPerDay * daysLate) / 100), flat: 0 }
    }
    case 'none':
      return none
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export type Replay = {
  balance: number
  perTask: Map<string, TaskState>
  /** Reverse chronological: most recent first. */
  entries: LedgerEntry[]
}

/**
 * Moves the streak up one step.
 *
 * Being late does not break it right away: it **freezes** the streak, kept but
 * stuck. The tolerance is **one day**, not one cycle: on a weekly task, a whole
 * cycle of grace amounted to doing it every other week and never losing the
 * streak. On a daily task a day and a cycle are the same thing — nothing changes
 * there.
 *
 * Reaching a counter's target counts as a completion: without that, the "streak
 * bonus" setting was useless on those tasks — three days at 3/3 left the streak
 * at zero.
 */
function avancerSerie(s: TaskState, ts: number, every: number, day: (t: number) => number): void {
  if (s.lastDoneTs === null) {
    s.streak = 1
    s.frozen = false
    return
  }
  const gap = day(ts) - day(s.lastDoneTs)
  // gap === 0: done again the same day, the streak does not move.
  if (gap <= 0) return
  if (gap <= every) {
    s.streak += 1
    s.frozen = false
  } else if (gap <= every + 1) {
    // Caught up within the day of grace: the streak holds, without growing.
    s.frozen = false
  } else {
    // Keep what was just lost: the interface has to be able to say it.
    s.brokenStreak = s.streak
    s.streak = 1
    s.frozen = false
    s.streakTiersPaid.clear()
  }
}

/**
 * The task as it stood at the time of the tap.
 *
 * The event freezes everything the balance depends on — reward, rhythm, streak
 * bonus, counter — because the replay itself reads today's task: without that
 * freeze, changing a reward or a multiplier rewrote the whole history and made
 * the balance jump. An event predating the freeze carries no such field: it
 * falls back on the current definition, for want of anything better.
 */
type Gel = {
  repeat?: Task['repeat']
  streak?: Task['streak']
  counter?: Task['counter']
  baseReward?: number
}

const commeAlors = (task: Task | undefined, gel: Gel): Task | undefined =>
  task && {
    ...task,
    repeat: gel.repeat !== undefined ? gel.repeat : task.repeat,
    streak: gel.streak !== undefined ? gel.streak : task.streak,
    counter: gel.counter !== undefined ? gel.counter : task.counter,
    reward: gel.baseReward ?? task.reward,
  }

const freshState = (): TaskState => ({
  streak: 0,
  lastDoneTs: null,
  pendingDue: null,
  count: 0,
  periodKey: null,
  targetPaid: false,
  lastTargetTs: null,
  frozen: false,
  brokenStreak: 0,
  bestStreak: 0,
  countTiersPaid: new Set(),
  streakTiersPaid: new Set(),
})

/**
 * Replays the whole log to get the balance and the state of every task.
 * Pure and deterministic: two devices holding the same events necessarily reach
 * the same balance, with no conflict resolution.
 *
 * ponytail: full replay on every load, O(n) over the log. Add a checkpoint
 * (frozen balance + cursor) if it ever goes past ~50k events.
 */
export function replay(events: Event[], tasks: Task[], now = Date.now(), dayStart = 0): Replay {
  const day = (ts: number) => dayNum(ts, dayStart)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const perTask = new Map<string, TaskState>()
  const entries: LedgerEntry[] = []
  let balance = 0

  /**
   * A correction does not write itself into the history: it erases the line it
   * corrects. So we remember where every counter payout was recorded — the
   * "target" or "tier N" key of a task — in order to remove it if the user
   * counts back down.
   */
  const paidLine = new Map<string, number>()
  const erased = new Set<number>()

  const credit = (key: string, entry: LedgerEntry) => {
    paidLine.set(key, entries.length)
    entries.push(entry)
  }
  /** Takes back exactly what was paid, even if the task has changed since. */
  const refund = (key: string): number => {
    const i = paidLine.get(key)
    paidLine.delete(key)
    if (i === undefined) return 0
    erased.add(i)
    return entries[i].total
  }

  const stateOf = (id: string): TaskState => {
    let s = perTask.get(id)
    if (!s) perTask.set(id, (s = freshState()))
    return s
  }

  // Undos are known up front: the targeted event is simply skipped, as if it
  // had never happened. Streaks and counters therefore recompute themselves.
  const undone = new Set<string>()
  for (const e of events) if (e.kind === 'undo') undone.add(e.targetId)

  // `id` breaks ties between events sharing a timestamp: two devices sort alike.
  const sorted = [...events]
    .filter((e): e is Exclude<Event, { kind: 'undo' }> => e.kind !== 'undo' && !undone.has(e.id))
    .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const e of sorted) {
    if (e.kind === 'spend' || e.kind === 'adjust') {
      const total = e.kind === 'spend' ? -Math.abs(e.amount) : e.amount
      balance += total
      entries.push({
        eventId: e.id,
        ts: e.ts,
        kind: e.kind,
        label: e.label,
        base: 0,
        penalty: 0,
        multiplierBonus: 0,
        tierBonus: 0,
        total,
      })
      continue
    }

    const task = byId.get(e.taskId)
    const label = task?.name ?? '(tâche supprimée)'
    const s = stateOf(e.taskId)

    if (e.kind === 'count') {
      // The counter as it stood at the tap: its reward, its target, its tiers
      // and its period rhythm. Editing the task no longer replays the past.
      const alors = commeAlors(task, e)
      const target = alors?.counter?.target ?? Infinity
      const k = counterPeriod(alors, e.ts, dayStart)
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
      // The target caps the counter: past it, one more tap is useless and must
      // above all not shift when a tier gets crossed.
      s.count = Math.min(target, Math.max(0, s.count + e.delta))

      // The balance follows the counter both ways: reaching the target pays the
      // reward, dropping back below takes it away. That is what one expects when
      // fixing a mis-tap — and it is also what makes farming impossible, since a
      // round trip nets zero.
      let base = 0
      const reached = alors != null && s.count >= target
      if (reached && !s.targetPaid) {
        s.targetPaid = true
        s.lastTargetTs = e.ts
        base = alors!.reward
        // Reaching the target counts as a completion: that is what keeps a
        // counter's streak alive. Streak bonuses stay reserved for completions
        // until the rule for partial counters is settled.
        avancerSerie(s, e.ts, everyDaysOf(alors), day)
        s.lastDoneTs = e.ts
        s.bestStreak = Math.max(s.bestStreak, s.streak)
        credit(`${e.taskId}:objectif`, {
          eventId: `${e.id}:objectif`,
          ts: e.ts,
          kind: 'count',
          taskId: e.taskId,
          label: `${label} — objectif atteint`,
          base,
          penalty: 0,
          multiplierBonus: 0,
          tierBonus: 0,
          total: base,
        })
      } else if (!reached && s.targetPaid) {
        s.targetPaid = false
        s.lastTargetTs = null
        base = -refund(`${e.taskId}:objectif`)
      }

      // Same symmetry on the intermediate tiers.
      let tierBonus = 0
      for (const t of alors?.counter?.tiers ?? []) {
        const crossed = t.at <= s.count
        const paid = s.countTiersPaid.has(t.at)
        if (crossed && !paid) {
          s.countTiersPaid.add(t.at)
          tierBonus += t.bonus
          credit(`${e.taskId}:palier${t.at}`, {
            eventId: `${e.id}:palier${t.at}`,
            ts: e.ts,
            kind: 'count',
            taskId: e.taskId,
            label: `${label} — palier ${t.at}`,
            base: 0,
            penalty: 0,
            multiplierBonus: 0,
            tierBonus: t.bonus,
            total: t.bonus,
          })
        } else if (!crossed && paid) {
          s.countTiersPaid.delete(t.at)
          tierBonus -= refund(`${e.taskId}:palier${t.at}`)
        }
      }
      balance += base + tierBonus
      continue
    }

    // --- completing a task ---
    // What is frozen on the event wins — rhythm and streak bonus: editing the
    // task today must neither repair nor break what played out yesterday, nor
    // re-price what has already been paid.
    const alors = commeAlors(task, e)
    const every = everyDaysOf(alors)
    avancerSerie(s, e.ts, every, day)

    let tierBonus = 0
    for (const t of alors?.streak?.tiers ?? []) {
      if (t.at <= s.streak && !s.streakTiersPaid.has(t.at)) {
        s.streakTiersPaid.add(t.at)
        tierBonus += t.bonus
      }
    }

    // The cycle is filled, move on to the next. Computed here and not at read
    // time: it depends on the deadline then in force, hence on the whole history.
    if (alors?.repeat) {
      s.pendingDue = nextCycleEnd(
        alors,
        s.pendingDue ?? firstCycleEnd(alors, e.ts, dayStart),
        e.ts,
        dayStart,
      )
    }

    const penalized = Math.max(0, e.baseReward * e.penaltyFactor - e.penaltyFlat)
    const m = alors?.streak?.multiplier
    const factor = m ? Math.max(1, Math.min(1 + m.perStep * (s.streak - 1), m.cap)) : 1
    const multiplierBonus = penalized * factor - penalized
    const total = penalized * factor + tierBonus

    balance += total
    s.lastDoneTs = e.ts
    s.bestStreak = Math.max(s.bestStreak, s.streak)
    entries.push({
      eventId: e.id,
      ts: e.ts,
      kind: 'complete',
      taskId: e.taskId,
      label,
      base: e.baseReward,
      penalty: penalized - e.baseReward,
      multiplierBonus,
      tierBonus,
      total,
    })
  }

  // Re-framing on the present moment: yesterday's counter goes back to zero, a
  // streak whose window has passed is broken.
  const today = day(now)
  for (const t of tasks) {
    const s = stateOf(t.id)
    const every = everyDaysOf(t)
    if (t.counter) {
      const k = counterPeriod(t, now, dayStart)
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
    }
    // Freeze and break both show without waiting for the next completion: the
    // mere passing of time is what pronounces them.
    if (s.lastDoneTs !== null) {
      const ecart = today - day(s.lastDoneTs)
      if (ecart > every + 1) {
        if (s.streak > 0) s.brokenStreak = s.streak
        s.streak = 0
        s.frozen = false
        s.streakTiersPaid.clear()
      } else if (ecart > every) {
        s.frozen = true
      }
    }
  }

  // Corrected lines disappear, they have nothing left to tell.
  const kept = entries.filter((_, i) => !erased.has(i))
  kept.reverse()
  return { balance, perTask, entries: kept }
}

/**
 * Cycles missed over a repeating task's history: the gap between two consecutive
 * completions (or the last one and now) beyond a single cycle.
 * A simplification for one global display figure: it uses the task's current
 * rhythm, not the one frozen on each event as the replay does — a repeating task
 * rarely changes rhythm, and nothing here touches the balance.
 */
export function missedCycles(tasks: Task[], entries: LedgerEntry[], now: number, dayStart = 0): number {
  let total = 0
  for (const task of tasks) {
    if (!task.repeat) continue
    const every = Math.max(1, task.repeat.everyDays)
    const jours = entries
      .filter(
        (e) =>
          e.taskId === task.id && (e.kind === 'complete' || (e.kind === 'count' && e.label.endsWith('objectif atteint'))),
      )
      .map((e) => dayNum(e.ts, dayStart))
      .sort((a, b) => a - b)

    for (let i = 1; i < jours.length; i++) {
      total += Math.max(0, Math.floor((jours[i] - jours[i - 1] - 1) / every))
    }
    const dernier = jours[jours.length - 1]
    if (dernier !== undefined) {
      total += Math.max(0, Math.floor((dayNum(now, dayStart) - dernier - 1) / every))
    }
  }
  return total
}

/**
 * What the task would pay on the n-th completion in a row, on time.
 * Used to simulate the effect of a multiplier before settling on it.
 */
export function rewardAtStreak(task: Task, streak: number): number {
  const m = task.streak?.multiplier
  const factor = m ? Math.max(1, Math.min(1 + m.perStep * (streak - 1), m.cap)) : 1
  const tier = (task.streak?.tiers ?? [])
    .filter((t) => t.at === streak)
    .reduce((sum, t) => sum + t.bonus, 0)
  return task.reward * factor + tier
}

/** What the task would pay when completed `daysLate` days late. */
export function rewardAfterDays(task: Task, daysLate: number): number {
  const due = dueTsFor(task, undefined)
  if (due === null) return task.reward
  // Exactly n days after the deadline: `penaltyAt` rounds days up, so being one
  // millisecond off would count one extra day late.
  const { factor, flat } = penaltyAt(task, due + Math.max(0, daysLate) * DAY, due)
  return Math.max(0, task.reward * factor - flat)
}

/** First day late at which the task pays nothing, or null if it always pays. */
export function daysUntilWorthless(task: Task): number | null {
  if (!task.due) return null
  for (let d = 0; d <= 60; d++) {
    if (rewardAfterDays(task, d) <= 0) return d
  }
  return null
}

/** Rank at which the multiplier hits its cap, or null when there is none. */
export function streakAtCap(task: Task): number | null {
  const m = task.streak?.multiplier
  if (!m || m.perStep <= 0) return null
  return Math.ceil((m.cap - 1) / m.perStep) + 1
}

/**
 * A task's last completion still standing, the one "undo" aims at.
 * Already undone events are skipped, otherwise undo would hit thin air.
 */
export type CompleteEvent = Extract<Event, { kind: 'complete' }>

export function lastCompletion(events: Event[], taskId: string): CompleteEvent | null {
  const undone = new Set<string>()
  for (const e of events) if (e.kind === 'undo') undone.add(e.targetId)

  let found: CompleteEvent | null = null
  for (const e of events) {
    if (e.kind !== 'complete' || e.taskId !== taskId || undone.has(e.id)) continue
    if (!found || e.ts > found.ts) found = e
  }
  return found
}

/** A repeating task can only be completed again on the next cycle. */
export function isAvailable(
  task: Task,
  s: TaskState | undefined,
  now = Date.now(),
  dayStart = 0,
): boolean {
  if (task.counter) return true
  if (!s || s.lastDoneTs === null) return true
  if (!task.repeat) return false
  return now >= cycleFor(task, s, now, dayStart).from
}

/**
 * Turns taps made on a widget into log events.
 *
 * The penalty is computed with the timestamp of the tap, not that of the pour:
 * completing on time from the home screen then reopening the app three days
 * later must not cost a late penalty.
 *
 * ponytail: one replay per item, O(n²) over the queue. It holds a handful of
 * taps; revisit only if widgets become the main way of using the app.
 */
export function pendingToEvents(
  items: Pending[],
  tasks: Task[],
  existing: Event[],
  newId: () => string,
): Event[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const added: Event[] = []

  for (const p of [...items].sort((a, b) => a.ts - b.ts)) {
    if (p.kind === 'complete') {
      const task = byId.get(p.taskId)
      if (!task) continue
      const { perTask } = replay([...existing, ...added], tasks, p.ts)
      const { factor, flat } = computePenalty(task, p.ts, perTask.get(task.id))
      added.push({
        id: newId(),
        ts: p.ts,
        kind: 'complete',
        taskId: p.taskId,
        baseReward: task.reward,
        penaltyFactor: factor,
        penaltyFlat: flat,
        repeat: task.repeat,
        streak: task.streak,
      })
    } else {
      // The freeze happens at pour time, not at tap time: the native side only
      // sends facts. It is today's task, but frozen once and for all — a later
      // edit will no longer replay that particular tap.
      const task = byId.get(p.taskId)
      added.push({
        id: newId(),
        ts: p.ts,
        kind: 'count',
        taskId: p.taskId,
        delta: p.delta,
        baseReward: task?.reward,
        counter: task?.counter,
        repeat: task?.repeat,
      })
    }
  }
  return added
}

/**
 * One-shot tasks completed before today: they have served their purpose.
 * They are cleared the next day rather than on the spot, so they stay visible
 * and undoable for the rest of the day. Their events — hence their payouts —
 * outlive the deletion.
 *
 * A counter with no repetition belongs here too: it will not happen again, and
 * once its target is reached it has nothing left to do in the list.
 */
export function staleOneShots(
  tasks: Task[],
  rep: Replay,
  now = Date.now(),
  dayStart = 0,
): string[] {
  const today = dayNum(now, dayStart)
  return tasks
    .filter((t) => {
      if (t.repeat || t.deletedAt) return false
      const s = rep.perTask.get(t.id)
      const last = t.counter ? s?.lastTargetTs : s?.lastDoneTs
      return last != null && dayNum(last, dayStart) < today
    })
    .map((t) => t.id)
}

/** Preview of what completing now would pay, to show it before the tap. */
export function previewReward(task: Task, s: TaskState | undefined, now = Date.now()): number {
  const { factor, flat } = computePenalty(task, now, s)
  const penalized = Math.max(0, task.reward * factor - flat)
  const nextStreak = (s?.streak ?? 0) + 1
  const m = task.streak?.multiplier
  const mf = m ? Math.max(1, Math.min(1 + m.perStep * (nextStreak - 1), m.cap)) : 1
  const tiers = (task.streak?.tiers ?? [])
    .filter((t) => t.at <= nextStreak && !s?.streakTiersPaid.has(t.at))
    .reduce((sum, t) => sum + t.bonus, 0)
  return penalized * mf + tiers
}
