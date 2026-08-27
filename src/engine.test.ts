import { describe, expect, it } from 'vitest'
import {
  DAY,
  computePenalty,
  childrenOf,
  isAvailable,
  isDone,
  subtaskProgress,
  withParents,
  dayNum,
  daysUntilWorthless,
  dueTsFor,
  missedCycles,
  pendingToEvents,
  replay,
  rewardAfterDays,
  rewardAtStreak,
  staleOneShots,
  streakAtCap,
  upcomingDues,
} from './engine'
import { parseBackup, serialize } from './backup'
import { fakeStreak, undoDebugEvents } from './debug'
import type { Event, Task } from './types'

// Monday 5 January 2026, noon — far from any daylight saving change.
const T0 = new Date(2026, 0, 5, 12, 0, 0).getTime()
const at = (days: number) => T0 + days * DAY

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'Tâche',
  reward: 10,
  repeat: null,
  counter: null,
  due: null,
  streak: null,
  remind: null,
  cheer: false,
  archived: false,
  updatedAt: 0,
  deletedAt: null,
  ...over,
})

let seq = 0
const done = (days: number, over: Partial<Extract<Event, { kind: 'complete' }>> = {}): Event => ({
  id: `e${++seq}`,
  ts: at(days),
  kind: 'complete',
  taskId: 't1',
  baseReward: 10,
  penaltyFactor: 1,
  penaltyFlat: 0,
  ...over,
})
// Every tap offset by a few milliseconds: on equal timestamps the engine breaks
// ties by id, and "c10" would come before "c9".
const count = (days: number, delta = 1, id?: string): Event => {
  const n = ++seq
  return { id: id ?? `c${n}`, ts: at(days) + n, kind: 'count', taskId: 't1', delta }
}

const daily = { everyDays: 1 }

describe('late penalty', () => {
  const t = task({ reward: 50, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'decay', percentPerDay: 20 } } })

  it('decays per day late and never goes below zero', () => {
    expect(computePenalty(t, at(0), undefined).factor).toBe(1)
    expect(computePenalty(t, at(1), undefined).factor).toBeCloseTo(0.8)
    expect(computePenalty(t, at(3), undefined).factor).toBeCloseTo(0.4)
    expect(computePenalty(t, at(5), undefined).factor).toBe(0)
    expect(computePenalty(t, at(50), undefined).factor).toBe(0)
  })

  it('never makes a late task cost money', () => {
    const flat = task({ reward: 10, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'flat', amount: 999 } } })
    const p = computePenalty(flat, at(1), undefined)
    const { balance } = replay([done(1, { baseReward: 10, penaltyFactor: p.factor, penaltyFlat: p.flat })], [flat])
    expect(balance).toBe(0)
  })

  it('slides by one cycle on a repeating task instead of being late forever', () => {
    const rep = task({ repeat: { everyDays: 7 }, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'percent', percent: 50 } } })
    // Last completion on day 10: the next deadline is day 17, not day 0.
    const s = replay([done(10)], [rep], at(10)).perTask.get('t1')
    expect(computePenalty(rep, at(16), s).factor).toBe(1)
    expect(computePenalty(rep, at(18), s).factor).toBeCloseTo(0.5)
  })
})

describe('cycles', () => {
  // T0 = Monday 5 January 2026, noon. Deadline at 8 pm.
  const vingtHeures = new Date(at(0))
  vingtHeures.setHours(20, 0, 0, 0)
  const due = { at: vingtHeures.toISOString(), penalty: { kind: 'none' as const } }
  const state = (t: Task, evts: Event[]) =>
    replay(evts, [t], evts[evts.length - 1].ts).perTask.get('t1')

  describe('weekly', () => {
    const t = task({ repeat: { everyDays: 7, weekday: 0 }, due }) // dimanche

    it('aims at the next Sunday, not at a fixed date', () => {
      const d = dueTsFor(t, undefined, at(0))!
      expect(new Date(d).getDay()).toBe(0)
      expect(new Date(d).getHours()).toBe(20)
      expect(dayNum(d) - dayNum(at(0))).toBe(6) // lundi → dimanche
    })

    it('does not pull the deadline closer when done early', () => {
      // Done on Saturday, the day before the deadline: the next one is the
      // Sunday after, not tomorrow's.
      const s = state(t, [done(5)])
      expect(dayNum(dueTsFor(t, s, at(5))!) - dayNum(at(5))).toBe(8)
    })

    it('catching up fills the current week, not the one that was missed', () => {
      // Done on Sunday the 11th, then Sunday the 18th missed and caught up on
      // Wednesday the 21st: that Wednesday falls in the week of the 19th to the
      // 25th, so that is the week filled — otherwise the task was left to do
      // again the very same day.
      const s = state(t, [done(6), done(16)])
      expect(dayNum(dueTsFor(t, s, at(16))!) - dayNum(at(16))).toBe(11)
      expect(isAvailable(t, s, at(16))).toBe(false)
    })

    it('a catch-up landing before the next cycle opens stays a late completion', () => {
      // Sunday the 18th missed by three hours: the cycle of the 19th is not open
      // yet, so the tap does settle the one just missed.
      const s = state(t, [done(6), done(13, { ts: at(13) + 11 * 3_600_000 })])
      expect(new Date(dueTsFor(t, s, at(13))!).getDay()).toBe(0)
      expect(dayNum(dueTsFor(t, s, at(13))!) - dayNum(at(13))).toBe(7)
    })

    it('reopens the day after the deadline, not seven days after the completion', () => {
      const s = state(t, [done(2)]) // fait mercredi, pour le dimanche 11
      expect(isAvailable(t, s, at(5))).toBe(false) // samedi : rien à refaire
      expect(isAvailable(t, s, at(7))).toBe(true) // lundi : nouveau cycle
    })
  })

  describe('daily', () => {
    const t = task({ repeat: { everyDays: 1 }, due })

    it('is not left pending after a completion on a broken chain', () => {
      // Done on the 5th, nothing for six days — the streak is broken — then
      // completed on the 11th: it fills the 11th, not the day that was missed.
      const s = state(t, [done(0), done(6)])
      expect(isAvailable(t, s, at(6))).toBe(false)
      expect(dayNum(dueTsFor(t, s, at(6))!) - dayNum(at(6))).toBe(1)
    })

    it('keeps the configured time instead of drifting on every completion', () => {
      const tard = at(0) + 9 * 3_600_000 // validée à 21 h, une heure trop tard
      const s = replay([done(0, { ts: tard })], [t], tard).perTask.get('t1')
      const d = new Date(dueTsFor(t, s, tard)!)
      expect(d.getHours()).toBe(20)
      expect(dayNum(+d) - dayNum(tard)).toBe(1)
    })
  })

  describe('monthly', () => {
    const t = task({ repeat: { everyDays: 31, monthday: 31 }, due })

    it('falls back on the last day of months that are too short', () => {
      const janvier = state(t, [done(26)]) // 31 janvier
      const suivante = dueTsFor(t, janvier, at(26))!
      expect(new Date(suivante).getMonth()).toBe(1) // février
      expect(new Date(suivante).getDate()).toBe(28)
    })
  })

  describe('upcoming deadlines', () => {
    it('follows the calendar grid, one Sunday after another', () => {
      const t = task({ repeat: { everyDays: 7, weekday: 0 }, due })
      const dues = upcomingDues(t, undefined, at(0), 0, 4)
      expect(dues).toHaveLength(4)
      expect(dues.every((d) => new Date(d).getDay() === 0)).toBe(true)
      expect(dues.map((d) => dayNum(d) - dayNum(at(0)))).toEqual([6, 13, 20, 27])
    })

    it('moves forward by the rhythm on a rolling cycle', () => {
      const t = task({ repeat: { everyDays: 3 }, due })
      const dues = upcomingDues(t, undefined, at(0), 0, 3)
      expect(dues.map((d) => dayNum(d) - dayNum(at(0)))).toEqual([0, 3, 6])
    })

    it('returns only one for a one-shot task, and none without a deadline', () => {
      expect(upcomingDues(task({ due }), undefined, at(0))).toHaveLength(1)
      expect(upcomingDues(task({ repeat: { everyDays: 1 } }), undefined, at(0))).toEqual([])
    })
  })
})

describe('streak', () => {
  const t = task({
    repeat: daily,
    streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 1.3 } },
  })

  it('stacks tier and multiplier, and honours the cap', () => {
    const { balance, perTask } = replay([done(0), done(1), done(2), done(3), done(4)], [t], at(4))
    //  10 + 11 + (12 + 5) + 13 + 13(capped)
    expect(balance).toBeCloseTo(64)
    expect(perTask.get('t1')!.streak).toBe(5)
  })

  it('does not grow twice on the same day', () => {
    const { perTask } = replay([done(0), done(0.1), done(0.2)], [t], at(0))
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('breaks outside the window and replays its tiers afterwards', () => {
    const big = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 100 }], multiplier: null } })
    const { balance, perTask } = replay([done(0), done(1), done(5), done(6)], [big], at(6))
    expect(perTask.get('t1')!.streak).toBe(2)
    expect(balance).toBe(40 + 200) // 4 validations à 10, le palier 2 franchi deux fois
  })

  it('remembers the lost streak so it can be announced', () => {
    const { perTask } = replay([done(0), done(1), done(2)], [t], at(9))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(0) // rompue par le simple passage du temps
    expect(s.brokenStreak).toBe(3)
    expect(s.bestStreak).toBe(3)
  })

  it('keeps the record after a break and a fresh start', () => {
    const { perTask } = replay([done(0), done(1), done(2), done(9), done(10)], [t], at(10))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2)
    expect(s.brokenStreak).toBe(3)
    expect(s.bestStreak).toBe(3)
  })

  it('freezes the streak on a missed cycle instead of breaking it', () => {
    const { perTask } = replay([done(0), done(1), done(3)], [t], at(3))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2) // le rattrapage tient la série, sans la faire monter
    expect(s.frozen).toBe(false) // rattrapée, donc dégelée
  })

  it('does not freeze while the current cycle is still open', () => {
    const { perTask } = replay([done(0), done(1)], [t], at(2))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2)
    expect(s.frozen).toBe(false) // le jour 2 est le cycle en cours, pas un cycle manqué
  })

  it('announces the freeze as soon as the cycle passes, without a completion', () => {
    const { perTask } = replay([done(0), done(1)], [t], at(3))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2)
    expect(s.frozen).toBe(true)
  })

  it('breaks on the second missed cycle', () => {
    const { perTask } = replay([done(0), done(1)], [t], at(5))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(0)
    expect(s.brokenStreak).toBe(2)
  })

  it('no longer grows a daily streak done every other day', () => {
    const { perTask } = replay([done(0), done(2), done(4), done(6), done(8)], [t], at(8))
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  // The freeze lasts one day, not one cycle: otherwise a weekly task done every
  // other week kept its streak forever.
  describe('hebdomadaire', () => {
    const h = task({ repeat: { everyDays: 7, weekday: 1 } })

    it('holds through one day late, without growing', () => {
      const { perTask } = replay([done(0), done(7), done(15)], [h], at(15))
      const s = perTask.get('t1')!
      expect(s.streak).toBe(2) // le retard d'un jour ne casse pas, mais ne compte pas
      expect(s.brokenStreak).toBe(0)
      expect(s.frozen).toBe(false)
    })

    it('breaks on the second day late', () => {
      const { perTask } = replay([done(0), done(7), done(16)], [h], at(16))
      const s = perTask.get('t1')!
      expect(s.streak).toBe(1)
      expect(s.brokenStreak).toBe(2)
    })

    it('freezes during the day of grace, then breaks', () => {
      expect(replay([done(0), done(7)], [h], at(15)).perTask.get('t1')!).toMatchObject({
        streak: 2,
        frozen: true,
      })
      expect(replay([done(0), done(7)], [h], at(16)).perTask.get('t1')!.streak).toBe(0)
    })

    it('no longer holds when done every other week', () => {
      const { perTask } = replay([done(0), done(14), done(28)], [h], at(28))
      expect(perTask.get('t1')!.streak).toBe(1)
    })
  })
})

describe('missed cycles', () => {
  const t = task({ repeat: daily })

  it('counts zero on a streak with no gap', () => {
    const events = [done(0), done(1), done(2), done(3)]
    const { entries } = replay(events, [t], at(3))
    expect(missedCycles([t], entries, at(3))).toBe(0)
  })

  it('counts the days skipped between two completions, and since the last one', () => {
    // 0, 1, then 5: days 2, 3 and 4 are missed.
    const { entries } = replay([done(0), done(1), done(5)], [t], at(5))
    expect(missedCycles([t], entries, at(5))).toBe(3)
    // Observed at 10 with no new completion: 6, 7, 8 and 9 add up.
    expect(missedCycles([t], entries, at(10))).toBe(7)
  })

  // The target line is recognised by its flag, not by its label: translating the
  // interface would otherwise have broken the count in silence. A tier crossed
  // is not a completion, only the target is.
  it('counts a counter target as a completion, and a tier as nothing', () => {
    const c = task({ reward: 10, repeat: daily, counter: { target: 2, tiers: [{ at: 1, bonus: 1 }] } })
    // Days 0 and 4 reach the target; day 2 stops at the tier.
    const { entries } = replay([count(0), count(0), count(2), count(4), count(4)], [c], at(4))
    expect(entries.filter(isDone).map((e) => e.target)).toEqual([true, true])
    expect(entries.filter((e) => !isDone(e)).every((e) => e.label.includes('palier'))).toBe(true)
    // Only days 0 and 4 count: days 1, 2 and 3 are missed.
    expect(missedCycles([c], entries, at(4))).toBe(3)
  })
})

describe('counter', () => {
  // Reward of 10 for the target, plus an intermediate bonus at 4.
  const t = task({ reward: 10, counter: { target: 8, unit: 'verres', tiers: [{ at: 4, bonus: 3 }] } })

  it('pays the reward at the target, with no tier needed there', () => {
    const nu = task({ reward: 10, counter: { target: 2, unit: '', tiers: [] } })
    expect(replay([count(0)], [nu], at(0)).balance).toBe(0)
    expect(replay([count(0), count(0)], [nu], at(0)).balance).toBe(10)
  })

  it('stacks the intermediate bonuses with the reward', () => {
    const events = [...Array(8)].map(() => count(0))
    expect(replay(events, [t], at(0)).balance).toBe(13) // 3 à mi-parcours + 10 à l'objectif
  })

  it('pays the target only once despite two concurrent increments', () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map(() => count(0))
    // Two offline devices each cross the target on their own.
    const events = [...seven, count(0, 1, 'phone'), count(0, 1, 'pc')]
    const { balance, perTask } = replay(events, [t], at(0))
    expect(perTask.get('t1')!.count).toBe(8) // plafonné à l'objectif
    expect(balance).toBe(13)
  })

  it('takes the reward back when dropping below the target', () => {
    const events = [...Array(8)].map(() => count(0))
    expect(replay(events, [t], at(0)).balance).toBe(13)
    // 8/8 → 7/8: the target is no longer reached, its 10 go back.
    const { balance, perTask } = replay([...events, count(0, -1)], [t], at(0))
    expect(perTask.get('t1')!.count).toBe(7)
    expect(balance).toBe(3) // il reste le bonus intermédiaire de 4
  })

  it('also refunds the intermediate tiers that were left behind', () => {
    const events = [...Array(8)].map(() => count(0))
    const retours = [...Array(5)].map(() => count(0, -1))
    // Back down to 3: neither the target nor the tier at 4 holds.
    expect(replay([...events, ...retours], [t], at(0)).balance).toBe(0)
  })

  it('cannot be farmed with round trips', () => {
    const events = [...Array(8)].map(() => count(0))
    events.push(count(0, -1), count(0, 1), count(0, -1), count(0, 1))
    expect(replay(events, [t], at(0)).balance).toBe(13)
  })

  it('never goes past the target', () => {
    const events = [...Array(12)].map(() => count(0))
    const { perTask, balance } = replay(events, [t], at(0))
    expect(perTask.get('t1')!.count).toBe(8)
    expect(balance).toBe(13)
  })

  it('caps correctly again after a decrement', () => {
    const events = [...Array(10)].map(() => count(0))
    events.push(count(0, -1), count(0, -1))
    expect(replay(events, [t], at(0)).perTask.get('t1')!.count).toBe(6)
  })

  it('pays the target again on every new period', () => {
    const quotidien = { ...t, repeat: daily }
    const jour1 = [...Array(8)].map(() => count(0))
    const jour2 = [...Array(8)].map(() => count(1))
    expect(replay([...jour1, ...jour2], [quotidien], at(1)).balance).toBe(26)
  })

  it('goes back to zero on the next period', () => {
    const quotidien = { ...t, repeat: daily }
    const { perTask, balance } = replay([count(0), count(0), count(1)], [quotidien], at(1))
    expect(perTask.get('t1')!.count).toBe(1)
    expect(balance).toBe(0)
  })

  it('resets the counter even with no event today', () => {
    const quotidien = { ...t, repeat: daily }
    const { perTask } = replay([count(0), count(0)], [quotidien], at(3))
    expect(perTask.get('t1')!.count).toBe(0)
  })

  // The reset follows the task's cycle, not the calendar: that is what tells
  // "8 glasses a day" apart from "30 km this month".
  it('keeps its progress from day to day when there is no repetition', () => {
    const { perTask } = replay([count(0), count(0)], [t], at(5))
    expect(perTask.get('t1')!.count).toBe(2)
  })

  it('never pays the target twice when there is no repetition', () => {
    const huit = [...Array(8)].map(() => count(0))
    const encore = [...Array(8)].map(() => count(1))
    expect(replay([...huit, ...encore], [t], at(1)).balance).toBe(13)
  })

  it('only resets on a cycle change on a weekly task', () => {
    // T0 = Monday 5 January, deadline on Sunday: the cycle runs to the 11th.
    // Wednesday the 7th and Thursday the 8th are in the same cycle, but in two
    // different seven-day slices — the cycle is what has to win.
    const hebdo = { ...t, repeat: { everyDays: 7, weekday: 0 } }
    const dans = replay([count(2), count(3)], [hebdo], at(3))
    expect(dans.perTask.get('t1')!.count).toBe(2)
    const apres = replay([count(2), count(3)], [hebdo], at(8)) // mardi suivant
    expect(apres.perTask.get('t1')!.count).toBe(0)
  })
})

describe('undo', () => {
  const t = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 50 }], multiplier: null } })

  it('removes the undone completion from the balance', () => {
    const e = done(0)
    expect(replay([e], [t], at(0)).balance).toBe(10)
    const annule: Event = { id: 'u1', ts: at(0), kind: 'undo', targetId: e.id }
    expect(replay([e, annule], [t], at(0)).balance).toBe(0)
  })

  it('recomputes the streak and takes the tier back', () => {
    const a = done(0)
    const b = done(1)
    // Two days in a row: the tier at 2 is crossed.
    expect(replay([a, b], [t], at(1)).balance).toBe(70)

    const annule: Event = { id: 'u2', ts: at(1), kind: 'undo', targetId: b.id }
    const { balance, perTask } = replay([a, b, annule], [t], at(1))
    expect(balance).toBe(10)
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('leaves no trace in the history', () => {
    const e = done(0)
    const annule: Event = { id: 'u5', ts: at(0), kind: 'undo', targetId: e.id }
    const { entries } = replay([e, annule], [t], at(0))
    // Neither the completion nor an "undone" line: a correction erases, it does not write.
    expect(entries).toEqual([])
  })

  it('erases the line of a counter dropped back below its target', () => {
    const c = task({ reward: 10, counter: { target: 2, unit: '', tiers: [] } })
    const monte = [count(0), count(0)]
    expect(replay(monte, [c], at(0)).entries).toHaveLength(1)
    expect(replay([...monte, count(0, -1)], [c], at(0)).entries).toEqual([])
  })

  it('has no effect when undone twice', () => {
    const e = done(0)
    const u1: Event = { id: 'u3', ts: at(0), kind: 'undo', targetId: e.id }
    const u2: Event = { id: 'u4', ts: at(0), kind: 'undo', targetId: e.id }
    expect(replay([e, u1, u2], [t], at(0)).balance).toBe(0)
  })
})

describe('balance', () => {
  it('allows going negative — blocking it would make corrections impossible', () => {
    const spend: Event = { id: 's1', ts: at(0), kind: 'spend', amount: 50, label: 'Ciné' }
    expect(replay([spend], []).balance).toBe(-50)
  })

  it('does not depend on the order in which events arrive', () => {
    const t = task({ repeat: daily, streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 2 } } })
    const events = [done(0), done(1), done(2), done(3)]
    const shuffled = [events[2], events[0], events[3], events[1]]
    expect(replay(shuffled, [t]).balance).toBeCloseTo(replay(events, [t]).balance)
  })

  it('keeps the payouts of a deleted task', () => {
    expect(replay([done(0)], []).balance).toBe(10)
  })
})

describe('multiplier simulation', () => {
  const t = task({
    reward: 10,
    streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 1.5 } },
  })

  it('gives the same amounts as the real replay', () => {
    expect(rewardAtStreak(t, 1)).toBeCloseTo(10)
    expect(rewardAtStreak(t, 2)).toBeCloseTo(11)
    expect(rewardAtStreak(t, 3)).toBeCloseTo(17) // 12 + palier 5
    expect(rewardAtStreak(t, 9)).toBeCloseTo(15) // plafonné à ×1,5
  })

  it('announces the rank at which the cap is reached', () => {
    expect(streakAtCap(t)).toBe(6)
    expect(streakAtCap(task())).toBeNull()
  })
})

describe('penalty simulation', () => {
  const decay = task({
    reward: 50,
    due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'decay', percentPerDay: 20 } },
  })

  it('decays then falls to zero', () => {
    expect(rewardAfterDays(decay, 0)).toBe(50)
    expect(rewardAfterDays(decay, 1)).toBeCloseTo(40)
    expect(rewardAfterDays(decay, 3)).toBeCloseTo(20)
    expect(rewardAfterDays(decay, 5)).toBe(0)
  })

  it('announces the day the payout becomes nothing', () => {
    expect(daysUntilWorthless(decay)).toBe(5)
    expect(daysUntilWorthless(task())).toBeNull()
    const soft = task({
      reward: 10,
      due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'percent', percent: 50 } },
    })
    expect(daysUntilWorthless(soft)).toBeNull() // 50 % de moins, mais jamais nul
  })
})

describe('purging one-shot tasks', () => {
  it('clears them the next day, not the same day', () => {
    const t = task()
    const evts = [done(0)]
    expect(staleOneShots([t], replay(evts, [t], at(0)), at(0))).toEqual([])
    expect(staleOneShots([t], replay(evts, [t], at(1)), at(1))).toEqual(['t1'])
  })

  it('clears a counter without repetition once its target is reached', () => {
    const c = task({ counter: { target: 2, unit: '', tiers: [] } })
    const events = [count(0), count(0)]
    // The same day it stays visible, the next day it goes.
    expect(staleOneShots([c], replay(events, [c], at(0)), at(0))).toEqual([])
    expect(staleOneShots([c], replay(events, [c], at(1)), at(1))).toEqual(['t1'])
  })

  it('keeps a counter without repetition whose target is not reached', () => {
    const c = task({ counter: { target: 5, unit: '', tiers: [] } })
    const events = [count(0), count(0)]
    expect(staleOneShots([c], replay(events, [c], at(3)), at(3))).toEqual([])
  })

  it('spares repeating tasks and counters that come back', () => {
    const rep = task({ id: 'r', repeat: daily })
    const cnt = task({ id: 'c', counter: { target: 2, unit: '', tiers: [] } })
    const evts: Event[] = [
      { id: 'a', ts: at(0), kind: 'complete', taskId: 'r', baseReward: 10, penaltyFactor: 1, penaltyFlat: 0 },
      { id: 'b', ts: at(0), kind: 'complete', taskId: 'c', baseReward: 10, penaltyFactor: 1, penaltyFlat: 0 },
    ]
    expect(staleOneShots([rep, cnt], replay(evts, [rep, cnt], at(5)), at(5))).toEqual([])
  })

  it('keeps the payouts of a purged task', () => {
    const t = task()
    const r = replay([done(0)], [{ ...t, deletedAt: at(1) }], at(1))
    expect(r.balance).toBe(10)
  })
})

describe('taps coming from the widgets', () => {
  let n = 0
  const ids = () => `p${++n}`

  it('turns an increment into a counter event', () => {
    const t = task({ counter: { target: 8, unit: '', tiers: [] } })
    const got = pendingToEvents([{ kind: 'count', taskId: 't1', delta: 1, ts: at(0) }], [t], [], () => 'p0')
    // The counter is frozen onto the event at pour time: editing the task
    // afterwards must not replay that particular tap.
    expect(got).toEqual([
      {
        id: 'p0',
        ts: at(0),
        kind: 'count',
        taskId: 't1',
        delta: 1,
        baseReward: 10,
        counter: { target: 8, unit: '', tiers: [] },
        repeat: null,
      },
    ])
  })

  it('applies the penalty of the tap time, not of the pour time', () => {
    const t = task({
      reward: 50,
      due: { at: new Date(at(1)).toISOString(), penalty: { kind: 'decay', percentPerDay: 50 } },
    })
    // Completed on time from the home screen, app reopened 5 days later.
    const got = pendingToEvents([{ kind: 'complete', taskId: 't1', delta: 1, ts: at(0) }], [t], [], ids)
    expect(replay(got, [t], at(6)).balance).toBe(50)
  })

  it('chains several completions while keeping the streak consistent', () => {
    const t = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 100 }], multiplier: null } })
    const got = pendingToEvents(
      [
        { kind: 'complete', taskId: 't1', delta: 1, ts: at(1) },
        { kind: 'complete', taskId: 't1', delta: 1, ts: at(0) },
      ],
      [t],
      [],
      ids,
    )
    expect(got).toHaveLength(2)
    expect(replay(got, [t], at(1)).balance).toBe(120) // 10 + 10 + palier 100
  })

  it('ignores a task deleted in the meantime', () => {
    expect(pendingToEvents([{ kind: 'complete', taskId: 'zzz', delta: 1, ts: at(0) }], [], [], ids)).toEqual([])
  })
})

describe('backup', () => {
  const db = {
    tasks: [task({ name: 'Vaisselle' })],
    shopItems: [],
    events: [done(0)],
    settings: {
      currency: '€',
      budgetLabel: 'budget loisirs',
      accent: '#4ade80',
      dayStart: 0,
      defaultReward: 10,
      allowNegative: false,
      weekStart: 1 as const,
      showStats: true,
      serverUrl: '',
      serverToken: '',
    },
  }

  it('round-trips without losing anything', () => {
    const relu = parseBackup(serialize(db))
    expect(relu.tasks).toEqual(db.tasks)
    expect(relu.events).toEqual(db.events)
    expect(relu.settings.currency).toBe('€')
  })

  it('refuses a foreign file rather than overwrite the database', () => {
    expect(() => parseBackup('pas du json')).toThrow(/JSON/)
    expect(() => parseBackup('{"app":"autre"}')).toThrow(/Butineur/)
    expect(() => parseBackup('{"app":"butineur","format":99}')).toThrow(/inconnu/)
    expect(() => parseBackup('{"app":"butineur","format":1,"db":{}}')).toThrow(/incomplète/)
  })
})

describe('streak of a counter', () => {
  // Reaching the target is a counter's completion: without that, the "streak
  // bonus" setting was useless on those tasks.
  const boire = task({
    reward: 5,
    repeat: daily,
    counter: { target: 3, unit: 'verres', tiers: [] },
    streak: { tiers: [{ at: 3, bonus: 10 }], multiplier: null },
  })
  const jour = (d: number) => [count(d), count(d), count(d)]

  it('grows one step per target reached', () => {
    const { perTask } = replay([...jour(0), ...jour(1), ...jour(2)], [boire], at(2))
    expect(perTask.get('t1')!.streak).toBe(3)
  })

  it('does not grow twice for the same day', () => {
    const { perTask } = replay([...jour(0), count(0, -1), count(0)], [boire], at(0))
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('breaks when a day is skipped', () => {
    const { perTask } = replay([...jour(0), ...jour(1), ...jour(5)], [boire], at(5))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(1)
    expect(s.brokenStreak).toBe(2)
  })

  it('still pays the target only, not the streak bonuses', () => {
    // Three targets at 5: the streak tier stays reserved for completions.
    expect(replay([...jour(0), ...jour(1), ...jour(2)], [boire], at(2)).balance).toBe(15)
  })
})

describe('the past is not recomputed', () => {
  // A daily task completed three days in a row, then moved to "every 5 days".
  const quotidienne = task({ repeat: daily, streak: { tiers: [], multiplier: null } })
  const evts = [
    done(0, { repeat: { everyDays: 1 } }),
    done(1, { repeat: { everyDays: 1 } }),
    done(2, { repeat: { everyDays: 1 } }),
  ]

  it('keeps the streak the rhythm of the time produced', () => {
    const rallongee = { ...quotidienne, repeat: { everyDays: 5 } }
    expect(replay(evts, [rallongee], at(2)).perTask.get('t1')!.streak).toBe(3)
  })

  it('does not repair a broken streak by lengthening the rhythm', () => {
    // Three days four apart: the streak was broken under the daily rhythm.
    const espaces = [0, 4, 8].map((d) => done(d, { repeat: { everyDays: 1 } }))
    const rallongee = { ...quotidienne, repeat: { everyDays: 5 } }
    expect(replay(espaces, [rallongee], at(8)).perTask.get('t1')!.streak).toBe(1)
  })

  it('falls back on the current rhythm for an event predating the freeze', () => {
    const anciens = [done(0), done(1), done(2)] // sans `repeat` figé
    expect(replay(anciens, [quotidienne], at(2)).perTask.get('t1')!.streak).toBe(3)
  })

  describe('the streak bonuses', () => {
    const petit = { tiers: [], multiplier: { perStep: 0.1, cap: 2 } }
    const bonus = [done(0, { streak: petit }), done(1, { streak: petit }), done(2, { streak: petit })]

    it('does not re-price past completions when the multiplier goes up', () => {
      // 10 + 11 + 12 = 33, whatever today's setting is.
      const gros = task({ repeat: daily, streak: { tiers: [], multiplier: { perStep: 1, cap: 5 } } })
      expect(replay(bonus, [gros], at(2)).balance).toBeCloseTo(33)
    })

    it('does not retroactively pay a tier added afterwards', () => {
      const avecPalier = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 50 }], multiplier: null } })
      expect(replay(bonus, [avecPalier], at(2)).balance).toBeCloseTo(33)
    })

    it('applies the new setting to the next completion', () => {
      // What is wanted: the past does not move, what follows benefits.
      const gros = task({ repeat: daily, streak: { tiers: [], multiplier: { perStep: 1, cap: 5 } } })
      const suite = [...bonus, done(3, { streak: gros.streak })]
      expect(replay(suite, [gros], at(3)).balance).toBeCloseTo(33 + 40)
    })

    it('does not break the streak in passing', () => {
      const gros = task({ repeat: daily, streak: { tiers: [], multiplier: { perStep: 1, cap: 5 } } })
      expect(replay(bonus, [gros], at(2)).perTask.get('t1')!.streak).toBe(3)
    })

    it('falls back on the current bonuses for an event predating the freeze', () => {
      const anciens = [done(0), done(1), done(2)] // sans `streak` figé
      const gros = task({ repeat: daily, streak: { tiers: [], multiplier: { perStep: 1, cap: 5 } } })
      expect(replay(anciens, [gros], at(2)).balance).toBeCloseTo(10 + 20 + 30)
    })
  })

  describe('the counters', () => {
    const objectif = { target: 3, unit: '', tiers: [{ at: 2, bonus: 4 }] }
    const cnt = task({ repeat: daily, counter: objectif, streak: null })
    const gele = { baseReward: 10, counter: objectif, repeat: daily }
    // Target reached on day 0: 10 € for the target, 4 € for the tier.
    const taps = [count(0, 1), count(0, 1), count(0, 1)].map((e) => ({ ...e, ...gele }))

    it('does not re-price a target already reached when the reward changes', () => {
      expect(replay(taps, [{ ...cnt, reward: 100 }], at(1)).balance).toBeCloseTo(14)
    })

    it('does not take back a target already reached when it is raised', () => {
      const plusHaut = { ...cnt, counter: { ...objectif, target: 10 } }
      expect(replay(taps, [plusHaut], at(1)).balance).toBeCloseTo(14)
    })

    it('does not pay a tier again after its amount was changed', () => {
      const plusCher = { ...cnt, counter: { ...objectif, tiers: [{ at: 2, bonus: 40 }] } }
      expect(replay(taps, [plusCher], at(1)).balance).toBeCloseTo(14)
    })

    it('takes back exactly what was paid when counting back down', () => {
      // The decrement lands after the reward change: what goes back is the
      // amount actually credited, not today's task value.
      const retrait = { ...count(0, -1), baseReward: 100, counter: objectif, repeat: daily }
      expect(replay([...taps, retrait], [{ ...cnt, reward: 100 }], at(1)).balance).toBeCloseTo(4)
    })

    it('falls back on the current counter for an event predating the freeze', () => {
      const anciens = [count(0, 1), count(0, 1), count(0, 1)] // sans gel
      expect(replay(anciens, [{ ...cnt, reward: 100 }], at(1)).balance).toBeCloseTo(104)
    })
  })
})

describe('debug workshop', () => {
  const t = task({ repeat: daily, streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: null } })

  it('manufactures a real streak, computed by the engine', () => {
    const { perTask } = replay(fakeStreak(t, 5, at(0)), [t], at(0))
    expect(perTask.get('t1')!.streak).toBe(5)
  })

  it('leaves the balance intact once the events are taken back', () => {
    const faux = fakeStreak(t, 5, at(0))
    expect(replay(faux, [t], at(0)).balance).toBeGreaterThan(0)
    const propre = [...faux, ...undoDebugEvents(faux, at(0))]
    expect(replay(propre, [t], at(0)).balance).toBe(0)
    expect(replay(propre, [t], at(0)).entries).toEqual([])
  })

  it('also takes back what was completed while the clock was shifted', () => {
    // A completion dated tomorrow can only come from a shifted clock.
    const demain = done(1)
    const propre = [demain, ...undoDebugEvents([demain], at(0))]
    expect(replay(propre, [t], at(0)).balance).toBe(0)
    expect(replay(propre, [t], at(0)).entries).toEqual([])
  })

  it('does not undo twice what is already undone', () => {
    const faux = fakeStreak(t, 3, at(0))
    const premier = undoDebugEvents(faux, at(0))
    expect(undoDebugEvents([...faux, ...premier], at(0))).toEqual([])
  })
})

describe('subtasks', () => {
  const parent = task({ id: 'p', repeat: { everyDays: 7, weekday: 0 }, reward: 20 })
  const sub = (id: string): Task => ({ ...task({ reward: 5 }), id, parentId: 'p' })
  const all = [parent, sub('a'), sub('b')]

  const doneSub = (id: string, days: number): Event => ({
    id: `s${++seq}`,
    ts: at(days),
    kind: 'complete',
    taskId: id,
    baseReward: 5,
    penaltyFactor: 1,
    penaltyFlat: 0,
    repeat: parent.repeat,
  })

  it('borrows the parent rhythm, since it has none of its own', () => {
    const resolved = withParents(all)
    expect(resolved.find((t) => t.id === 'a')!.repeat).toEqual(parent.repeat)
    expect(resolved.find((t) => t.id === 'p')!.repeat).toEqual(parent.repeat)
  })

  it('is only completable again on the parent cycle', () => {
    const resolved = withParents(all)
    const a = resolved.find((t) => t.id === 'a')!
    const rep = replay([doneSub('a', 0)], resolved, at(0))
    // Monday, done: nothing to do again before the cycle that opens on the 12th.
    expect(isAvailable(a, rep.perTask.get('a'), at(3))).toBe(false)
    expect(isAvailable(a, rep.perTask.get('a'), at(7))).toBe(true)
  })

  it('counts the progress of the bouquet on the cycle in progress', () => {
    const resolved = withParents(all)
    expect(childrenOf('p', resolved)).toHaveLength(2)
    const none = replay([], resolved, at(0))
    expect(subtaskProgress('p', resolved, none, at(0))).toEqual({ done: 0, total: 2 })
    const one = replay([doneSub('a', 0)], resolved, at(0))
    expect(subtaskProgress('p', resolved, one, at(0))).toEqual({ done: 1, total: 2 })
  })

  it('pays each subtask on its own, plus the parent bonus', () => {
    const resolved = withParents(all)
    const parentDone: Event = {
      id: 'pp', ts: at(0), kind: 'complete', taskId: 'p',
      baseReward: 20, penaltyFactor: 1, penaltyFlat: 0, repeat: parent.repeat,
    }
    const { balance } = replay([doneSub('a', 0), doneSub('b', 0), parentDone], resolved, at(0))
    expect(balance).toBe(30)
  })

  it('leaves a subtask alone when the parent has no rhythm', () => {
    const orphan = withParents([task({ id: 'p', repeat: null }), sub('a')])
    expect(orphan.find((t) => t.id === 'a')!.repeat).toBeNull()
  })
})

describe('availability', () => {
  it('blocks a repeating task before the end of its cycle', () => {
    const t = task({ repeat: { everyDays: 3 } })
    const { perTask } = replay([done(0)], [t], at(0))
    const s = perTask.get('t1')
    expect(isAvailable(t, s, at(1))).toBe(false)
    expect(isAvailable(t, s, at(3))).toBe(true)
  })

  it('uses up a one-shot task', () => {
    const t = task()
    const { perTask } = replay([done(0)], [t], at(0))
    expect(isAvailable(t, perTask.get('t1'), at(9))).toBe(false)
  })
})
