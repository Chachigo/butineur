/**
 * Une icône de tâche est soit un emoji, soit un glyphe Phosphor préfixé `ph:`.
 *
 * On stocke le caractère lui-même, pas le nom de l'icône : les widgets Android
 * affichent alors la même chaîne avec la même police, sans table de
 * correspondance à dupliquer côté Kotlin.
 */
const PH = 'ph:'

export const isPhosphor = (icon: string) => icon.startsWith(PH)
export const phosphor = (char: string) => PH + char
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
  return (
    <span className={`${className} ${isPhosphor(value) ? 'ph-glyph' : ''}`.trim()}>
      {iconChar(value)}
    </span>
  )
}
