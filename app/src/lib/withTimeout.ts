// withTimeout — race a promise against a deadline and fall back.
//
// Boot paths (avatar catalog, room configs) must never hang the public
// game on a slow or paused Supabase: a *rejected* fetch already falls
// back, but a fetch that never settles would block forever. The timer is
// cleared on settle so it can't keep the event loop alive.

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}
