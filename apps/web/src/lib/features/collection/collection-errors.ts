export function collectionErrorMessage(failure: unknown, fallback: string): string {
  if (!(failure instanceof Error)) return fallback;
  const code = (failure as { code?: unknown }).code;
  if (code === 'stale-state') {
    return 'The collection changed in another tab. Reload the page for the latest state, then try again.';
  }
  if (code === 'invalid-progression-rules') {
    return 'The collection progression rules are unavailable or invalid. Reload the page and try again.';
  }
  if (code === 'insufficient-funds') {
    return 'The balance is too low for this purchase.';
  }
  if (code === 'target-unchanged') {
    return 'That player is already the active target.';
  }
  return failure.message.length > 0 ? failure.message : fallback;
}
