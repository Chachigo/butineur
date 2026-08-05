/**
 * Extrait de Phosphor la table nom -> caractères des seules icônes retenues,
 * et copie la police là où Android et le web la lisent.
 *
 * Une seule police pour les deux plateformes : le web affiche le(s)
 * caractère(s), le widget Android les affiche avec `@font/phosphor`. Pas de
 * rastérisation SVG à écrire côté Kotlin.
 *
 * Police duotone : chaque icône y porte DEUX caractères (fond, détail) à la
 * même position — c'est ce qui donne les deux tons, pas un réglage CSS sur
 * une police à un seul caractère. On stocke les deux à la suite dans la
 * valeur de l'icône (`ph:` + fond + détail) : web et Android dessinent l'un
 * sur l'autre, sans jamais avoir besoin de connaître le nom de l'icône.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const SRC = 'node_modules/@phosphor-icons/web/src/duotone'
// Uniquement pour retrouver, à la migration, quelle icône portait un ancien
// caractère de la police à un seul ton (avant ce changement).
const SRC_REGULAR = 'node_modules/@phosphor-icons/web/src/regular'

// Choisies pour ce que fait l'appli. Grouper ici sert directement le sélecteur.
// Une icône n'appartient qu'à un seul groupe — le contrôle plus bas le garantit,
// sinon elle apparaissait deux fois dans le sélecteur, sélectionnée aux deux
// endroits à la fois.
const GROUPS = {
  Maison: ['broom', 'washing-machine', 'bed', 'shower', 'trash', 'trash-simple', 'recycle',
    'toilet', 'toilet-paper', 'bathtub', 'basket', 'coat-hanger', 'plant', 'dog', 'cat',
    'fork-knife', 'cooking-pot', 'paint-brush-household', 'hammer', 'wrench', 'screwdriver',
    'lightbulb', 'key', 'package', 'shopping-cart'],
  Corps: ['barbell', 'person-simple-run', 'person-simple-bike', 'person-simple-walk',
    'heartbeat', 'pill', 'tooth', 'first-aid-kit', 'sneaker', 'yin-yang', 'brain'],
  Repas: ['drop', 'coffee', 'apple-logo', 'carrot', 'bread', 'egg', 'wine', 'beer-stein',
    'hamburger', 'bowl-food', 'orange-slice'],
  Travail: ['briefcase', 'laptop', 'books', 'pencil', 'note', 'calendar-dots', 'phone',
    'graduation-cap', 'chart-line', 'folders', 'envelope', 'clock'],
  Loisirs: ['palette', 'guitar', 'game-controller', 'camera', 'puzzle-piece', 'film-slate',
    'book-open', 'airplane-tilt', 'headphones', 'globe-hemisphere-west', 'television', 'music-notes'],
  Fête: ['confetti', 'balloon', 'cake', 'champagne', 'gift', 'cheers', 'martini',
    'beer-bottle', 'disco-ball', 'sparkle'],
  Divers: ['star', 'fire', 'check-circle', 'target', 'diamond', 'trophy', 'leaf', 'paw-print',
    'lightning', 'heart', 'bell', 'flag', 'medal', 'rocket', 'sun', 'moon'],
}

const tous = Object.values(GROUPS).flat()
const doublons = tous.filter((name, i) => tous.indexOf(name) !== i)
if (doublons.length) {
  console.error(`Icônes dans plusieurs groupes : ${[...new Set(doublons)].join(', ')}`)
  process.exit(1)
}

const css = readFileSync(`${SRC}/style.css`, 'utf8')
// Chaque icône a deux règles à la suite : `:before` (fond, 20% d'opacité)
// puis `:after` (détail, plein).
const duotone = new Map()
for (const m of css.matchAll(
  /\.ph-duotone\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([a-f0-9]+)"[^}]*\}\s*\.ph-duotone\.ph-\1:after\s*\{\s*content:\s*"\\([a-f0-9]+)"/g,
)) {
  duotone.set(m[1], [m[2], m[3]])
}

const cssRegular = readFileSync(`${SRC_REGULAR}/style.css`, 'utf8')
const regular = new Map()
for (const m of cssRegular.matchAll(/\.ph\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([a-f0-9]+)"/g)) {
  regular.set(m[1], m[2])
}

const missing = []
const out = {}
const migrate = {}
for (const [group, names] of Object.entries(GROUPS)) {
  out[group] = []
  for (const name of names) {
    const paire = duotone.get(name)
    if (!paire) {
      missing.push(name)
      continue
    }
    const deuxTons = String.fromCodePoint(parseInt(paire[0], 16)) + String.fromCodePoint(parseInt(paire[1], 16))
    out[group].push([name, deuxTons])
    const ancien = regular.get(name)
    if (ancien) migrate[String.fromCodePoint(parseInt(ancien, 16))] = deuxTons
  }
}

if (missing.length) {
  console.error(`Icônes introuvables dans Phosphor : ${missing.join(', ')}`)
  process.exit(1)
}

const total = Object.values(out).flat().length
writeFileSync(
  'src/ui/icons.generated.ts',
  `// Généré par scripts/build-icons.mjs — ne pas éditer à la main.\n` +
    `// ${total} icônes Phosphor duotone : [fond, détail] concaténés.\n` +
    `export const PHOSPHOR_GROUPS: [string, [string, string][]][] = ${JSON.stringify(
      Object.entries(out),
    )}\n\n` +
    `// D'un ancien caractère à un seul ton vers la paire duotone — migration au chargement.\n` +
    `export const PHOSPHOR_MIGRATE: Record<string, string> = ${JSON.stringify(migrate)}\n`,
)

mkdirSync('public/fonts', { recursive: true })
copyFileSync(`${SRC}/Phosphor-Duotone.woff2`, 'public/fonts/phosphor.woff2')
mkdirSync('android/app/src/main/res/font', { recursive: true })
copyFileSync(`${SRC}/Phosphor-Duotone.ttf`, 'android/app/src/main/res/font/phosphor.ttf')

console.log(`${total} icônes générées, police copiée (web + android).`)
