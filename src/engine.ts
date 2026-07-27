import type { Event, LedgerEntry, Pending, Task, TaskState } from './types'

export const DAY = 86_400_000

/** Numéro de jour local, insensible aux changements d'heure d'été. */
export function dayNum(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

/** Période d'un compteur : tranche de `everyDays` jours alignée sur le calendrier. */
export function periodKey(ts: number, everyDays: number): number {
  return Math.floor(dayNum(ts) / Math.max(1, everyDays))
}

const everyDaysOf = (task: Task | undefined) => Math.max(1, task?.repeat?.everyDays ?? 1)

/**
 * Échéance qui s'applique à la prochaine validation.
 * Tâche ponctuelle : la date fixe. Tâche répétitive : elle glisse d'un cycle
 * à chaque passage, sinon toute tâche récurrente serait en retard à vie.
 */
export function dueTsFor(task: Task, lastDoneTs: number | null): number | null {
  if (!task.due) return null
  const fixed = Date.parse(task.due.at)
  if (Number.isNaN(fixed)) return null
  if (!task.repeat || lastDoneTs === null) return fixed
  return lastDoneTs + task.repeat.everyDays * DAY
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
export function replay(events: Event[], tasks: Task[], now = Date.now()): Replay {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const perTask = new Map<string, TaskState>()
  const entries: LedgerEntry[] = []
  let balance = 0

  const stateOf = (id: string): TaskState => {
    let s = perTask.get(id)
    if (!s) perTask.set(id, (s = freshState()))
    return s
  }

  // `id` départage les événements de même horodatage : deux appareils trient pareil.
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

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
      const k = periodKey(e.ts, everyDaysOf(task))
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
      // L'objectif plafonne le compteur : au-delà, un tap de plus ne sert à rien
      // et ne doit surtout pas décaler le franchissement d'un palier.
      s.count = Math.min(target, Math.max(0, s.count + e.delta))

      // Atteindre l'objectif verse la récompense de la tâche, une fois par
      // période. Les paliers ne servent qu'aux bonus intermédiaires.
      let base = 0
      if (task && s.count >= target && !s.targetPaid) {
        s.targetPaid = true
        base = task.reward
      }

      // Un palier franchi n'est payé qu'une fois par période : décrémenter puis
      // réincrémenter ne permet pas de le farmer, et deux `count` concurrents
      // venus de deux appareils ne le versent pas deux fois.
      let tierBonus = 0
      for (const t of task?.counter?.tiers ?? []) {
        if (t.at <= s.count && !s.countTiersPaid.has(t.at)) {
          s.countTiersPaid.add(t.at)
          tierBonus += t.bonus
        }
      }
      const gained = base + tierBonus
      balance += gained
      entries.push({
        eventId: e.id,
        ts: e.ts,
        kind: 'count',
        taskId: e.taskId,
        label: `${label} ${e.delta > 0 ? '+' : ''}${e.delta}`,
        base,
        penalty: 0,
        multiplierBonus: 0,
        tierBonus,
        total: gained,
      })
      continue
    }

    // --- validation d'une tâche ---
    const every = everyDaysOf(task)
    if (s.lastDoneTs === null) {
      s.streak = 1
    } else {
      const gap = dayNum(e.ts) - dayNum(s.lastDoneTs)
      if (gap > 0) {
        // Un jour de tolérance sur la fenêtre attendue.
        if (gap <= every + 1) s.streak += 1
        else {
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
  const today = dayNum(now)
  for (const t of tasks) {
    const s = stateOf(t.id)
    const every = everyDaysOf(t)
    if (t.counter) {
      const k = periodKey(now, every)
      if (s.periodKey !== k) {
        s.periodKey = k
        s.count = 0
        s.targetPaid = false
        s.countTiersPaid = new Set()
      }
    }
    if (s.lastDoneTs !== null && today - dayNum(s.lastDoneTs) > every + 1) {
      s.streak = 0
      s.streakTiersPaid.clear()
    }
  }

  entries.reverse()
  return { balance, perTask, entries }
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

/** Une tâche répétitive n'est re-validable qu'une fois son cycle écoulé. */
export function isAvailable(task: Task, s: TaskState | undefined, now = Date.now()): boolean {
  if (task.counter) return true
  if (!s || s.lastDoneTs === null) return true
  if (!task.repeat) return false
  return dayNum(now) - dayNum(s.lastDoneTs) >= task.repeat.everyDays
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
 * Tâches à usage unique validées avant aujourd'hui : elles ont fait leur temps.
 * On les efface le lendemain plutôt qu'à la validation, pour qu'elles restent
 * visibles et annulables le jour même. Leurs événements — donc leurs gains —
 * survivent à la suppression.
 */
export function staleOneShots(tasks: Task[], rep: Replay, now = Date.now()): string[] {
  const today = dayNum(now)
  return tasks
    .filter((t) => {
      if (t.repeat || t.counter || t.deletedAt) return false
      const last = rep.perTask.get(t.id)?.lastDoneTs
      return last != null && dayNum(last) < today
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
