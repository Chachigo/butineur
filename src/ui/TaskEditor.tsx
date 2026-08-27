import { useState, type ReactNode } from 'react'
import {
  childrenOf,
  daysUntilWorthless,
  dueTsFor,
  rewardAfterDays,
  rewardAtStreak,
  rythme,
  streakAtCap,
  type Rythme,
} from '../engine'
import {
  combineDateTime,
  defaultDue,
  fmt,
  formatDueLong,
  toDateInput,
  toTimeInput,
  weekdayName,
} from '../format'
import { rich, tr, trn, type Key } from '../i18n'
import { deleteTask, saveTaskTree, uid, useDB } from '../store'
import type { Penalty, Task, TaskState, Tier } from '../types'
import IconPicker from './IconPicker'
import NumberInput from './NumberInput'
import TierEditor from './TierEditor'
import { useCloseOnBack } from './useCloseOnBack'

export function blankTask(defaultReward: number): Task {
  return {
    id: uid(),
    name: '',
    icon: '',
    reward: defaultReward,
    repeat: null,
    counter: null,
    due: null,
    streak: null,
    remind: null,
    cheer: false,
    archived: false,
    updatedAt: 0,
    deletedAt: null,
  }
}

/**
 * Clamps the tiers when the target goes down: the counter caps at the target, so
 * a tier beyond it would never be crossed.
 */
function retarget(counter: NonNullable<Task['counter']>, next: number): Tier[] {
  const clamped = counter.tiers.map((t) => ({ ...t, at: Math.min(t.at, next) }))
  // The clamping can create duplicates: one tier per value only.
  return [...new Map(clamped.map((t) => [t.at, t])).values()].sort((a, b) => a.at - b.at)
}

const BEFORE_UNITS = { minutes: 1, heures: 60, jours: 1440 } as const
const BEFORE_LABEL: Record<keyof typeof BEFORE_UNITS, Key> = {
  minutes: 'ed.minutesBefore',
  heures: 'ed.hoursBefore',
  jours: 'ed.daysBefore',
}

/** Missing `kind` = fixed time: it was the only mode before. */
const remindKind = (t: Task): 'time' | 'jour' | 'before' =>
  t.remind && 'kind' in t.remind && (t.remind.kind === 'before' || t.remind.kind === 'jour')
    ? t.remind.kind
    : 'time'

/** The largest unit that divides evenly, to show "2 days" and not "2880 minutes". */
function beforeUnit(t: Task): keyof typeof BEFORE_UNITS {
  const m = (t.remind as { minutes?: number })?.minutes ?? 0
  if (m % BEFORE_UNITS.jours === 0) return 'jours'
  if (m % BEFORE_UNITS.heures === 0) return 'heures'
  return 'minutes'
}

/**
 * Monday first — the value stays the one from `Date.getDay()`. The letter is the
 * first one of the day's name in the active language, so the row reads right in
 * every language instead of carrying seven hard-coded French initials.
 */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

const RYTHMES: [Rythme, Key][] = [
  ['jour', 'ed.r.jour'],
  ['semaine', 'ed.r.semaine'],
  ['mois', 'ed.r.mois'],
  ['glissant', 'ed.r.glissant'],
]

/**
 * The chosen rhythm alone decides the fields: two settings can no longer
 * contradict each other, since only one exists at a time.
 *
 * ponytail: the monthly rhythm sets `everyDays` to 31, which is enough for
 * counter periods and streak tolerance; the deadline itself follows the real
 * calendar. To revisit the day a monthly counter shows up.
 */
function newRepeat(r: Rythme, prev: NonNullable<Task['repeat']>): NonNullable<Task['repeat']> {
  const now = new Date()
  switch (r) {
    case 'jour':
      return { everyDays: 1 }
    case 'semaine':
      return { everyDays: 7, weekday: prev.weekday ?? now.getDay() }
    case 'mois':
      return { everyDays: 31, monthday: prev.monthday ?? now.getDate() }
    case 'glissant':
      return { everyDays: Math.max(2, prev.everyDays) }
  }
}

/** The deadline spelled out: that is what makes the setting readable. */
function NextDue({ task, state }: { task: Task; state?: TaskState }) {
  // The task's real state, otherwise a rolling cycle would announce the deadline
  // of a brand new task instead of its own.
  const due = dueTsFor(task, state)
  if (due === null) return null
  return <p className="hint">{tr('ed.nextDue', { date: formatDueLong(due) })}</p>
}

const PENALTY_KINDS: [Penalty['kind'], Key][] = [
  ['flat', 'ed.p.flat'],
  ['percent', 'ed.p.percent'],
  ['decay', 'ed.p.decay'],
]

/**
 * A "per day" decay means nothing on a daily task: one day late is already the
 * next cycle. A flat percentage is offered instead, which punishes the hour and
 * not the day.
 */
const defaultPenalty = (t: Task): Penalty =>
  t.repeat && rythme(t.repeat) === 'jour'
    ? { kind: 'percent', percent: 50 }
    : { kind: 'decay', percentPerDay: 20 }

export default function TaskEditor({
  task,
  state,
  onClose,
}: {
  task: Task
  state?: TaskState
  onClose: () => void
}) {
  const db = useDB()
  const [t, setT] = useState(task)
  const isNew = !db.tasks.some((x) => x.id === task.id)
  const patch = (p: Partial<Task>) => setT((prev) => ({ ...prev, ...p }))
  const cur = db.settings.currency

  // The subtasks are edited here, with their parent, and saved with it. They
  // only reach the database on save — cancelling has to leave nothing behind.
  const [enfants, setEnfants] = useState(() => childrenOf(task.id, db.tasks))
  const aDesEnfants = enfants.length > 0

  /*
   * A bouquet happens once: a parent does not repeat, so a subtask has neither
   * rhythm nor deadline. Only tasks that could host one are offered, and a task
   * that already hosts subtasks cannot become one itself.
   */
  const parents = db.tasks.filter(
    (x) => !x.deletedAt && !x.template && !x.parentId && !x.repeat && x.id !== t.id,
  )

  useCloseOnBack(true, onClose)

  // A target of zero would be reached straight away and pay immediately.
  const missingTarget = !!t.counter && t.counter.target < 1
  const canSave = !!t.name.trim() && !missingTarget

  const save = () => {
    if (!canSave) return
    saveTaskTree(
      { ...t, name: t.name.trim() },
      enfants.filter((e) => e.name.trim()).map((e) => ({ ...e, name: e.name.trim() })),
    )
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>{tr(isNew ? 'ed.new' : 'common.edit')}</h2>
          <button className="sheet__x" onClick={onClose} aria-label={tr('common.close')}>
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <div className="field field--row">
            <IconPicker
              value={t.icon ?? ''}
              onChange={(icon) => patch({ icon })}
              fallback={t.counter ? '🎯' : '✓'}
            />
            <input
              className="input"
              value={t.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={tr('ed.nameHint')}
              aria-label={tr('ed.name')}
            />
          </div>

          {/*
            A subtask has neither rhythm, deadline nor reminder — the blocks
            below simply do not exist for it. Attaching is possible after the
            fact: since a bouquet never repeats, there is no reference cycle to
            shift under a history already written.
          */}
          {!aDesEnfants && parents.length > 0 && (
            <div className="row">
              <span className="row__label">{tr('ed.parent')}</span>
              <select
                className="input input--select"
                value={t.parentId ?? ''}
                onChange={(e) =>
                  patch({
                    parentId: e.target.value || undefined,
                    repeat: e.target.value ? null : t.repeat,
                    due: e.target.value ? null : t.due,
                    remind: e.target.value ? null : t.remind,
                    streak: e.target.value ? null : t.streak,
                    template: e.target.value ? false : t.template,
                  })
                }
                aria-label={tr('ed.parent')}
              >
                <option value="">{tr('ed.parentNone')}</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {aDesEnfants && !t.parentId && <p className="hint">{tr('ed.isParent')}</p>}

          <label className="field">
            <span className="field__label">{tr('ed.reward')}</span>
            <span className="field__row">
              <NumberInput
                className="input input--sm"
                value={t.reward}
                min={0}
                onChange={(reward) => patch({ reward })}
              />
              <span className="field__suffix">{cur}</span>
            </span>
          </label>

          {!t.parentId && (
            <>
          <Section
            title={tr('ed.subtasks')}
            hint={tr('ed.subtasksHint')}
            on={aDesEnfants}
            disabled={!!t.repeat}
            disabledHint={tr('ed.subNoRepeat')}
            onToggle={(v) =>
              setEnfants(v ? [blankChild(t.id, db.settings.defaultReward)] : [])
            }
          >
            <SubtaskEditor
              enfants={enfants}
              onChange={setEnfants}
              currency={cur}
              onAdd={() =>
                setEnfants([...enfants, blankChild(t.id, db.settings.defaultReward)])
              }
            />
            <p className="hint">{tr('ed.parentBonus')}</p>
          </Section>

          <Section
            title={tr('ed.quick')}
            hint={tr('ed.quickHint')}
            on={!!t.template}
            // A template waits to be pulled out: no rhythm and no deadline to meet.
            onToggle={(v) => patch({ template: v, repeat: v ? null : t.repeat })}
          >
            <p className="hint">{tr('ed.quickText')}</p>
          </Section>

          <Section
            title={tr('ed.repeat')}
            on={!!t.repeat}
            disabled={aDesEnfants}
            disabledHint={tr('ed.repeatNoSub')}
            onToggle={(v) =>
              patch({
                repeat: v ? { everyDays: 1 } : null,
                // Removing the repetition takes the streak with it: it would mean nothing.
                streak: v ? t.streak : null,
                // A recurring task is expected on every round: the deadline comes
                // with it, penalty-free until one is asked for. Not on a counter,
                // which fills up during the day without ever being late.
                due: v && !t.due && !t.counter ? { at: defaultDue(), penalty: { kind: 'none' } } : t.due,
              })
            }
          >
            {t.repeat && (
              <>
                <div className="row">
                  <span className="row__label">{tr('ed.comesBack')}</span>
                  <select
                    className="input input--select"
                    value={rythme(t.repeat)}
                    onChange={(e) => patch({ repeat: newRepeat(e.target.value as Rythme, t.repeat!) })}
                    aria-label={tr('ed.rhythm')}
                  >
                    {RYTHMES.map(([k, label]) => (
                      <option key={k} value={k}>
                        {tr(label)}
                      </option>
                    ))}
                  </select>
                </div>

                {rythme(t.repeat) === 'semaine' && (
                  <div className="days" role="group" aria-label={tr('ed.weekday')}>
                    {WEEKDAYS.map((value) => {
                      const on = t.repeat!.weekday === value
                      const label = weekdayName(value)
                      return (
                        <button
                          key={value}
                          type="button"
                          className={on ? 'day day--on' : 'day'}
                          title={label}
                          aria-label={label}
                          aria-pressed={on}
                          onClick={() => patch({ repeat: { ...t.repeat!, weekday: value } })}
                        >
                          {label.charAt(0).toUpperCase()}
                        </button>
                      )
                    })}
                  </div>
                )}

                {rythme(t.repeat) === 'mois' && (
                  <div className="row">
                    <span className="row__label">{tr('ed.onThe')}</span>
                    <NumberInput
                      className="input input--xs"
                      value={t.repeat.monthday ?? 1}
                      min={1}
                      max={31}
                      onChange={(monthday) => patch({ repeat: { ...t.repeat!, monthday } })}
                      aria-label={tr('ed.monthday')}
                    />
                    <span className="field__suffix">{tr('ed.ofMonth')}</span>
                  </div>
                )}

                {rythme(t.repeat) === 'glissant' && (
                  <>
                    <div className="row">
                      <span className="row__label">{tr('ed.every')}</span>
                      <NumberInput
                        className="input input--xs"
                        value={t.repeat.everyDays}
                        // Below 2 it is "every day": the same setting in two places
                        // would make no sense.
                        min={2}
                        onChange={(everyDays) => patch({ repeat: { everyDays } })}
                        aria-label={tr('ed.dayCount')}
                      />
                      <span className="field__suffix">{tr('ed.days')}</span>
                    </div>
                    <p className="hint">{tr('ed.rollingHint')}</p>
                  </>
                )}

                {/* The time belongs to the rhythm: "every Sunday at 8 pm" reads in one go. */}
                {t.due && (
                  <>
                    <div className="row">
                      <span className="row__label">{tr('ed.lateFrom')}</span>
                      <input
                        className="input input--time"
                        type="time"
                        value={toTimeInput(t.due.at)}
                        onChange={(e) => {
                          const at = combineDateTime(toDateInput(t.due!.at), e.target.value)
                          if (at) patch({ due: { ...t.due!, at } })
                        }}
                        aria-label={tr('ed.dueTime')}
                      />
                    </div>
                    <NextDue task={t} state={state} />
                  </>
                )}
              </>
            )}
          </Section>

            </>
          )}

          <Section
            title={tr('ed.counter')}
            hint={tr('ed.counterHint')}
            on={!!t.counter}
            onToggle={(v) =>
              // Reaching the target pays the task's reward: no tier by default,
              // they only serve as intermediate bonuses.
              patch({ counter: v ? { target: 0, unit: tr('ed.unitDefault'), tiers: [] } : null })
            }
          >
            {t.counter && (
              <>
                <div className="row">
                  <span className="row__label">{tr('ed.target')}</span>
                  <NumberInput
                    className="input input--xs"
                    value={t.counter.target}
                    min={1}
                    placeholder="8"
                    onChange={(target) =>
                      patch({ counter: { ...t.counter!, target, tiers: retarget(t.counter!, target) } })
                    }
                    aria-label={tr('ed.target')}
                  />
                  <input
                    className="input input--unit"
                    value={t.counter.unit ?? ''}
                    onChange={(e) => patch({ counter: { ...t.counter!, unit: e.target.value } })}
                    placeholder={tr('ed.unitDefault')}
                    aria-label={tr('ed.unit')}
                  />
                </div>
                <p className="preview">
                  {rich(tr('ed.targetReached', { amount: fmt(t.reward), cur }))}
                </p>
                <p className="hint">{tr('ed.midTiers')}</p>
                <TierEditor
                  tiers={t.counter.tiers}
                  onChange={(tiers) => patch({ counter: { ...t.counter!, tiers } })}
                  unit={t.counter.unit || tr('ed.unitDefault')}
                  currency={cur}
                  max={t.counter.target}
                />
              </>
            )}
          </Section>

          {/* A recurring task gets its deadline from its rhythm: no date to pick,
              only for the ones that happen just once. */}
          {!t.repeat && !t.parentId && (
            <Section
              title={tr('ed.deadline')}
              on={!!t.due}
              onToggle={(v) => patch({ due: v ? { at: defaultDue(), penalty: { kind: 'none' } } : null })}
            >
              {t.due && (
                <div className="row">
                  <input
                    className="input"
                    type="date"
                    value={toDateInput(t.due.at)}
                    onChange={(e) => {
                      const at = combineDateTime(e.target.value, toTimeInput(t.due!.at))
                      if (at) patch({ due: { ...t.due!, at } })
                    }}
                    aria-label={tr('ed.dueDay')}
                  />
                  <input
                    className="input input--time"
                    type="time"
                    value={toTimeInput(t.due.at)}
                    onChange={(e) => {
                      const at = combineDateTime(toDateInput(t.due!.at), e.target.value)
                      if (at) patch({ due: { ...t.due!, at } })
                    }}
                    aria-label={tr('ed.dueTime')}
                  />
                </div>
              )}
            </Section>
          )}

          {t.due && (
            <Section
              title={tr('ed.penalty')}
              hint={tr('ed.penaltyHint')}
              on={t.due.penalty.kind !== 'none'}
              onToggle={(v) =>
                patch({ due: { ...t.due!, penalty: v ? defaultPenalty(t) : { kind: 'none' } } })
              }
            >
              {t.due.penalty.kind !== 'none' && (
                <>
                  <div className="row">
                    <span className="row__label">{tr('ed.kind')}</span>
                    <select
                      className="input input--select"
                      value={t.due.penalty.kind}
                      onChange={(e) =>
                        patch({ due: { ...t.due!, penalty: newPenalty(e.target.value as Penalty['kind']) } })
                      }
                    >
                      {PENALTY_KINDS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {tr(label)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <PenaltyValue
                    penalty={t.due.penalty}
                    currency={cur}
                    onChange={(penalty) => patch({ due: { ...t.due!, penalty } })}
                  />
                  <PenaltySim task={t} currency={cur} />
                  {/* The streak, on the other hand, is not negotiable: it drops on a missed cycle. */}
                  {t.streak && (
                    <p className="hint">{tr('ed.penaltyVsStreak')}</p>
                  )}
                </>
              )}
            </Section>
          )}

          {!t.parentId && (
            <>
          <Section
            title={tr('ed.remind')}
            hint={tr('ed.remindHint')}
            on={!!t.remind}
            onToggle={(v) => patch({ remind: v ? { kind: 'time', time: '19:00' } : null })}
          >
            {t.remind && (
              <>
                <div className="row">
                  <button
                    type="button"
                    className={remindKind(t) === 'time' ? 'chip-btn chip-btn--on' : 'chip-btn'}
                    onClick={() => patch({ remind: { kind: 'time', time: '19:00' } })}
                  >
                    {tr('ed.atTime')}
                  </button>
                  <button
                    type="button"
                    className={remindKind(t) === 'jour' ? 'chip-btn chip-btn--on' : 'chip-btn'}
                    // Same need for a deadline as "before": we lay one down rather
                    // than leave a button with no effect.
                    onClick={() =>
                      patch({
                        remind: { kind: 'jour', time: '09:00' },
                        due: t.due ?? { at: defaultDue(), penalty: { kind: 'none' } },
                      })
                    }
                  >
                    {tr('ed.onTheDay')}
                  </button>
                  <button
                    type="button"
                    className={remindKind(t) === 'before' ? 'chip-btn chip-btn--on' : 'chip-btn'}
                    // Without a deadline there was nothing to come ahead of, and
                    // the button stayed dead without saying so. The missing deadline
                    // is laid down — penalty-free, a date set in passing must cost
                    // nothing.
                    onClick={() =>
                      patch({
                        remind: { kind: 'before', minutes: 60 },
                        due: t.due ?? { at: defaultDue(), penalty: { kind: 'none' } },
                      })
                    }
                  >
                    {tr('ed.beforeDue')}
                  </button>
                </div>
                {remindKind(t) === 'before' && (
                  <p className="hint">{tr('ed.beforeHint')}</p>
                )}

                {remindKind(t) === 'jour' && (
                  <div className="row">
                    <span className="row__label">{tr('ed.onDueDayAt')}</span>
                    <input
                      className="input input--time"
                      type="time"
                      value={(t.remind as { time: string }).time}
                      onChange={(e) =>
                        e.target.value && patch({ remind: { kind: 'jour', time: e.target.value } })
                      }
                      aria-label={tr('ed.remindTime')}
                    />
                  </div>
                )}

                {remindKind(t) === 'time' ? (
                  <div className="row">
                    <span className="row__label">{tr('ed.everyDayAt')}</span>
                    <input
                      className="input input--time"
                      type="time"
                      value={(t.remind as { time: string }).time}
                      onChange={(e) =>
                        e.target.value && patch({ remind: { kind: 'time', time: e.target.value } })
                      }
                      aria-label={tr('ed.remindTime')}
                    />
                  </div>
                ) : remindKind(t) === 'before' ? (
                  <div className="row">
                    <span className="row__label">{tr('ed.warnMe')}</span>
                    <NumberInput
                      className="input input--xs"
                      value={Math.round((t.remind as { minutes: number }).minutes / BEFORE_UNITS[beforeUnit(t)])}
                      min={1}
                      onChange={(v) =>
                        patch({ remind: { kind: 'before', minutes: v * BEFORE_UNITS[beforeUnit(t)] } })
                      }
                      aria-label={tr('ed.beforeDelay')}
                    />
                    <select
                      className="input input--select"
                      value={beforeUnit(t)}
                      onChange={(e) => {
                        const u = e.target.value as keyof typeof BEFORE_UNITS
                        const n = Math.round(
                          (t.remind as { minutes: number }).minutes / BEFORE_UNITS[beforeUnit(t)],
                        )
                        patch({ remind: { kind: 'before', minutes: n * BEFORE_UNITS[u] } })
                      }}
                      aria-label={tr('ed.delayUnit')}
                    >
                      {(Object.keys(BEFORE_UNITS) as (keyof typeof BEFORE_UNITS)[]).map((u) => (
                        <option key={u} value={u}>
                          {tr(BEFORE_LABEL[u])}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <p className="hint">{tr('ed.remindText')}</p>
              </>
            )}
          </Section>


          {/* A streak only makes sense on a task that comes back. */}
          <Section
            title={tr('ed.streak')}
            hint={tr('ed.streakHint')}
            on={!!t.streak}
            disabled={!t.repeat}
            disabledHint={tr('ed.streakNeedsRepeat')}
            onToggle={(v) =>
              patch({ streak: v ? { tiers: [{ at: 3, bonus: 5 }], multiplier: null } : null })
            }
          >
            {t.streak && (
              <>
                <p className="hint">{tr('ed.tiers')}</p>
                <TierEditor
                  tiers={t.streak.tiers}
                  onChange={(tiers) => patch({ streak: { ...t.streak!, tiers } })}
                  unit={tr('ed.inARow')}
                  currency={cur}
                />
                <Section
                  title={tr('ed.multiplier')}
                  on={!!t.streak.multiplier}
                  onToggle={(v) =>
                    patch({ streak: { ...t.streak!, multiplier: v ? { perStep: 0.1, cap: 2 } : null } })
                  }
                >
                  {t.streak.multiplier && (
                    <>
                      <div className="row">
                        <span className="row__label">{tr('ed.perStep')}</span>
                        <span className="field__suffix">+</span>
                        <NumberInput
                          className="input input--xs"
                          value={Math.round(t.streak.multiplier.perStep * 100)}
                          min={0}
                          step={5}
                          onChange={(v) =>
                            patch({
                              streak: {
                                ...t.streak!,
                                multiplier: { ...t.streak!.multiplier!, perStep: v / 100 },
                              },
                            })
                          }
                          aria-label={tr('ed.perStepLabel')}
                        />
                        <span className="field__suffix">%</span>
                      </div>
                      <div className="row">
                        <span className="row__label">{tr('ed.cap')}</span>
                        <span className="field__suffix">×</span>
                        <NumberInput
                          className="input input--xs"
                          value={t.streak.multiplier.cap}
                          min={1}
                          step={0.1}
                          onChange={(cap) =>
                            patch({
                              streak: { ...t.streak!, multiplier: { ...t.streak!.multiplier!, cap } },
                            })
                          }
                          aria-label={tr('ed.capLabel')}
                        />
                      </div>
                      <StreakSim task={t} currency={cur} everyDays={t.repeat?.everyDays ?? 1} />
                    </>
                  )}
                </Section>

                <Section
                  title={tr('ed.cheer')}
                  hint={tr('ed.cheerHint')}
                  on={t.cheer}
                  onToggle={(cheer) => patch({ cheer })}
                >
                  <p className="hint">{tr('ed.cheerText')}</p>
                </Section>
              </>
            )}
          </Section>

            </>
          )}

          {!t.counter && (
            <p className="preview">{rich(tr('ed.onTimeNoStreak', { amount: fmt(t.reward), cur }))}</p>
          )}
        </div>

        <footer className="sheet__foot">
          {isNew ? (
            <button className="btn" onClick={onClose}>
              {tr('common.cancel')}
            </button>
          ) : (
            <button
              className="btn btn--danger"
              onClick={() => {
                deleteTask(t.id)
                onClose()
              }}
            >
              {tr('common.delete')}
            </button>
          )}
          <button className="btn btn--go" onClick={save} disabled={!canSave}>
            {tr('common.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}

const blankChild = (parentId: string, reward: number): Task => ({
  ...blankTask(reward),
  parentId,
})

/**
 * One line per subtask: a name, an amount, and a counter when the thing is
 * counted rather than ticked. No unit — the line is already narrow, and "3/8"
 * says enough under a parent that names the bouquet.
 */
function SubtaskEditor({
  enfants,
  onChange,
  currency,
  onAdd,
}: {
  enfants: Task[]
  onChange: (e: Task[]) => void
  currency: string
  onAdd: () => void
}) {
  const set = (i: number, p: Partial<Task>) =>
    onChange(enfants.map((e, j) => (j === i ? { ...e, ...p } : e)))

  return (
    <div className="subs">
      {enfants.map((e, i) => (
        <div className="sub" key={e.id}>
          <div className="sub__row">
            <input
              className="input input--sm sub__name"
              value={e.name}
              onChange={(ev) => set(i, { name: ev.target.value })}
              placeholder={tr('ed.subtaskName')}
              aria-label={tr('ed.subtaskName')}
            />
            <NumberInput
              className="input input--xs"
              value={e.reward}
              min={0}
              onChange={(reward) => set(i, { reward })}
              aria-label={tr('ed.reward')}
            />
            <span className="field__suffix">{currency}</span>
            <button
              className="tier__del"
              onClick={() => onChange(enfants.filter((_, j) => j !== i))}
              aria-label={tr('ed.subtaskRemove')}
            >
              ✕
            </button>
          </div>
          <div className="sub__row">
            <label className="row row--check sub__count">
              <input
                type="checkbox"
                checked={!!e.counter}
                onChange={(ev) =>
                  set(i, { counter: ev.target.checked ? { target: 3, tiers: [] } : null })
                }
              />
              <span className="row__label">{tr('ed.subtaskCounter')}</span>
            </label>
            {e.counter && (
              <NumberInput
                className="input input--xs"
                value={e.counter.target}
                min={1}
                onChange={(target) => set(i, { counter: { ...e.counter!, target } })}
                aria-label={tr('ed.target')}
              />
            )}
          </div>
        </div>
      ))}
      <button className="link" onClick={onAdd}>
        {tr('ed.addSubtask')}
      </button>
    </div>
  )
}

/**
 * Streak simulation: what the task would pay on each completion in a row. The
 * amounts come from the same function as the real replay, so the preview cannot
 * lie about the result.
 */
function StreakSim({
  task,
  currency,
  everyDays,
}: {
  task: Task
  currency: string
  everyDays: number
}) {
  const cap = streakAtCap(task)
  const upTo = Math.min(12, Math.max(6, (cap ?? 6) + 1))
  const steps = Array.from({ length: upTo }, (_, i) => i + 1)
  const total = steps.reduce((sum, n) => sum + rewardAtStreak(task, n), 0)
  const span = (upTo - 1) * everyDays

  return (
    <div className="sim">
      <p className="hint">{tr('sim.title')}</p>
      <div className="sim__strip">
        {steps.map((n) => {
          const tier = (task.streak?.tiers ?? []).some((t) => t.at === n)
          return (
            <div key={n} className={`sim__step${cap !== null && n >= cap ? ' sim__step--cap' : ''}`}>
              {/* The rank in the streak, and the day it falls on. */}
              <span className="sim__n">
                {n}
                {everyDays > 1 && <em className="sim__day">j{(n - 1) * everyDays}</em>}
              </span>
              <span className="sim__v">
                {fmt(rewardAtStreak(task, n))}
                {tier && <em className="sim__tier">🎁</em>}
              </span>
            </div>
          )
        })}
      </div>
      <p className="hint">
        {cap !== null ? tr('sim.capAt', { n: cap }) : ''}
        {rich(
          tr('sim.total', {
            n: upTo,
            days: trn('sim.days', span),
            amount: fmt(total),
            cur: currency,
          }),
        )}
      </p>
    </div>
  )
}

/** How much the task still pays depending on lateness, and when it is worth nothing. */
function PenaltySim({ task, currency }: { task: Task; currency: string }) {
  const zero = daysUntilWorthless(task)
  const upTo = Math.min(8, (zero ?? 4) + 1)
  const days = Array.from({ length: upTo }, (_, i) => i)

  return (
    <div className="sim">
      <p className="hint">{tr('sim.late')}</p>
      <div className="sim__strip">
        {days.map((d) => (
          <div key={d} className={`sim__step${zero !== null && d >= zero ? ' sim__step--cap' : ''}`}>
            <span className="sim__n">{d === 0 ? tr('sim.onTime') : tr('sim.plusDays', { n: d })}</span>
            <span className={`sim__v${rewardAfterDays(task, d) === 0 ? ' sim__v--zero' : ''}`}>
              {fmt(rewardAfterDays(task, d))}
            </span>
          </div>
        ))}
      </div>
      <p className="hint">
        {zero !== null
          ? rich(tr('sim.worthless', { days: trn('sim.days', zero) }))
          : tr('sim.alwaysPays', { amount: fmt(rewardAfterDays(task, 60)), cur: currency })}
      </p>
    </div>
  )
}

function newPenalty(kind: Penalty['kind']): Penalty {
  switch (kind) {
    case 'flat':
      return { kind: 'flat', amount: 5 }
    case 'percent':
      return { kind: 'percent', percent: 50 }
    case 'decay':
      return { kind: 'decay', percentPerDay: 20 }
    case 'none':
      return { kind: 'none' }
  }
}

function PenaltyValue({
  penalty,
  currency,
  onChange,
}: {
  penalty: Penalty
  currency: string
  onChange: (p: Penalty) => void
}) {
  if (penalty.kind === 'none') return null

  const [value, suffix, key] =
    penalty.kind === 'flat'
      ? ([penalty.amount, currency, 'amount'] as const)
      : penalty.kind === 'percent'
        ? ([penalty.percent, tr('ed.percentOff'), 'percent'] as const)
        : ([penalty.percentPerDay, tr('ed.percentPerDay'), 'percentPerDay'] as const)

  return (
    <div className="row">
      <span className="row__label">{tr('ed.subtract')}</span>
      <span className="field__suffix">−</span>
      <NumberInput
        className="input input--xs"
        value={value}
        min={0}
        onChange={(n) => onChange({ ...penalty, [key]: n } as Penalty)}
        aria-label={tr('ed.penaltyValue')}
      />
      <span className="field__suffix">{suffix}</span>
    </div>
  )
}

function Section({
  title,
  hint,
  on,
  disabled,
  disabledHint,
  onToggle,
  children,
}: {
  title: string
  hint?: string
  on: boolean
  disabled?: boolean
  disabledHint?: string
  onToggle: (v: boolean) => void
  children?: ReactNode
}) {
  return (
    <section className={`sect${on ? ' sect--on' : ''}${disabled ? ' sect--off' : ''}`}>
      <label className="sect__head">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="sect__title">{title}</span>
        {disabled ? (
          <span className="sect__hint">{disabledHint}</span>
        ) : (
          hint && !on && <span className="sect__hint">{hint}</span>
        )}
      </label>
      {on && !disabled && <div className="sect__body">{children}</div>}
    </section>
  )
}
