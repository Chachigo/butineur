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
  /** null = tâche ponctuelle. */
  repeat: null | { everyDays: number }
  /** null = validation simple ; sinon on incrémente jusqu'à `target`. */
  counter: null | { target: number; unit?: string; tiers: Tier[] }
  /** Pour une tâche répétitive, l'échéance glisse : dernier passage + everyDays. */
  due: null | { at: string; penalty: Penalty }
  streak: null | { tiers: Tier[]; multiplier: null | { perStep: number; cap: number } }
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
    }
  | { id: string; ts: number; kind: 'count'; taskId: string; delta: number }
  | { id: string; ts: number; kind: 'spend'; amount: number; label: string; shopItemId?: string }
  | { id: string; ts: number; kind: 'adjust'; amount: number; label: string }

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
  /** Récompense pré-remplie à la création d'une tâche. */
  defaultReward: number
  /** Le journal sait tenir un solde négatif ; l'interface le refuse par défaut. */
  allowNegative: boolean
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
  /** Compte de la période courante. */
  count: number
  periodKey: number | null
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
