import { useEffect, useState } from 'react'

type Props = {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number | 'any'
  className?: string
  /** Avec un placeholder, `0` s'affiche vide : le champ suggère au lieu d'imposer. */
  placeholder?: string
  'aria-label'?: string
}

const clamp = (n: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

/** Le clavier français produit une virgule ; `Number` n'en veut pas. */
const parse = (s: string) => Number(s.replace(',', '.'))

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
  step = 'any',
  className = 'input',
  placeholder,
  ...rest
}: Props) {
  const shown = (n: number) => (placeholder && n === 0 ? '' : String(n))
  const [text, setText] = useState(() => shown(value))
  const [editing, setEditing] = useState(false)

  // On ne suit les changements venus d'ailleurs que quand l'utilisateur ne tape pas.
  useEffect(() => {
    if (!editing) setText(shown(value))
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
        const n = parse(e.target.value)
        // Seules les valeurs déjà valides remontent ; le clamp attend le blur.
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
      placeholder={placeholder}
      onBlur={() => {
        setEditing(false)
        const n = parse(text)
        // Vidé alors qu'un placeholder existe : on laisse à zéro, c'est « non renseigné ».
        if (text === '' && placeholder) {
          if (value !== 0) onChange(0)
          return
        }
        const next = clamp(Number.isFinite(n) && text !== '' ? n : (min ?? 0), min, max)
        setText(String(next))
        if (next !== value) onChange(next)
      }}
    />
  )
}
