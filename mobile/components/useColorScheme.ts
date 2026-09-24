/**
 * GasTa is a single light (cream + forest) design on every platform.
 * Web already forces light via useColorScheme.web.ts — keep native in sync
 * so iOS/Android dark mode does not invert screens.
 */
export function useColorScheme(): 'light' {
  return 'light';
}
