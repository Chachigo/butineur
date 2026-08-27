/**
 * A task icon is either an emoji or a Phosphor glyph prefixed with `ph:`.
 *
 * We store the character(s) themselves, not the icon name: the Android widgets
 * then draw the same string with the same font, with no lookup table to
 * duplicate on the Kotlin side.
 *
 * The font is duotone: an icon is worth **two** characters drawn on top of each
 * other — the background, which carries the accent color, then the detail. A
 * single character is an icon from before that change: it is rendered as is
 * rather than showing a silhouette without its detail.
 */
const PH = 'ph:'

export const isPhosphor = (icon: string) => icon.startsWith(PH)
export const phosphor = (chars: string) => PH + chars
export const iconChar = (icon: string) => (isPhosphor(icon) ? icon.slice(PH.length) : icon)

export default function Icon({
  icon,
  fallback,
  className = '',
}: {
  icon: string
  fallback: string
  className?: string
}) {
  const value = icon || fallback
  if (!isPhosphor(value)) return <span className={className}>{value}</span>

  const [fond, detail] = [...iconChar(value)]
  return (
    <span className={`${className} ph-glyph`.trim()}>
      <span className="ph-glyph__fond">{fond}</span>
      {detail && <span className="ph-glyph__detail">{detail}</span>}
    </span>
  )
}
