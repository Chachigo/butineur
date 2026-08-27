/** Tier: `at` = streak rank reached, or count reached on a counter. */
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
   * null = one-shot task. Otherwise the rhythm, which cuts time into cycles:
   * `weekday` (0 = Sunday) for a weekly appointment, `monthday` (1-31) for "the
   * 5th of the month", neither of them for a cycle rolling `everyDays` after
   * each completion. `everyDays` stays the rhythm in days in every case — it is
   * what sets counter periods and streak tolerance.
   */
  repeat: null | { everyDays: number; weekday?: number; monthday?: number }
  /** null = plain completion; otherwise it is incremented up to `target`. */
  counter: null | { target: number; unit?: string; tiers: Tier[] }
  /**
   * Deadline. On a repeating task only the time of day of `at` matters: the day
   * comes from the rhythm. Without `due` the task still has cycles, it simply is
   * never late.
   */
  due: null | { at: string; penalty: Penalty }
  streak: null | { tiers: Tier[]; multiplier: null | { perStep: number; cap: number } }
  /**
   * Reminder, for as long as the task is pending: at a fixed time every day, on
   * the day of the deadline at the given time, or some time before it.
   * Missing `kind` = fixed time, for tasks created before the other modes.
   */
  remind:
    | null
    | { kind?: 'time'; time: string }
    | { kind: 'jour'; time: string }
    | { kind: 'before'; minutes: number }
  /** Cheers about the running streak. Off by default, it is intrusive. */
  cheer: boolean
  /**
   * Quick-task template: absent from the list and the widgets, it waits in a
   * shortcut bar to be pulled out again. For what comes back often without being
   * regular — groceries, laundry.
   */
  template?: boolean
  /**
   * Parent of a subtask. One level only, no sub-subtask.
   *
   * A bouquet is one-shot: a parent cannot repeat, so neither can its subtasks.
   * A subtask is therefore a task stripped of rhythm, deadline and reminder —
   * a name, an amount, and a counter if it needs one. It keeps its own reward,
   * so it is completed like any other task and `replay()` has nothing to learn.
   *
   * A parent is not completed by hand: the last subtask completes it, and its
   * own reward is the bonus for the full bouquet.
   */
  parentId?: string
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
 * Append-only log. An event carries local facts only: never an amount that
 * depends on the other events. Streaks, multipliers and tiers are derived at
 * replay time — that is what makes the multi-device merge correct.
 */
export type Event =
  | {
      id: string
      ts: number
      kind: 'complete'
      taskId: string
      /** Reward frozen at completion time: editing the task does not rewrite history. */
      baseReward: number
      penaltyFactor: number
      penaltyFlat: number
      /**
       * The task's rhythm at the time of the tap, frozen for the same reason as
       * the reward: moving a task from 60 to 31 days must not recompute past
       * deadlines, nor repair — or break — yesterday's streak.
       * Absent on older events: they fall back on the current rhythm.
       */
      repeat?: { everyDays: number; weekday?: number; monthday?: number } | null
      /**
       * Streak bonus at the time of the tap. Same freeze, and it was missing:
       * raising the multiplier re-priced every past completion at once, and
       * adding a tier paid it retroactively.
       */
      streak?: Task['streak']
    }
  | {
      id: string
      ts: number
      kind: 'count'
      taskId: string
      delta: number
      /**
       * The counter as it stood at the tap. Nothing used to be frozen here:
       * changing the reward re-priced targets already reached, raising the target
       * took back what they had paid, and changing the rhythm re-cut past
       * periods. Absent on events predating the freeze: fall back on the current
       * task, for want of anything better.
       */
      baseReward?: number
      counter?: Task['counter']
      repeat?: Task['repeat']
    }
  | { id: string; ts: number; kind: 'spend'; amount: number; label: string; shopItemId?: string }
  | { id: string; ts: number; kind: 'adjust'; amount: number; label: string }
  /**
   * Undoes another event. A fact is never erased from the log — one is added
   * saying "that one does not count", which stays mergeable across devices and
   * idempotent.
   */
  | { id: string; ts: number; kind: 'undo'; targetId: string }

/**
 * A tap made from a widget with the app closed. The native side only puts facts
 * in it: which task, when, and which gesture. The amount is computed at pour time.
 */
export type Pending = {
  kind?: 'count' | 'complete'
  taskId: string
  delta: number
  ts: number
}

export type Settings = {
  currency: string
  /** Subtitle of the balance — "budget loisirs" by default. */
  budgetLabel: string
  /** Accent color, in hex. Shared with the widgets. */
  accent: string
  /** Start of a new day, in minutes since midnight (0-1439). */
  dayStart: number
  /** Reward pre-filled when creating a task. */
  defaultReward: number
  /** The log can hold a negative balance; the interface refuses it by default. */
  allowNegative: boolean
  /** First day of the week in the statistics graph. 1 = Monday. */
  weekStart: 0 | 1
  /** The Stats tab can be hidden for those who have no use for it. */
  showStats: boolean
  /** Filled in at batch 3. */
  serverUrl: string
  serverToken: string
}

export type DB = {
  tasks: Task[]
  shopItems: ShopItem[]
  events: Event[]
  settings: Settings
}

/** A task's state, entirely derived from the log. Never persisted. */
export type TaskState = {
  streak: number
  lastDoneTs: number | null
  /**
   * End of the current cycle — the deadline the next completion has to meet.
   * It only moves forward on a completion, never with time passing: that is what
   * makes a task done early not pull the next deadline closer.
   */
  pendingDue: number | null
  /** Count for the current period. */
  count: number
  periodKey: number | null
  /** The counter's target has already been paid for this period. */
  targetPaid: boolean
  /** Last time a counter's target was reached, across all periods. */
  lastTargetTs: number | null
  /**
   * A missed cycle freezes the streak: it is kept but no longer grows. The next
   * cycle thaws it, or breaks it if that one is missed too.
   */
  frozen: boolean
  /** Length of the streak just lost, until a new one is started. */
  brokenStreak: number
  /** Longest streak ever held on this task. */
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
  /** Base reward before penalty (0 for a spending). */
  base: number
  /** Negative or zero. */
  penalty: number
  multiplierBonus: number
  tierBonus: number
  /** Net effect on the balance, signed. */
  total: number
  /**
   * Set on the line that pays a counter's target — the one that counts as a
   * completion. A flag rather than a match on the label, which the translation
   * of the interface would have broken in silence.
   */
  target?: true
}
