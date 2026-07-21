/**
 * Lightweight debug logger for the renderer.
 *
 * Verbose tracing is useful while developing but spams the console in a packaged
 * build (and everything from the main process is also forwarded here). Gate the
 * chatty `console.log`-style calls behind this so they only appear in dev or when
 * a user opts in via `localStorage.lightcurveDebug = '1'`. Warnings and errors
 * should keep using `console.warn`/`console.error` directly.
 */

const enabled = (() => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('lightcurveDebug') === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return Boolean((import.meta as any).env?.DEV);
})();

export const dlog = (...args: unknown[]): void => {
  if (enabled) console.log(...args);
};
