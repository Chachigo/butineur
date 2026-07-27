import { describe, expect, it } from 'vitest'
import {
  DAY,
  computePenalty,
  isAvailable,
  daysUntilWorthless,
  pendingToEvents,
  replay,
  rewardAfterDays,
  rewardAtStreak,
  staleOneShots,
  streakAtCap,
} from './engine'
import type { Event, Task } from './types'

// Lundi 5 janvier 2026, midi — loin de tout changement d'heure.
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
const count = (days: number, delta = 1, id = `c${++seq}`): Event => ({
  id,
  ts: at(days),
  kind: 'count',
  taskId: 't1',
  delta,
})

const daily = { everyDays: 1 }

describe('pénalité de retard', () => {
  const t = task({ reward: 50, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'decay', percentPerDay: 20 } } })

  it('décroît par jour de retard et ne passe jamais sous zéro', () => {
    expect(computePenalty(t, at(0), null).factor).toBe(1)
    expect(computePenalty(t, at(1), null).factor).toBeCloseTo(0.8)
    expect(computePenalty(t, at(3), null).factor).toBeCloseTo(0.4)
    expect(computePenalty(t, at(5), null).factor).toBe(0)
    expect(computePenalty(t, at(50), null).factor).toBe(0)
  })

  it('ne rend jamais une tâche en retard coûteuse', () => {
    const flat = task({ reward: 10, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'flat', amount: 999 } } })
    const p = computePenalty(flat, at(1), null)
    const { balance } = replay([done(1, { baseReward: 10, penaltyFactor: p.factor, penaltyFlat: p.flat })], [flat])
    expect(balance).toBe(0)
  })

  it("glisse d'un cycle sur une tâche répétitive au lieu d'être en retard à vie", () => {
    const rep = task({ repeat: { everyDays: 7 }, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'percent', percent: 50 } } })
    // Dernier passage au jour 10 : la prochaine échéance est le jour 17, pas le jour 0.
    expect(computePenalty(rep, at(16), at(10)).factor).toBe(1)
    expect(computePenalty(rep, at(18), at(10)).factor).toBeCloseTo(0.5)
  })
})

describe('série', () => {
  const t = task({
    repeat: daily,
    streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 1.3 } },
  })

  it('cumule palier et multiplicateur, et respecte le plafond', () => {
    const { balance, perTask } = replay([done(0), done(1), done(2), done(3), done(4)], [t], at(4))
    //  10 + 11 + (12 + 5) + 13 + 13(plafonné)
    expect(balance).toBeCloseTo(64)
    expect(perTask.get('t1')!.streak).toBe(5)
  })

  it('ne monte pas deux fois le même jour', () => {
    const { perTask } = replay([done(0), done(0.1), done(0.2)], [t], at(0))
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('se rompt hors fenêtre et rejoue ses paliers ensuite', () => {
    const big = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 100 }], multiplier: null } })
    const { balance, perTask } = replay([done(0), done(1), done(5), done(6)], [big], at(6))
    expect(perTask.get('t1')!.streak).toBe(2)
    expect(balance).toBe(40 + 200) // 4 validations à 10, le palier 2 franchi deux fois
  })

  it('tolère un jour de retard sans casser la série', () => {
    const { perTask } = replay([done(0), done(2)], [t], at(2))
    expect(perTask.get('t1')!.streak).toBe(2)
  })
})

describe('compteur', () => {
  // Récompense 10 pour l'objectif, plus un bonus intermédiaire à 4.
  const t = task({ reward: 10, counter: { target: 8, unit: 'verres', tiers: [{ at: 4, bonus: 3 }] } })

  it('verse la récompense à l’objectif, sans palier à y poser', () => {
    const nu = task({ reward: 10, counter: { target: 2, unit: '', tiers: [] } })
    expect(replay([count(0)], [nu], at(0)).balance).toBe(0)
    expect(replay([count(0), count(0)], [nu], at(0)).balance).toBe(10)
  })

  it('cumule les bonus intermédiaires avec la récompense', () => {
    const events = [...Array(8)].map(() => count(0))
    expect(replay(events, [t], at(0)).balance).toBe(13) // 3 à mi-parcours + 10 à l'objectif
  })

  it('ne paie l’objectif qu’une fois malgré deux incréments concurrents', () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map(() => count(0))
    // Deux appareils hors-ligne franchissent l'objectif chacun de leur côté.
    const events = [...seven, count(0, 1, 'phone'), count(0, 1, 'pc')]
    const { balance, perTask } = replay(events, [t], at(0))
    expect(perTask.get('t1')!.count).toBe(8) // plafonné à l'objectif
    expect(balance).toBe(13)
  })

  it('ne se laisse pas farmer en décrémentant puis réincrémentant', () => {
    const events = [...Array(8)].map(() => count(0))
    events.push(count(0, -1), count(0, 1), count(0, -1), count(0, 1))
    expect(replay(events, [t], at(0)).balance).toBe(13)
  })

  it('ne dépasse jamais l’objectif', () => {
    const events = [...Array(12)].map(() => count(0))
    const { perTask, balance } = replay(events, [t], at(0))
    expect(perTask.get('t1')!.count).toBe(8)
    expect(balance).toBe(13)
  })

  it('replafonne correctement après un retrait', () => {
    const events = [...Array(10)].map(() => count(0))
    events.push(count(0, -1), count(0, -1))
    expect(replay(events, [t], at(0)).perTask.get('t1')!.count).toBe(6)
  })

  it('repaie l’objectif à chaque nouvelle période', () => {
    const jour1 = [...Array(8)].map(() => count(0))
    const jour2 = [...Array(8)].map(() => count(1))
    expect(replay([...jour1, ...jour2], [t], at(1)).balance).toBe(26)
  })

  it('repart à zéro à la période suivante', () => {
    const { perTask, balance } = replay([count(0), count(0), count(1)], [t], at(1))
    expect(perTask.get('t1')!.count).toBe(1)
    expect(balance).toBe(0)
  })

  it('remet le compteur à zéro même sans événement aujourd’hui', () => {
    const { perTask } = replay([count(0), count(0)], [t], at(3))
    expect(perTask.get('t1')!.count).toBe(0)
  })
})

describe('solde', () => {
  it('autorise le négatif — bloquer rendrait les corrections impossibles', () => {
    const spend: Event = { id: 's1', ts: at(0), kind: 'spend', amount: 50, label: 'Ciné' }
    expect(replay([spend], []).balance).toBe(-50)
  })

  it('ne dépend pas de l’ordre d’arrivée des événements', () => {
    const t = task({ repeat: daily, streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 2 } } })
    const events = [done(0), done(1), done(2), done(3)]
    const shuffled = [events[2], events[0], events[3], events[1]]
    expect(replay(shuffled, [t]).balance).toBeCloseTo(replay(events, [t]).balance)
  })

  it('garde les gains d’une tâche supprimée', () => {
    expect(replay([done(0)], []).balance).toBe(10)
  })
})

describe('simulation du multiplicateur', () => {
  const t = task({
    reward: 10,
    streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: { perStep: 0.1, cap: 1.5 } },
  })

  it('donne les mêmes montants que le rejeu réel', () => {
    expect(rewardAtStreak(t, 1)).toBeCloseTo(10)
    expect(rewardAtStreak(t, 2)).toBeCloseTo(11)
    expect(rewardAtStreak(t, 3)).toBeCloseTo(17) // 12 + palier 5
    expect(rewardAtStreak(t, 9)).toBeCloseTo(15) // plafonné à ×1,5
  })

  it('annonce le rang où le plafond est atteint', () => {
    expect(streakAtCap(t)).toBe(6)
    expect(streakAtCap(task())).toBeNull()
  })
})

describe('simulation de pénalité', () => {
  const decay = task({
    reward: 50,
    due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'decay', percentPerDay: 20 } },
  })

  it('décroît puis tombe à zéro', () => {
    expect(rewardAfterDays(decay, 0)).toBe(50)
    expect(rewardAfterDays(decay, 1)).toBeCloseTo(40)
    expect(rewardAfterDays(decay, 3)).toBeCloseTo(20)
    expect(rewardAfterDays(decay, 5)).toBe(0)
  })

  it('annonce le jour où le gain devient nul', () => {
    expect(daysUntilWorthless(decay)).toBe(5)
    expect(daysUntilWorthless(task())).toBeNull()
    const soft = task({
      reward: 10,
      due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'percent', percent: 50 } },
    })
    expect(daysUntilWorthless(soft)).toBeNull() // 50 % de moins, mais jamais nul
  })
})

describe('purge des tâches à usage unique', () => {
  it('efface le lendemain, pas le jour même', () => {
    const t = task()
    const evts = [done(0)]
    expect(staleOneShots([t], replay(evts, [t], at(0)), at(0))).toEqual([])
    expect(staleOneShots([t], replay(evts, [t], at(1)), at(1))).toEqual(['t1'])
  })

  it('épargne les répétitives et les compteurs', () => {
    const rep = task({ id: 'r', repeat: daily })
    const cnt = task({ id: 'c', counter: { target: 2, unit: '', tiers: [] } })
    const evts: Event[] = [
      { id: 'a', ts: at(0), kind: 'complete', taskId: 'r', baseReward: 10, penaltyFactor: 1, penaltyFlat: 0 },
      { id: 'b', ts: at(0), kind: 'complete', taskId: 'c', baseReward: 10, penaltyFactor: 1, penaltyFlat: 0 },
    ]
    expect(staleOneShots([rep, cnt], replay(evts, [rep, cnt], at(5)), at(5))).toEqual([])
  })

  it('garde les gains d’une tâche purgée', () => {
    const t = task()
    const r = replay([done(0)], [{ ...t, deletedAt: at(1) }], at(1))
    expect(r.balance).toBe(10)
  })
})

describe('taps venus des widgets', () => {
  let n = 0
  const ids = () => `p${++n}`

  it('convertit un incrément en événement de compteur', () => {
    const t = task({ counter: { target: 8, unit: '', tiers: [] } })
    const got = pendingToEvents([{ kind: 'count', taskId: 't1', delta: 1, ts: at(0) }], [t], [], () => 'p0')
    expect(got).toEqual([{ id: 'p0', ts: at(0), kind: 'count', taskId: 't1', delta: 1 }])
  })

  it('applique la pénalité de l’heure du tap, pas de celle du versement', () => {
    const t = task({
      reward: 50,
      due: { at: new Date(at(1)).toISOString(), penalty: { kind: 'decay', percentPerDay: 50 } },
    })
    // Validé dans les temps depuis l'écran d'accueil, appli rouverte 5 jours après.
    const got = pendingToEvents([{ kind: 'complete', taskId: 't1', delta: 1, ts: at(0) }], [t], [], ids)
    expect(replay(got, [t], at(6)).balance).toBe(50)
  })

  it('enchaîne plusieurs validations en gardant la série cohérente', () => {
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

  it('ignore une tâche supprimée entre-temps', () => {
    expect(pendingToEvents([{ kind: 'complete', taskId: 'zzz', delta: 1, ts: at(0) }], [], [], ids)).toEqual([])
  })
})

describe('disponibilité', () => {
  it('bloque une tâche répétitive avant la fin de son cycle', () => {
    const t = task({ repeat: { everyDays: 3 } })
    const { perTask } = replay([done(0)], [t], at(0))
    const s = perTask.get('t1')
    expect(isAvailable(t, s, at(1))).toBe(false)
    expect(isAvailable(t, s, at(3))).toBe(true)
  })

  it('épuise une tâche ponctuelle', () => {
    const t = task()
    const { perTask } = replay([done(0)], [t], at(0))
    expect(isAvailable(t, perTask.get('t1'), at(9))).toBe(false)
  })
})
