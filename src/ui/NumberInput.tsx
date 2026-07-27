import { useEffect, useState } from 'react'

type Props = {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  'aria-label'?: string
}

const clamp = (n: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

/**
 * Champ numérique qui accepte d'être vide pendant la saisie.
 *
 * Clamper la valeur à chaque frappe empêchait d'effacer « 8 » pour taper « 3 » :
 * dès le champ vidé, la borne minimale se réécrivait dedans. Ici le texte tapé
 * appartient au champ tant qu'il a le focus, et le clamp n'a lieu qu'à la sortie.
 */
export default function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className = 'input',
  ...rest
}: Props) {
  const [text, setText] = useState(() => String(value))
  const [editing, setEditing] = useState(false)

  // On ne suit les changements venus d'ailleurs que quand l'utilisateur ne tape pas.
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  return (
    <input
      {...rest}
      className={className}
      type="number"
      step={step}
      min={min}
      max={max}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        // Seules les valeurs déjà valides remontent ; le clamp attend le blur.
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        setEditing(false)
        const n = Number(text)
        const next = clamp(Number.isFinite(n) && text !== '' ? n : (min ?? 0), min, max)
        setText(String(next))
        if (next !== value) onChange(next)
      }}
    />
  )
}
