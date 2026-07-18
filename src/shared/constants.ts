// Constants shared by main and renderer, ported verbatim from the web app.

export const PROVIDERS = ['claude', 'codex', 'antigravity'] as const
export type Provider = (typeof PROVIDERS)[number]

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
}

// "" means "let the CLI use its configured default" — no flag is passed.
// Antigravity's --model takes the display names printed by `agy models`.
export const PROVIDER_MODELS: Record<Provider, string[]> = {
  claude: ['', 'fable', 'opus', 'sonnet', 'haiku'],
  codex: ['', 'gpt-5.6-sol'],
  antigravity: [
    '',
    'Gemini 3.5 Flash (Low)',
    'Gemini 3.5 Flash (Medium)',
    'Gemini 3.5 Flash (High)',
    'Gemini 3.1 Pro (Low)',
    'Gemini 3.1 Pro (High)',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)',
  ],
}

// Antigravity bakes effort into the model name, so it has no separate options.
export const PROVIDER_EFFORTS: Record<Provider, string[]> = {
  claude: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['', 'low', 'medium', 'high', 'xhigh'],
  antigravity: [''],
}

export const PROVIDER_ENV_VARS: Record<Provider, string> = {
  claude: 'CLAUDE_BIN',
  codex: 'CODEX_BIN',
  antigravity: 'AGY_BIN',
}

// Default executable name on PATH; not always the same as the provider id.
export const PROVIDER_COMMANDS: Record<Provider, string> = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
}

export const MODES = ['ask', 'explain', 'summarize', 'eli12'] as const
export type Mode = (typeof MODES)[number]

export const MODE_LABELS: Record<Mode, string> = {
  ask: 'Ask',
  explain: 'Explain',
  summarize: 'Summarize',
  eli12: 'ELI12',
}

export const MODE_QUESTIONS: Partial<Record<Mode, string>> = {
  explain: 'Explain this passage.',
  summarize: 'Summarize this passage.',
  eli12: "Explain this passage like I'm 12.",
}

// Used instead of MODE_QUESTIONS when the selected block is sent as an image.
export const IMAGE_MODE_QUESTIONS: Partial<Record<Mode, string>> = {
  explain: 'Explain this figure.',
  summarize: 'Summarize this figure.',
  eli12: "Explain this figure like I'm 12.",
}

// Exact Shift-drag crops may contain text, notation, figures, or all three.
export const REGION_MODE_QUESTIONS: Partial<Record<Mode, string>> = {
  explain: 'Explain this selected region.',
  summarize: 'Summarize this selected region.',
  eli12: "Explain this selected region like I'm 12.",
}

export const ZOOM_LEVELS = [50, 65, 80, 100, 120, 145, 175, 210, 250, 300]
export const APP_ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const
export const DEFAULT_APP_ZOOM = 100

export function isValidAppZoomFactor(factor: number): boolean {
  return Number.isFinite(factor)
    && factor >= APP_ZOOM_LEVELS[0] / 100
    && factor <= APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1] / 100
}

export const BASE_PAGE_WIDTH = 740
export const CHIP_PREVIEW_CHARS = 90
export const MAX_PDF_BYTES = 50 * 1024 * 1024
