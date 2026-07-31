const SETTINGS_KEY = 'pocket-leads:settings'

export interface AppSettings {
  openRouterApiKey: string
  openRouterModel: string
  scraperUrl: string
  autoEnrich: boolean // auto-fill email/phone/website for newly added leads
  autoAdvance: boolean // bump status new -> ready when a lead gains an email
  autoEnrollSeqId: string // sequence id to auto-enroll newly-reachable leads into ('' = off)
}

// Fallback list, verified against OpenRouter's live catalogue on 2026-07-30.
// Free model IDs churn constantly — five of the six previously listed here had
// been withdrawn (DeepSeek R1 and Chat, Llama 3.1 8B, Mistral 7B, Gemma 2 9B),
// which meant a user selecting one got a silent failure. Prefer the live list
// from fetchFreeModels(); this is only what we fall back to when that call fails.
export const FREE_MODELS = [
  { id: 'auto', label: 'Auto (OpenRouter picks)' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)' },
  { id: 'openai/gpt-oss-20b:free', label: 'GPT OSS 20B (free)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', label: 'Nemotron Nano 9B (free)' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (free)' },
  { id: 'inclusionai/ling-3.0-flash:free', label: 'Ling 3.0 Flash (free)' },
]

/**
 * Ask OpenRouter what is actually free right now. Hardcoded lists go stale
 * within weeks; this keeps the selector honest. Falls back to FREE_MODELS on
 * any failure so the UI never ends up with an empty dropdown.
 */
export async function fetchFreeModels(): Promise<{ id: string; label: string }[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) throw new Error(String(res.status))
    const { data } = await res.json()
    const free = (data as { id: string; name?: string }[])
      .filter(m => m.id.endsWith(':free'))
      .map(m => ({ id: m.id, label: `${m.name ?? m.id} (free)` }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return free.length ? [{ id: 'auto', label: 'Auto (OpenRouter picks)' }, ...free] : FREE_MODELS
  } catch {
    return FREE_MODELS
  }
}

const DEFAULTS: AppSettings = {
  openRouterApiKey: import.meta.env.VITE_OPENROUTER_API_KEY ?? '',
  openRouterModel: 'auto',
  scraperUrl: '',
  autoEnrich: true,
  autoAdvance: true,
  autoEnrollSeqId: '',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch (err) {
    console.warn('Failed to save settings', err)
  }
}
