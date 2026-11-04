export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCE_EVENT = 'elitehr:appearance-change';

export function appearancePreference(): Appearance {
  try {
    const saved = localStorage.getItem('placement-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch { return 'system'; }
}

export function applyAppearance(preference = appearancePreference()) {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', !!dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export function setAppearance(preference: Appearance) {
  try { localStorage.setItem('placement-theme', preference); } catch { /* Session appearance still works. */ }
  applyAppearance(preference);
}
