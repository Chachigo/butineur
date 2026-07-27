import { DAY, dayNum } from './engine'

/** Montants arrondis au dixième — les multiplicateurs produisent des décimales. */
export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')
}

export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))

const dt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const dtTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const formatDate = (ts: number) => dt.format(ts)
export const formatDateTime = (ts: number) => dtTime.format(ts)

/** « aujourd'hui », « demain », « il y a 3 j » — pour les échéances. */
export function relativeDay(ts: number, now = Date.now()): string {
  const d = dayNum(ts) - dayNum(now)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'demain'
  if (d === -1) return 'hier'
  if (d < 0) return `en retard de ${-d} j`
  if (d <= 7) return `dans ${d} j`
  return `le ${formatDate(ts)}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * `<input type="date">` ouvre un vrai calendrier sur Android, là où
 * `datetime-local` n'affichait que des sélecteurs à molette. On sépare donc
 * le jour et l'heure en deux champs natifs.
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

/** Recompose un ISO local. Sans heure, l'échéance tombe en fin de journée. */
export function combineDateTime(date: string, time: string): string | null {
  if (!date) return null
  const d = new Date(`${date}T${time || '23:59'}`)
  return Number.isNaN(+d) ? null : d.toISOString()
}

/** Demain, fin de journée — une échéance à minuit pile serait un piège. */
export function defaultDue(): string {
  const d = new Date(Date.now() + DAY)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}
