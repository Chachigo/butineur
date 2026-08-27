import { dueTsFor, rewardAtStreak, type Replay } from '../engine'
import { fmt, formatDueLong, rythmeLabel } from '../format'
import type { Task } from '../types'
import Icon from './Icon'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * The detail sheet of a recurring task: where the streak stands, what the next
 * tier pays, when the deadline falls. Everything comes from the replay — this is
 * display, no computation is redone here.
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
