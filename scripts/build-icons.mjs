/**
 * Extracts from Phosphor the name -> characters table of the selected icons
 * only, and copies the font where Android and the web read it.
 *
 * A single font for both platforms: the web draws the character(s), the Android
 * widget draws them with `@font/phosphor`. No SVG rasterisation to write on the
 * Kotlin side.
 *
 * Duotone font: every icon carries TWO characters (background, detail) at the
 * same position — that is what gives the two tones, not a CSS setting over a
 * single-character font. Both are stored back to back in the icon value
 * (`ph:` + background + detail): web and Android draw one over the other,
 * without ever needing to know the icon's name.
 *
 * The font copied here is the complete one; `scripts/subset-font.py` then cuts
 * it down to the selected icons only. Go through `npm run icons`, which chains
 * both — otherwise we ship 1510 icons for the ones we actually use.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const SRC = 'node_modules/@phosphor-icons/web/src/duotone'
// Only to find out, at migration time, which icon carried an old single-tone
// character of the font (before that change).
const SRC_REGULAR = 'node_modules/@phosphor-icons/web/src/regular'

// Picked for what the app does. Grouping them here directly serves the picker.
// An icon belongs to a single group — the check further down guarantees it,
// otherwise it showed up twice in the picker, selected in both places at once.
const GROUPS = {
  Maison: ['broom', 'washing-machine', 'bed', 'shower', 'bathtub', 'toilet', 'toilet-paper',
    'towel', 'trash', 'trash-simple', 'recycle', 'basket', 'bag', 'couch', 'fan', 'wall',
    'paint-brush-household', 'paint-roller', 'hammer', 'wrench', 'screwdriver', 'lightbulb',
    'key', 'package', 'shopping-cart'],
  Corps: ['barbell', 'person-simple-run', 'person-simple-bike', 'person-simple-walk',
    'brain', 'eye', 'hair-dryer', 'yin-yang'],
  Santé: ['bandaids', 'first-aid-kit', 'heartbeat', 'pill', 'syringe', 'tooth', 'face-mask',
    'cigarette-slash', 'flask', 'test-tube'],
  Repas: ['drop', 'coffee', 'apple-logo', 'carrot', 'bread', 'egg', 'cheese', 'cherries',
    'hamburger', 'pizza', 'ice-cream', 'bowl-food', 'bowl-steam', 'onigiri', 'orange-slice',
    'cooking-pot', 'chef-hat', 'fork-knife', 'jar-label'],
  Fête: ['confetti', 'balloon', 'cake', 'champagne', 'gift', 'cheers', 'martini', 'brandy',
    'wine', 'beer-stein', 'beer-bottle', 'disco-ball'],
  Travail: ['briefcase', 'books', 'pencil', 'note', 'note-pencil', 'push-pin', 'calendar-dots',
    'calendar-check', 'calendar-star', 'clock', 'phone', 'envelope', 'chat-dots',
    'chat-circle-dots', 'video-conference', 'voicemail', 'graduation-cap', 'chart-line',
    'gavel', 'factory'],
  Informatique: ['laptop', 'desktop', 'desktop-tower', 'code', 'password', 'hard-drives',
    'floppy-disk-back', 'file', 'folder-simple', 'folders', 'download', 'video', 'head-circuit'],
  Loisirs: ['palette', 'guitar', 'music-note', 'music-notes', 'microphone-stage', 'headphones',
    'game-controller', 'puzzle-piece', 'lego', 'camera', 'video-camera', 'film-slate',
    'television', 'book-open', 'globe-hemisphere-west', 'binoculars', 'ticket', 'yarn',
    'beach-ball', 'bowling-ball'],
  Transport: ['airplane-tilt', 'bicycle', 'bus', 'car-profile', 'van', 'sailboat', 'suitcase',
    'gas-pump', 'engine', 'tire', 'car-battery', 'bridge'],
  Vêtements: ['t-shirt', 'pants', 'dress', 'sock', 'sneaker', 'boot', 'high-heel',
    'coat-hanger', 'eyeglasses', 'watch'],
  Animaux: ['dog', 'cat', 'rabbit', 'bird', 'cow', 'butterfly', 'paw-print', 'bone', 'feather'],
  Nature: ['plant', 'leaf', 'sun', 'moon', 'rainbow', 'mountains', 'tent', 'umbrella'],
  Divers: ['star', 'sparkle', 'fire', 'lightning', 'heart', 'check-circle', 'check-fat',
    'target', 'diamond', 'trophy', 'medal', 'flag', 'bell', 'rocket', 'ghost', 'info',
    'user', 'coins', 'vault', 'scales'],
}

const tous = Object.values(GROUPS).flat()
const doublons = tous.filter((name, i) => tous.indexOf(name) !== i)
if (doublons.length) {
  console.error(`Icônes dans plusieurs groupes : ${[...new Set(doublons)].join(', ')}`)
  process.exit(1)
}

const css = readFileSync(`${SRC}/style.css`, 'utf8')
// Every icon has two rules back to back: `:before` (background, 20% opacity)
// then `:after` (detail, full).
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
