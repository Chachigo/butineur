import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './native'
import type { DB } from './types'
import { tr } from './i18n'

/**
 * A backup is the raw content of the database, wrapped in the minimum needed to
 * read it back later: a format number and a date. The balance is not in it — it
 * is recomputed from the log, writing it down would freeze it.
 */
export type Backup = {
  format: 1
  app: 'butineur'
  exportedAt: string
  db: DB
}

const FORMAT = 1

export const backupName = (now = new Date()) =>
  `butineur-${now.toISOString().slice(0, 10)}.json`

export function serialize(db: DB): string {
  const backup: Backup = { format: FORMAT, app: 'butineur', exportedAt: new Date().toISOString(), db }
  return JSON.stringify(backup, null, 2)
}

/**
 * Writes the file then offers to send it. On the web a plain download is enough
 * — this is the only place where the platform changes anything, the rest of the
 * path is shared.
 */
export async function exportBackup(db: DB): Promise<string> {
  const name = backupName()
  const data = serialize(db)

  if (!isNative) {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    return name
  }

  const { uri } = await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  })

  // Sharing is a bonus: the file is already written to Documents. Dismissing the
  // share sheet must therefore not look like a failed backup.
  void Share.share({
    title: 'Sauvegarde Butineur',
    url: uri,
    dialogTitle: 'Envoyer la sauvegarde',
  }).catch(() => {})

  return name
}

export type ImportResult = { tasks: number; events: number; shopItems: number }

/**
 * Reads a backup back. The shape is validated before anything is returned:
 * importing a foreign file would overwrite everything, so better refuse early
 * and clearly than leave a half-written database.
 */
export function parseBackup(text: string): DB {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(tr('bk.notJson'))
  }

  const b = parsed as Partial<Backup>
  if (b?.app !== 'butineur') throw new Error(tr('bk.notButineur'))
  if (b.format !== FORMAT) throw new Error(tr('bk.unknownFormat', { format: String(b.format) }))

  const db = b.db as Partial<DB> | undefined
  if (!db || !Array.isArray(db.tasks) || !Array.isArray(db.events)) {
    throw new Error(tr('bk.incomplete'))
  }

  return {
    tasks: db.tasks,
    shopItems: Array.isArray(db.shopItems) ? db.shopItems : [],
    events: db.events,
    settings: db.settings as DB['settings'],
  }
}
