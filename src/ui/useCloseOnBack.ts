import { useEffect, useRef } from 'react'

/**
 * Panneaux ouverts, du plus ancien au plus récent. Le bouton « retour » ferme
 * toujours le dernier — un sélecteur d'icône se referme donc avant l'éditeur
 * qui le contient.
 */
const stack: (() => void)[] = []

declare global {
  interface Window {
    /** Appelé par MainActivity au bouton retour. Vrai si un panneau a été fermé. */
    butineurBack?: () => boolean
  }
}

if (typeof window !== 'undefined') {
  window.butineurBack = () => {
    const close = stack.pop()
    if (!close) return false
    close()
    return true
  }
}

/**
 * Ferme un panneau au bouton « retour » du téléphone.
 *
 * On ne passe pas par l'historique de la WebView : `canGoBack()` ignore les
 * entrées ajoutées par `pushState` dans le montage Capacitor, le natif croyait
 * donc n'avoir rien à fermer. C'est le web qui répond, puisque c'est lui qui
 * sait quels panneaux sont ouverts.
 */
export function useCloseOnBack(open: boolean, onClose: () => void) {
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    if (!open) return
    const entry = () => latest.current()
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
}
