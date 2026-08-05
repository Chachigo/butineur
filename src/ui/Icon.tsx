/**
 * Une icône de tâche est soit un emoji, soit un glyphe Phosphor préfixé `ph:`.
 *
 * On stocke le ou les caractères eux-mêmes, pas le nom de l'icône : les widgets
 * Android affichent alors la même chaîne avec la même police, sans table de
 * correspondance à dupliquer côté Kotlin.
 *
 * La police est duotone : une icône y vaut **deux** caractères dessinés l'un
 * sur l'autre — le fond, qui porte la couleur d'accentuation, puis le détail.
 * Un seul caractère est une icône d'avant ce changement : on la rend telle
 * quelle plutôt que d'afficher une silhouette sans son détail.
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
