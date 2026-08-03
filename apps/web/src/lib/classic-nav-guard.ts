import { beforeNavigate } from '$app/navigation';
import type { ClassicDraftState } from '@hoop-rush/data-contracts';

/**
 * Classic draft navigation guard. While a draft is unfinished (status
 * 'drafting'), every in-app navigation away from the Classic page — the page
 * Back link, the header Home link, browser-back ('popstate'), or any in-app
 * link — is cancelled and reported to the caller, which shows the leave/
 * discard confirmation dialog. Refresh and tab close are NOT intercepted (the
 * draft stays saved for resume), and the automatic navigation that launches
 * the season after the fifth pick marks itself with setClassicGuardBypass so
 * the guard lets it through without a prompt.
 */

/** Marks the NEXT client-side navigation as automatic (challenge launch), so the draft guard lets it through. */
let bypass = false;
export function setClassicGuardBypass(enabled: boolean): void {
  bypass = enabled;
}

export interface ClassicGuardTarget {
  pathname: string;
  search: string;
}

/**
 * Intercepts in-app navigation away from an unfinished Classic draft. The
 * getter returns the current draft; when it is drafting, every client-side
 * navigation is cancelled and `onBlocked` receives the intended target.
 * Refresh and tab close are NOT intercepted (the draft stays saved for resume).
 * Register at the top level of the page component; the returned function
 * unsubscribes.
 */
export function registerClassicDraftNavigationGuard(
  getDraft: () => ClassicDraftState | null,
  onBlocked: (target: ClassicGuardTarget) => void,
): () => void {
  let active = true;
  beforeNavigate((nav) => {
    if (!active) return;
    if (bypass) {
      bypass = false;
      return;
    }
    // Full-page unloads (refresh, tab close) keep the draft saved for resume.
    if (nav.willUnload) return;
    const draft = getDraft();
    if (!draft || draft.status !== 'drafting') return;
    nav.cancel();
    const url = nav.to?.url;
    onBlocked({ pathname: url?.pathname ?? '/', search: url?.search ?? '' });
  });
  return () => {
    active = false;
  };
}
