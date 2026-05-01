import { safeInvoke as invoke, isTauri } from './core';

export type WindowChromeTheme = 'light' | 'dark';

export async function setWindowThemeChrome(theme: WindowChromeTheme): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('window_set_theme_chrome', { theme });
}
