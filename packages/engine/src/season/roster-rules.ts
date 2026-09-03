import type { Position } from '@hoop-rush/data-contracts';
import { canPlay, slotGroupOf } from '../domain/positions.ts';
import { SEASON_ROSTER_RULES_VERSION } from '@hoop-rush/data-contracts';
export const SEASON_ROSTER_RULES = {
    version: SEASON_ROSTER_RULES_VERSION,
    size: 10,
    gameMinimums: { guards: 3, forwards: 3, centers: 2 },
    completionTargets: { guards: 4, forwards: 4, centers: 3 },
    fiveStructure: { guards: 2, forwards: 2, centers: 1 },
} as const;
export const SEASON_ROSTER_SIZE = SEASON_ROSTER_RULES.size;
export interface SeasonRosterMemberInput {
    playerVersionId: string;
    playable: readonly Position[];
}
export function groupMaskOf(playable: readonly Position[]): number {
    let mask = 0;
    for (const position of playable) {
        const group = slotGroupOf(position);
        if (group === 'G')
            mask |= 1;
        else if (group === 'F')
            mask |= 2;
        else
            mask |= 4;
    }
    return mask;
}
export function rosterGroupCounts(members: readonly SeasonRosterMemberInput[]): {
    guards: number;
    forwards: number;
    centers: number;
} {
    let guards = 0;
    let forwards = 0;
    let centers = 0;
    for (const member of members) {
        const mask = groupMaskOf(member.playable);
        if ((mask & 1) !== 0)
            guards += 1;
        if ((mask & 2) !== 0)
            forwards += 1;
        if ((mask & 4) !== 0)
            centers += 1;
    }
    return { guards, forwards, centers };
}
export function legalFiveExists(members: readonly SeasonRosterMemberInput[]): boolean {
    let reachable = 1;
    for (const member of members) {
        const mask = groupMaskOf(member.playable);
        const next = new Set<number>();
        for (let state = 0; state < 18; state += 1) {
            if ((reachable & (1 << state)) === 0)
                continue;
            const g = Math.floor(state / 6);
            const f = Math.floor((state % 6) / 2);
            const c = state % 2;
            next.add(state);
            if ((mask & 1) !== 0 && g < 2)
                next.add((g + 1) * 6 + f * 2 + c);
            if ((mask & 2) !== 0 && f < 2)
                next.add(g * 6 + (f + 1) * 2 + c);
            if ((mask & 4) !== 0 && c < 1)
                next.add(g * 6 + f * 2 + 1);
        }
        reachable = 0;
        for (const state of next)
            reachable |= 1 << state;
    }
    return (reachable & (1 << 17)) !== 0;
}
export function legalFiveAfterAnyRemoval(members: readonly SeasonRosterMemberInput[]): boolean {
    for (let remove = 0; remove < members.length; remove += 1) {
        const remaining: SeasonRosterMemberInput[] = [];
        for (let i = 0; i < members.length; i += 1) {
            const member = members[i];
            if (member === undefined)
                continue;
            if (i !== remove)
                remaining.push(member);
        }
        if (!legalFiveExists(remaining))
            return false;
    }
    return true;
}
export function completionTargetsMet(members: readonly SeasonRosterMemberInput[]): boolean {
    const counts = rosterGroupCounts(members);
    return (counts.guards >= SEASON_ROSTER_RULES.completionTargets.guards &&
        counts.forwards >= SEASON_ROSTER_RULES.completionTargets.forwards &&
        counts.centers >= SEASON_ROSTER_RULES.completionTargets.centers);
}
export function validateSeasonRoster(members: readonly SeasonRosterMemberInput[]): string[] {
    const failures: string[] = [];
    const ids = members.map((member) => member.playerVersionId);
    if (ids.length !== SEASON_ROSTER_RULES.size) {
        failures.push(`roster must have exactly ${String(SEASON_ROSTER_RULES.size)} players (got ${String(ids.length)})`);
    }
    if (new Set(ids).size !== ids.length) {
        failures.push('roster must contain ten distinct playerVersionIds');
    }
    const counts = rosterGroupCounts(members);
    if (counts.guards < SEASON_ROSTER_RULES.gameMinimums.guards) {
        failures.push(`roster needs at least ${String(SEASON_ROSTER_RULES.gameMinimums.guards)} guard-capable players`);
    }
    if (counts.forwards < SEASON_ROSTER_RULES.gameMinimums.forwards) {
        failures.push(`roster needs at least ${String(SEASON_ROSTER_RULES.gameMinimums.forwards)} forward-capable players`);
    }
    if (counts.centers < SEASON_ROSTER_RULES.gameMinimums.centers) {
        failures.push(`roster needs at least ${String(SEASON_ROSTER_RULES.gameMinimums.centers)} center-capable players`);
    }
    if (!legalFiveExists(members)) {
        failures.push('roster has no legal G,G,F,F,C starting five');
    }
    if (!legalFiveAfterAnyRemoval(members)) {
        failures.push('removing one roster member leaves no legal starting five');
    }
    return failures;
}
export function rosterFeasibleFromCounts(ownedCounts: {
    guards: number;
    forwards: number;
    centers: number;
}, availableMaskCounts: readonly number[], remainingPicks: number): boolean {
    if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
        throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
    }
    const startG = Math.min(SEASON_ROSTER_RULES.completionTargets.guards, ownedCounts.guards);
    const startF = Math.min(SEASON_ROSTER_RULES.completionTargets.forwards, ownedCounts.forwards);
    const startC = Math.min(SEASON_ROSTER_RULES.completionTargets.centers, ownedCounts.centers);
    if (startG >= 4 && startF >= 4 && startC >= 3)
        return true;
    const usedBase = 100;
    const stateCount = usedBase * (remainingPicks + 1);
    const reachable = new Uint8Array(stateCount);
    const targetUsed = remainingPicks;
    const targetG = 4;
    const targetF = 4;
    const targetC = 3;
    reachable[startG * 16 + startF * 4 + startC] = 1;
    for (let mask = 1; mask <= 7; mask += 1) {
        const count = availableMaskCounts[mask] ?? 0;
        if (count === 0)
            continue;
        for (let used = targetUsed - 1; used >= 0; used -= 1) {
            const maxAdd = Math.min(count, targetUsed - used);
            for (let g = targetG; g >= 0; g -= 1) {
                for (let f = targetF; f >= 0; f -= 1) {
                    for (let c = targetC; c >= 0; c -= 1) {
                        const idx = used * usedBase + g * 16 + f * 4 + c;
                        if (reachable[idx] === 0)
                            continue;
                        for (let add = 1; add <= maxAdd; add += 1) {
                            const ng = Math.min(targetG, g + ((mask & 1) !== 0 ? add : 0));
                            const nf = Math.min(targetF, f + ((mask & 2) !== 0 ? add : 0));
                            const nc = Math.min(targetC, c + ((mask & 4) !== 0 ? add : 0));
                            const nidx = (used + add) * usedBase + ng * 16 + nf * 4 + nc;
                            reachable[nidx] = 1;
                        }
                    }
                }
            }
        }
        if (reachable[targetUsed * usedBase + targetG * 16 + targetF * 4 + targetC] === 1) {
            return true;
        }
    }
    return reachable[targetUsed * usedBase + targetG * 16 + targetF * 4 + targetC] === 1;
}
export function rosterFeasible(owned: readonly SeasonRosterMemberInput[], available: readonly SeasonRosterMemberInput[], remainingPicks: number): boolean {
    const ownedCounts = rosterGroupCounts(owned);
    const maskCounts = new Array<number>(8).fill(0);
    for (const member of available) {
        const mask = groupMaskOf(member.playable);
        if (mask !== 0)
            maskCounts[mask] = (maskCounts[mask] ?? 0) + 1;
    }
    return rosterFeasibleFromCounts(ownedCounts, maskCounts, remainingPicks);
}
export function anyMemberPlays(members: readonly SeasonRosterMemberInput[], slot: 'G' | 'F' | 'C'): boolean {
    return members.some((member) => canPlay(member.playable, slot));
}
