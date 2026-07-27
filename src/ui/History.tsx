import { fmt, formatDateTime, signed } from '../format'
import type { LedgerEntry } from '../types'

/** Le détail du calcul est visible : on doit pouvoir expliquer chaque montant. */
export default function History({ entries, currency }: { entries: LedgerEntry[]; currency: string }) {
  if (entries.length === 0) return <p className="empty">Rien ne s’est encore passé.</p>

  return (
    <ul className="list list--history">
      {entries.map((e) => (
        <li key={e.eventId} className="entry">
          <div className="entry__main">
            <span className="entry__label">{e.label}</span>
            <span className={`entry__total${e.total < 0 ? ' entry__total--neg' : ''}`}>
              {e.total === 0 ? '—' : `${signed(e.total)} ${currency}`}
            </span>
          </div>
          <div className="entry__meta">
            <span>{formatDateTime(e.ts)}</span>
            {e.base > 0 && <span className="chip">base {fmt(e.base)}</span>}
            {e.penalty < 0 && <span className="chip chip--neg">retard {fmt(e.penalty)}</span>}
            {e.multiplierBonus > 0.05 && <span className="chip chip--bonus">série +{fmt(e.multiplierBonus)}</span>}
            {e.tierBonus > 0 && <span className="chip chip--bonus">palier +{fmt(e.tierBonus)}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
