import type { Tier } from '../types'
import NumberInput from './NumberInput'

type Props = {
  tiers: Tier[]
  onChange: (t: Tier[]) => void
  /** What `at` counts: "in a row", "glasses"… */
  unit: string
  currency: string
  /** On a counter, a tier beyond the target would never be crossed. */
  max?: number
}

/** Streak tiers and counter tiers: same shape, same editor. */
export default function TierEditor({ tiers, onChange, unit, currency, max }: Props) {
  const set = (i: number, p: Partial<Tier>) =>
    onChange(tiers.map((t, j) => (j === i ? { ...t, ...p } : t)))

  return (
    <div className="tiers">
      {tiers.map((t, i) => (
        <div className="tier" key={i}>
          <NumberInput
            className="input input--xs"
            value={t.at}
            min={1}
            max={max}
            onChange={(at) => set(i, { at })}
            aria-label={`Palier ${i + 1} : ${unit}`}
          />
          <span className="tier__unit">{unit}</span>
          <span className="tier__arrow">→</span>
          <NumberInput
            className="input input--xs"
            value={t.bonus}
            onChange={(bonus) => set(i, { bonus })}
            aria-label={`Bonus du palier ${i + 1}`}
          />
          <span className="tier__unit">{currency}</span>
          <button
            className="tier__del"
            onClick={() => onChange(tiers.filter((_, j) => j !== i))}
            aria-label="Retirer ce palier"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="link"
        onClick={() => onChange([...tiers, { at: (tiers[tiers.length - 1]?.at ?? 0) + 1, bonus: 10 }])}
      >
        + ajouter un palier
      </button>
    </div>
  )
}
