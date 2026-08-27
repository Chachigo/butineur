import { Fragment, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import {
  childrenOf,
  computePenalty,
  dueTsFor,
  isAvailable,
  lastCompletion,
  previewReward,
  subtaskProgress,
  type Replay,
} from '../engine'
import { now as clock } from '../debug'
import { fmt, relativeDay, rythmeLabel } from '../format'
import { tr } from '../i18n'
import { burst, coinFly, pop } from '../fx'
import { addEvent, deleteTask, saveTask, uid, useDB } from '../store'
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
  /** A recurring task has a history: a click opens it instead of the editor. */
  onStats: (t: Task) => void
  /** Quick-task templates, pulled back out with a button. */
  modeles: Task[]
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
  onStats,
  modeles,
  onNew,
}: Props) {
  // Most urgent on top: late, then deadline approaching, then available.
  const sorted = [...tasks].sort((a, b) => rank(a, rep, now, dayStart) - rank(b, rep, now, dayStart))

  /*
   * A completed task drops to the bottom of the list — but not right away.
   * Otherwise the next one slides up under the finger, and a slightly quick
   * second tap completes a task that was not the target. The displayed order
   * freezes for two seconds.
   */
  const [gele, setGele] = useState<string[] | null>(null)
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined)
  const figer = () => {
    setGele(sorted.map((t) => t.id))
    clearTimeout(minuteur.current)
    minuteur.current = setTimeout(() => setGele(null), 2000)
  }
  useEffect(() => () => clearTimeout(minuteur.current), [])

  const place = (id: string) => {
    const i = gele!.indexOf(id)
    // A task created in the meantime was not in the frozen order: it goes last.
    return i === -1 ? gele!.length : i
  }
  const affichees = gele ? [...tasks].sort((a, b) => place(a.id) - place(b.id)) : sorted
  // A subtask is shown under its parent, never on its own line at the top level.
  const racines = affichees.filter((t) => !t.parentId)

  const sel = useSelection(affichees, deleteTask)
  useCloseOnBack(sel.selecting, sel.stop)

  // The fold is screen state, not data: nothing to persist, nothing to sync.
  const [deplies, setDeplies] = useState<Set<string>>(new Set())
  const plier = (id: string) =>
    setDeplies((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <>
      <SelectionBar sel={sel} noun="sel.task" />

      {/* What comes back often without being regular: a button lays it back in the list. */}
      {!sel.selecting && modeles.length > 0 && (
        <div className="rapides">
          {modeles.map((m) => (
            <Rapide key={m.id} modele={m} onEdit={onEdit} />
          ))}
        </div>
      )}

      {affichees.length === 0 && (
        <p className="empty">
          {tr('list.empty')}
          <br />
          {tr('list.emptyHint')}
        </p>
      )}

      <ul className="list">
        {racines.map((t) => {
          const subs = childrenOf(t.id, affichees)
          const ouvert = deplies.has(t.id)
          return (
            <Fragment key={t.id}>
              <TaskRow
                task={t}
                onValider={figer}
                rep={rep}
                now={now}
                currency={currency}
                dayStart={dayStart}
                balanceRef={balanceRef}
                onEdit={onEdit}
                onStats={onStats}
                sel={sel}
                tasks={tasks}
                ouvert={ouvert}
                onPlier={() => plier(t.id)}
              />
              {ouvert &&
                subs.map((sub) => (
                  <TaskRow
                    key={sub.id}
                    task={sub}
                    onValider={figer}
                    rep={rep}
                    now={now}
                    currency={currency}
                    dayStart={dayStart}
                    balanceRef={balanceRef}
                    onEdit={onEdit}
                    onStats={onStats}
                    sel={sel}
                    tasks={tasks}
                  />
                ))}
            </Fragment>
          )
        })}
      </ul>

      {!sel.selecting && (
        <button className="fab" onClick={onNew} aria-label={tr('list.new')}>
          +
        </button>
      )}
    </>
  )
}

/** A template has its own button, outside the list: long press to edit it, tap to lay it down. */
function Rapide({ modele, onEdit }: { modele: Task; onEdit: (t: Task) => void }) {
  const longPress = useLongPress(() => onEdit(modele), true)
  return (
    <button
      className="rapide"
      // The laid-down task lands lower in the list, sometimes off screen:
      // without a jolt under the finger, nothing says the tap registered.
      onClick={(e) => {
        pop(e.currentTarget)
        saveTask({ ...modele, id: uid(), template: false, updatedAt: 0 })
      }}
      {...longPress}
    >
      <Icon icon={modele.icon ?? ''} fallback="✓" /> {modele.name}
    </button>
  )
}

function rank(t: Task, rep: Replay, now: number, dayStart: number): number {
  const s = rep.perTask.get(t.id)
  if (!isAvailable(t, s, now, dayStart)) return 3
  // Counter at its target: nothing left to do there today, it drops down.
  if (t.counter && (s?.count ?? 0) >= t.counter.target) return 3
  const due = dueTsFor(t, s, now, dayStart)
  if (due !== null && now > due) return 0
  if (due !== null) return 1
  return 2
}

type RowProps = Omit<Props, 'onNew' | 'modeles'> & {
  task: Task
  sel: Selection
  /** Freezes the list order for as long as it takes the finger to leave the screen. */
  onValider: () => void
  /** Set on a parent only: the chevron state and what toggles it. */
  ouvert?: boolean
  onPlier?: () => void
}

function TaskRow({
  task,
  tasks,
  rep,
  now,
  currency,
  dayStart,
  balanceRef,
  onEdit,
  onStats,
  sel,
  onValider,
  ouvert,
  onPlier,
}: RowProps) {
  const events = useDB().events
  const s = rep.perTask.get(task.id)
  const streak = s?.streak ?? 0
  const available = isAvailable(task, s, now, dayStart)
  const due = dueTsFor(task, s, now, dayStart)
  const late = due !== null && now > due

  const completionEvent = (t: Task, ts: number) => {
    const st = rep.perTask.get(t.id)
    const { factor, flat } = computePenalty(t, ts, st)
    return {
      id: uid(),
      ts,
      kind: 'complete' as const,
      taskId: t.id,
      baseReward: t.reward,
      penaltyFactor: factor,
      penaltyFlat: flat,
      repeat: t.repeat,
      streak: t.streak,
    }
  }

  const complete = (e: MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    onValider()
    const ts = clock()
    const gain = previewReward(task, s, ts)
    addEvent(completionEvent(task, ts))
    // Last subtask down: the parent falls with it, in the same gesture. One
    // rule, one place — the count in the chevron reads the same `isAvailable`.
    //
    // ponytail: the parent's completion is written, not derived at replay time.
    // At batch 3, two devices each ticking the last box would complete the
    // parent twice. Deriving it would be fairer but grows the engine, so not
    // before it is needed.
    if (task.parentId) {
      const { done, total } = subtaskProgress(task.parentId, tasks, rep, ts, dayStart)
      const parent = tasks.find((p) => p.id === task.parentId)
      if (parent && total > 0 && done + 1 >= total) addEvent(completionEvent(parent, ts))
    }
    coinFly(el, balanceRef.current, `+${fmt(gain)}`)
    // Confetti only when a streak tier is crossed.
    const next = streak + 1
    if ((task.streak?.tiers ?? []).some((t) => t.at <= next && !s?.streakTiersPaid.has(t.at))) burst(el)
    else pop(el)
  }

  const undo = (e: MouseEvent<HTMLButtonElement>) => {
    const target = lastCompletion(events, task.id)
    if (!target) return
    onValider()
    addEvent({ id: uid(), ts: clock(), kind: 'undo', targetId: target.id })
    // Undoing a subtask undoes the parent it had just completed: the bouquet is
    // no longer complete. Two `undo` events, the log stays append-only.
    if (task.parentId) {
      const parent = lastCompletion(events, task.parentId)
      if (parent) addEvent({ id: uid(), ts: clock(), kind: 'undo', targetId: parent.id })
    }
    coinFly(e.currentTarget, balanceRef.current, `−${fmt(target.baseReward)}`, true)
    pop(balanceRef.current, true)
  }

  const bump = (delta: number) => (e: MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    onValider()
    const before = s?.count ?? 0
    const after = Math.min(target, Math.max(0, before + delta))

    // The balance follows the counter both ways: we announce the same amount.
    const tiers = task.counter?.tiers ?? []
    const crossed = (n: number) =>
      (n >= target ? task.reward : 0) +
      tiers.filter((t) => t.at <= n).reduce((a, t) => a + t.bonus, 0)
    const gain = crossed(after) - crossed(before)

    addEvent({
      id: uid(),
      ts: clock(),
      kind: 'count',
      taskId: task.id,
      delta,
      baseReward: task.reward,
      counter: task.counter,
      repeat: task.repeat,
    })
    if (gain !== 0) {
      coinFly(el, balanceRef.current, `${gain > 0 ? '+' : '−'}${fmt(Math.abs(gain))}`, gain < 0)
      if (gain > 0) burst(el)
      else pop(balanceRef.current, true)
    } else pop(el, delta < 0)
  }

  const count = s?.count ?? 0
  const target = task.counter?.target ?? 0
  const reached = task.counter !== null && count >= target
  // A counter at its target is done for today: greyed out like the rest.
  const spent = !available || reached

  const sousTaches = subtaskProgress(task.id, tasks, rep, now, dayStart)
  const selecting = sel.selecting
  const selected = sel.selection?.has(task.id) ?? false
  const longPress = useLongPress(() => sel.start(task.id), !selecting)

  return (
    <li
      className={`task${spent ? ' task--done' : ''}${late ? ' task--late' : ''}${
        selected ? ' task--picked' : ''
      }${task.parentId ? ' task--sub' : ''}`}
    >
      {onPlier && sousTaches.total > 0 && !selecting && (
        <button
          className="task__fold"
          onClick={onPlier}
          aria-expanded={ouvert}
          aria-label={tr(ouvert ? 'sub.collapse' : 'sub.expand')}
        >
          <span className={`task__chevron${ouvert ? ' task__chevron--on' : ''}`}>›</span>
          <em className="badge">
            {tr('sub.progress', { done: sousTaches.done, total: sousTaches.total })}
          </em>
        </button>
      )}
      <button
        className="task__body"
        onClick={() => (selecting ? sel.toggle(task.id) : task.repeat ? onStats(task) : onEdit(task))}
        {...longPress}
      >
        {selecting && (
          <span className={`task__tick${selected ? ' task__tick--on' : ''}`} aria-hidden>
            {selected ? '✓' : ''}
          </span>
        )}
        <Icon className="task__icon" icon={task.icon ?? ''} fallback={task.counter ? '🎯' : '✓'} />
        <span className="task__text">
          <span className="task__name">{task.name || tr('list.noName')}</span>
          <span className="task__meta">
            {/* The rhythm is the parent's, shown one line above: saying it again
                on each subtask only makes the list heavier. */}
            {task.repeat && !task.parentId && <em className="badge">{rythmeLabel(task.repeat)}</em>}
            {streak > 1 && (
              <em className={`badge ${s?.frozen ? 'badge--frozen' : 'badge--streak'}`}>
                {tr('list.streak', { n: streak, emoji: s?.frozen ? '🧊' : '🔥' })}
              </em>
            )}
            {/* A lost streak is said once, for as long as it has not been restarted. */}
            {streak === 0 && (s?.brokenStreak ?? 0) > 1 && (
              <em className="badge badge--broken">{tr('list.broken', { n: s!.brokenStreak })}</em>
            )}
            {due !== null && (
              <em className={`badge${late ? ' badge--late' : ''}`}>
                {relativeDay(due, now, dayStart)}
              </em>
            )}
            {!available && !task.repeat && <em className="badge">{tr('list.finished')}</em>}
          </span>
        </span>
      </button>

      {selecting ? null : task.counter ? (
        <div className="task__counter-wrap">
          <div className="task__counter">
            <button className="round" onClick={bump(-1)} disabled={count === 0} aria-label={tr('list.minus')}>
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
              aria-label={tr('list.plus')}
            >
              {reached ? '✓' : '+'}
            </button>
          </div>
          <span className="task__counter-reward">
            {fmt(task.reward)} {currency}
          </span>
        </div>
      ) : (
        <button
          className={available ? 'task__go' : 'task__go task__go--undo'}
          onClick={available ? complete : undo}
          title={available ? undefined : tr('list.undo')}
        >
          {available ? `+${fmt(previewReward(task, s, now))} ${currency}` : '↩ ✓'}
        </button>
      )}
    </li>
  )
}
