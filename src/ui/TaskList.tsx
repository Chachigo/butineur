import type { MouseEvent, RefObject } from 'react'
import {
  computePenalty,
  dueTsFor,
  isAvailable,
  lastCompletion,
  previewReward,
  type Replay,
} from '../engine'
import { fmt, relativeDay, rythmeLabel } from '../format'
import { burst, coinFly, pop } from '../fx'
import { addEvent, deleteTask, uid, useDB } from '../store'
import type { Task } from '../types'
import Icon from './Icon'
import { useCloseOnBack } from './useCloseOnBack'
import { SelectionBar, useLongPress, useSelection, type Selection } from './useSelection'

type Props = {
  tasks: Task[]
  rep: Replay
  now: number
  currency: string
  dayStart: number
  balanceRef: RefObject<HTMLElement | null>
  onEdit: (t: Task) => void
  onNew: () => void
}

export default function TaskList({
  tasks,
  rep,
  now,
  currency,
  dayStart,
  balanceRef,
  onEdit,
  onNew,
}: Props) {
  // Le plus urgent en haut : en retard, puis échéance proche, puis disponible.
  const sorted = [...tasks].sort((a, b) => rank(a, rep, now, dayStart) - rank(b, rep, now, dayStart))

  const sel = useSelection(sorted, deleteTask)
  useCloseOnBack(sel.selecting, sel.stop)

  return (
    <>
      <SelectionBar sel={sel} noun={['sélectionnée', 'sélectionnées']} />

      {sorted.length === 0 && (
        <p className="empty">
          Aucune tâche pour l’instant.
          <br />
          Crée-en une pour commencer à remplir ton budget.
        </p>
      )}

      <ul className="list">
        {sorted.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            rep={rep}
            now={now}
            currency={currency}
            dayStart={dayStart}
            balanceRef={balanceRef}
            onEdit={onEdit}
            sel={sel}
          />
        ))}
      </ul>

      {!sel.selecting && (
        <button className="fab" onClick={onNew} aria-label="Nouvelle tâche">
          +
        </button>
      )}
    </>
  )
}

function rank(t: Task, rep: Replay, now: number, dayStart: number): number {
  const s = rep.perTask.get(t.id)
  if (!isAvailable(t, s, now, dayStart)) return 3
  // Compteur à son objectif : plus rien à y faire aujourd'hui, il descend.
  if (t.counter && (s?.count ?? 0) >= t.counter.target) return 3
  const due = dueTsFor(t, s, now, dayStart)
  if (due !== null && now > due) return 0
  if (due !== null) return 1
  return 2
}

type RowProps = Omit<Props, 'tasks' | 'onNew'> & { task: Task; sel: Selection }

function TaskRow({
  task,
  rep,
  now,
  currency,
  dayStart,
  balanceRef,
  onEdit,
  sel,
}: RowProps) {
  const events = useDB().events
  const s = rep.perTask.get(task.id)
  const streak = s?.streak ?? 0
  const available = isAvailable(task, s, now, dayStart)
  const due = dueTsFor(task, s, now, dayStart)
  const late = due !== null && now > due

  const complete = (e: MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    const ts = Date.now()
    const { factor, flat } = computePenalty(task, ts, s)
    const gain = previewReward(task, s, ts)
    addEvent({
      id: uid(),
      ts,
      kind: 'complete',
      taskId: task.id,
      baseReward: task.reward,
      penaltyFactor: factor,
      penaltyFlat: flat,
    })
    coinFly(el, balanceRef.current, `+${fmt(gain)}`)
    // Confettis seulement quand un palier de série tombe.
    const next = streak + 1
    if ((task.streak?.tiers ?? []).some((t) => t.at <= next && !s?.streakTiersPaid.has(t.at))) burst(el)
    else pop(el)
  }

  const undo = (e: MouseEvent<HTMLButtonElement>) => {
    const target = lastCompletion(events, task.id)
    if (!target) return
    addEvent({ id: uid(), ts: Date.now(), kind: 'undo', targetId: target.id })
    coinFly(e.currentTarget, balanceRef.current, `−${fmt(target.baseReward)}`, true)
    pop(balanceRef.current, true)
  }

  const bump = (delta: number) => (e: MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    const before = s?.count ?? 0
    const after = Math.min(target, Math.max(0, before + delta))

    // Le solde suit le compteur dans les deux sens : on annonce le même montant.
    const tiers = task.counter?.tiers ?? []
    const crossed = (n: number) =>
      (n >= target ? task.reward : 0) +
      tiers.filter((t) => t.at <= n).reduce((a, t) => a + t.bonus, 0)
    const gain = crossed(after) - crossed(before)

    addEvent({ id: uid(), ts: Date.now(), kind: 'count', taskId: task.id, delta })
    if (gain !== 0) {
      coinFly(el, balanceRef.current, `${gain > 0 ? '+' : '−'}${fmt(Math.abs(gain))}`, gain < 0)
      if (gain > 0) burst(el)
      else pop(balanceRef.current, true)
    } else pop(el, delta < 0)
  }

  const count = s?.count ?? 0
  const target = task.counter?.target ?? 0
  const reached = task.counter !== null && count >= target
  // Un compteur à son objectif est fini pour aujourd'hui : on le grise comme le reste.
  const spent = !available || reached

  const selecting = sel.selecting
  const selected = sel.selection?.has(task.id) ?? false
  const longPress = useLongPress(() => sel.start(task.id), !selecting)

  return (
    <li
      className={`task${spent ? ' task--done' : ''}${late ? ' task--late' : ''}${
        selected ? ' task--picked' : ''
      }`}
    >
      <button
        className="task__body"
        onClick={() => (selecting ? sel.toggle(task.id) : onEdit(task))}
        {...longPress}
      >
        {selecting && (
          <span className={`task__tick${selected ? ' task__tick--on' : ''}`} aria-hidden>
            {selected ? '✓' : ''}
          </span>
        )}
        <Icon className="task__icon" icon={task.icon ?? ''} fallback={task.counter ? '🎯' : '✓'} />
        <span className="task__text">
          <span className="task__name">{task.name || 'Sans nom'}</span>
          <span className="task__meta">
            {task.repeat && <em className="badge">{rythmeLabel(task.repeat)}</em>}
            {streak > 1 && <em className="badge badge--streak">série {streak} 🔥</em>}
            {/* Une série perdue se dit une fois, tant qu'elle n'est pas relancée. */}
            {streak === 0 && (s?.brokenStreak ?? 0) > 1 && (
              <em className="badge badge--broken">série {s!.brokenStreak} perdue 💔</em>
            )}
            {due !== null && (
              <em className={`badge${late ? ' badge--late' : ''}`}>{relativeDay(due, now)}</em>
            )}
            {!available && !task.repeat && <em className="badge">terminée</em>}
          </span>
        </span>
      </button>

      {selecting ? null : task.counter ? (
        <div className="task__counter">
          <button className="round" onClick={bump(-1)} disabled={count === 0} aria-label="Retirer">
            −
          </button>
          <span className={`task__count${reached ? ' task__count--ok' : ''}`}>
            {count}
            <span className="task__target">/{target}</span>
          </span>
          <button
            className="round round--go"
            onClick={bump(1)}
            disabled={reached}
            aria-label="Ajouter"
          >
            {reached ? '✓' : '+'}
          </button>
        </div>
      ) : (
        <button
          className={available ? 'task__go' : 'task__go task__go--undo'}
          onClick={available ? complete : undo}
          title={available ? undefined : 'Annuler cette validation'}
        >
          {available ? `+${fmt(previewReward(task, s, now))} ${currency}` : '↩ ✓'}
        </button>
      )}
    </li>
  )
}
