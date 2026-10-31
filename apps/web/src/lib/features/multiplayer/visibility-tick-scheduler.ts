export function visibilityTickScheduler(
  tick: () => void,
  intervalMs: number,
  hiddenIntervalMs = 1000,
): () => void {
  if (typeof document === 'undefined') {
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }
  let timer: ReturnType<typeof setInterval>;
  const schedule = () => {
    timer = setInterval(
      tick,
      document.hidden ? Math.max(intervalMs, hiddenIntervalMs) : intervalMs,
    );
  };
  const changed = () => {
    clearInterval(timer);
    schedule();
    if (!document.hidden) tick();
  };
  schedule();
  document.addEventListener('visibilitychange', changed);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', changed);
  };
}
