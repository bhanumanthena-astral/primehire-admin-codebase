/** Legacy provider screens belong only to the local development/BFF workflow. */
export function legacyScreensAllowed(): boolean {
  return import.meta.env.DEV;
}
