const SETTINGS_KEY = 'pocket-leads:settings'

export interface AppSettings {
  openRouterApiKey: string
  openRouterModel: string
  scraperUrl: string
  autoEnrich: boolean // auto-fill email/phone/website for newly added leads
  autoAdvance: boolean // bump status new -> ready when a lead gains an email
  autoEnrollSeqId: string // sequence id to auto-enroll newly-reachable leads into ('' = off)
}

export const FREE_MODELS = [
  { id: 'auto', label: 'Auto (OpenRouter picks)' },
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free)' },
  { id: 'deepseek/deepseek-chat:free', label: 'DeepSeek Chat (free)' },
  { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (free)' },
  { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (free)' },
  { id: 'google/gemma-2-9b-it:free', label: 'Gemma 2 9B (free)' },
]

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
