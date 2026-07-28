import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { dayNum, dueTsFor, isAvailable, previewReward, type Replay } from './engine'
import { fmt } from './format'
import type { Pending, Settings, Task, TaskState } from './types'
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
  /** Bascule du jour en minutes, pour que le natif compte comme le moteur. */
  dayStart: number
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
    /** Base des identifiants de notification, pour que le widget puisse les couper. */
    notifBase: number
    /**
     * Ce que rapporte chaque cran : `gains[i]` est le gain du tap qui fait
     * passer le compte de `i` à `i+1`. Le widget indexe par son compte courant,
     * et reste donc juste sur plusieurs taps consécutifs appli fermée.
     */
    gains: number[]
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
    /** Base des identifiants de notification, pour que le widget puisse les couper. */
    notifBase: number
  }[]
}

/**
 * Gain de chaque cran d'un compteur, du premier à l'objectif.
 *
 * Un seul montant ne suffisait pas : après un tap appli fermée, il valait encore
 * ce que le web avait chiffré pour le cran précédent, et le solde du widget ne
 * bougeait plus. Avec le tableau, le natif indexe par son compte courant.
 */
function countGains(t: Task, rep: Replay): number[] {
  if (!t.counter) return []
  const paid = rep.perTask.get(t.id)?.countTiersPaid
  const { target, tiers } = t.counter
  return Array.from({ length: target }, (_, i) => {
    const step = i + 1
    const tier = tiers
      .filter((x) => x.at === step && !paid?.has(x.at))
      .reduce((sum, x) => sum + x.bonus, 0)
    return (step === target ? t.reward : 0) + tier
  })
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
  const day = dayNum(now, settings.dayStart)
  const live = tasks.filter((t) => !t.deletedAt && !t.archived)
  const { currency } = settings

  return {
    balance: fmt(rep.balance),
    balanceRaw: rep.balance,
    currency,
    budgetLabel: settings.budgetLabel,
    accent: settings.accent,
    dayStart: settings.dayStart,
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
        gains: countGains(t, rep),
        notifBase: notifId(t.id),
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
            // Un compteur : le gain dépend du cran, le natif le lit dans `tasks`.
            gain: 0,
            done,
            notifBase: notifId(t.id),
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
          notifBase: notifId(t.id),
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
  dueTsFor(t, rep.perTask.get(t.id)?.lastDoneTs ?? null, now) ?? now + 3.15e10

export async function pushWidgetState(p: WidgetPayload): Promise<void> {
  if (!isNative) return
  await Preferences.set({ key: 'balance', value: p.balance })
  await Preferences.set({ key: 'balanceRaw', value: String(p.balanceRaw) })
  await Preferences.set({ key: 'currency', value: p.currency })
  await Preferences.set({ key: 'budgetLabel', value: p.budgetLabel })
  await Preferences.set({ key: 'accent', value: p.accent })
  await Preferences.set({ key: 'dayStart', value: String(p.dayStart) })
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
  const live = tasks.filter((t) => !t.deletedAt && !t.archived)

  // `isAvailable` partout : une tâche déjà faite n'a plus rien à rappeler, ni
  // son échéance ni son rappel. Sans ce filtre, valider une tâche — dans
  // l'appli comme depuis un widget — laissait la notification partir quand même.
  const deadlines = live
    .filter((t) => t.due && isAvailable(t, rep.perTask.get(t.id), now))
    .map((t) => ({ t, at: dueTsFor(t, rep.perTask.get(t.id)?.lastDoneTs ?? null, now) }))
    .filter((x): x is { t: Task; at: number } => x.at !== null && x.at > now)
    .map(({ t, at }) => ({
      id: notifId(t.id),
      title: t.name,
      body: `Échéance maintenant — ${fmt(t.reward)} ${currency} en jeu`,
      at,
    }))

  // Rappels : rien pour une tâche déjà faite, on la reprogramme au prochain cycle.
  const reminders = live
    .filter((t) => t.remind && isAvailable(t, rep.perTask.get(t.id), now))
    .map((t) => ({ t, at: remindAt(t, rep, now) }))
    .filter((x): x is { t: Task; at: number } => x.at !== null && x.at > now)
    .map(({ t, at }) => ({
      // Décalé pour ne pas écraser la notification d'échéance de la même tâche.
      id: notifId(t.id) + 1,
      title: t.name,
      body: t.counter
        ? `Objectif du jour : ${t.counter.target} ${t.counter.unit ?? ''}`.trim()
        : `À faire — ${fmt(previewReward(t, rep.perTask.get(t.id), now))} ${currency}`,
      at,
    }))

  // Encouragements : uniquement quand il y a quelque chose à dire.
  const cheers = live
    .filter((t) => t.cheer && t.streak && isAvailable(t, rep.perTask.get(t.id), now))
    .map((t) => ({ t, body: cheerFor(t, rep.perTask.get(t.id)) }))
    .filter((x): x is { t: Task; body: string } => x.body !== null)
    .map(({ t, body }) => ({
      id: notifId(t.id) + 2,
      title: t.name,
      body,
      at: nextTimeToday(t.remind && !('kind' in t.remind && t.remind.kind === 'before') ? t.remind.time : '19:00', now),
    }))

  return [...deadlines, ...reminders, ...cheers]
    .sort((a, b) => a.at - b.at)
    // Android plafonne les alarmes programmées ; les plus proches suffisent.
    .slice(0, 32)
}

/**
 * Le message d'encouragement du jour, ou `null` s'il n'y a rien à dire.
 *
 * Trois cas seulement : un palier tout proche, une série qu'on vient de perdre,
 * un record en vue. Le reste du temps on se tait — un encouragement quotidien
 * sans contenu devient du bruit qu'on finit par désactiver.
 */
function cheerFor(t: Task, s: TaskState | undefined): string | null {
  const streak = s?.streak ?? 0

  if (streak === 0 && (s?.brokenStreak ?? 0) > 1) {
    return `Série de ${s!.brokenStreak} perdue. On repart d’ici ce soir ?`
  }

  const next = (t.streak?.tiers ?? [])
    .filter((x) => x.at > streak)
    .sort((a, b) => a.at - b.at)[0]
  if (next && next.at - streak <= 2) {
    const reste = next.at - streak
    return `${streak} d’affilée. Encore ${reste} et le palier tombe : +${fmt(next.bonus)}.`
  }

  if (streak > 0 && streak + 1 > (s?.bestStreak ?? 0)) {
    return `${streak} d’affilée — une de plus et c’est ton record.`
  }

  return null
}

/**
 * Quand sonner le rappel d'une tâche.
 *
 * « x avant l'échéance » n'a de sens que s'il y a une échéance, et seulement si
 * ce moment est encore devant nous : un rappel calé sur une échéance déjà
 * dépassée n'aurait jamais lieu.
 */
function remindAt(t: Task, rep: Replay, now: number): number | null {
  const r = t.remind!
  if ('kind' in r && r.kind === 'before') {
    const due = dueTsFor(t, rep.perTask.get(t.id)?.lastDoneTs ?? null, now)
    if (due === null) return null
    return due - r.minutes * 60_000
  }
  return nextTimeToday((r as { time: string }).time, now)
}

/** Prochaine occurrence de « HH:MM » : aujourd'hui si l'heure est à venir, sinon demain. */
function nextTimeToday(time: string, now: number): number {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h || 0, m || 0, 0, 0)
  if (+d <= now) d.setDate(d.getDate() + 1)
  return +d
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
