import { get, set } from 'idb-keyval'
import { PREFIX, setTimeOffset, timeOffset, undoDebugEvents } from './debug'
import { defaultDue } from './format'
import { PHOSPHOR_MIGRATE } from './ui/icons.generated'
import { useSyncExternalStore } from 'react'
import type { DB, Event, ShopItem, Task } from './types'
import { tr } from './i18n'

const KEY = 'db'

const EMPTY: DB = {
  tasks: [],
  shopItems: [],
  events: [],
  settings: {
    currency: '€',
    budgetLabel: tr('set.budgetHint'),
    accent: '#4ade80',
    dayStart: 0,
    defaultReward: 10,
    allowNegative: false,
    weekStart: 1,
    showStats: true,
    serverUrl: '',
    serverToken: '',
  },
}

let db: DB = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

let timer: ReturnType<typeof setTimeout> | undefined
function persist() {
  clearTimeout(timer)
  // ponytail: the whole blob is rewritten on every mutation. Move to a
  // per-event IndexedDB store if the log ever goes past a few MB.
  timer = setTimeout(() => void set(KEY, db), 300)
}

export const uid = () => crypto.randomUUID()

/** Writes without waiting for the debounce — a reload must lose nothing. */
export async function flush(): Promise<void> {
  clearTimeout(timer)
  await set(KEY, db)
}

/**
 * Leaving the workshop: everything manufactured or completed while the clock was
 * shifted is taken back, then we return to the present. Without this, a
 * completion made "tomorrow" stayed in the log with a future date.
 */
export async function quitterAtelier(): Promise<void> {
  update((d) => ({ ...d, events: [...d.events, ...undoDebugEvents(d.events)] }))
  await flush()
  setTimeOffset(0)
}

/**
 * The Phosphor font moved to duotone: an icon is worth two characters there
 * instead of one. Without this catch-up, an icon picked before the change would
 * only draw its background silhouette, without its detail.
 */
const migrerIcone = (icon?: string): string | undefined => {
  if (!icon?.startsWith('ph:')) return icon
  const chars = icon.slice(3)
  return [...chars].length > 1 ? icon : `ph:${PHOSPHOR_MIGRATE[chars] ?? chars}`
}

/**
 * Three catch-ups, applied on load and on restore so that an older backup stays
 * readable:
 *
 * - the day of the week moved from `due` to `repeat` — the rhythm carries it,
 *   not the deadline;
 * - a repeating task necessarily has a deadline on every round, so it always
 *   carries a `due`: without a penalty, it merely displays the date;
 * - Phosphor icons move to duotone, see [migrerIcone].
 */
const migrate = (tasks: Task[] = []): Task[] =>
  tasks.map((t) => {
    const { weekday, ...reste } = (t.due ?? {}) as Task['due'] & { weekday?: number }
    let next = { ...t, icon: migrerIcone(t.icon) }
    if (weekday != null && t.repeat) {
      next = { ...next, due: reste as Task['due'], repeat: { ...t.repeat, everyDays: 7, weekday } }
    }
    if (!next.repeat || next.due || next.counter) return next
    return { ...next, due: { at: defaultDue(), penalty: { kind: 'none' } } }
  })

/**
 * Freezes onto older events whatever the balance depends on, using the task's
 * current definition.
 *
 * That is already the one the replay applies to them for want of anything
 * better: the balance therefore does not move by a cent. But from then on,
 * editing the task no longer touches them — without this catch-up, the freeze
 * would only protect what is completed after the update, and the whole history
 * would stay rewritable.
 */
const gelerEvents = (events: Event[] = [], tasks: Task[]): Event[] => {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return events.map((e) => {
    const t = 'taskId' in e ? byId.get(e.taskId) : undefined
    if (!t) return e
    // `...e` last: whatever is already frozen on the event wins.
    if (e.kind === 'complete') return { repeat: t.repeat, streak: t.streak, ...e }
    if (e.kind === 'count') return { baseReward: t.reward, counter: t.counter, repeat: t.repeat, ...e }
    return e
  })
}

const migrateDB = (d: DB): DB => {
  const tasks = migrate(d.tasks)
  return {
    ...d,
    tasks,
    events: gelerEvents(d.events, tasks),
    shopItems: (d.shopItems ?? []).map((s) => ({ ...s, icon: migrerIcone(s.icon) })),
  }
}

/** Called once before the first render. */
export async function load() {
  const saved = await get<DB>(KEY)
  db = saved
    ? migrateDB({ ...EMPTY, ...saved, settings: { ...EMPTY.settings, ...saved.settings } })
    : EMPTY
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const useDB = () => useSyncExternalStore(subscribe, () => db)

export function update(fn: (d: DB) => DB) {
  db = fn(db)
  persist()
  emit()
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

/**
 * An event written while the clock was shifted is marked: it never happened, and
 * "back to the present" has to be able to take it back.
 */
const marquer = (e: Event): Event => (timeOffset() ? { ...e, id: PREFIX + e.id } : e)

export const addEvent = (e: Event) => update((d) => ({ ...d, events: [...d.events, marquer(e)] }))

export const saveTask = (t: Task) =>
  update((d) => ({ ...d, tasks: upsert(d.tasks, { ...t, updatedAt: Date.now() }) }))

/**
 * Saves a task together with the subtasks edited alongside it. The ones removed
 * from the list are soft-deleted.
 *
 * One `update()` for the lot rather than one per child: a bouquet must never be
 * seen half written — neither by the replay, nor by the widgets.
 */
export function saveTaskTree(parent: Task, children: Task[]) {
  update((d) => {
    const now = Date.now()
    const keep = new Set(children.map((c) => c.id))
    let tasks = d.tasks.map((t) =>
      t.parentId === parent.id && !keep.has(t.id) && !t.deletedAt
        ? { ...t, deletedAt: now, updatedAt: now }
        : t,
    )
    for (const t of [parent, ...children]) tasks = upsert(tasks, { ...t, updatedAt: now })
    return { ...d, tasks }
  })
}

export const saveShopItem = (s: ShopItem) =>
  update((d) => ({ ...d, shopItems: upsert(d.shopItems, { ...s, updatedAt: Date.now() }) }))

/**
 * Soft delete: `deletedAt` lets the batch-3 sync propagate the removal, and past
 * events keep their value in the balance.
 *
 * Deleting a parent takes its subtasks with it — left behind, they would be
 * orphans with no cycle, invisible in the list and impossible to delete.
 */
export const deleteTask = (id: string) =>
  update((d) => {
    const now = Date.now()
    const gone = (t: Task) => t.id === id || t.parentId === id
    return {
      ...d,
      tasks: d.tasks.map((t) => (gone(t) ? { ...t, deletedAt: now, updatedAt: now } : t)),
    }
  })

export const deleteShopItem = (id: string) =>
  update((d) => ({
    ...d,
    shopItems: d.shopItems.map((s) =>
      s.id === id ? { ...s, deletedAt: Date.now(), updatedAt: Date.now() } : s,
    ),
  }))

/**
 * Replaces the whole database with a backup. Missing settings fall back on their
 * default values, so that an older backup stays readable.
 */
export function replaceAll(next: DB) {
  update(() => migrateDB({ ...EMPTY, ...next, settings: { ...EMPTY.settings, ...next.settings } }))
}

export const setSettings = (patch: Partial<DB['settings']>) =>
  update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
