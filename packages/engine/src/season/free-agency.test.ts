import { describe, expect, it } from 'vitest';
import type { SeasonDraftCatalog, SeasonEffectsState, SeasonFreeAgencyBand, SeasonFreeAgencyIndex, SeasonRoster, SeasonRun, } from '@hoop-rush/data-contracts';
import { SEASON_FREE_AGENCY_BAND_SIGNING_CAPS, SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES, applyFreeAgencyDeclaration, applyFreeAgencySkip, FreeAgencyValidationRejection, freeAgencySeed, freeAgencyUnresolvedWindowIndex, openSeasonFreeAgencyWindow, resolveSeasonFreeAgencyWindow, seasonFreeAgencyUniverseOf, } from './free-agency.ts';
import { buildEconomyTestRun } from './season-economy-test-support.ts';
import { expandSeasonRunRosters } from './block.ts';
import { reconcileSeasonEffects } from './effects.ts';
import { buildMinimalRotation } from './rotation.ts';
const HUMAN = 'lakers';
const BAND_CYCLE: SeasonFreeAgencyBand[] = ['featured', 'role', 'role', 'development', 'emergency'];
function fixtureIndex(catalog: SeasonDraftCatalog): SeasonFreeAgencyIndex {
    const candidates: SeasonFreeAgencyIndex['candidates'] = catalog.candidates.map((candidate, index) => ({
        playerVersionId: candidate.playerVersionId,
        playerId: candidate.playerId,
        displayName: candidate.displayName,
        positions: candidate.positions,
        band: BAND_CYCLE[index % BAND_CYCLE.length] as SeasonFreeAgencyBand,
        minimumInfluence: 1,
        supportedRoles: ['rotation', 'depth', 'emergency'] as const,
        strengths: ['recorded role coverage'],
        limitations: [],
        durabilityRating: candidate.durability.rating,
        minutesPerGame: candidate.stamina.historicalMpg,
        availability: { healthy: true, notes: '' },
        catalogRef: {
            catalogVersion: catalog.catalogVersion,
            dataVersion: catalog.dataVersion,
            candidateIndex: index,
        },
        derivationEvidence: 'fixture eligibility',
        exclusionEvidence: '',
    }));
    const groupedVersions: Record<string, string[]> = {};
    for (const candidate of candidates) {
        const group = groupedVersions[candidate.playerId] ?? [];
        group.push(candidate.playerVersionId);
        groupedVersions[candidate.playerId] = group;
    }
    return {
        schemaVersion: 1,
        indexVersion: 'free-agency-index-v1',
        dataVersion: 'fixture',
        catalogRef: {
            catalogVersion: catalog.catalogVersion,
            contentHash: '0'.repeat(64),
            candidateCount: catalog.candidates.length,
        },
        candidates,
        groupedVersions,
    };
}
function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
    return {
        schemaVersion: 2,
        playerStates: run.rosters.flatMap((roster) => roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            lastCompletedRound: 0,
        }))),
        inactivePlayerStates: [],
        pairStates: [],
        archivedPairs: [],
    };
}
function fixture() {
    const { run, catalog } = buildEconomyTestRun({ humanFranchiseId: HUMAN });
    return { run, catalog, index: fixtureIndex(catalog) };
}
function contextOf(run: SeasonRun, catalog: SeasonDraftCatalog, index: SeasonFreeAgencyIndex) {
    return { run, catalog, index, effects: zeroEffectsOf(run), humanFranchiseId: HUMAN };
}
describe('free-agency universe and canonical selection', () => {
    it('derives the runtime universe from the index minus owned/represented versions', () => {
        const { run, index } = fixture();
        const universe = seasonFreeAgencyUniverseOf(run, index);
        const represented = new Set(run.rosters.flatMap((roster) => roster.players.map((p) => p.playerId)));
        for (const [playerId, entries] of universe) {
            expect(represented.has(playerId)).toBe(false);
            expect(entries.length).toBeGreaterThan(0);
        }
    });
    it('opens a window with unique identities, at most one featured, and canonical records', () => {
        const { run, catalog, index } = fixture();
        const opened = openSeasonFreeAgencyWindow(contextOf(run, catalog, index), 0, 2);
        expect(opened.window.candidates.length).toBeLessThanOrEqual(SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES);
        expect(opened.window.candidates.length).toBeGreaterThan(0);
        const identities = new Set(opened.window.candidates.map((candidate) => candidate.playerId));
        expect(identities.size).toBe(opened.window.candidates.length);
        const featured = opened.window.candidates.filter((candidate) => candidate.band === 'featured');
        expect(featured.length).toBeLessThanOrEqual(1);
        for (const candidate of opened.window.candidates) {
            const canonical = opened.freeAgency.canonicalCandidates[candidate.playerId];
            expect(canonical).toBeDefined();
            expect(canonical?.playerVersionId).toBe(candidate.playerVersionId);
            expect(canonical?.admittedWindowIndex).toBe(0);
            expect(canonical?.seedPath).toEqual(['0', 'canonical', candidate.playerId]);
        }
    });
    it('reuses canonical identity choices in later windows', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const reopened = openSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: opened.freeAgency } }, 1, 4);
        for (const candidate of opened.window.candidates) {
            const again = reopened.window.candidates.find((entry) => entry.playerId === candidate.playerId);
            if (again !== undefined) {
                expect(again.playerVersionId).toBe(candidate.playerVersionId);
            }
        }
    });
    it('names the free-agency seed paths under the frozen namespace', () => {
        const { run } = fixture();
        expect(freeAgencySeed(run.rootSeed, '0', 'canonical', 'p-x')).toBe(freeAgencySeed(run.rootSeed, '0', 'canonical', 'p-x'));
        expect(freeAgencySeed(run.rootSeed, '0', 'canonical', 'p-x')).not.toBe(freeAgencySeed(run.rootSeed, '0', 'canonical', 'p-y'));
        expect(freeAgencySeed(run.rootSeed, '0', 'canonical', 'p-x')).not.toBe(freeAgencySeed(run.rootSeed, '1', 'canonical', 'p-x'));
    });
});
describe('free-agency declarations', () => {
    it('records an immutable declaration and rejects a second one', () => {
        const { run, catalog, index } = fixture();
        const opened = openSeasonFreeAgencyWindow(contextOf(run, catalog, index), 0, 2);
        const candidate = opened.window.candidates[0];
        if (candidate === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-declare-1', [{ playerVersionId: candidate.playerVersionId, roleExpectation: 'rotation', influence: 1 }]);
        expect(declared.windows[0]?.declarations[HUMAN]?.targets).toHaveLength(1);
        expect(() => applyFreeAgencyDeclaration({ ...run, freeAgency: declared }, 0, HUMAN, 'cmd-declare-2', [
            { playerVersionId: candidate.playerVersionId, roleExpectation: 'rotation', influence: 1 },
        ])).toThrow(FreeAgencyValidationRejection);
    });
    it('rejects unknown targets, duplicate priorities, and out-of-range influence', () => {
        const { run, catalog, index } = fixture();
        const opened = openSeasonFreeAgencyWindow(contextOf(run, catalog, index), 0, 2);
        const runWithWindow = { ...run, freeAgency: opened.freeAgency };
        expect(() => applyFreeAgencyDeclaration(runWithWindow, 0, HUMAN, 'cmd-1', [
            {
                playerVersionId: 'pv-ffffffffffffffffffffffffffffffff',
                roleExpectation: 'rotation',
                influence: 1,
            },
        ])).toThrow(FreeAgencyValidationRejection);
        const candidate = opened.window.candidates[0];
        if (candidate === undefined)
            throw new Error('no candidates');
        expect(() => applyFreeAgencyDeclaration(runWithWindow, 0, HUMAN, 'cmd-2', [
            { playerVersionId: candidate.playerVersionId, roleExpectation: 'rotation', influence: 4 },
        ])).toThrow(FreeAgencyValidationRejection);
        expect(() => applyFreeAgencyDeclaration(runWithWindow, 0, HUMAN, 'cmd-3', [
            { playerVersionId: candidate.playerVersionId, roleExpectation: 'rotation', influence: 1 },
            { playerVersionId: candidate.playerVersionId, roleExpectation: 'depth', influence: 1 },
        ])).toThrow(FreeAgencyValidationRejection);
    });
    it('rejects declarations on a window that is not open', () => {
        const { run } = fixture();
        expect(() => applyFreeAgencyDeclaration(run, 0, HUMAN, 'cmd-1', [])).toThrow(FreeAgencyValidationRejection);
    });
});
describe('free-agency resolution', () => {
    it('resolves deterministically across repeated calls', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'rotation', influence: 1 }]);
        const first = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const second = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        expect(first.freeAgency).toEqual(second.freeAgency);
        expect(first.signings).toEqual(second.signings);
        expect(first.traces).toEqual(second.traces);
    });
    it('signs at most one player per franchise', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'rotation', influence: 2 }]);
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const perFranchise = new Map<string, number>();
        for (const signing of resolved.signings) {
            perFranchise.set(signing.franchiseId, (perFranchise.get(signing.franchiseId) ?? 0) + 1);
        }
        for (const count of perFranchise.values()) {
            expect(count).toBe(1);
        }
        const humanSignings = resolved.signings.filter((signing) => signing.franchiseId === HUMAN);
        expect(humanSignings.length).toBeLessThanOrEqual(1);
    });
    it('applies a signing atomically: roster, ownership, ledger, transaction, caps', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'rotation', influence: 2 }]);
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const humanSigning = resolved.signings.find((signing) => signing.franchiseId === HUMAN);
        if (humanSigning === undefined) {
            expect(resolved.rosters).toEqual(run.rosters);
            expect(resolved.ownership).toEqual(run.ownership);
            return;
        }
        const roster = resolved.rosters.find((entry) => entry.franchiseId === HUMAN);
        expect(roster?.players.some((player) => player.playerVersionId === humanSigning.playerVersionId)).toBe(true);
        expect(resolved.ownership.some((row) => row.playerVersionId === humanSigning.playerVersionId)).toBe(true);
        const ledgerEntry = resolved.influence.ledger.find((entry) => entry.entryId === humanSigning.ledgerEntryId);
        expect(ledgerEntry).toBeDefined();
        expect(ledgerEntry?.source).toBe('free-agent-signing');
        expect(ledgerEntry?.appliedDelta).toBe(-humanSigning.influenceCost);
        const transaction = resolved.transactions.find((entry) => entry.transactionId === humanSigning.transactionId);
        expect(transaction).toBeDefined();
        expect(transaction?.type).toBe('free-agent-signing');
        expect(resolved.freeAgency.signingCounts[HUMAN]).toBe(1);
        expect(resolved.freeAgency.seasonSpend[HUMAN]).toBe(humanSigning.influenceCost);
        expect(resolved.freeAgency.windows[0]?.status).toBe('resolved');
    });
    it('appends exactly one transaction per signing without duplicating prior entries', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'rotation', influence: 2 }]);
        const priorCount = run.transactions.length;
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        expect(resolved.transactions.length).toBe(priorCount + resolved.signings.length);
        const transactionIds = resolved.transactions.map((entry) => entry.transactionId);
        expect(new Set(transactionIds).size).toBe(transactionIds.length);
        for (const signing of resolved.signings) {
            expect(transactionIds.filter((id) => id === signing.transactionId)).toHaveLength(1);
        }
    });
    it('rejects resolution before the human declares or skips', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        expect(() => resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: opened.freeAgency } }, 0, 'cmd-r')).toThrow(FreeAgencyValidationRejection);
        const skipped = applyFreeAgencySkip({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-s');
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: skipped } }, 0, 'cmd-r');
        expect(resolved.freeAgency.windows[0]?.status).toBe('resolved');
    });
    it('keeps every signing within the season caps across all three windows', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        let currentRun = run;
        for (const [windowIndex, blockIndex] of [
            [0, 2],
            [1, 4],
            [2, 6],
        ] as const) {
            const opened = openSeasonFreeAgencyWindow({ ...context, run: currentRun }, windowIndex, blockIndex);
            const skipped = applyFreeAgencySkip({ ...currentRun, freeAgency: opened.freeAgency }, windowIndex, HUMAN, `cmd-skip-${String(windowIndex)}`);
            const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...currentRun, freeAgency: skipped } }, windowIndex, `cmd-resolve-${String(windowIndex)}`);
            for (const franchiseId of run.league.teams.map((team) => team.franchiseId)) {
                const count = resolved.freeAgency.signingCounts[franchiseId] ?? 0;
                const assignment = run.aiAssignments.find((entry) => entry.franchiseId === franchiseId);
                const cap = SEASON_FREE_AGENCY_BAND_SIGNING_CAPS[assignment?.band ?? 'average'] ?? 3;
                expect(count).toBeLessThanOrEqual(Math.min(3, cap));
                expect(resolved.freeAgency.seasonSpend[franchiseId] ?? 0).toBeLessThanOrEqual(6);
            }
            currentRun = {
                ...currentRun,
                freeAgency: resolved.freeAgency,
                rosters: resolved.rosters,
                ownership: resolved.ownership,
                influence: resolved.influence,
                transactions: resolved.transactions,
            };
        }
    });
    it('reports the unresolved window until resolution', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        expect(freeAgencyUnresolvedWindowIndex(run.freeAgency)).toBeNull();
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        expect(freeAgencyUnresolvedWindowIndex(opened.freeAgency)).toBe(0);
    });
});
describe('effects reconciliation (season-chemistry-v2)', () => {
    it('preserves the 300/1350 invariants when nothing changes', () => {
        const { run } = fixture();
        const reconciled = reconcileSeasonEffects({
            previous: zeroEffectsOf(run),
            rosters: run.rosters,
            rotations: run.rotations,
        });
        expect(reconciled.playerStates).toHaveLength(300);
        expect(reconciled.pairStates).toHaveLength(1350);
        expect(reconciled.inactivePlayerStates).toHaveLength(0);
    });
    it('freezes a demoted player load into the inactive set', () => {
        const { run, catalog } = fixture();
        const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
        const humanPool = catalog.pools.find((pool) => pool.franchiseId === HUMAN);
        const humanRotation = run.rotations.find((rotation) => rotation.franchiseId === HUMAN);
        if (humanRoster === undefined || humanPool === undefined || humanRotation === undefined) {
            throw new Error('fixture');
        }
        const inactiveId = humanPool.playerVersionIds[10];
        const inactiveCandidate = catalog.candidates.find((candidate) => candidate.playerVersionId === inactiveId);
        if (inactiveId === undefined || inactiveCandidate === undefined)
            throw new Error('fixture');
        const expandedRoster: SeasonRoster = {
            franchiseId: HUMAN,
            players: [
                ...humanRoster.players,
                {
                    playerVersionId: inactiveCandidate.playerVersionId,
                    playerId: inactiveCandidate.playerId,
                    franchiseId: HUMAN,
                    eraId: inactiveCandidate.eraId,
                    seasonKey: inactiveCandidate.seasonKey,
                    displayName: inactiveCandidate.displayName,
                },
            ],
        };
        const rosters = run.rosters.map((roster) => roster.franchiseId === HUMAN ? expandedRoster : roster);
        const demoted = humanRotation.starters[0];
        if (demoted === undefined)
            throw new Error('fixture');
        const nextRotations = run.rotations.map((rotation) => rotation.franchiseId === HUMAN
            ? {
                ...rotation,
                starters: rotation.starters.map((id) => (id === demoted ? inactiveId : id)),
            }
            : rotation);
        const base = zeroEffectsOf(run);
        const touched: SeasonEffectsState = {
            ...base,
            playerStates: base.playerStates.map((player) => player.playerVersionId === demoted ? { ...player, fatigueBasisPoints: 4000 } : player),
        };
        const reconciled = reconcileSeasonEffects({
            previous: touched,
            rosters,
            rotations: nextRotations,
        });
        expect(reconciled.playerStates).toHaveLength(300);
        expect(reconciled.pairStates).toHaveLength(1350);
        const frozen = reconciled.inactivePlayerStates.find((player) => player.playerVersionId === demoted);
        expect(frozen?.fatigueBasisPoints).toBe(4000);
        expect(reconciled.playerStates.some((player) => player.playerVersionId === demoted)).toBe(false);
        const promotedLoad = reconciled.playerStates.find((player) => player.playerVersionId === inactiveId);
        expect(promotedLoad?.fatigueBasisPoints).toBe(0);
    });
    it('creates zero pair state for a newly promoted signing', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'depth', influence: 1 }]);
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const humanRoster = resolved.rosters.find((roster) => roster.franchiseId === HUMAN);
        const humanRotation = run.rotations.find((rotation) => rotation.franchiseId === HUMAN);
        if (humanRoster === undefined || humanRotation === undefined)
            throw new Error('fixture');
        const ids = [...humanRotation.starters, ...humanRotation.benchOrder].slice(0, 9);
        ids.push(target.playerVersionId);
        const members = ids.map((id) => {
            const catalogCandidate = catalog.candidates.find((candidate) => candidate.playerVersionId === id);
            return {
                playerVersionId: id,
                playable: catalogCandidate?.positions.playable ?? [],
            };
        });
        const repairedRotation = buildMinimalRotation({ franchiseId: HUMAN, members });
        const nextRotations = run.rotations.map((rotation) => rotation.franchiseId === HUMAN ? repairedRotation : rotation);
        const reconciled = reconcileSeasonEffects({
            previous: resolved.effects,
            rosters: resolved.rosters,
            rotations: nextRotations,
        });
        const newPairs = reconciled.pairStates.filter((pair) => pair.a === target.playerVersionId || pair.b === target.playerVersionId);
        expect(newPairs.length).toBe(9);
        for (const pair of newPairs) {
            expect(pair.sharedPossessions).toBe(0);
        }
    });
    it('does not promote a depth signing into the rotation — roster grows, rotation stays locked', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'depth', influence: 1 }]);
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const humanRoster = resolved.rosters.find((roster) => roster.franchiseId === HUMAN);
        if (humanRoster === undefined)
            throw new Error('fixture');
        expect(humanRoster.players.length).toBeGreaterThan(10);
        expect(humanRoster.players.some((p) => p.playerVersionId === target.playerVersionId)).toBe(true);
        const expectedRotation = run.rotations.find((r) => r.franchiseId === HUMAN);
        if (expectedRotation === undefined)
            throw new Error('fixture');
        const humanRunAfter = { ...run, rosters: resolved.rosters, freeAgency: resolved.freeAgency };
        const rotationIds = new Set([...expectedRotation.starters, ...expectedRotation.benchOrder]);
        expect(rotationIds.size).toBe(10);
        expect(rotationIds.has(target.playerVersionId)).toBe(false);
        const expanded = expandSeasonRunRosters(humanRunAfter, catalog);
        expect(expanded.has(target.playerVersionId)).toBe(true);
        expect(resolved.effects.inactivePlayerStates.some((p) => p.playerVersionId === target.playerVersionId)).toBe(true);
        expect(resolved.effects.playerStates.some((p) => p.playerVersionId === target.playerVersionId)).toBe(false);
    });
    it('leaves inactive depth signings untouched across runs — no legacy auto-repair', () => {
        const { run, catalog, index } = fixture();
        const context = contextOf(run, catalog, index);
        const opened = openSeasonFreeAgencyWindow(context, 0, 2);
        const target = opened.window.candidates[0];
        if (target === undefined)
            throw new Error('no candidates');
        const declared = applyFreeAgencyDeclaration({ ...run, freeAgency: opened.freeAgency }, 0, HUMAN, 'cmd-d', [{ playerVersionId: target.playerVersionId, roleExpectation: 'depth', influence: 1 }]);
        const resolved = resolveSeasonFreeAgencyWindow({ ...context, run: { ...run, freeAgency: declared } }, 0, 'cmd-r');
        const originalRotation = run.rotations.find((r) => r.franchiseId === HUMAN);
        if (originalRotation === undefined)
            throw new Error('fixture');
        const rotationIds = new Set([...originalRotation.starters, ...originalRotation.benchOrder]);
        expect(rotationIds.has(target.playerVersionId)).toBe(false);
    });
});
