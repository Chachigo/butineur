import { useState, type ReactNode } from 'react'
import {
  daysUntilWorthless,
  dueTsFor,
  rewardAfterDays,
  rewardAtStreak,
  rythme,
  streakAtCap,
  type Rythme,
} from '../engine'
import { combineDateTime, defaultDue, fmt, formatDueLong, toDateInput, toTimeInput } from '../format'
import { deleteTask, saveTask, uid, useDB } from '../store'
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

/** Monday first as in France; the value stays the one from `Date.getDay()`. */
const WEEKDAYS: [number, string, string][] = [
  [1, 'L', 'lundi'],
  [2, 'M', 'mardi'],
  [3, 'M', 'mercredi'],
  [4, 'J', 'jeudi'],
  [5, 'V', 'vendredi'],
  [6, 'S', 'samedi'],
  [0, 'D', 'dimanche'],
]

const RYTHMES: [Rythme, string][] = [
  ['jour', 'Chaque jour'],
  ['semaine', 'Chaque semaine'],
  ['mois', 'Chaque mois'],
  ['glissant', 'Tous les N jours'],
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
  return <p className="hint">Prochaine échéance : {formatDueLong(due)}</p>
}

const PENALTY_KINDS: [Penalty['kind'], string][] = [
  ['flat', 'montant fixe'],
  ['percent', 'pourcentage'],
  ['decay', 'dégressive par jour'],
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

  useCloseOnBack(true, onClose)

  // A target of zero would be reached straight away and pay immediately.
  const missingTarget = !!t.counter && t.counter.target < 1
  const canSave = !!t.name.trim() && !missingTarget

  const save = () => {
    if (!canSave) return
    saveTask({ ...t, name: t.name.trim() })
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>{isNew ? 'Nouvelle tâche' : 'Modifier'}</h2>
          <button className="sheet__x" onClick={onClose} aria-label="Fermer">
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
              placeholder="Nom de la tâche"
              aria-label="Nom"
            />
          </div>

          <label className="field">
            <span className="field__label">Récompense</span>
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

          <Section
            title="Tâche rapide"
            hint="Un bouton pour la reposer dans la liste"
            on={!!t.template}
            // A template waits to be pulled out: no rhythm and no deadline to meet.
            onToggle={(v) => patch({ template: v, repeat: v ? null : t.repeat })}
          >
            <p className="hint">
              Rangée hors de la liste, elle apparaît en raccourci au-dessus. Taper
              dessus en crée une copie à faire aujourd'hui.
            </p>
          </Section>

          <Section
            title="Répétitive"
            on={!!t.repeat}
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
                  <span className="row__label">Revient</span>
                  <select
                    className="input input--select"
                    value={rythme(t.repeat)}
                    onChange={(e) => patch({ repeat: newRepeat(e.target.value as Rythme, t.repeat!) })}
                    aria-label="Rythme"
                  >
                    {RYTHMES.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {rythme(t.repeat) === 'semaine' && (
                  <div className="days" role="group" aria-label="Jour de la semaine">
                    {WEEKDAYS.map(([value, letter, label]) => {
                      const on = t.repeat!.weekday === value
                      return (
                        <button
                          key={label}
                          type="button"
                          className={on ? 'day day--on' : 'day'}
                          title={label}
                          aria-label={label}
                          aria-pressed={on}
                          onClick={() => patch({ repeat: { ...t.repeat!, weekday: value } })}
                        >
                          {letter}
                        </button>
                      )
                    })}
                  </div>
                )}

                {rythme(t.repeat) === 'mois' && (
                  <div className="row">
                    <span className="row__label">Le</span>
                    <NumberInput
                      className="input input--xs"
                      value={t.repeat.monthday ?? 1}
                      min={1}
                      max={31}
                      onChange={(monthday) => patch({ repeat: { ...t.repeat!, monthday } })}
                      aria-label="Jour du mois"
                    />
                    <span className="field__suffix">du mois</span>
                  </div>
                )}

                {rythme(t.repeat) === 'glissant' && (
                  <>
                    <div className="row">
                      <span className="row__label">Tous les</span>
                      <NumberInput
                        className="input input--xs"
                        value={t.repeat.everyDays}
                        // Below 2 it is "every day": the same setting in two places
                        // would make no sense.
                        min={2}
                        onChange={(everyDays) => patch({ repeat: { everyDays } })}
                        aria-label="Nombre de jours"
                      />
                      <span className="field__suffix">jour(s)</span>
                    </div>
                    <p className="hint">
                      Le compte repart de la dernière validation : faire en retard décale la suite.
                    </p>
                  </>
                )}

                {/* L'heure appartient au rythme : « chaque dimanche à 20 h » se lit d'un trait. */}
                {t.due && (
                  <>
                    <div className="row">
                      <span className="row__label">En retard à partir de</span>
                      <input
                        className="input input--time"
                        type="time"
                        value={toTimeInput(t.due.at)}
                        onChange={(e) => {
                          const at = combineDateTime(toDateInput(t.due!.at), e.target.value)
                          if (at) patch({ due: { ...t.due!, at } })
                        }}
                        aria-label="Heure de l’échéance"
                      />
                    </div>
                    <NextDue task={t} state={state} />
                  </>
                )}
              </>
            )}
          </Section>

          <Section
            title="Compteur"
            hint="Ex. 8 verres d’eau par jour"
            on={!!t.counter}
            onToggle={(v) =>
              // Reaching the target pays the task's reward: no tier by default,
              // they only serve as intermediate bonuses.
              patch({ counter: v ? { target: 0, unit: 'fois', tiers: [] } : null })
            }
          >
            {t.counter && (
              <>
                <div className="row">
                  <span className="row__label">Objectif</span>
                  <NumberInput
                    className="input input--xs"
                    value={t.counter.target}
                    min={1}
                    placeholder="8"
                    onChange={(target) =>
                      patch({ counter: { ...t.counter!, target, tiers: retarget(t.counter!, target) } })
                    }
                    aria-label="Objectif"
                  />
                  <input
                    className="input input--unit"
                    value={t.counter.unit ?? ''}
                    onChange={(e) => patch({ counter: { ...t.counter!, unit: e.target.value } })}
                    placeholder="fois"
                    aria-label="Unité"
                  />
                </div>
                <p className="preview">
                  Objectif atteint :{' '}
                  <strong>
                    +{fmt(t.reward)} {cur}
                  </strong>
                </p>
                <p className="hint">Bonus intermédiaires (facultatif)</p>
                <TierEditor
                  tiers={t.counter.tiers}
                  onChange={(tiers) => patch({ counter: { ...t.counter!, tiers } })}
                  unit={t.counter.unit || 'fois'}
                  currency={cur}
                  max={t.counter.target}
                />
              </>
            )}
          </Section>

          {/* Une tâche qui revient tient son échéance de son rythme : pas de
              date à choisir, seulement pour celles qui n'arrivent qu'une fois. */}
          {!t.repeat && (
            <Section
              title="Date limite"
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
                    aria-label="Jour de l’échéance"
                  />
                  <input
                    className="input input--time"
                    type="time"
                    value={toTimeInput(t.due.at)}
                    onChange={(e) => {
                      const at = combineDateTime(toDateInput(t.due!.at), e.target.value)
                      if (at) patch({ due: { ...t.due!, at } })
                    }}
                    aria-label="Heure de l’échéance"
                  />
                </div>
              )}
            </Section>
          )}

          {t.due && (
            <Section
              title="Pénalité de retard"
              hint="Aucune : le retard ne coûte rien"
              on={t.due.penalty.kind !== 'none'}
              onToggle={(v) =>
                patch({ due: { ...t.due!, penalty: v ? defaultPenalty(t) : { kind: 'none' } } })
              }
            >
              {t.due.penalty.kind !== 'none' && (
                <>
                  <div className="row">
                    <span className="row__label">Type</span>
                    <select
                      className="input input--select"
                      value={t.due.penalty.kind}
                      onChange={(e) =>
                        patch({ due: { ...t.due!, penalty: newPenalty(e.target.value as Penalty['kind']) } })
                      }
                    >
                      {PENALTY_KINDS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
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
                  {/* La série, elle, ne se négocie pas : elle tombe au cycle manqué. */}
                  {t.streak && (
                    <p className="hint">
                      Sans rapport avec la série : elle tolère un jour de retard, au-delà
                      elle casse.
                    </p>
                  )}
                </>
              )}
            </Section>
          )}

          <Section
            title="Rappel"
            hint="Notification à une heure fixe"
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
                    à une heure fixe
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
                    le jour même
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
                    avant l’échéance
                  </button>
                </div>
                {remindKind(t) === 'before' && (
                  <p className="hint">
                    Compté depuis l’échéance ci-dessus : change l’heure dans « Date limite ».
                  </p>
                )}

                {remindKind(t) === 'jour' && (
                  <div className="row">
                    <span className="row__label">Le jour de l’échéance à</span>
                    <input
                      className="input input--time"
                      type="time"
                      value={(t.remind as { time: string }).time}
                      onChange={(e) =>
                        e.target.value && patch({ remind: { kind: 'jour', time: e.target.value } })
                      }
                      aria-label="Heure du rappel"
                    />
                  </div>
                )}

                {remindKind(t) === 'time' ? (
                  <div className="row">
                    <span className="row__label">Chaque jour à</span>
                    <input
                      className="input input--time"
                      type="time"
                      value={(t.remind as { time: string }).time}
                      onChange={(e) =>
                        e.target.value && patch({ remind: { kind: 'time', time: e.target.value } })
                      }
                      aria-label="Heure du rappel"
                    />
                  </div>
                ) : remindKind(t) === 'before' ? (
                  <div className="row">
                    <span className="row__label">Prévenir</span>
                    <NumberInput
                      className="input input--xs"
                      value={Math.round((t.remind as { minutes: number }).minutes / BEFORE_UNITS[beforeUnit(t)])}
                      min={1}
                      onChange={(v) =>
                        patch({ remind: { kind: 'before', minutes: v * BEFORE_UNITS[beforeUnit(t)] } })
                      }
                      aria-label="Délai avant l’échéance"
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
                      aria-label="Unité du délai"
                    >
                      <option value="minutes">minutes avant</option>
                      <option value="heures">heures avant</option>
                      <option value="jours">jours avant</option>
                    </select>
                  </div>
                ) : null}

                <p className="hint">
                  Envoyé seulement les jours où la tâche est à faire. Rien tant qu’elle
                  est déjà validée.
                </p>
              </>
            )}
          </Section>


          {/* Une série n'a de sens que sur une tâche qui revient. */}
          <Section
            title="Bonus de série"
            hint="Récompense la régularité"
            on={!!t.streak}
            disabled={!t.repeat}
            disabledHint="Active « Répétitive » d’abord"
            onToggle={(v) =>
              patch({ streak: v ? { tiers: [{ at: 3, bonus: 5 }], multiplier: null } : null })
            }
          >
            {t.streak && (
              <>
                <p className="hint">Paliers</p>
                <TierEditor
                  tiers={t.streak.tiers}
                  onChange={(tiers) => patch({ streak: { ...t.streak!, tiers } })}
                  unit="d’affilée"
                  currency={cur}
                />
                <Section
                  title="Multiplicateur"
                  on={!!t.streak.multiplier}
                  onToggle={(v) =>
                    patch({ streak: { ...t.streak!, multiplier: v ? { perStep: 0.1, cap: 2 } : null } })
                  }
                >
                  {t.streak.multiplier && (
                    <>
                      <div className="row">
                        <span className="row__label">Par cran</span>
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
                          aria-label="Pourcentage par cran"
                        />
                        <span className="field__suffix">%</span>
                      </div>
                      <div className="row">
                        <span className="row__label">Plafond</span>
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
                          aria-label="Plafond du multiplicateur"
                        />
                      </div>
                      <StreakSim task={t} currency={cur} everyDays={t.repeat?.everyDays ?? 1} />
                    </>
                  )}
                </Section>

                <Section
                  title="Encouragements"
                  hint="Notifications sur la série"
                  on={t.cheer}
                  onToggle={(cheer) => patch({ cheer })}
                >
                  <p className="hint">
                    Un message quand un palier approche, quand une série se casse, ou
                    quand ton record est à portée. Rien à dire, rien d’envoyé.
                  </p>
                </Section>
              </>
            )}
          </Section>

          {!t.counter && (
            <p className="preview">
              À l’heure et sans série :{' '}
              <strong>
                +{fmt(t.reward)} {cur}
              </strong>
            </p>
          )}
        </div>

        <footer className="sheet__foot">
          {isNew ? (
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
          ) : (
            <button
              className="btn btn--danger"
              onClick={() => {
                deleteTask(t.id)
                onClose()
              }}
            >
              Supprimer
            </button>
          )}
          <button className="btn btn--go" onClick={save} disabled={!canSave}>
            Enregistrer
          </button>
        </footer>
      </div>
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
      <p className="hint">Simulation</p>
      <div className="sim__strip">
        {steps.map((n) => {
          const tier = (task.streak?.tiers ?? []).some((t) => t.at === n)
          return (
            <div key={n} className={`sim__step${cap !== null && n >= cap ? ' sim__step--cap' : ''}`}>
              {/* Le rang de la série, et le jour où il tombe. */}
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
        {cap !== null ? `Plafond atteint à la ${cap}ᵉ. ` : ''}
        {upTo} validations d’affilée, soit {span} jour{span > 1 ? 's' : ''} ={' '}
        <strong className="sim__total">
          {fmt(total)} {currency}
        </strong>
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
      <p className="hint">Simulation du retard</p>
      <div className="sim__strip">
        {days.map((d) => (
          <div key={d} className={`sim__step${zero !== null && d >= zero ? ' sim__step--cap' : ''}`}>
            <span className="sim__n">{d === 0 ? 'à l’heure' : `+${d} j`}</span>
            <span className={`sim__v${rewardAfterDays(task, d) === 0 ? ' sim__v--zero' : ''}`}>
              {fmt(rewardAfterDays(task, d))}
            </span>
          </div>
        ))}
      </div>
      <p className="hint">
        {zero !== null ? (
          <>
            Ne rapporte plus rien à partir de{' '}
            <strong className="sim__total">
              {zero} jour{zero > 1 ? 's' : ''} de retard
            </strong>
            .
          </>
        ) : (
          <>
            Rapporte toujours quelque chose, même très en retard ({fmt(rewardAfterDays(task, 60))}{' '}
            {currency} au minimum).
          </>
        )}
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
        ? ([penalty.percent, '% en moins', 'percent'] as const)
        : ([penalty.percentPerDay, '% par jour', 'percentPerDay'] as const)

  return (
    <div className="row">
      <span className="row__label">Retrait</span>
      <span className="field__suffix">−</span>
      <NumberInput
        className="input input--xs"
        value={value}
        min={0}
        onChange={(n) => onChange({ ...penalty, [key]: n } as Penalty)}
        aria-label="Valeur de la pénalité"
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
