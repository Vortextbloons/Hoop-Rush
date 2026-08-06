/**
 * Window seams the Season Run block-runner e2e journeys activate before any
 * app code runs (see src/lib/season/fake-season-block-runner.ts and
 * src/lib/season/season-repo.ts).
 */
interface Window {
  __HOOP_RUSH_E2E_FAKE_RUNNER__?: boolean;
  __HOOP_RUSH_E2E_STALL_ONCE__?: boolean;
  /** M2.5: the next fake-runner startBlock emits one typed interruption. */
  __HOOP_RUSH_E2E_INTERRUPT_ONCE__?: boolean;
}
