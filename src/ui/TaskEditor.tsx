import { useState, type ReactNode } from 'react'
import { daysUntilWorthless, rewardAfterDays, rewardAtStreak, streakAtCap } from '../engine'
import { combineDateTime, defaultDue, fmt, toDateInput, toTimeInput } from '../format'
import { deleteTask, saveTask, uid, useDB } from '../store'
import type { Penalty, Task, Tier } from '../types'
import IconPicker from './IconPicker'
import NumberInput from './NumberInput'
import TierEditor from './TierEditor'

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
 * Borne les paliers quand l'objectif baisse : le compteur plafonne à l'objectif,
 * un palier au-delà ne tomberait jamais.
 */
function retarget(counter: NonNullable<Task['counter']>, next: number): Tier[] {
  const clamped = counter.tiers.map((t) => ({ ...t, at: Math.min(t.at, next) }))
  // Le recalage peut faire doublon : un seul palier par valeur.
  return [...new Map(clamped.map((t) => [t.at, t])).values()].sort((a, b) => a.at - b.at)
}

/** Index = `Date.getDay()`, dimanche en premier. */
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

const PENALTY_KINDS: [Penalty['kind'], string][] = [
  ['none', 'aucune'],
  ['flat', 'montant fixe'],
  ['percent', 'pourcentage'],
  ['decay', 'dégressive par jour'],
]

export default function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const db = useDB()
  const [t, setT] = useState(task)
  const isNew = !db.tasks.some((x) => x.id === task.id)
  const patch = (p: Partial<Task>) => setT((prev) => ({ ...prev, ...p }))
  const cur = db.settings.currency

  // Un objectif à zéro serait atteint d'emblée et paierait aussitôt.
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
            title="Répétitive"
            on={!!t.repeat}
            // Retirer la répétition emporte la série : elle n'aurait plus de sens.
            onToggle={(v) => patch({ repeat: v ? { everyDays: 1 } : null, streak: v ? t.streak : null })}
          >
            {t.repeat && (
              <div className="row">
                <span className="row__label">Tous les</span>
                <NumberInput
                  className="input input--xs"
                  value={t.repeat.everyDays}
                  min={1}
                  onChange={(everyDays) => patch({ repeat: { everyDays } })}
                  aria-label="Nombre de jours"
                />
                <span className="field__suffix">jour(s)</span>
              </div>
            )}
          </Section>

          <Section
            title="Compteur"
            hint="Ex. 8 verres d’eau par jour"
            on={!!t.counter}
            onToggle={(v) =>
              // Atteindre l'objectif verse la récompense de la tâche : pas de
              // palier par défaut, ils ne servent qu'aux bonus intermédiaires.
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

          <Section
            title="Date limite"
            on={!!t.due}
            onToggle={(v) =>
              patch({ due: v ? { at: defaultDue(), penalty: { kind: 'decay', percentPerDay: 20 } } : null })
            }
          >
            {t.due && (
              <>
                <div className="row">
                  {/* Une date figée n'a aucun sens sur une tâche qui revient. */}
                  {t.repeat ? (
                    <select
                      className="input input--select"
                      value={t.due.weekday ?? ''}
                      onChange={(e) =>
                        patch({
                          due: {
                            ...t.due!,
                            weekday: e.target.value === '' ? undefined : Number(e.target.value),
                          },
                        })
                      }
                      aria-label="Jour de l’échéance"
                    >
                      <option value="">à chaque cycle</option>
                      {WEEKDAYS.map((label, i) => (
                        <option key={i} value={i}>
                          chaque {label}
                        </option>
                      ))}
                    </select>
                  ) : (
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
                  )}
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
                {t.repeat && t.due.weekday == null && (
                  <p className="hint">L’échéance glisse d’un cycle à chaque passage.</p>
                )}

                <div className="row">
                  <span className="row__label">Pénalité</span>
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
                {t.due.penalty.kind !== 'none' && <PenaltySim task={t} currency={cur} />}
              </>
            )}
          </Section>

          <Section
            title="Rappel"
            hint="Notification à une heure fixe"
            on={!!t.remind}
            onToggle={(v) => patch({ remind: v ? { time: '19:00' } : null })}
          >
            {t.remind && (
              <>
                <div className="row">
                  <span className="row__label">Chaque jour à</span>
                  <input
                    className="input input--time"
                    type="time"
                    value={t.remind.time}
                    onChange={(e) =>
                      e.target.value && patch({ remind: { time: e.target.value } })
                    }
                    aria-label="Heure du rappel"
                  />
                </div>
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
 * Simulation d'une série : ce que la tâche rapporterait à chaque validation
 * d'affilée. Les montants viennent de la même fonction que le rejeu réel,
 * donc l'aperçu ne peut pas mentir sur le résultat.
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

/** Combien la tâche rapporte encore selon le retard, et quand elle ne vaut plus rien. */
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
