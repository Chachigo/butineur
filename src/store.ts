import { get, set } from 'idb-keyval'
import { useSyncExternalStore } from 'react'
import type { DB, Event, ShopItem, Task } from './types'

const KEY = 'db'

const EMPTY: DB = {
  tasks: [],
  shopItems: [],
  events: [],
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

let db: DB = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

let timer: ReturnType<typeof setTimeout> | undefined
function persist() {
  clearTimeout(timer)
  // ponytail: réécriture du blob entier à chaque mutation. Passer à un store
  // IndexedDB par événement si le journal dépasse quelques Mo.
  timer = setTimeout(() => void set(KEY, db), 300)
}

export const uid = () => crypto.randomUUID()

/** Appelé une fois avant le premier rendu. */
export async function load() {
  const saved = await get<DB>(KEY)
  db = saved ? { ...EMPTY, ...saved, settings: { ...EMPTY.settings, ...saved.settings } } : EMPTY
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

export const addEvent = (e: Event) => update((d) => ({ ...d, events: [...d.events, e] }))

export const saveTask = (t: Task) =>
  update((d) => ({ ...d, tasks: upsert(d.tasks, { ...t, updatedAt: Date.now() }) }))

export const saveShopItem = (s: ShopItem) =>
  update((d) => ({ ...d, shopItems: upsert(d.shopItems, { ...s, updatedAt: Date.now() }) }))

/**
 * Suppression douce : `deletedAt` permet à la synchro du lot 3 de propager
 * l'effacement, et les événements passés gardent leur valeur au solde.
 */
export const deleteTask = (id: string) =>
  update((d) => ({
    ...d,
    tasks: d.tasks.map((t) => (t.id === id ? { ...t, deletedAt: Date.now(), updatedAt: Date.now() } : t)),
  }))

export const deleteShopItem = (id: string) =>
  update((d) => ({
    ...d,
    shopItems: d.shopItems.map((s) =>
      s.id === id ? { ...s, deletedAt: Date.now(), updatedAt: Date.now() } : s,
    ),
  }))

/**
 * Remplace toute la base par une sauvegarde. Les réglages absents reprennent
 * leurs valeurs par défaut, pour qu'une sauvegarde plus ancienne reste lisible.
 */
export function replaceAll(next: DB) {
  update(() => ({ ...EMPTY, ...next, settings: { ...EMPTY.settings, ...next.settings } }))
}

export const setSettings = (patch: Partial<DB['settings']>) =>
  update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
