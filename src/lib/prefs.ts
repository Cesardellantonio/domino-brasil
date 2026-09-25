import { useSyncExternalStore } from 'react';

export type Lang = 'pt' | 'en';

export interface Prefs {
  clientId: string;
  name: string;
  avatar: string;
  lang: Lang;
  sound: boolean;
  coloredPips: boolean;
  memoryAid: boolean;
  theme: 'felt' | 'wood' | 'night';
}

const KEY = 'domino.prefs';

function randomId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function load(): Prefs {
  let saved: Partial<Prefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* ignore */
  }
  const lang: Lang = navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  return {
    clientId: saved.clientId || randomId(),
    name: saved.name || '',
    avatar: saved.avatar || '😎',
    lang: saved.lang || (lang === 'en' ? 'en' : 'pt'),
    sound: saved.sound ?? true,
    coloredPips: saved.coloredPips ?? false,
    memoryAid: saved.memoryAid ?? true,
    theme: saved.theme || 'felt',
  };
}

let prefs = load();
const listeners = new Set<() => void>();
try {
  localStorage.setItem(KEY, JSON.stringify(prefs));
} catch {
  /* ignore */
}

export function getPrefs() {
  return prefs;
}
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => prefs,
  );
}

export const AVATARS = ['😎', '👴', '🧔', '👨‍🦳', '👩', '👵', '🧑', '👦', '🤠', '🥸', '🦁', '🐯', '⚽', '🍺', '☕', '🎸'];
