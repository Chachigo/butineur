import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { dayNum, dueTsFor, isAvailable, previewReward, type Replay } from './engine'
import { fmt } from './format'
import type { Pending, Settings, Task } from './types'
import { iconChar, isPhosphor } from './ui/Icon'

export const isNative = Capacitor.isNativePlatform()

interface WidgetBridgePlugin {
  refresh(): Promise<void>
  drainPending(): Promise<{ items: Pending[] }>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

// --- widgets ---

export type WidgetPayload = {
  balance: string
  /** Valeur brute : le natif y ajoute les taps en attente pour un affichage immédiat. */
  balanceRaw: number
  currency: string
  budgetLabel: string
  accent: string
  tasks: {
    id: string
    name: string
    icon: string
    /** Vrai si `icon` est un glyphe Phosphor : le widget applique alors sa police. */
    iconPh: boolean
    count: number
    target: number
    unit: string
    day: number
    /** Ce que le prochain +1 rapporterait, pour l'affichage immédiat du solde. */
    gain: number
  }[]
  /** Toutes les tâches en cours, compteurs compris — la liste du widget défile. */
  todo: {
    id: string
    name: string
    icon: string
    iconPh: boolean
    /** Ce que fait le bouton : incrémenter, ou valider. */
    kind: 'count' | 'complete'
    /** Libellé du bouton, déjà formaté : « +10 », « 3/8 », « ✓ ». */
    label: string
    /**
     * Ce que rapporterait le prochain tap. Le widget l'ajoute au solde affiché
     * en attendant que l'appli recalcule pour de vrai — sans quoi valider une
     * tâche depuis l'écran d'accueil ne bougeait rien.
     */
    gain: number
    done: boolean
  }[]
}

/**
 * Ce que le prochain +1 verserait sur un compteur : la récompense de la tâche
 * s'il atteint l'objectif, plus tout palier franchi au passage.
 */
function nextCountGain(t: Task, rep: Replay): number {
  if (!t.counter) return 0
  const s = rep.perTask.get(t.id)
  const count = s?.count ?? 0
  if (count >= t.counter.target) return 0
  const next = count + 1
  const tier = t.counter.tiers
    .filter((x) => x.at <= next && !s?.countTiersPaid.has(x.at))
    .reduce((sum, x) => sum + x.bonus, 0)
  return (next >= t.counter.target ? t.reward : 0) + tier
}

/** Le natif reçoit le caractère à afficher, jamais un nom d'icône à résoudre. */
const icon = (raw: string | undefined) => ({
  icon: iconChar(raw ?? ''),
  iconPh: isPhosphor(raw ?? ''),
})

/** Strictement ce que les widgets ont besoin de savoir — aucune règle métier. */
export function widgetPayload(
  rep: Replay,
  tasks: Task[],
  settings: Settings,
  now: number,
): WidgetPayload {
  const day = dayNum(now)
  const live = tasks.filter((t) => !t.deletedAt && !t.archived)
  const { currency } = settings

  return {
    balance: fmt(rep.balance),
    balanceRaw: rep.balance,
    currency,
    budgetLabel: settings.budgetLabel,
    accent: settings.accent,
    tasks: live
      .filter((t) => t.counter)
      .map((t) => ({
        id: t.id,
        name: t.name,
        ...icon(t.icon),
        count: rep.perTask.get(t.id)?.count ?? 0,
        target: t.counter!.target,
        unit: t.counter!.unit ?? '',
        day,
        gain: nextCountGain(t, rep),
      })),
    todo: live
      .filter((t) => isAvailable(t, rep.perTask.get(t.id), now))
      .map((t) => {
        const s = rep.perTask.get(t.id)
        if (t.counter) {
          const count = s?.count ?? 0
          const done = count >= t.counter.target
          return {
            id: t.id,
            name: t.name,
            ...icon(t.icon),
            kind: 'count' as const,
            label: done ? '✓' : `${count}/${t.counter.target}`,
            gain: nextCountGain(t, rep),
            done,
          }
        }
        return {
          id: t.id,
          name: t.name,
          ...icon(t.icon),
          kind: 'complete' as const,
          label: `+${fmt(previewReward(t, s, now))}`,
          gain: previewReward(t, s, now),
          done: false,
        }
      })
      // Ce qui reste à faire d'abord, le plus urgent en tête ; le fini en bas.
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1
        const ta = live.find((t) => t.id === a.id)!
        const tb = live.find((t) => t.id === b.id)!
        return due(ta, rep, now) - due(tb, rep, now)
      }),
  }
}

const due = (t: Task, rep: Replay, now: number) =>
  dueTsFor(t, rep.perTask.get(t.id)?.lastDoneTs ?? null) ?? now + 3.15e10

export async function pushWidgetState(p: WidgetPayload): Promise<void> {
  if (!isNative) return
  await Preferences.set({ key: 'balance', value: p.balance })
  await Preferences.set({ key: 'balanceRaw', value: String(p.balanceRaw) })
  await Preferences.set({ key: 'currency', value: p.currency })
  await Preferences.set({ key: 'budgetLabel', value: p.budgetLabel })
  await Preferences.set({ key: 'accent', value: p.accent })
  await Preferences.set({ key: 'widgetTasks', value: JSON.stringify(p.tasks) })
  await Preferences.set({ key: 'widgetTodo', value: JSON.stringify(p.todo) })
  await WidgetBridge.refresh()
}

/** Les taps faits sur un widget appli fermée, à verser au journal. */
export async function drainPending(): Promise<Pending[]> {
  if (!isNative) return []
  const { items } = await WidgetBridge.drainPending()
  return Array.isArray(items) ? items : []
}

/**
 * Le « + » du widget liste. Il écrit juste un drapeau : le natif n'ouvre pas
 * d'écran de création lui-même, il n'y a qu'un seul éditeur, celui du web.
 */
export async function takeNewTaskRequest(): Promise<boolean> {
  if (!isNative) return false
  const { value } = await Preferences.get({ key: 'newTaskRequested' })
  if (!value) return false
  await Preferences.remove({ key: 'newTaskRequested' })
  return true
}

// --- rappels d'échéance ---

export type NotifSpec = { id: number; title: string; body: string; at: number }

export function notificationSpecs(rep: Replay, tasks: Task[], now: number, currency: string): NotifSpec[] {
  return tasks
    .filter((t) => t.due && !t.deletedAt && !t.archived)
    .map((t) => ({ t, at: dueTsFor(t, rep.perTask.get(t.id)?.lastDoneTs ?? null) }))
    .filter((x): x is { t: Task; at: number } => x.at !== null && x.at > now)
    .sort((a, b) => a.at - b.at)
    // Android plafonne les alarmes programmées ; les plus proches suffisent.
    .slice(0, 32)
    .map(({ t, at }) => ({
      id: notifId(t.id),
      title: t.name,
      body: `Échéance maintenant — ${fmt(t.reward)} ${currency} en jeu`,
      at,
    }))
}

export async function syncNotifications(specs: NotifSpec[]): Promise<void> {
  if (!isNative) return

  let perm = await LocalNotifications.checkPermissions()
  if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
    perm = await LocalNotifications.requestPermissions()
  }
  if (perm.display !== 'granted') return

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) await LocalNotifications.cancel(pending)
  if (!specs.length) return

  await LocalNotifications.schedule({
    notifications: specs.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      schedule: { at: new Date(s.at) },
    })),
  })
}

/** L'API n'accepte qu'un entier ; on en dérive un stable depuis l'uuid. */
function notifId(taskId: string): number {
  let h = 0
  for (let i = 0; i < taskId.length; i++) h = (h * 31 + taskId.charCodeAt(i)) | 0
  return Math.abs(h) % 2_000_000_000
}
