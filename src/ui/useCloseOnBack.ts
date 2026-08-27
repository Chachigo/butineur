import { useEffect, useRef } from 'react'

/**
 * Open panels, oldest to most recent. The "back" button always closes the last
 * one — an icon picker therefore closes before the editor that contains it.
 */
const stack: (() => void)[] = []

declare global {
  interface Window {
    /** Called by MainActivity on the back button. True if a panel was closed. */
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
 * Closes a panel on the phone's "back" button.
 *
 * We do not go through the WebView history: `canGoBack()` ignores the entries
 * added by `pushState` in the Capacitor setup, so the native side believed it
 * had nothing to close. The web side answers, since it is the one that knows
 * which panels are open.
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
