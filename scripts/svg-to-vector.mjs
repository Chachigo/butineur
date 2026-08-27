/**
 * Converts a simple SVG (`<path>` elements only) into an Android VectorDrawable.
 *
 * Android Studio can do it, but not from the command line: without this the icon
 * cannot be regenerated reproducibly. Deliberately limited to paths — that is
 * all we need, and it saves writing an SVG engine.
 *
 *   node scripts/svg-to-vector.mjs input.svg output.xml [size_dp]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output, sizeDp = '108'] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/svg-to-vector.mjs entree.svg sortie.xml [taille_dp]')
  process.exit(1)
}

const svg = readFileSync(input, 'utf8')

const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
if (!viewBox) throw new Error('viewBox absent — impossible de connaître le repère du dessin')
const [, , vw, vh] = viewBox.trim().split(/[\s,]+/).map(Number)

/** Noto writes `style="fill:#abc"`, Twemoji `fill="#abc"`: both are accepted. */
function fillOf(attrs) {
  const direct = attrs.match(/\bfill="([^"]*)"/)?.[1]
  const styled = attrs.match(/style="[^"]*\bfill:\s*([^;"]+)/)?.[1]
  const raw = (direct ?? styled ?? '#000000').trim()
  if (raw === 'none') return null
  // VectorDrawable wants #RRGGBB, not color names.
  return raw.startsWith('#') ? raw.toUpperCase() : '#000000'
}

const paths = []
for (const m of svg.matchAll(/<path\b([^>]*?)\/?>/g)) {
  const attrs = m[1]
  const d = attrs.match(/\bd="([^"]+)"/)?.[1]
  if (!d) continue
  const fill = fillOf(attrs)
  if (!fill) continue
  const opacity = attrs.match(/\b(?:fill-)?opacity="([^"]+)"/)?.[1]
  paths.push({ d: d.replace(/\s+/g, ' ').trim(), fill, opacity })
}

if (!paths.length) throw new Error('aucun <path> exploitable')

const body = paths
  .map(
    (p) =>
      `    <path\n        android:fillColor="${p.fill}"` +
      (p.opacity ? `\n        android:fillAlpha="${p.opacity}"` : '') +
      `\n        android:pathData="${p.d}" />`,
  )
  .join('\n')

writeFileSync(
  output,
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/svg-to-vector.mjs depuis ${input.split('/').pop()} — ne pas éditer à la main. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${sizeDp}dp"
    android:height="${sizeDp}dp"
    android:viewportWidth="${vw}"
    android:viewportHeight="${vh}">
${body}
</vector>
`,
)

console.log(`${paths.length} chemins convertis → ${output} (repère ${vw}×${vh})`)
