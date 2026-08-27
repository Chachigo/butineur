/**
 * Screenshots for the README and the blog, on demo data — never the real tasks.
 * Prerequisite: `npm run dev` running.
 *
 *   node scripts/screenshots.mjs [output folder]
 *
 * The seed lives in `screenshots-seed.js` and writes straight into IndexedDB:
 * the same database as the app, without going through the interface.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 9333
const APP = 'http://localhost:5173'
const OUT = process.argv[2] ?? 'docs/demo'
const seed = await readFile(new URL('./screenshots-seed.js', import.meta.url), 'utf8')

await fetch(APP).catch(() => {
  throw new Error(`${APP} ne répond pas — lancer \`npm run dev\` d'abord.`)
})

const profil = await mkdtemp(join(tmpdir(), 'butineur-shots-'))
const chrome = spawn(
  'chromium-browser',
  [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
   '--no-first-run', '--hide-scrollbars', APP],
  { stdio: 'ignore' },
)
process.on('exit', () => chrome.kill())
// The debug port takes a second to open; we retry rather than gamble.
let targets
for (let i = 0; i < 30 && !targets; i++) {
  await new Promise((r) => setTimeout(r, 500))
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json().catch(() => null)
}
if (!targets) throw new Error('chromium n’a pas ouvert son port de debug')
const page = targets.find((t) => t.type === 'page' && t.url.includes('5173'))
if (!page) throw new Error('page 5173 introuvable')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const waiters = new Map()
const events = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiters.has(m.id)) waiters.get(m.id)(m)
  else if (m.method) events.push(m.method)
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    waiters.set(i, (m) => (m.error ? rej(new Error(method + ' : ' + m.error.message)) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'erreur JS')
  return r.result.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await mkdir(OUT, { recursive: true })
await send('Page.enable')
// 400 × 860 is a reasonable phone screen; the scale factor sets the file size.
// At 1, a capture is 400 × 1290 and weighs a third of what it weighed at 2.5.
// `DSF=2` for 800 × 1720, to zoom into.
await send('Emulation.setDeviceMetricsOverride', {
  width: 400,
  height: 860,
  deviceScaleFactor: Number(process.env.DSF) || 1,
  mobile: true,
})
// Entrance animations would spoil a capture taken too early.
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

console.log('semis :', await evaluate(seed))
await send('Page.reload')
await wait(2500)

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('→', `${OUT}/${name}.png`)
}

const click = async (selector, texte) => {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((e) => ${texte ? `e.textContent.includes(${JSON.stringify(texte)})` : 'true'})
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`introuvable : ${selector} ${texte ?? ''}`)
  await wait(600)
}

await shot('01-taches')

await click('.task__body', 'Vaisselle')
await shot('02-fiche')
await click('.sheet__x')

// The sport task's editor: it is the one carrying a multiplier, hence the most
// telling simulation.
await click('.task__body', '20 minutes de sport')
await click('.btn--go', 'Modifier')
await wait(400)
await shot('03-editeur')
// The streak block sits further down the editor.
await evaluate(`document.querySelector('.sheet__body, .editor, form')?.scrollBy(0, 950)`)
await wait(400)
await shot('04-editeur-serie')
await click('.sheet__x')

await click('.tab', 'Boutique')
await shot('05-boutique')
await click('.tab', 'Historique')
await shot('06-historique')
await click('.tab', 'Stats')
await shot('07-stats')

ws.close()
chrome.kill()
await rm(profil, { recursive: true, force: true })
