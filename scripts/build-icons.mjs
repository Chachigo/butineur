/**
 * Extrait de Phosphor la table nom -> codepoint des seules icônes retenues,
 * et copie la police là où Android et le web la lisent.
 *
 * Une seule police pour les deux plateformes : le web affiche le caractère,
 * le widget Android affiche le même caractère avec `@font/phosphor`. Pas de
 * rastérisation SVG à écrire côté Kotlin.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const SRC = 'node_modules/@phosphor-icons/web/src/regular'

// Choisies pour ce que fait l'appli. Grouper ici sert directement le sélecteur.
const GROUPS = {
  Maison: ['broom', 'washing-machine', 'bed', 'shower', 'trash', 'plant', 'dog', 'cat',
    'fork-knife', 'cooking-pot', 'toilet-paper', 'hammer', 'lightbulb', 'key', 'package', 'shopping-cart'],
  Corps: ['barbell', 'person-simple-run', 'person-simple-bike', 'person-simple-walk',
    'heartbeat', 'pill', 'tooth', 'bed', 'first-aid-kit', 'sneaker', 'yin-yang', 'brain'],
  Repas: ['drop', 'coffee', 'apple-logo', 'carrot', 'bread', 'egg', 'wine', 'beer-stein',
    'hamburger', 'cake', 'bowl-food', 'orange-slice'],
  Travail: ['briefcase', 'laptop', 'books', 'pencil', 'note', 'calendar-dots', 'phone',
    'graduation-cap', 'chart-line', 'folders', 'envelope', 'clock'],
  Loisirs: ['palette', 'guitar', 'game-controller', 'camera', 'puzzle-piece', 'film-slate',
    'book-open', 'airplane-tilt', 'headphones', 'globe-hemisphere-west', 'television', 'music-notes'],
  Divers: ['star', 'fire', 'check-circle', 'target', 'diamond', 'trophy', 'leaf', 'paw-print',
    'lightning', 'heart', 'bell', 'flag', 'medal', 'rocket', 'sun', 'moon'],
}

const css = readFileSync(`${SRC}/style.css`, 'utf8')
const codepoints = new Map()
for (const m of css.matchAll(/\.ph\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([a-f0-9]+)"/g)) {
  codepoints.set(m[1], m[2])
}

const missing = []
const out = {}
for (const [group, names] of Object.entries(GROUPS)) {
  out[group] = []
  for (const name of names) {
    const cp = codepoints.get(name)
    if (!cp) {
      missing.push(name)
      continue
    }
    out[group].push([name, String.fromCodePoint(parseInt(cp, 16))])
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
    `// ${total} icônes Phosphor, avec le caractère de la police.\n` +
    `export const PHOSPHOR_GROUPS: [string, [string, string][]][] = ${JSON.stringify(
      Object.entries(out),
    )}\n`,
)

mkdirSync('public/fonts', { recursive: true })
copyFileSync(`${SRC}/Phosphor.woff2`, 'public/fonts/phosphor.woff2')
mkdirSync('android/app/src/main/res/font', { recursive: true })
copyFileSync(`${SRC}/Phosphor.ttf`, 'android/app/src/main/res/font/phosphor.ttf')

console.log(`${total} icônes générées, police copiée (web + android).`)
