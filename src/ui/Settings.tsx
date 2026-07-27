import { useState } from 'react'
import { addEvent, setSettings, uid, useDB } from '../store'
import NumberInput from './NumberInput'

const pad = (n: number) => String(n).padStart(2, '0')
const minutesToTime = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return ((h || 0) * 60 + (m || 0)) % 1440
}

/** Teintes lisibles sur le fond sombre, contraste vérifié à l'œil. */
const ACCENTS = [
  ['#4ade80', 'Vert'],
  ['#38bdf8', 'Bleu'],
  ['#a78bfa', 'Violet'],
  ['#f472b6', 'Rose'],
  ['#fb923c', 'Orange'],
  ['#facc15', 'Jaune'],
  ['#2dd4bf', 'Turquoise'],
  ['#f87171', 'Rouge'],
]

export default function Settings({ onClose }: { onClose: () => void }) {
  const db = useDB()
  const [adjust, setAdjust] = useState('')

  const applyAdjust = () => {
    const amount = +adjust.replace(',', '.')
    if (!amount) return
    addEvent({ id: uid(), ts: Date.now(), kind: 'adjust', amount, label: 'Correction manuelle' })
    setAdjust('')
  }

  return (
    <div className="page">
      <header className="page__head">
        <button className="page__back" onClick={onClose} aria-label="Retour">
          ←
        </button>
        <h1>Réglages</h1>
      </header>

      <div className="page__body">
        <section className="card">
          <h2 className="card__title">Budget</h2>

          <label className="field">
            <span className="field__label">Nom du budget</span>
            <input
              className="input"
              value={db.settings.budgetLabel}
              onChange={(e) => setSettings({ budgetLabel: e.target.value.slice(0, 24) })}
              placeholder="budget loisirs"
            />
          </label>

          <div className="row">
            <span className="row__label">Symbole</span>
            <input
              className="input input--xs"
              value={db.settings.currency}
              onChange={(e) => setSettings({ currency: e.target.value.slice(0, 3) })}
              aria-label="Symbole du budget"
            />
          </div>

          <div className="row">
            <span className="row__label">Début de journée</span>
            <input
              className="input input--time"
              type="time"
              value={minutesToTime(db.settings.dayStart)}
              onChange={(e) => e.target.value && setSettings({ dayStart: timeToMinutes(e.target.value) })}
              aria-label="Heure de début de journée"
            />
          </div>
          <p className="hint">
            À 4 h 30, un compteur monté jusqu’à 4 h du matin compte encore pour la
            veille. Les dates limites, elles, ne bougent pas.
          </p>

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
        </section>

        <section className="card">
          <h2 className="card__title">Apparence</h2>
          <p className="hint">Couleur d’accentuation — appliquée aussi aux widgets.</p>
          <div className="swatches">
            {ACCENTS.map(([hex, name]) => (
              <button
                key={hex}
                className={`swatch${db.settings.accent === hex ? ' swatch--on' : ''}`}
                style={{ background: hex }}
                onClick={() => setSettings({ accent: hex })}
                aria-label={name}
                title={name}
              />
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Dépenses</h2>
          <label className="row row--check">
            <input
              type="checkbox"
              checked={db.settings.allowNegative}
              onChange={(e) => setSettings({ allowNegative: e.target.checked })}
            />
            <span className="row__label">Autoriser le solde négatif</span>
          </label>
          <p className="hint">
            Désactivé, une dépense plus grande que le solde est refusée. Les corrections
            ci-dessous restent toujours possibles.
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
            La correction apparaît dans l’historique — le solde reste toujours la somme
            du journal.
          </p>
        </section>
      </div>
    </div>
  )
}
