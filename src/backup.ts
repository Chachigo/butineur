import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './native'
import type { DB } from './types'

/**
 * Une sauvegarde est le contenu brut de la base, entouré du minimum permettant
 * de la relire plus tard : un numéro de format et une date. Le solde n'y figure
 * pas — il se recalcule du journal, l'écrire serait le figer.
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
 * Écrit le fichier puis propose de l'envoyer. Sur le web, un simple
 * téléchargement suffit — c'est le seul endroit où la plateforme change quelque
 * chose, le reste du chemin est commun.
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

  // Le partage est un bonus : le fichier est déjà écrit dans Documents. Refuser
  // la feuille de partage ne doit donc pas ressembler à une sauvegarde ratée.
  void Share.share({
    title: 'Sauvegarde Butineur',
    url: uri,
    dialogTitle: 'Envoyer la sauvegarde',
  }).catch(() => {})

  return name
}

export type ImportResult = { tasks: number; events: number; shopItems: number }

/**
 * Relit une sauvegarde. On valide la forme avant de rendre quoi que ce soit :
 * importer un fichier étranger écraserait tout, autant refuser tôt et
 * clairement plutôt que de laisser une base à moitié écrite.
 */
export function parseBackup(text: string): DB {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Ce fichier n’est pas du JSON valide.')
  }

  const b = parsed as Partial<Backup>
  if (b?.app !== 'butineur') throw new Error('Ce fichier ne vient pas de Butineur.')
  if (b.format !== FORMAT) throw new Error(`Format de sauvegarde inconnu (${String(b.format)}).`)

  const db = b.db as Partial<DB> | undefined
  if (!db || !Array.isArray(db.tasks) || !Array.isArray(db.events)) {
    throw new Error('Sauvegarde incomplète : tâches ou journal manquants.')
  }

  return {
    tasks: db.tasks,
    shopItems: Array.isArray(db.shopItems) ? db.shopItems : [],
    events: db.events,
    settings: db.settings as DB['settings'],
  }
}
