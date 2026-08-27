import { useEffect, useState } from 'react'

type Props = {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number | 'any'
  className?: string
  /** With a placeholder, `0` shows as empty: the field suggests instead of imposing. */
  placeholder?: string
  'aria-label'?: string
}

const clamp = (n: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

/** The French keyboard produces a comma; `Number` will not take one. */
const parse = (s: string) => Number(s.replace(',', '.'))

/**
 * Number field that accepts being empty while typing.
 *
 * Clamping the value on every keystroke made it impossible to erase "8" to type
 * "3": as soon as the field was emptied, the lower bound wrote itself back in.
 * Here the typed text belongs to the field for as long as it has focus, and the
 * clamp only happens on blur.
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

  // Changes coming from elsewhere are only followed while the user is not typing.
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
        // Only already-valid values are propagated; the clamp waits for the blur.
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
      placeholder={placeholder}
      onBlur={() => {
        setEditing(false)
        const n = parse(text)
        // Emptied while a placeholder exists: left at zero, meaning "not set".
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
