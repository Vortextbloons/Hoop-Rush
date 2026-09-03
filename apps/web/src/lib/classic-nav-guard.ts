import { beforeNavigate } from '$app/navigation';
import type { ClassicDraftState } from '@hoop-rush/data-contracts';
let bypass = false;
export function setClassicGuardBypass(enabled: boolean): void {
    bypass = enabled;
}
export interface ClassicGuardTarget {
    pathname: string;
    search: string;
}
export function registerClassicDraftNavigationGuard(getDraft: () => ClassicDraftState | null, onBlocked: (target: ClassicGuardTarget) => void): () => void {
    let active = true;
    beforeNavigate((nav) => {
        if (!active)
            return;
        if (bypass) {
            bypass = false;
            return;
        }
        if (nav.willUnload)
            return;
        const draft = getDraft();
        if (!draft || draft.status !== 'drafting')
            return;
        nav.cancel();
        const url = nav.to?.url;
        onBlocked({ pathname: url?.pathname ?? '/', search: url?.search ?? '' });
    });
    return () => {
        active = false;
    };
}
