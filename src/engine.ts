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

/** Période d'un compteur : tranche de `everyDays` jours alignée sur le calendrier. */
export function periodKey(ts: number, everyDays: number, dayStart = 0): number {
  return Math.floor(dayNum(ts, dayStart) / Math.max(1, everyDays))
}

const everyDaysOf = (task: Task | undefined) => Math.max(1, task?.repeat?.everyDays ?? 1)

/**
 * Échéance qui s'applique à la prochaine validation.
 *
 * Tâche ponctuelle : la date fixe. Tâche répétitive : elle glisse d'un cycle à
 * chaque passage, sinon toute tâche récurrente serait en retard à vie. Avec un
 * jour de la semaine, c'est sa prochaine occurrence après le dernier passage.
 */
export function dueTsFor(task: Task, lastDoneTs: number | null, now = Date.now()): number | null {
  if (!task.due) return null
  const fixed = Date.parse(task.due.at)
  if (Number.isNaN(fixed)) return null

  if (task.due.weekday != null && task.repeat) {
    // Depuis la veille quand rien n'a encore été fait : l'échéance du jour compte.
    return nextWeekday(lastDoneTs ?? now - DAY, task.due.weekday, fixed)
  }
  if (!task.repeat || lastDoneTs === null) return fixed
  return lastDoneTs + task.repeat.everyDays * DAY
}

/** Première occurrence de `weekday` strictement après `from`, à l'heure de `timeFrom`. */
function nextWeekday(from: number, weekday: number, timeFrom: number): number {
  const t = new Date(timeFrom)
  const d = new Date(from)
  d.setHours(t.getHours(), t.getMinutes(), 0, 0)
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() !== weekday % 7)
  return +d
}

/**
 * Pénalité de retard, figée sur l'événement à la validation.
 * `factor` multiplie la récompense, `flat` en retire un montant fixe.
 */
export function computePenalty(
  task: Task,
  ts: number,
  lastDoneTs: number | null,
): { factor: number; flat: number } {
  const none = { factor: 1, flat: 0 }
  const due = dueTsFor(task, lastDoneTs)
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

const freshState = (): TaskState => ({
  streak: 0,
  lastDoneTs: null,
  count: 0,
  periodKey: null,
  targetPaid: false,
  lastTargetTs: null,
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
  const refund = (key: string) => {
    const i = paidLine.get(key)
    if (i !== undefined) erased.add(i)
    paidLine.delete(key)
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
      const target = task?.counter?.target ?? Infinity
      const k = periodKey(e.ts, everyDaysOf(task), dayStart)
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
      const reached = task != null && s.count >= target
      if (reached && !s.targetPaid) {
        s.targetPaid = true
        s.lastTargetTs = e.ts
        base = task!.reward
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
        base = -(task?.reward ?? 0)
        refund(`${e.taskId}:objectif`)
      }

      // Même symétrie sur les paliers intermédiaires.
      let tierBonus = 0
      for (const t of task?.counter?.tiers ?? []) {
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
          tierBonus -= t.bonus
          refund(`${e.taskId}:palier${t.at}`)
        }
      }
      balance += base + tierBonus
      continue
    }

    // --- validation d'une tâche ---
    const every = everyDaysOf(task)
    if (s.lastDoneTs === null) {
      s.streak = 1
    } else {
      const gap = day(e.ts) - day(s.lastDoneTs)
      if (gap > 0) {
        // Un jour de tolérance sur la fenêtre attendue.
        if (gap <= every + 1) s.streak += 1
        else {
          // On garde ce qu'on vient de perdre : l'interface doit pouvoir le dire.
          s.brokenStreak = s.streak
          s.streak = 1
          s.streakTiersPaid.clear()
        }
      }
      // gap === 0 : revalidé le même jour, la série ne bouge pas.
    }

    let tierBonus = 0
    for (const t of task?.streak?.tiers ?? []) {
      if (t.at <= s.streak && !s.streakTiersPaid.has(t.at)) {
        s.streakTiersPaid.add(t.at)
        tierBonus += t.bonus
      }
    }

    const penalized = Math.max(0, e.baseReward * e.penaltyFactor - e.penaltyFlat)
    const m = task?.streak?.multiplier
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
      const k = periodKey(now, every, dayStart)
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
    }
    if (s.lastDoneTs !== null && today - day(s.lastDoneTs) > every + 1) {
      // La fenêtre est passée sans validation : la série est perdue maintenant,
      // pas à la prochaine validation. C'est ce qui permet de l'annoncer.
      if (s.streak > 0) s.brokenStreak = s.streak
      s.streak = 0
      s.streakTiersPaid.clear()
    }
  }

  // Les lignes corrigées disparaissent, elles n'ont plus rien à raconter.
  const kept = entries.filter((_, i) => !erased.has(i))
  kept.reverse()
  return { balance, perTask, entries: kept }
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
  if (!task.due) return task.reward
  const due = Date.parse(task.due.at)
  if (Number.isNaN(due)) return task.reward
  // Pile n jours après l'échéance : `computePenalty` arrondit au jour supérieur,
  // un décalage d'une milliseconde compterait un jour de retard en trop.
  const { factor, flat } = computePenalty(task, due + Math.max(0, daysLate) * DAY, null)
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

/** Une tâche répétitive n'est re-validable qu'une fois son cycle écoulé. */
export function isAvailable(
  task: Task,
  s: TaskState | undefined,
  now = Date.now(),
  dayStart = 0,
): boolean {
  if (task.counter) return true
  if (!s || s.lastDoneTs === null) return true
  if (!task.repeat) return false
  return dayNum(now, dayStart) - dayNum(s.lastDoneTs, dayStart) >= task.repeat.everyDays
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
      const { factor, flat } = computePenalty(task, p.ts, perTask.get(task.id)?.lastDoneTs ?? null)
      added.push({
        id: newId(),
        ts: p.ts,
        kind: 'complete',
        taskId: p.taskId,
        baseReward: task.reward,
        penaltyFactor: factor,
        penaltyFlat: flat,
      })
    } else {
      added.push({ id: newId(), ts: p.ts, kind: 'count', taskId: p.taskId, delta: p.delta })
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
  const last = s?.lastDoneTs ?? null
  const { factor, flat } = computePenalty(task, now, last)
  const penalized = Math.max(0, task.reward * factor - flat)
  const nextStreak = (s?.streak ?? 0) + 1
  const m = task.streak?.multiplier
  const mf = m ? Math.max(1, Math.min(1 + m.perStep * (nextStreak - 1), m.cap)) : 1
  const tiers = (task.streak?.tiers ?? [])
    .filter((t) => t.at <= nextStreak && !s?.streakTiersPaid.has(t.at))
    .reduce((sum, t) => sum + t.bonus, 0)
  return penalized * mf + tiers
}
