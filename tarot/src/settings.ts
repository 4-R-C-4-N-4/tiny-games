export interface Settings {
  reversals: boolean;
}

const KEY = 'tarot:settings';
const DEFAULTS: Settings = { reversals: false };

export function loadSettings(): Settings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode etc. — setting just won't persist */ }
}
