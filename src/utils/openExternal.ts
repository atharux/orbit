import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

// A plain <a target="_blank"> click is a no-op inside the Tauri webview --
// there's no "new browser tab" for it to open. Outside Tauri (npm run dev in
// a normal browser) window.open works exactly as usual, so this only takes
// the special path when it actually needs to. Static import: plugin-opener
// is tiny and already pulled in by the other Tauri plugins, so a dynamic
// import here wouldn't achieve any real code-splitting.
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
