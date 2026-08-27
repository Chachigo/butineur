import { useEffect, useRef, useState } from 'react'
import { exportBackup, parseBackup } from '../backup'
import { pinWidget } from '../native'
import {
  atelierOuvert,
  fakeStreak,
  now as clock,
  setAtelierOuvert,
  setTimeOffset,
  timeOffset,
  undoDebugEvents,
} from '../debug'
import { DAY } from '../engine'
import { langSetting, rich, setLang, tr, type Key, type Lang } from '../i18n'
import { addEvent, quitterAtelier, replaceAll, setSettings, uid, update, useDB } from '../store'
import NumberInput from './NumberInput'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * GitHub issue link with the app version and the phone version already filled
 * in: nobody thinks of giving them, and without them a bug is not reproducible.
 * The link opens the `bug.yml` template, which demands the rest.
 */
const lienBug = () => {
  const appareil = navigator.userAgent.match(/Android [\d.]+(; [^;)]+?)?(?= Build|\))/)?.[0] ?? ''
  const q = new URLSearchParams({
    template: 'bug.yml',
    version: __VERSION__,
    android: appareil.replace('; ', ', '),
  })
  return `https://github.com/Chachigo/butineur/issues/new?${q}`
}

const pad = (n: number) => String(n).padStart(2, '0')
const minutesToTime = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return ((h || 0) * 60 + (m || 0)) % 1440
}

/** Hues readable on the dark background, contrast checked by eye. */
const ACCENTS: [string, Key][] = [
  ['#4ade80', 'color.green'],
  ['#38bdf8', 'color.blue'],
  ['#a78bfa', 'color.purple'],
  ['#f472b6', 'color.pink'],
  ['#fb923c', 'color.orange'],
  ['#facc15', 'color.yellow'],
  ['#2dd4bf', 'color.teal'],
  ['#f87171', 'color.red'],
]

/**
 * Each language is named in itself: someone who landed in the wrong one has to
 * be able to find their way back out.
 */
const LANG_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English' }

export default function Settings({ onClose, onTuto }: { onClose: () => void; onTuto: () => void }) {
  const db = useDB()
  const [adjust, setAdjust] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  const [taps, setTaps] = useState(0)
  const [atelier, setAtelier] = useState(atelierOuvert)
  useEffect(() => {
    if (taps >= 7 && !atelier) {
      setAtelier(true)
      setAtelierOuvert(true)
    }
  }, [taps, atelier])
  const fermer = () => {
    setTaps(0)
    setAtelier(false)
    setAtelierOuvert(false)
  }
  const fichier = useRef<HTMLInputElement>(null)

  const sauvegarder = async () => {
    try {
      const nom = await exportBackup(db)
      setMessage({ ok: true, texte: tr('set.saved', { name: nom }) })
    } catch (e) {
      setMessage({ ok: false, texte: tr('set.saveFailed', { error: (e as Error).message }) })
    }
  }

  const restaurer = async (f: File) => {
    try {
      const db = parseBackup(await f.text())
      // Full replacement: mixing two databases would duplicate the log and
      // therefore the balance. A restore puts the device in a known state.
      replaceAll(db)
      setMessage({ ok: true, texte: tr('set.restored', { tasks: db.tasks.length, events: db.events.length }) })
    } catch (e) {
      setMessage({ ok: false, texte: (e as Error).message })
    }
  }

  useCloseOnBack(true, onClose)

  const applyAdjust = () => {
    const amount = +adjust.replace(',', '.')
    if (!amount) return
    addEvent({ id: uid(), ts: clock(), kind: 'adjust', amount, label: tr('set.fixLabel') })
    setAdjust('')
  }

  return (
    <div className="page">
      <header className="page__head">
        <button className="page__back" onClick={onClose} aria-label={tr('set.back')}>
          ←
        </button>
        <h1>{tr('set.title')}</h1>
      </header>

      <div className="page__body">
        <section className="card">
          <h2 className="card__title">{tr('set.budget')}</h2>

          <label className="field">
            <span className="field__label">{tr('set.budgetName')}</span>
            <input
              className="input"
              value={db.settings.budgetLabel}
              onChange={(e) => setSettings({ budgetLabel: e.target.value.slice(0, 24) })}
              placeholder={tr('set.budgetHint')}
            />
          </label>

          <div className="row">
            <span className="row__label">{tr('set.symbol')}</span>
            <input
              className="input input--xs"
              value={db.settings.currency}
              onChange={(e) => setSettings({ currency: e.target.value.slice(0, 3) })}
              aria-label={tr('set.symbolLabel')}
            />
          </div>

          <div className="row">
            <span className="row__label">{tr('set.dayStart')}</span>
            <input
              className="input input--time"
              type="time"
              value={minutesToTime(db.settings.dayStart)}
              onChange={(e) => e.target.value && setSettings({ dayStart: timeToMinutes(e.target.value) })}
              aria-label={tr('set.dayStartLabel')}
            />
          </div>
          <p className="hint">{tr('set.dayStartHint')}</p>

          <div className="row">
            <span className="row__label">{tr('set.defaultReward')}</span>
            <NumberInput
              className="input input--xs"
              value={db.settings.defaultReward}
              min={0}
              onChange={(defaultReward) => setSettings({ defaultReward })}
              aria-label={tr('set.defaultReward')}
            />
            <span className="field__suffix">{db.settings.currency}</span>
          </div>
          <p className="hint">{tr('set.defaultRewardHint')}</p>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.backup')}</h2>
          <p className="hint">{tr('set.backupHint')}</p>
          <div className="row">
            <button className="btn btn--go" onClick={sauvegarder}>
              {tr('set.save')}
            </button>
            <button className="btn" onClick={() => fichier.current?.click()}>
              {tr('set.restore')}
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
          <p className="hint">{rich(tr('set.restoreHint'))}</p>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.stats')}</h2>
          <label className="row row--check">
            <input
              type="checkbox"
              checked={db.settings.showStats}
              onChange={(e) => setSettings({ showStats: e.target.checked })}
            />
            <span className="row__label">{tr('set.showStats')}</span>
          </label>
          <div className="row">
            <span className="row__label">{tr('set.weekStart')}</span>
            <button
              className={`btn${db.settings.weekStart === 1 ? ' btn--go' : ''}`}
              onClick={() => setSettings({ weekStart: 1 })}
            >
              {tr('set.monday')}
            </button>
            <button
              className={`btn${db.settings.weekStart === 0 ? ' btn--go' : ''}`}
              onClick={() => setSettings({ weekStart: 0 })}
            >
              {tr('set.sunday')}
            </button>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.home')}</h2>
          <p className="hint">{tr('set.homeHint')}</p>
          <div className="row">
            {(['solde', 'compteur', 'liste'] as const).map((k) => (
              <button
                key={k}
                className="btn"
                onClick={async () =>
                  setMessage(
                    (await pinWidget(k))
                      ? { ok: true, texte: tr('set.pinOk') }
                      : { ok: false, texte: tr('set.pinKo') },
                  )
                }
              >
                {tr(`set.widget.${k}`)}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.language')}</h2>
          <div className="row">
            {(['system', 'fr', 'en'] as const).map((l) => (
              <button
                key={l}
                className={`btn${langSetting() === l ? ' btn--go' : ''}`}
                onClick={() => void setLang(l as Lang | 'system')}
              >
                {l === 'system' ? tr('set.system') : LANG_NAMES[l]}
              </button>
            ))}
          </div>
          <p className="hint">{tr('set.languageHint')}</p>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.look')}</h2>
          <p className="hint">{tr('set.accentHint')}</p>
          <div className="swatches">
            {ACCENTS.map(([hex, name]) => (
              <button
                key={hex}
                className={`swatch${db.settings.accent === hex ? ' swatch--on' : ''}`}
                style={{ background: hex }}
                onClick={() => setSettings({ accent: hex })}
                aria-label={tr(name)}
                title={tr(name)}
              />
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">{tr('set.spending')}</h2>
          <label className="row row--check">
            <input
              type="checkbox"
              checked={db.settings.allowNegative}
              onChange={(e) => setSettings({ allowNegative: e.target.checked })}
            />
            <span className="row__label">{tr('set.allowNegative')}</span>
          </label>
          <p className="hint">{tr('set.allowNegativeHint')}</p>

          <div className="row">
            <span className="row__label">{tr('set.fixBalance')}</span>
            <input
              className="input input--xs"
              inputMode="decimal"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              placeholder="+10"
              aria-label={tr('set.fixBalanceLabel')}
            />
            <button className="btn" onClick={applyAdjust} disabled={!+adjust.replace(',', '.')}>
              {tr('set.apply')}
            </button>
          </div>
          <p className="hint">{tr('set.fixHint')}</p>
        </section>

        {atelier && <Atelier onClose={fermer} />}

        <section className="card">
          <h2 className="card__title">{tr('set.help')}</h2>
          <button
            className="btn"
            onClick={() => {
              onClose()
              onTuto()
            }}
          >
            {tr('set.replayTuto')}
          </button>
          <a className="btn" href={lienBug()} target="_blank" rel="noreferrer">
            {tr('set.reportBug')}
          </a>
        </section>

        <footer className="about">
          <a className="link" href="https://github.com/Chachigo/butineur" target="_blank" rel="noreferrer">
            {tr('set.github')}
          </a>
          {/* Seven taps on the version: the debug workshop has no business showing up on its own. */}
          <button className="about__version" onClick={() => setTaps((n) => n + 1)}>
            {tr('set.version', { v: __VERSION__ })}
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * Debug workshop: travel in time and manufacture streaks, to check in ten
 * seconds what would otherwise take days. Everything it adds to the log is taken
 * back by an `undo`, never erased.
 */
function Atelier({ onClose }: { onClose: () => void }) {
  const db = useDB()
  const [taskId, setTaskId] = useState('')
  const [n, setN] = useState(5)

  const repetitives = db.tasks.filter((t) => !t.deletedAt && t.repeat)
  const cible = repetitives.find((t) => t.id === taskId) ?? repetitives[0]
  const faux = undoDebugEvents(db.events).length

  const decaler = (ms: number) => setTimeOffset(timeOffset() + ms)

  return (
    <section className="card">
      <div className="row">
        <h2 className="card__title">{tr('wk.title')}</h2>
        {/* Once seen, one has to be able to close it without restarting the app. */}
        <button className="link" onClick={onClose}>
          {tr('wk.hide')}
        </button>
      </div>

      <p className="hint">{tr('wk.clockHint')}</p>
      <div className="row">
        <button className="btn" onClick={() => decaler(3_600_000)}>
          {tr('wk.hour')}
        </button>
        <button className="btn" onClick={() => decaler(DAY)}>
          {tr('wk.day')}
        </button>
        <button className="btn" onClick={() => decaler(7 * DAY)}>
          {tr('wk.week')}
        </button>
        <button className="btn" onClick={() => void quitterAtelier()} disabled={!timeOffset()}>
          {tr('wk.now')}
        </button>
      </div>

      {repetitives.length > 0 && (
        <>
          <p className="hint">{tr('wk.streakHint')}</p>
          <div className="row">
            <select
              className="input input--select"
              value={cible?.id ?? ''}
              onChange={(e) => setTaskId(e.target.value)}
              aria-label={tr('wk.pickTask')}
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
              aria-label={tr('wk.streakLength')}
            />
            <button
              className="btn btn--go"
              onClick={() =>
                cible &&
                update((d) => ({ ...d, events: [...d.events, ...fakeStreak(cible, n)] }))
              }
            >
              {tr('wk.simulate')}
            </button>
          </div>
        </>
      )}

      <p className="hint">{tr('wk.undoHint')}</p>
      <div className="row">
        <span className="row__label">{tr('wk.fake', { n: faux })}</span>
        <button
          className="btn btn--danger"
          disabled={!faux}
          onClick={() => update((d) => ({ ...d, events: [...d.events, ...undoDebugEvents(d.events)] }))}
        >
          {tr('wk.undoAll')}
        </button>
      </div>
    </section>
  )
}
