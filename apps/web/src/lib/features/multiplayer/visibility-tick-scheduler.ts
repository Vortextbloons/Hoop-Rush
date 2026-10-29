export function visibilityTickScheduler(tick: () => void, intervalMs: number): () => void {
  if (typeof document === 'undefined') {
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }
  let timer: ReturnType<typeof setInterval>;
  const schedule = () => {
    timer = setInterval(tick, document.hidden ? Math.max(intervalMs, 1000) : intervalMs);
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
