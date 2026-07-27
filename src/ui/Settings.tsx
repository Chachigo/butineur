import { useState } from 'react'
import { addEvent, setSettings, uid, useDB } from '../store'
import NumberInput from './NumberInput'

export default function Settings({ onClose }: { onClose: () => void }) {
  const db = useDB()
  const [adjust, setAdjust] = useState('')

  const applyAdjust = () => {
    const amount = +adjust.replace(',', '.')
    if (!amount) return
    addEvent({ id: uid(), ts: Date.now(), kind: 'adjust', amount, label: 'Correction manuelle' })
    setAdjust('')
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>Réglages</h2>
          <button className="sheet__x" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <div className="row">
            <span className="row__label">Symbole du budget</span>
            <input
              className="input input--xs"
              value={db.settings.currency}
              onChange={(e) => setSettings({ currency: e.target.value.slice(0, 3) })}
              aria-label="Symbole du budget"
            />
          </div>

          <div className="row">
            <span className="row__label">Récompense par défaut</span>
            <NumberInput
              className="input input--xs"
              value={db.settings.defaultReward}
              min={0}
              onChange={(defaultReward) => setSettings({ defaultReward })}
              aria-label="Récompense par défaut"
            />
            <span className="field__suffix">{db.settings.currency}</span>
          </div>
          <p className="hint">Pré-remplie à la création d’une nouvelle tâche.</p>

          <label className="sect sect__head">
            <input
              type="checkbox"
              checked={db.settings.allowNegative}
              onChange={(e) => setSettings({ allowNegative: e.target.checked })}
            />
            <span className="sect__title">Autoriser le solde négatif</span>
          </label>
          <p className="hint">
            Désactivé, une dépense plus grande que le solde est refusée. Les corrections
            manuelles ci-dessous restent toujours possibles.
          </p>

          <div className="row">
            <span className="row__label">Corriger le solde</span>
            <input
              className="input input--xs"
              inputMode="decimal"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              placeholder="+10"
              aria-label="Correction du solde"
            />
            <button className="btn" onClick={applyAdjust} disabled={!+adjust.replace(',', '.')}>
              Appliquer
            </button>
          </div>
          <p className="hint">
            La correction est enregistrée dans l’historique — le solde reste toujours la
            somme du journal.
          </p>
        </div>
      </div>
    </div>
  )
}
