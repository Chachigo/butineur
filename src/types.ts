/** Palier : `at` = n° de série atteint, ou compte atteint sur un compteur. */
export type Tier = { at: number; bonus: number }

export type Penalty =
  | { kind: 'none' }
  | { kind: 'flat'; amount: number }
  | { kind: 'percent'; percent: number }
  | { kind: 'decay'; percentPerDay: number }

export type Task = {
  id: string
  name: string
  icon?: string
  reward: number
  /**
   * null = tâche ponctuelle. Sinon le rythme, qui découpe le temps en cycles :
   * `weekday` (0 = dimanche) pour un rendez-vous hebdomadaire, `monthday` (1-31)
   * pour « le 5 du mois », aucun des deux pour un cycle qui glisse d'`everyDays`
   * après chaque passage. `everyDays` reste le rythme en jours dans tous les
   * cas — c'est lui qui règle les périodes de compteur et la tolérance de série.
   */
  repeat: null | { everyDays: number; weekday?: number; monthday?: number }
  /** null = validation simple ; sinon on incrémente jusqu'à `target`. */
  counter: null | { target: number; unit?: string; tiers: Tier[] }
  /**
   * Date limite. Sur une tâche répétitive, seule l'heure de `at` compte : le
   * jour vient du rythme. Sans `due`, la tâche a quand même des cycles, elle
   * n'est simplement jamais en retard.
   */
  due: null | { at: string; penalty: Penalty }
  streak: null | { tiers: Tier[]; multiplier: null | { perStep: number; cap: number } }
  /**
   * Rappel, tant que la tâche est à faire : à une heure fixe chaque jour, le
   * jour de l'échéance à l'heure dite, ou un certain temps avant elle.
   * `kind` absent = heure fixe, pour les tâches créées avant les autres modes.
   */
  remind:
    | null
    | { kind?: 'time'; time: string }
    | { kind: 'jour'; time: string }
    | { kind: 'before'; minutes: number }
  /** Encouragements sur la série en cours. Désactivé par défaut, c'est intrusif. */
  cheer: boolean
  /**
   * Modèle de tâche rapide : absent de la liste et des widgets, il attend dans
   * une barre de raccourcis qu'on le ressorte. Pour ce qui revient souvent sans
   * être régulier — les courses, la lessive.
   */
  template?: boolean
  archived: boolean
  updatedAt: number
  deletedAt: number | null
}

export type ShopItem = {
  id: string
  name: string
  icon?: string
  price: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Journal append-only. Un événement ne porte que des faits locaux : jamais un
 * montant qui dépend des autres événements. Séries, multiplicateurs et paliers
 * sont dérivés au rejeu — c'est ce qui rend la fusion multi-appareils juste.
 */
export type Event =
  | {
      id: string
      ts: number
      kind: 'complete'
      taskId: string
      /** Récompense figée au moment de la validation : éditer la tâche ne réécrit pas l'historique. */
      baseReward: number
      penaltyFactor: number
      penaltyFlat: number
      /**
       * Rythme de la tâche au moment du tap, figé pour la même raison que la
       * récompense : passer une tâche de 60 à 31 jours ne doit pas recalculer
       * les échéances passées ni réparer — ou casser — une série d'hier.
       * Absent sur les événements d'avant : on retombe alors sur le rythme actuel.
       */
      repeat?: { everyDays: number; weekday?: number; monthday?: number } | null
    }
  | { id: string; ts: number; kind: 'count'; taskId: string; delta: number }
  | { id: string; ts: number; kind: 'spend'; amount: number; label: string; shopItemId?: string }
  | { id: string; ts: number; kind: 'adjust'; amount: number; label: string }
  /**
   * Annule un autre événement. On n'efface jamais un fait du journal — on en
   * ajoute un qui dit « celui-là ne compte pas », ce qui reste fusionnable
   * entre appareils et idempotent.
   */
  | { id: string; ts: number; kind: 'undo'; targetId: string }

/**
 * Un tap fait depuis un widget, appli fermée. Le natif n'y met que des faits :
 * quelle tâche, quand, et quel geste. Le montant est calculé au versement.
 */
export type Pending = {
  kind?: 'count' | 'complete'
  taskId: string
  delta: number
  ts: number
}

export type Settings = {
  currency: string
  /** Sous-titre du solde — « budget loisirs » par défaut. */
  budgetLabel: string
  /** Couleur d'accentuation, en hexa. Partagée avec les widgets. */
  accent: string
  /** Début d'une nouvelle journée, en minutes depuis minuit (0-1439). */
  dayStart: number
  /** Récompense pré-remplie à la création d'une tâche. */
  defaultReward: number
  /** Le journal sait tenir un solde négatif ; l'interface le refuse par défaut. */
  allowNegative: boolean
  /** Premier jour de la semaine dans le graphe des statistiques. 1 = lundi. */
  weekStart: 0 | 1
  /** Renseignés au lot 3. */
  serverUrl: string
  serverToken: string
}

export type DB = {
  tasks: Task[]
  shopItems: ShopItem[]
  events: Event[]
  settings: Settings
}

/** État d'une tâche, entièrement dérivé du journal. Jamais persisté. */
export type TaskState = {
  streak: number
  lastDoneTs: number | null
  /**
   * Fin du cycle en cours — l'échéance que la prochaine validation doit tenir.
   * Elle n'avance qu'à la validation, jamais avec le temps qui passe : c'est ce
   * qui fait qu'une tâche faite en avance ne rapproche pas l'échéance suivante.
   */
  pendingDue: number | null
  /** Compte de la période courante. */
  count: number
  periodKey: number | null
  /** L'objectif du compteur a déjà été payé pour cette période. */
  targetPaid: boolean
  /** Dernier moment où l'objectif d'un compteur a été atteint, toutes périodes confondues. */
  lastTargetTs: number | null
  /**
   * Un cycle manqué met la série en gel : elle est conservée mais n'avance
   * plus. Le cycle suivant la dégèle, ou la casse s'il est manqué aussi.
   */
  frozen: boolean
  /** Longueur de la série qui vient d'être perdue, tant qu'on ne l'a pas relancée. */
  brokenStreak: number
  /** Plus longue série jamais tenue sur cette tâche. */
  bestStreak: number
  countTiersPaid: Set<number>
  streakTiersPaid: Set<number>
}

export type LedgerEntry = {
  eventId: string
  ts: number
  kind: Event['kind']
  taskId?: string
  label: string
  /** Récompense de base avant pénalité (0 pour une dépense). */
  base: number
  /** Négatif ou nul. */
  penalty: number
  multiplierBonus: number
  tierBonus: number
  /** Effet net sur le solde, signé. */
  total: number
}
