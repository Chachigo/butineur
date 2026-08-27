import { useState } from 'react'
import { now as clock } from '../debug'
import { decimalInput, fmt, formatDateTime, signed } from '../format'
import { tr } from '../i18n'
import { addEvent, uid, useDB } from '../store'
import type { LedgerEntry } from '../types'
import { useCloseOnBack } from './useCloseOnBack'

/** The breakdown is visible: every amount has to be explainable. */
export default function History({ entries, currency }: { entries: LedgerEntry[]; currency: string }) {
  const events = useDB().events
  const [corrige, setCorrige] = useState<LedgerEntry | null>(null)

  if (entries.length === 0) return <p className="empty">{tr('history.empty')}</p>

  /**
   * Only a free-form spending can be corrected: a catalogue purchase is redone
   * by changing the item, and a task payout is replayed from the task.
   */
  const libre = (e: LedgerEntry) => {
    const src = events.find((x) => x.id === e.eventId)
    return e.kind === 'spend' && src?.kind === 'spend' && !src.shopItemId
  }

  return (
    <>
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
              {e.base > 0 && <span className="chip">{tr('history.base', { n: fmt(e.base) })}</span>}
              {e.penalty < 0 && <span className="chip chip--neg">{tr('history.late', { n: fmt(e.penalty) })}</span>}
              {e.multiplierBonus > 0.05 && (
                <span className="chip chip--bonus">{tr('history.streak', { n: fmt(e.multiplierBonus) })}</span>
              )}
              {e.tierBonus > 0 && <span className="chip chip--bonus">{tr('history.tier', { n: fmt(e.tierBonus) })}</span>}
              {libre(e) && (
                <button className="entry__edit" onClick={() => setCorrige(e)} aria-label={tr('common.edit')}>
                  ✏️
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {corrige && <CorrigerDepense entry={corrige} currency={currency} onClose={() => setCorrige(null)} />}
    </>
  )
}

/**
 * Correcting a spending does not write into the past: the event is undone and a
 * fresh one is laid down, at the same date. The faulty line disappears from the
 * history instead of being doubled — same mechanics as undoing a completion.
 */
function CorrigerDepense({
  entry,
  currency,
  onClose,
}: {
  entry: LedgerEntry
  currency: string
  onClose: () => void
}) {
  const [label, setLabel] = useState(entry.label)
  const [montant, setMontant] = useState(decimalInput(Math.abs(entry.total)))
  useCloseOnBack(true, onClose)

  const valeur = +montant.replace(',', '.')

  const enregistrer = () => {
    if (!(valeur > 0)) return
    addEvent({ id: uid(), ts: clock(), kind: 'undo', targetId: entry.eventId })
    addEvent({
      id: uid(),
      // The original date: it is the same spending, corrected.
      ts: entry.ts,
      kind: 'spend',
      amount: valeur,
      label: label.trim() || tr('history.defaultLabel'),
    })
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>{tr('history.fix')}</h2>
          <button className="sheet__x" onClick={onClose} aria-label={tr('common.close')}>
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <label className="field">
            <span className="field__label">{tr('history.what')}</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label={tr('history.label')}
            />
          </label>

          <label className="field">
            <span className="field__label">{tr('history.amount')}</span>
            <span className="field__row">
              <input
                className="input input--sm"
                inputMode="decimal"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                aria-label={tr('history.amount')}
              />
              <span className="field__suffix">{currency}</span>
            </span>
          </label>
        </div>

        <footer className="sheet__foot">
          <button className="btn" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button className="btn btn--go" onClick={enregistrer} disabled={!(valeur > 0)}>
            {tr('common.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
