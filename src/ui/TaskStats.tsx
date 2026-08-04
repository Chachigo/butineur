import { dayNum, dueTsFor, rewardAtStreak, type Replay } from '../engine'
import { fmt, formatDueLong, rythmeLabel } from '../format'
import type { Task } from '../types'
import Icon from './Icon'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * La fiche d'une tâche qui revient : où en est la série, ce que rapporte le
 * prochain palier, quand tombe l'échéance. Tout vient du rejeu — c'est de
 * l'affichage, aucun calcul n'est refait ici.
 */
export default function TaskStats({
  task,
  rep,
  now,
  currency,
  dayStart,
  onEdit,
  onClose,
}: {
  task: Task
  rep: Replay
  now: number
  currency: string
  dayStart: number
  onEdit: () => void
  onClose: () => void
}) {
  const s = rep.perTask.get(task.id)
  useCloseOnBack(true, onClose)

  const streak = s?.streak ?? 0
  const due = dueTsFor(task, s, now, dayStart)
  const paliers = (task.streak?.tiers ?? []).filter((t) => t.at > streak).sort((a, b) => a.at - b.at)
  const prochain = paliers[0]

  const lignes = rep.entries.filter((e) => e.taskId === task.id)
  const gagne = lignes.reduce((sum, e) => sum + e.total, 0)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <Icon className="task__icon" icon={task.icon ?? ''} fallback={task.counter ? '🎯' : '✓'} />
          <h2>{task.name}</h2>
          <button className="sheet__x" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <div className="stats">
            <Chiffre valeur={String(streak)} legende={s?.frozen ? 'série en gel 🧊' : 'série 🔥'} />
            <Chiffre valeur={String(s?.bestStreak ?? 0)} legende="record" />
            <Chiffre valeur={`${fmt(gagne)} ${currency}`} legende="gagné en tout" />
          </div>

          {task.repeat && <p className="hint">Revient {rythmeLabel(task.repeat)}.</p>}
          {due !== null && <p className="hint">Prochaine échéance : {formatDueLong(due)}.</p>}

          {prochain ? (
            <p className="hint">
              Prochain palier à la <strong>{prochain.at}ᵉ</strong> — encore{' '}
              <strong>{prochain.at - streak}</strong>, pour{' '}
              <strong>
                +{fmt(prochain.bonus)} {currency}
              </strong>
              .
            </p>
          ) : (
            task.streak && <p className="hint">Tous les paliers sont franchis.</p>
          )}

          {task.streak?.multiplier && (
            <p className="hint">
              La prochaine validation rapporterait{' '}
              <strong>
                {fmt(rewardAtStreak(task, streak + 1))} {currency}
              </strong>
              .
            </p>
          )}

          <Graphe rep={rep} taskId={task.id} now={now} dayStart={dayStart} />
        </div>

        <footer className="sheet__foot">
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
          <button className="btn btn--go" onClick={onEdit}>
            Modifier
          </button>
        </footer>
      </div>
    </div>
  )
}

const Chiffre = ({ valeur, legende }: { valeur: string; legende: string }) => (
  <div className="stats__cell">
    <span className="stats__value">{valeur}</span>
    <span className="stats__label">{legende}</span>
  </div>
)

/**
 * Les dix dernières semaines, une case par jour — la vue d'ensemble que trois
 * chiffres ne donnent pas. Une case allumée = au moins une ligne ce jour-là.
 */
function Graphe({
  rep,
  taskId,
  now,
  dayStart,
}: {
  rep: Replay
  taskId: string
  now: number
  dayStart: number
}) {
  const SEMAINES = 10
  const aujourdhui = dayNum(now, dayStart)
  const faits = new Set(
    rep.entries.filter((e) => e.taskId === taskId).map((e) => dayNum(e.ts, dayStart)),
  )

  // On termine sur aujourd'hui : la dernière colonne est la semaine en cours.
  const jours = Array.from({ length: SEMAINES * 7 }, (_, i) => aujourdhui - (SEMAINES * 7 - 1 - i))

  return (
    <>
      <p className="hint">Les {SEMAINES} dernières semaines</p>
      <div className="graphe">
        {jours.map((j) => (
          <span
            key={j}
            className={`graphe__jour${faits.has(j) ? ' graphe__jour--on' : ''}`}
            title={new Date((j + 0.5) * 86_400_000).toLocaleDateString('fr-FR')}
          />
        ))}
      </div>
    </>
  )
}
