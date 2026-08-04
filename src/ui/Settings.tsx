import { useRef, useState } from 'react'
import { exportBackup, parseBackup } from '../backup'
import { fakeStreak, isDebugEvent, now as clock, setTimeOffset, timeOffset, undoDebugEvents } from '../debug'
import { DAY } from '../engine'
import { addEvent, replaceAll, setSettings, uid, update, useDB } from '../store'
import NumberInput from './NumberInput'
import { useCloseOnBack } from './useCloseOnBack'

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
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  const [taps, setTaps] = useState(0)
  const atelier = taps >= 7
  const fichier = useRef<HTMLInputElement>(null)

  const sauvegarder = async () => {
    try {
      const nom = await exportBackup(db)
      setMessage({ ok: true, texte: `Sauvegarde créée dans Documents : ${nom}` })
    } catch (e) {
      setMessage({ ok: false, texte: `Échec de la sauvegarde : ${(e as Error).message}` })
    }
  }

  const restaurer = async (f: File) => {
    try {
      const db = parseBackup(await f.text())
      // Remplacement complet : mélanger deux bases ferait doublonner le journal
      // et donc le solde. Une restauration remet l'appareil dans un état connu.
      replaceAll(db)
      setMessage({ ok: true, texte: `Restauré : ${db.tasks.length} tâches, ${db.events.length} événements.` })
    } catch (e) {
      setMessage({ ok: false, texte: (e as Error).message })
    }
  }

  useCloseOnBack(true, onClose)

  const applyAdjust = () => {
    const amount = +adjust.replace(',', '.')
    if (!amount) return
    addEvent({ id: uid(), ts: clock(), kind: 'adjust', amount, label: 'Correction manuelle' })
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
          <h2 className="card__title">Sauvegarde</h2>
          <p className="hint">
            Tâches, boutique, historique et réglages dans un seul fichier. Le solde
            n’y est pas : il se recalcule du journal.
          </p>
          <div className="row">
            <button className="btn btn--go" onClick={sauvegarder}>
              Sauvegarder
            </button>
            <button className="btn" onClick={() => fichier.current?.click()}>
              Restaurer…
            </button>
          </div>
          <input
            ref={fichier}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void restaurer(f)
            }}
          />
          {message && (
            <p className={message.ok ? 'hint hint--ok' : 'hint hint--bad'}>{message.texte}</p>
          )}
          <p className="hint">
            Restaurer <strong>remplace</strong> tout ce qui est sur cet appareil.
          </p>
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

        {atelier && <Atelier />}

        <footer className="about">
          <a className="link" href="https://github.com/Chachigo/butineur" target="_blank" rel="noreferrer">
            Butineur sur GitHub
          </a>
          {/* Sept tapes sur la version : l'atelier de debug n'a pas à s'afficher tout seul. */}
          <button className="about__version" onClick={() => setTaps((n) => n + 1)}>
            version {__VERSION__}
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * Atelier de debug : voyager dans le temps et fabriquer des séries, pour
 * vérifier en dix secondes ce qui demanderait des jours. Tout ce qu'il ajoute
 * au journal est repris par un `undo`, jamais effacé.
 */
function Atelier() {
  const db = useDB()
  const [taskId, setTaskId] = useState('')
  const [n, setN] = useState(5)

  const repetitives = db.tasks.filter((t) => !t.deletedAt && t.repeat)
  const cible = repetitives.find((t) => t.id === taskId) ?? repetitives[0]
  const faux = db.events.filter((e) => isDebugEvent(e.id)).length

  const decaler = (ms: number) => setTimeOffset(timeOffset() + ms)

  return (
    <section className="card">
      <h2 className="card__title">Atelier</h2>

      <p className="hint">
        Décalage d’horloge — l’appli croit qu’on est plus tard, tout le reste en
        découle.
      </p>
      <div className="row">
        <button className="btn" onClick={() => decaler(3_600_000)}>
          +1 h
        </button>
        <button className="btn" onClick={() => decaler(DAY)}>
          +1 j
        </button>
        <button className="btn" onClick={() => decaler(7 * DAY)}>
          +7 j
        </button>
        <button className="btn" onClick={() => setTimeOffset(0)} disabled={!timeOffset()}>
          Présent
        </button>
      </div>

      {repetitives.length > 0 && (
        <>
          <p className="hint">Fabriquer une série sur une tâche répétitive.</p>
          <div className="row">
            <select
              className="input input--select"
              value={cible?.id ?? ''}
              onChange={(e) => setTaskId(e.target.value)}
              aria-label="Tâche à simuler"
            >
              {repetitives.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <NumberInput
              className="input input--xs"
              value={n}
              min={1}
              max={60}
              onChange={setN}
              aria-label="Longueur de la série"
            />
            <button
              className="btn btn--go"
              onClick={() =>
                cible &&
                update((d) => ({ ...d, events: [...d.events, ...fakeStreak(cible, n)] }))
              }
            >
              Simuler
            </button>
          </div>
        </>
      )}

      <div className="row">
        <span className="row__label">{faux} événement(s) fabriqué(s)</span>
        <button
          className="btn btn--danger"
          disabled={!faux}
          onClick={() => update((d) => ({ ...d, events: [...d.events, ...undoDebugEvents(d.events)] }))}
        >
          Tout retirer
        </button>
      </div>
    </section>
  )
}
