import { beforeNavigate } from '$app/navigation';
import type { ClassicDraftState } from '@hoop-rush/data-contracts';

/**
 * Classic draft navigation guard. While a draft is unfinished ('drafting'),
 * every in-app navigation away from the Classic page — Back, Home, browser-back,
 * or any link — is cancelled and reported to the caller, which shows the
 * leave/discard dialog. Refresh and tab close are NOT intercepted (the draft
 * stays saved), and the automatic navigation that launches the season after the
 * fifth pick marks itself with setClassicGuardBypass so the guard lets it pass.
 */

let bypass = false;
export function setClassicGuardBypass(enabled: boolean): void {
  bypass = enabled;
}

export interface ClassicGuardTarget {
  pathname: string;
  search: string;
}

/**
 * Intercepts in-app navigation away from an unfinished draft; `onBlocked`
 * receives the intended target. Refresh/tab close are not intercepted (the
 * draft stays saved). Register at the top level of the page component; the
 * returned function unsubscribes.
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
