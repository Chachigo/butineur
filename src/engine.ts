import type { Event, LedgerEntry, Pending, Task, TaskState } from './types'

export const DAY = 86_400_000

/**
 * Numéro de jour local, insensible aux changements d'heure d'été.
 *
 * `dayStart` est un décalage **en minutes** : à 270 (4 h 30), tout ce qui arrive
 * avant 4 h 30 compte encore pour la veille. Un compteur monté tard le soir se
 * termine donc bien sur la journée à laquelle on pense.
 */
export function dayNum(ts: number, dayStart = 0): number {
  const d = new Date(ts - dayStart * 60_000)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

/** Tranche de `everyDays` jours alignée sur le calendrier. */
export function periodKey(ts: number, everyDays: number, dayStart = 0): number {
  return Math.floor(dayNum(ts, dayStart) / Math.max(1, everyDays))
}

/**
 * Période d'un compteur : la fenêtre au bout de laquelle il repart à zéro.
 *
 * Sans rythme, il n'y en a pas — un compteur ponctuel garde son avancement
 * jusqu'à ce qu'il aboutisse, il n'a aucune raison de se vider au coup de
 * minuit. Sinon c'est le cycle de la tâche, donc une remise à zéro à
 * l'échéance et pas sur une grille indépendante d'elle.
 */
export function counterPeriod(task: Task | undefined, ts: number, dayStart = 0): number {
  if (!task?.repeat) return 0
  // Un cycle glissant n'a pas de grille tant que rien n'est validé, et un
  // compteur ne produit pas de validation : on garde les tranches de N jours.
  return rythme(task.repeat) === 'glissant'
    ? periodKey(ts, task.repeat.everyDays, dayStart)
    : firstCycleEnd(task, ts, dayStart)
}

const everyDaysOf = (task: Task | undefined) => Math.max(1, task?.repeat?.everyDays ?? 1)

/**
 * Rythme d'une tâche répétitive, déduit de ses champs plutôt que stocké : un
 * seul réglage à l'écran, donc aucune combinaison contradictoire possible.
 */
export type Rythme = 'jour' | 'semaine' | 'mois' | 'glissant'

export function rythme(repeat: NonNullable<Task['repeat']>): Rythme {
  if (repeat.monthday != null) return 'mois'
  if (repeat.weekday != null) return 'semaine'
  // « Tous les 1 jours après chaque passage » n'existe pas : c'est le quotidien.
  return repeat.everyDays > 1 ? 'glissant' : 'jour'
}

/** Heure de l'échéance. Sans date limite, le cycle se ferme en fin de journée. */
function dueHm(task: Task): [number, number] {
  const d = task.due ? new Date(task.due.at) : null
  return d && !Number.isNaN(+d) ? [d.getHours(), d.getMinutes()] : [23, 59]
}

const atHm = (d: Date, [h, m]: [number, number]) => {
  const x = new Date(d)
  x.setHours(h, m, 0, 0)
  return +x
}

/** Le `md` du mois demandé, ramené au dernier jour quand le mois est trop court. */
function monthdayTs(y: number, month: number, md: number, hm: [number, number]): number {
  const last = new Date(y, month + 1, 0).getDate()
  return atHm(new Date(y, month, Math.min(md, last)), hm)
}

/** Minuit du jour auquel `ts` appartient, `dayStart` compris. */
function startOfDay(ts: number, dayStart: number): number {
  const d = new Date(ts - dayStart * 60_000)
  d.setHours(0, 0, 0, 0)
  return +d + dayStart * 60_000
}

/** Prochaine échéance du calendrier strictement après `after`. */
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

/** Échéance précédant `due` sur la même grille. */
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
 * Échéance d'une tâche jamais validée : la prochaine du calendrier, celle
 * d'aujourd'hui comprise. Elle avance donc d'un cycle au lieu de rester au
 * passé — une tâche neuve n'est pas en retard depuis sa date de création.
 */
function firstCycleEnd(task: Task, now: number, dayStart: number): number {
  if (rythme(task.repeat!) === 'glissant') return atHm(new Date(now), dueHm(task))
  return nextBoundary(task, startOfDay(now, dayStart) - 1)
}

/** Ouverture du cycle qui se ferme à `end` : le lendemain de l'échéance précédente. */
function cycleOpen(task: Task, end: number, dayStart: number): number {
  const d = new Date(prevBoundary(task, end))
  d.setDate(d.getDate() + 1)
  return startOfDay(+d, dayStart)
}

/**
 * Échéance suivante une fois `ts` validé.
 *
 * En calendaire, la validation remplit le cycle **ouvert au moment du tap** :
 * faire en avance ne rapproche pas l'échéance suivante, et rattraper un retard
 * ne laisse pas la tâche à refaire dans la foulée — elle repartait sinon pour
 * le cycle courant, qu'on venait pourtant de faire. Un tap tombé dans le
 * battement entre une échéance ratée et l'ouverture du cycle suivant remplit
 * bien le cycle raté, lui : c'est une tâche faite en retard, pas en avance.
 * En glissant, c'est le passage qui redémarre le compte — tout l'intérêt de ce rythme.
 */
function nextCycleEnd(task: Task, pending: number, ts: number, dayStart: number): number {
  const r = task.repeat!
  if (rythme(r) === 'glissant') {
    const d = new Date(ts)
    d.setDate(d.getDate() + Math.max(1, r.everyDays))
    return atHm(d, dueHm(task))
  }
  // `ts - 1` : une validation pile à l'échéance tient encore dans son cycle.
  const end = nextBoundary(task, ts - 1)
  const rempli = ts >= cycleOpen(task, end, dayStart) ? nextBoundary(task, end) : end
  // Un tap versé après coup par un widget ne doit jamais faire reculer l'échéance.
  return Math.max(pending, rempli)
}

export type Cycle = {
  /** Ouverture : avant, la tâche est déjà faite pour ce tour. */
  from: number
  /** Fermeture : après, on est en retard. */
  end: number | null
}

/**
 * Le cycle que la prochaine validation vient remplir. Disponibilité et retard
 * en sortent tous les deux, donc ils ne peuvent plus se contredire.
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

  // Une hebdomadaire due dimanche se fait du lundi au dimanche, pas de
  // dimanche 20 h à dimanche 20 h.
  return { from: cycleOpen(task, end, dayStart), end }
}

/** Échéance qui s'applique à la prochaine validation, ou null sans date limite. */
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
 * Les `n` prochaines échéances, la courante comprise.
 *
 * Sert à programmer des rappels plusieurs cycles d'avance, pour qu'ils
 * continuent de tomber sans qu'on ait à ouvrir l'appli. On y **suppose chaque
 * cycle tenu à temps** : `pendingDue` n'avance qu'à la validation, il n'existe
 * donc pas de « cycle suivant » tant que le courant n'est pas rempli. Une
 * supposition sans risque ici — rien de tout ça ne touche au solde, et le
 * moindre passage dans l'appli reprogramme tout sur l'état réel.
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
 * Pénalité de retard, figée sur l'événement à la validation.
 * `factor` multiplie la récompense, `flat` en retire un montant fixe.
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
      // Être en retard coûte au moins un jour de décroissance.
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
  /** Anti-chronologique : le plus récent d'abord. */
  entries: LedgerEntry[]
}

/**
 * Fait avancer la série d'un cran.
 *
 * Un retard ne casse pas tout de suite : il **gèle** la série, conservée mais
 * figée. La tolérance est d'**un jour**, pas d'un cycle : sur une hebdomadaire,
 * un cycle entier de rattrapage revenait à la faire une semaine sur deux sans
 * jamais rompre la série. Pour une quotidienne, un jour et un cycle sont la
 * même chose — le comportement n'y change pas.
 *
 * Atteindre l'objectif d'un compteur compte pour une validation : sans ça, le
 * réglage « Bonus de série » ne servait à rien sur ces tâches — trois jours à
 * 3/3 laissaient la série à zéro.
 */
function avancerSerie(s: TaskState, ts: number, every: number, day: (t: number) => number): void {
  if (s.lastDoneTs === null) {
    s.streak = 1
    s.frozen = false
    return
  }
  const gap = day(ts) - day(s.lastDoneTs)
  // gap === 0 : refait le même jour, la série ne bouge pas.
  if (gap <= 0) return
  if (gap <= every) {
    s.streak += 1
    s.frozen = false
  } else if (gap <= every + 1) {
    // Rattrapé dans la journée de tolérance : la série tient, sans monter.
    s.frozen = false
  } else {
    // On garde ce qu'on vient de perdre : l'interface doit pouvoir le dire.
    s.brokenStreak = s.streak
    s.streak = 1
    s.frozen = false
    s.streakTiersPaid.clear()
  }
}

/**
 * La tâche telle qu'elle était au moment du tap.
 *
 * L'événement fige tout ce dont le solde dépend — récompense, rythme, bonus de
 * série, compteur — parce que le rejeu, lui, lit la tâche d'aujourd'hui : sans
 * ce gel, changer une récompense ou un multiplicateur réécrivait l'historique
 * entier et faisait sauter le solde. Un événement d'avant ce gel ne porte pas
 * le champ : il retombe sur la définition courante, faute de mieux.
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
 * Rejoue tout le journal pour obtenir le solde et l'état de chaque tâche.
 * Fonction pure et déterministe : deux appareils ayant les mêmes événements
 * aboutissent forcément au même solde, sans résolution de conflit.
 *
 * ponytail: rejeu intégral à chaque chargement, O(n) sur le journal. Ajouter un
 * checkpoint (solde figé + curseur) si ça dépasse ~50k événements.
 */
export function replay(events: Event[], tasks: Task[], now = Date.now(), dayStart = 0): Replay {
  const day = (ts: number) => dayNum(ts, dayStart)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const perTask = new Map<string, TaskState>()
  const entries: LedgerEntry[] = []
  let balance = 0

  /**
   * Une correction ne s'écrit pas dans l'historique : elle efface la ligne
   * qu'elle corrige. On retient donc où chaque gain de compteur a été inscrit —
   * clé « objectif » ou « palier N » d'une tâche — pour pouvoir l'enlever si
   * l'utilisateur redescend.
   */
  const paidLine = new Map<string, number>()
  const erased = new Set<number>()

  const credit = (key: string, entry: LedgerEntry) => {
    paidLine.set(key, entries.length)
    entries.push(entry)
  }
  /** Reprend exactement ce qui a été versé, même si la tâche a changé depuis. */
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

  // Les annulations sont connues d'avance : l'événement visé est simplement
  // sauté, comme s'il n'avait jamais eu lieu. Séries et compteurs se
  // recalculent donc tout seuls.
  const undone = new Set<string>()
  for (const e of events) if (e.kind === 'undo') undone.add(e.targetId)

  // `id` départage les événements de même horodatage : deux appareils trient pareil.
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
      // Le compteur tel qu'il était au tap : sa récompense, son objectif, ses
      // paliers et son rythme de période. Éditer la tâche ne rejoue plus le passé.
      const alors = commeAlors(task, e)
      const target = alors?.counter?.target ?? Infinity
      const k = counterPeriod(alors, e.ts, dayStart)
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
      // L'objectif plafonne le compteur : au-delà, un tap de plus ne sert à rien
      // et ne doit surtout pas décaler le franchissement d'un palier.
      s.count = Math.min(target, Math.max(0, s.count + e.delta))

      // Le solde suit le compteur dans les deux sens : atteindre l'objectif
      // verse la récompense, redescendre en dessous la reprend. C'est ce que
      // l'on attend en corrigeant une erreur de saisie — et c'est aussi ce qui
      // rend le farming impossible, puisqu'un aller-retour se solde à zéro.
      let base = 0
      const reached = alors != null && s.count >= target
      if (reached && !s.targetPaid) {
        s.targetPaid = true
        s.lastTargetTs = e.ts
        base = alors!.reward
        // Atteindre l'objectif vaut validation : c'est ce qui fait vivre la
        // série d'un compteur. Les bonus de série, eux, restent réservés aux
        // validations tant que la règle des compteurs partiels n'est pas tranchée.
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

      // Même symétrie sur les paliers intermédiaires.
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

    // --- validation d'une tâche ---
    // Ce qui est figé sur l'événement prime — rythme et bonus de série :
    // modifier la tâche aujourd'hui ne doit ni réparer ni casser ce qui s'est
    // joué hier, ni revaloriser ce qui a déjà été payé.
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

    // Le cycle rempli, on passe au suivant. Calculé ici et pas à la lecture :
    // il dépend de l'échéance qui était en cours, donc de tout l'historique.
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

  // Recadrage sur l'instant présent : un compteur d'hier repart à zéro, une
  // série dont la fenêtre est passée est rompue.
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
    // Le gel comme la rupture se voient sans attendre la prochaine validation :
    // c'est le simple passage du temps qui les prononce.
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

  // Les lignes corrigées disparaissent, elles n'ont plus rien à raconter.
  const kept = entries.filter((_, i) => !erased.has(i))
  kept.reverse()
  return { balance, perTask, entries: kept }
}

/**
 * Cycles manqués sur l'historique d'une tâche répétitive : l'écart entre deux
 * validations consécutives (ou la dernière et maintenant) au-delà d'un cycle.
 * Simplification pour un chiffre d'affichage global : utilise le rythme
 * actuel de la tâche, pas celui figé sur chaque événement comme le fait le
 * rejeu — une répétitive change rarement de rythme, et rien ici ne touche au
 * solde.
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
 * Ce que rapporterait la tâche à la n-ième validation d'affilée, à l'heure.
 * Sert à simuler l'effet d'un multiplicateur avant de le régler.
 */
export function rewardAtStreak(task: Task, streak: number): number {
  const m = task.streak?.multiplier
  const factor = m ? Math.max(1, Math.min(1 + m.perStep * (streak - 1), m.cap)) : 1
  const tier = (task.streak?.tiers ?? [])
    .filter((t) => t.at === streak)
    .reduce((sum, t) => sum + t.bonus, 0)
  return task.reward * factor + tier
}

/** Ce que rapporterait la tâche validée avec `daysLate` jours de retard. */
export function rewardAfterDays(task: Task, daysLate: number): number {
  const due = dueTsFor(task, undefined)
  if (due === null) return task.reward
  // Pile n jours après l'échéance : `penaltyAt` arrondit au jour supérieur, un
  // décalage d'une milliseconde compterait un jour de retard en trop.
  const { factor, flat } = penaltyAt(task, due + Math.max(0, daysLate) * DAY, due)
  return Math.max(0, task.reward * factor - flat)
}

/** Premier jour de retard où la tâche ne rapporte plus rien, ou null si elle rapporte toujours. */
export function daysUntilWorthless(task: Task): number | null {
  if (!task.due) return null
  for (let d = 0; d <= 60; d++) {
    if (rewardAfterDays(task, d) <= 0) return d
  }
  return null
}

/** Rang auquel le multiplicateur atteint son plafond, ou null s'il n'y en a pas. */
export function streakAtCap(task: Task): number | null {
  const m = task.streak?.multiplier
  if (!m || m.perStep <= 0) return null
  return Math.ceil((m.cap - 1) / m.perStep) + 1
}

/**
 * Dernière validation encore active d'une tâche, celle qu'« annuler » vise.
 * Les événements déjà annulés sont ignorés, sinon on annulerait dans le vide.
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

/** Une tâche répétitive n'est re-validable qu'au cycle suivant. */
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
 * Convertit les taps faits sur un widget en événements du journal.
 *
 * La pénalité est calculée avec l'horodatage du tap, pas celui du versement :
 * valider dans les temps depuis l'écran d'accueil puis rouvrir l'appli trois
 * jours plus tard ne doit pas coûter de retard.
 *
 * ponytail: un rejeu par élément, O(n²) sur la file. Elle contient une poignée
 * de taps ; à revoir seulement si les widgets deviennent l'usage principal.
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
      // Le gel se fait au versement, pas au tap : le natif n'envoie que des
      // faits. C'est la tâche d'aujourd'hui, mais figée une bonne fois — une
      // édition ultérieure ne rejouera plus ce tap-là.
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
 * Tâches à usage unique accomplies avant aujourd'hui : elles ont fait leur temps.
 * On les efface le lendemain plutôt qu'à l'instant, pour qu'elles restent
 * visibles et annulables le jour même. Leurs événements — donc leurs gains —
 * survivent à la suppression.
 *
 * Un compteur sans répétition en fait partie : il ne se refera pas, une fois
 * son objectif atteint il n'a plus rien à faire dans la liste.
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

/** Aperçu de ce que rapporterait une validation maintenant, pour l'afficher avant le tap. */
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
