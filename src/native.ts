import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { dayNum, dueTsFor, isAvailable, previewReward, upcomingDues, type Replay } from './engine'
import { fmt } from './format'
import type { Pending, Settings, Task, TaskState } from './types'
import { iconChar, isPhosphor } from './ui/Icon'

export const isNative = Capacitor.isNativePlatform()

interface WidgetBridgePlugin {
  refresh(): Promise<void>
  drainPending(): Promise<{ items: Pending[] }>
  requestPin(options: { kind: string }): Promise<{ asked: boolean }>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

// --- widgets ---

export type WidgetPayload = {
  balance: string
  /** Raw value: the native side adds pending taps to it for an immediate display. */
  balanceRaw: number
  currency: string
  budgetLabel: string
  accent: string
  /** Day rollover in minutes, so the native side counts like the engine. */
  dayStart: number
  tasks: {
    id: string
    name: string
    icon: string
    /** True when `icon` is a Phosphor glyph: the widget then applies its font. */
    iconPh: boolean
    count: number
    target: number
    unit: string
    day: number
    /** Base of the notification ids, so the widget can cancel them. */
    notifBase: number
    /**
     * What each step pays: `gains[i]` is the payout of the tap taking the count
     * from `i` to `i+1`. The widget indexes by its current count, and therefore
     * stays right across several consecutive taps with the app closed.
     */
    gains: number[]
  }[]
  /** Every live task, counters included — the widget list scrolls. */
  todo: {
    id: string
    name: string
    icon: string
    iconPh: boolean
    /** What the button does: increment, or complete. */
    kind: 'count' | 'complete'
    /** Button label, already formatted: "+10", "3/8", "✓". */
    label: string
    /**
     * What the next tap would pay. The widget adds it to the displayed balance
     * while waiting for the app to recompute for real — without it, completing a
     * task from the home screen moved nothing.
     */
    gain: number
    done: boolean
    /** Base des identifiants de notification, pour que le widget puisse les couper. */
    notifBase: number
  }[]
}

/**
 * Payout of every step of a counter, from the first one to the target.
 *
 * A single amount was not enough: after a tap with the app closed, it still held
 * what the web side had priced for the previous step, and the widget balance
 * stopped moving. With the array, the native side indexes by its current count.
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

/** The native side receives the character to draw, never an icon name to resolve. */
const icon = (raw: string | undefined) => ({
  icon: iconChar(raw ?? ''),
  iconPh: isPhosphor(raw ?? ''),
})

/** Strictly what the widgets need to know — no business rule. */
export function widgetPayload(
  rep: Replay,
  tasks: Task[],
  settings: Settings,
  now: number,
): WidgetPayload {
  const day = dayNum(now, settings.dayStart)
  const live = tasks.filter((t) => !t.deletedAt && !t.archived && !t.template)
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
            // A counter: the payout depends on the step, the native side reads it in `tasks`.
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
      // What is still to do first, most urgent on top; what is done at the bottom.
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1
        const ta = live.find((t) => t.id === a.id)!
        const tb = live.find((t) => t.id === b.id)!
        return due(ta, rep, now) - due(tb, rep, now)
      }),
  }
}

const due = (t: Task, rep: Replay, now: number) =>
  dueTsFor(t, rep.perTask.get(t.id), now) ?? now + 3.15e10

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

/**
 * Offers to pin a widget onto the home screen. Returns `false` when the launcher
 * cannot do it — many still cannot — so we can explain how to do it by hand
 * rather than leave a button that does nothing.
 */
export async function pinWidget(kind: 'compteur' | 'liste' | 'solde'): Promise<boolean> {
  if (!isNative) return false
  const { asked } = await WidgetBridge.requestPin({ kind })
  return asked
}

/** Taps made on a widget with the app closed, to be poured into the log. */
export async function drainPending(): Promise<Pending[]> {
  if (!isNative) return []
  const { items } = await WidgetBridge.drainPending()
  return Array.isArray(items) ? items : []
}

/**
 * The "+" of the list widget. It only writes a flag: the native side does not
 * open a creation screen itself, there is a single editor, the web one.
 */
export async function takeNewTaskRequest(): Promise<boolean> {
  if (!isNative) return false
  const { value } = await Preferences.get({ key: 'newTaskRequested' })
  if (!value) return false
  await Preferences.remove({ key: 'newTaskRequested' })
  return true
}

// --- deadline reminders ---

export type NotifSpec = { id: number; title: string; body: string; at: number }

/**
 * How many cycles ahead we schedule.
 *
 * Nothing runs in the background: a notification only exists if it was posted
 * while the app was open. Posting a single one meant a reminder stopped as soon
 * as it had fired, until the next launch. So we post several — the coverage
 * follows the task's rhythm, four days for a daily one, four months for a
 * monthly one.
 */
const CYCLES_AVANCE = 4

export function notificationSpecs(rep: Replay, tasks: Task[], now: number, currency: string): NotifSpec[] {
  const live = tasks.filter((t) => !t.deletedAt && !t.archived && !t.template)

  // `isAvailable` everywhere: a task already done has nothing left to remind
  // about, neither its deadline nor its reminder. Without that filter, completing
  // a task — in the app or from a widget — still let the notification fire.
  const deadlines = live
    .filter((t) => t.due && isAvailable(t, rep.perTask.get(t.id), now))
    .flatMap((t) =>
      upcomingDues(t, rep.perTask.get(t.id), now, 0, CYCLES_AVANCE)
        .filter((at) => at > now)
        .map((at, i) => ({
          id: notifId(t.id) + i * 3,
          title: t.name,
          body: `Échéance maintenant — ${fmt(t.reward)} ${currency} en jeu`,
          at,
        })),
    )

  // Reminders: nothing for a task already done, it is rescheduled on the next cycle.
  const reminders = live
    .filter((t) => t.remind && isAvailable(t, rep.perTask.get(t.id), now))
    .flatMap((t) =>
      remindTimes(t, rep, now)
        .filter((at) => at > now)
        .map((at, i) => ({
          // Offset so it does not overwrite the deadline notification of the same task.
          id: notifId(t.id) + i * 3 + 1,
          title: t.name,
          body: t.counter
            ? `Objectif du jour : ${t.counter.target} ${t.counter.unit ?? ''}`.trim()
            : `À faire — ${fmt(previewReward(t, rep.perTask.get(t.id), now))} ${currency}`,
          at,
        })),
    )

  // Cheers: only when there is something to say.
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
    // Android caps scheduled alarms; the nearest ones are enough.
    .slice(0, 32)
}

/**
 * Today's cheer message, or `null` when there is nothing to say.
 *
 * Three cases only: a tier within reach, a streak just lost, a record in sight.
 * The rest of the time we keep quiet — a daily cheer with no content turns into
 * noise one ends up switching off.
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
 * When to fire a task's reminder, over the next cycles.
 *
 * "x before the deadline" and "on the day" only make sense when there is a
 * deadline: without one, there is nothing to hang them on. The fixed-time
 * reminder does not depend on the rhythm — it is simply the next few days.
 */
function remindTimes(t: Task, rep: Replay, now: number): number[] {
  const r = t.remind!
  const dues = () => upcomingDues(t, rep.perTask.get(t.id), now, 0, CYCLES_AVANCE)

  if ('kind' in r && r.kind === 'before') {
    return dues().map((due) => due - r.minutes * 60_000)
  }
  if ('kind' in r && r.kind === 'jour') {
    // On the day of the deadline at the given time — not on days without a
    // deadline, which is what sets it apart from the daily reminder.
    const [h, m] = r.time.split(':').map(Number)
    return dues().map((due) => {
      const d = new Date(due)
      d.setHours(h || 0, m || 0, 0, 0)
      return +d
    })
  }

  const premier = nextTimeToday((r as { time: string }).time, now)
  return Array.from({ length: CYCLES_AVANCE }, (_, i) => {
    const d = new Date(premier)
    d.setDate(d.getDate() + i)
    return +d
  })
}

/** Next occurrence of "HH:MM": today if the time is still ahead, tomorrow otherwise. */
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
      // `allowWhileIdle`, otherwise the plugin posts a `set(RTC)`: neither exact
      // nor waking, hence pushed back by Doze until the phone is picked up. That
      // is what made reminders arrive late, or not at all. With it, and with
      // USE_EXACT_ALARM in the manifest, it posts a
      // `setExactAndAllowWhileIdle(RTC_WAKEUP)`.
      schedule: { at: new Date(s.at), allowWhileIdle: true },
    })),
  })
}

/** The API only takes an integer; a stable one is derived from the uuid. */
function notifId(taskId: string): number {
  let h = 0
  for (let i = 0; i < taskId.length; i++) h = (h * 31 + taskId.charCodeAt(i)) | 0
  return Math.abs(h) % 2_000_000_000
}
