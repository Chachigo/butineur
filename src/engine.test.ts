import { describe, expect, it } from 'vitest'
import {
  DAY,
  computePenalty,
  isAvailable,
  dayNum,
  daysUntilWorthless,
  dueTsFor,
  pendingToEvents,
  replay,
  rewardAfterDays,
  rewardAtStreak,
  staleOneShots,
  streakAtCap,
} from './engine'
import { parseBackup, serialize } from './backup'
import { fakeStreak, undoDebugEvents } from './debug'
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
// Chaque tap décalé de quelques millisecondes : à horodatage égal le moteur
// départage par identifiant, et « c10 » passerait avant « c9 ».
const count = (days: number, delta = 1, id?: string): Event => {
  const n = ++seq
  return { id: id ?? `c${n}`, ts: at(days) + n, kind: 'count', taskId: 't1', delta }
}

const daily = { everyDays: 1 }

describe('pénalité de retard', () => {
  const t = task({ reward: 50, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'decay', percentPerDay: 20 } } })

  it('décroît par jour de retard et ne passe jamais sous zéro', () => {
    expect(computePenalty(t, at(0), undefined).factor).toBe(1)
    expect(computePenalty(t, at(1), undefined).factor).toBeCloseTo(0.8)
    expect(computePenalty(t, at(3), undefined).factor).toBeCloseTo(0.4)
    expect(computePenalty(t, at(5), undefined).factor).toBe(0)
    expect(computePenalty(t, at(50), undefined).factor).toBe(0)
  })

  it('ne rend jamais une tâche en retard coûteuse', () => {
    const flat = task({ reward: 10, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'flat', amount: 999 } } })
    const p = computePenalty(flat, at(1), undefined)
    const { balance } = replay([done(1, { baseReward: 10, penaltyFactor: p.factor, penaltyFlat: p.flat })], [flat])
    expect(balance).toBe(0)
  })

  it("glisse d'un cycle sur une tâche répétitive au lieu d'être en retard à vie", () => {
    const rep = task({ repeat: { everyDays: 7 }, due: { at: new Date(at(0)).toISOString(), penalty: { kind: 'percent', percent: 50 } } })
    // Dernier passage au jour 10 : la prochaine échéance est le jour 17, pas le jour 0.
    const s = replay([done(10)], [rep], at(10)).perTask.get('t1')
    expect(computePenalty(rep, at(16), s).factor).toBe(1)
    expect(computePenalty(rep, at(18), s).factor).toBeCloseTo(0.5)
  })
})

describe('cycles', () => {
  // T0 = lundi 5 janvier 2026, midi. Échéance à 20 h.
  const vingtHeures = new Date(at(0))
  vingtHeures.setHours(20, 0, 0, 0)
  const due = { at: vingtHeures.toISOString(), penalty: { kind: 'none' as const } }
  const state = (t: Task, evts: Event[]) =>
    replay(evts, [t], evts[evts.length - 1].ts).perTask.get('t1')

  describe('hebdomadaire', () => {
    const t = task({ repeat: { everyDays: 7, weekday: 0 }, due }) // dimanche

    it('vise le prochain dimanche, pas une date figée', () => {
      const d = dueTsFor(t, undefined, at(0))!
      expect(new Date(d).getDay()).toBe(0)
      expect(new Date(d).getHours()).toBe(20)
      expect(dayNum(d) - dayNum(at(0))).toBe(6) // lundi → dimanche
    })

    it('ne rapproche pas l’échéance quand on s’y prend en avance', () => {
      // Fait samedi, la veille de l'échéance : la suivante est le dimanche
      // d'après, pas celui de demain.
      const s = state(t, [done(5)])
      expect(dayNum(dueTsFor(t, s, at(5))!) - dayNum(at(5))).toBe(8)
    })

    it('ne saute pas un cycle quand on rattrape un retard', () => {
      // Faite le dimanche 11, puis le dimanche 18 manqué et rattrapé le
      // mercredi 21 : la prochaine échéance reste le dimanche qui vient.
      const s = state(t, [done(6), done(16)])
      expect(dayNum(dueTsFor(t, s, at(16))!) - dayNum(at(16))).toBe(4)
    })

    it('rouvre le lendemain de l’échéance, pas sept jours après le passage', () => {
      const s = state(t, [done(2)]) // fait mercredi, pour le dimanche 11
      expect(isAvailable(t, s, at(5))).toBe(false) // samedi : rien à refaire
      expect(isAvailable(t, s, at(7))).toBe(true) // lundi : nouveau cycle
    })
  })

  describe('quotidienne', () => {
    const t = task({ repeat: { everyDays: 1 }, due })

    it('garde l’heure réglée au lieu de la décaler à chaque passage', () => {
      const tard = at(0) + 9 * 3_600_000 // validée à 21 h, une heure trop tard
      const s = replay([done(0, { ts: tard })], [t], tard).perTask.get('t1')
      const d = new Date(dueTsFor(t, s, tard)!)
      expect(d.getHours()).toBe(20)
      expect(dayNum(+d) - dayNum(tard)).toBe(1)
    })
  })

  describe('mensuelle', () => {
    const t = task({ repeat: { everyDays: 31, monthday: 31 }, due })

    it('retombe sur le dernier jour des mois trop courts', () => {
      const janvier = state(t, [done(26)]) // 31 janvier
      const suivante = dueTsFor(t, janvier, at(26))!
      expect(new Date(suivante).getMonth()).toBe(1) // février
      expect(new Date(suivante).getDate()).toBe(28)
    })
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

  it('retient la série perdue pour pouvoir l’annoncer', () => {
    const { perTask } = replay([done(0), done(1), done(2)], [t], at(9))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(0) // rompue par le simple passage du temps
    expect(s.brokenStreak).toBe(3)
    expect(s.bestStreak).toBe(3)
  })

  it('garde le record après une rupture puis une reprise', () => {
    const { perTask } = replay([done(0), done(1), done(2), done(9), done(10)], [t], at(10))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2)
    expect(s.brokenStreak).toBe(3)
    expect(s.bestStreak).toBe(3)
  })

  it('gèle la série sur un cycle manqué au lieu de la casser', () => {
    const { perTask } = replay([done(0), done(1), done(3)], [t], at(3))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2) // le rattrapage tient la série, sans la faire monter
    expect(s.frozen).toBe(false) // rattrapée, donc dégelée
  })

  it('annonce le gel dès que le cycle passe, sans attendre une validation', () => {
    const { perTask } = replay([done(0), done(1)], [t], at(3))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(2)
    expect(s.frozen).toBe(true)
  })

  it('casse au deuxième cycle manqué', () => {
    const { perTask } = replay([done(0), done(1)], [t], at(5))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(0)
    expect(s.brokenStreak).toBe(2)
  })

  it('ne monte plus une série quotidienne faite un jour sur deux', () => {
    const { perTask } = replay([done(0), done(2), done(4), done(6), done(8)], [t], at(8))
    expect(perTask.get('t1')!.streak).toBe(1)
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

  it('reprend la récompense quand on redescend sous l’objectif', () => {
    const events = [...Array(8)].map(() => count(0))
    expect(replay(events, [t], at(0)).balance).toBe(13)
    // 8/8 → 7/8 : l'objectif n'est plus atteint, ses 10 repartent.
    const { balance, perTask } = replay([...events, count(0, -1)], [t], at(0))
    expect(perTask.get('t1')!.count).toBe(7)
    expect(balance).toBe(3) // il reste le bonus intermédiaire de 4
  })

  it('rembourse aussi les paliers intermédiaires quittés', () => {
    const events = [...Array(8)].map(() => count(0))
    const retours = [...Array(5)].map(() => count(0, -1))
    // Redescendu à 3 : ni l'objectif ni le palier de 4 ne tiennent.
    expect(replay([...events, ...retours], [t], at(0)).balance).toBe(0)
  })

  it('ne se laisse pas farmer par des allers-retours', () => {
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
    const quotidien = { ...t, repeat: daily }
    const jour1 = [...Array(8)].map(() => count(0))
    const jour2 = [...Array(8)].map(() => count(1))
    expect(replay([...jour1, ...jour2], [quotidien], at(1)).balance).toBe(26)
  })

  it('repart à zéro à la période suivante', () => {
    const quotidien = { ...t, repeat: daily }
    const { perTask, balance } = replay([count(0), count(0), count(1)], [quotidien], at(1))
    expect(perTask.get('t1')!.count).toBe(1)
    expect(balance).toBe(0)
  })

  it('remet le compteur à zéro même sans événement aujourd’hui', () => {
    const quotidien = { ...t, repeat: daily }
    const { perTask } = replay([count(0), count(0)], [quotidien], at(3))
    expect(perTask.get('t1')!.count).toBe(0)
  })

  // La remise à zéro suit le cycle de la tâche, pas le calendrier : c'est ce
  // qui distingue « 8 verres par jour » de « 30 km ce mois-ci ».
  it('garde son avancement d’un jour à l’autre sans répétition', () => {
    const { perTask } = replay([count(0), count(0)], [t], at(5))
    expect(perTask.get('t1')!.count).toBe(2)
  })

  it('ne repaie jamais l’objectif sans répétition', () => {
    const huit = [...Array(8)].map(() => count(0))
    const encore = [...Array(8)].map(() => count(1))
    expect(replay([...huit, ...encore], [t], at(1)).balance).toBe(13)
  })

  it('ne repart qu’au changement de cycle sur une hebdomadaire', () => {
    // T0 = lundi 5 janvier, échéance le dimanche : le cycle court jusqu'au 11.
    // Mercredi 7 et jeudi 8 sont dans le même cycle, mais dans deux tranches
    // de sept jours différentes — c'est le cycle qui doit gagner.
    const hebdo = { ...t, repeat: { everyDays: 7, weekday: 0 } }
    const dans = replay([count(2), count(3)], [hebdo], at(3))
    expect(dans.perTask.get('t1')!.count).toBe(2)
    const apres = replay([count(2), count(3)], [hebdo], at(8)) // mardi suivant
    expect(apres.perTask.get('t1')!.count).toBe(0)
  })
})

describe('annulation', () => {
  const t = task({ repeat: daily, streak: { tiers: [{ at: 2, bonus: 50 }], multiplier: null } })

  it('retire du solde la validation annulée', () => {
    const e = done(0)
    expect(replay([e], [t], at(0)).balance).toBe(10)
    const annule: Event = { id: 'u1', ts: at(0), kind: 'undo', targetId: e.id }
    expect(replay([e, annule], [t], at(0)).balance).toBe(0)
  })

  it('recalcule la série et reprend le palier', () => {
    const a = done(0)
    const b = done(1)
    // Deux jours d'affilée : le palier de 2 tombe.
    expect(replay([a, b], [t], at(1)).balance).toBe(70)

    const annule: Event = { id: 'u2', ts: at(1), kind: 'undo', targetId: b.id }
    const { balance, perTask } = replay([a, b, annule], [t], at(1))
    expect(balance).toBe(10)
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('ne laisse aucune trace dans l’historique', () => {
    const e = done(0)
    const annule: Event = { id: 'u5', ts: at(0), kind: 'undo', targetId: e.id }
    const { entries } = replay([e, annule], [t], at(0))
    // Ni la validation, ni une ligne « annulé » : la correction efface, elle n'écrit pas.
    expect(entries).toEqual([])
  })

  it('efface la ligne du compteur redescendu sous son objectif', () => {
    const c = task({ reward: 10, counter: { target: 2, unit: '', tiers: [] } })
    const monte = [count(0), count(0)]
    expect(replay(monte, [c], at(0)).entries).toHaveLength(1)
    expect(replay([...monte, count(0, -1)], [c], at(0)).entries).toEqual([])
  })

  it('reste sans effet si on annule deux fois', () => {
    const e = done(0)
    const u1: Event = { id: 'u3', ts: at(0), kind: 'undo', targetId: e.id }
    const u2: Event = { id: 'u4', ts: at(0), kind: 'undo', targetId: e.id }
    expect(replay([e, u1, u2], [t], at(0)).balance).toBe(0)
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

  it('efface un compteur sans répétition une fois son objectif atteint', () => {
    const c = task({ counter: { target: 2, unit: '', tiers: [] } })
    const events = [count(0), count(0)]
    // Le jour même il reste visible, le lendemain il s'en va.
    expect(staleOneShots([c], replay(events, [c], at(0)), at(0))).toEqual([])
    expect(staleOneShots([c], replay(events, [c], at(1)), at(1))).toEqual(['t1'])
  })

  it('garde un compteur sans répétition dont l’objectif n’est pas atteint', () => {
    const c = task({ counter: { target: 5, unit: '', tiers: [] } })
    const events = [count(0), count(0)]
    expect(staleOneShots([c], replay(events, [c], at(3)), at(3))).toEqual([])
  })

  it('épargne les répétitives et les compteurs qui reviennent', () => {
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

describe('sauvegarde', () => {
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
      serverUrl: '',
      serverToken: '',
    },
  }

  it('fait l’aller-retour sans rien perdre', () => {
    const relu = parseBackup(serialize(db))
    expect(relu.tasks).toEqual(db.tasks)
    expect(relu.events).toEqual(db.events)
    expect(relu.settings.currency).toBe('€')
  })

  it('refuse un fichier étranger plutôt que d’écraser la base', () => {
    expect(() => parseBackup('pas du json')).toThrow(/JSON/)
    expect(() => parseBackup('{"app":"autre"}')).toThrow(/Butineur/)
    expect(() => parseBackup('{"app":"butineur","format":99}')).toThrow(/inconnu/)
    expect(() => parseBackup('{"app":"butineur","format":1,"db":{}}')).toThrow(/incomplète/)
  })
})

describe('série d’un compteur', () => {
  // Atteindre l'objectif est la validation d'un compteur : sans ça, « Bonus de
  // série » ne servait à rien sur ces tâches.
  const boire = task({
    reward: 5,
    repeat: daily,
    counter: { target: 3, unit: 'verres', tiers: [] },
    streak: { tiers: [{ at: 3, bonus: 10 }], multiplier: null },
  })
  const jour = (d: number) => [count(d), count(d), count(d)]

  it('monte d’un cran par objectif atteint', () => {
    const { perTask } = replay([...jour(0), ...jour(1), ...jour(2)], [boire], at(2))
    expect(perTask.get('t1')!.streak).toBe(3)
  })

  it('ne monte pas deux fois pour le même jour', () => {
    const { perTask } = replay([...jour(0), count(0, -1), count(0)], [boire], at(0))
    expect(perTask.get('t1')!.streak).toBe(1)
  })

  it('se rompt quand un jour est sauté', () => {
    const { perTask } = replay([...jour(0), ...jour(1), ...jour(5)], [boire], at(5))
    const s = perTask.get('t1')!
    expect(s.streak).toBe(1)
    expect(s.brokenStreak).toBe(2)
  })

  it('ne paie toujours que l’objectif, pas les bonus de série', () => {
    // Trois objectifs à 5 : le palier de série reste réservé aux validations.
    expect(replay([...jour(0), ...jour(1), ...jour(2)], [boire], at(2)).balance).toBe(15)
  })
})

describe('atelier de debug', () => {
  const t = task({ repeat: daily, streak: { tiers: [{ at: 3, bonus: 5 }], multiplier: null } })

  it('fabrique une vraie série, calculée par le moteur', () => {
    const { perTask } = replay(fakeStreak(t, 5, at(0)), [t], at(0))
    expect(perTask.get('t1')!.streak).toBe(5)
  })

  it('rend le solde intact une fois les événements retirés', () => {
    const faux = fakeStreak(t, 5, at(0))
    expect(replay(faux, [t], at(0)).balance).toBeGreaterThan(0)
    const propre = [...faux, ...undoDebugEvents(faux, at(0))]
    expect(replay(propre, [t], at(0)).balance).toBe(0)
    expect(replay(propre, [t], at(0)).entries).toEqual([])
  })

  it('reprend aussi ce qui a été validé pendant le décalage', () => {
    // Une validation datée de demain ne peut venir que d'une horloge décalée.
    const demain = done(1)
    const propre = [demain, ...undoDebugEvents([demain], at(0))]
    expect(replay(propre, [t], at(0)).balance).toBe(0)
    expect(replay(propre, [t], at(0)).entries).toEqual([])
  })

  it('n’annule pas deux fois ce qui l’est déjà', () => {
    const faux = fakeStreak(t, 3, at(0))
    const premier = undoDebugEvents(faux, at(0))
    expect(undoDebugEvents([...faux, ...premier], at(0))).toEqual([])
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
