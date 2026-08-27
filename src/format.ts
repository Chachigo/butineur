import { DAY, dayNum, rythme } from './engine'
import { lang, tr } from './i18n'
import type { Task } from './types'

/**
 * Amounts to the cent — multipliers produce decimals, and rounding to a tenth
 * flattened real differences to the same figure. A round amount stays written
 * round: "10 €", not "10,00 €".
 */
const nf = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : nf.format(r)
}

export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))

const decimalSep = (1.1).toLocaleString(lang).charAt(1)

/** A number written as the local keyboard types it: comma or dot, per language. */
export const decimalInput = (n: number) => String(n).replace('.', decimalSep)

const dt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
const dtTime = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const dtDue = new Intl.DateTimeFormat(lang, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatDate = (ts: number) => dt.format(ts)
export const formatDateTime = (ts: number) => dtTime.format(ts)
/** "dimanche 2 août à 20:00" / "Sunday 2 August at 20:00" — in the editor. */
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
  if (d === 0) return tr('day.today')
  if (d === 1) return tr('day.tomorrow')
  if (d === -1) return tr('day.yesterday')
  if (d < 0) return tr('day.late', { n: -d })
  if (d <= 7) return tr('day.in', { n: d })
  return tr('day.on', { date: formatDate(ts) })
}

const weekday = new Intl.DateTimeFormat(lang, { weekday: 'long' })

/** Name of a weekday, `Date.getDay()` numbering. 4 Jan 1970 was a Sunday. */
export const weekdayName = (n: number) => weekday.format(new Date(1970, 0, 4 + (n % 7)))

/** The rhythm spelled out — the list badge says the same thing as the editor. */
export function rythmeLabel(repeat: NonNullable<Task['repeat']>): string {
  switch (rythme(repeat)) {
    case 'jour':
      return tr('rhythm.daily')
    case 'semaine':
      return tr('rhythm.weekly', { day: weekdayName(repeat.weekday!) })
    case 'mois':
      return tr('rhythm.monthly', { n: repeat.monthday! })
    case 'glissant':
      return tr('rhythm.rolling', { n: repeat.everyDays })
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
