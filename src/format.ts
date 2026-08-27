import { DAY, dayNum, rythme } from './engine'
import type { Task } from './types'

/**
 * Amounts to the cent — multipliers produce decimals, and rounding to a tenth
 * flattened real differences to the same figure. A round amount stays written
 * round: "10 €", not "10,00 €".
 */
export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',')
}

export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))

const dt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const dtTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const dtDue = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatDate = (ts: number) => dt.format(ts)
export const formatDateTime = (ts: number) => dtTime.format(ts)
/** "dimanche 2 août à 20:00" — the deadline spelled out, in the editor. */
export const formatDueLong = (ts: number) => dtDue.format(ts)

/**
 * "today", "tomorrow", "3 d ago" — for deadlines.
 *
 * `dayStart` included: with a day starting at 1 am, a deadline of 11:59 pm read
 * at 0:30 am still belongs to today. Without it, it flipped to "yesterday" on
 * the stroke of midnight while the day was not over.
 */
export function relativeDay(ts: number, now = Date.now(), dayStart = 0): string {
  const d = dayNum(ts, dayStart) - dayNum(now, dayStart)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'demain'
  if (d === -1) return 'hier'
  if (d < 0) return `en retard de ${-d} j`
  if (d <= 7) return `dans ${d} j`
  return `le ${formatDate(ts)}`
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** The rhythm spelled out — the list badge says the same thing as the editor. */
export function rythmeLabel(repeat: NonNullable<Task['repeat']>): string {
  switch (rythme(repeat)) {
    case 'jour':
      return 'chaque jour'
    case 'semaine':
      return `chaque ${JOURS[repeat.weekday! % 7]}`
    case 'mois':
      return `le ${repeat.monthday} du mois`
    case 'glissant':
      return `tous les ${repeat.everyDays} j`
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * `<input type="date">` opens a real calendar on Android, where
 * `datetime-local` only showed spinners. So the day and the time are split into
 * two native fields.
 */
export function toDateInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toTimeInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Rebuilds a local ISO string. Without a time, the deadline lands at end of day. */
export function combineDateTime(date: string, time: string): string | null {
  if (!date) return null
  const d = new Date(`${date}T${time || '23:59'}`)
  return Number.isNaN(+d) ? null : d.toISOString()
}

/** Tomorrow, end of day — a deadline at midnight sharp would be a trap. */
export function defaultDue(): string {
  const d = new Date(Date.now() + DAY)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}
