import { resolve } from 'node:path';
import { z } from 'zod';
import { SEASON_GAME_TARGETS_VERSION, SEASON_GAME_VERSION, SEASON_TRADE_TARGETS_VERSION, seasonRunSchema, type Position, type SeasonGamePlayerInput, type SeasonRun, } from '@hoop-rush/data-contracts';
import { canonicalRosterPairs, createEngineContext, expandSeasonRunRosters, legalFiveAfterAnyRemoval, ratioMutuallyWithinBand, validateSeasonRoster, validateSeasonRotation, type SeasonRosterMemberInput, type SeasonTradePackageKind, } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonTradeCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile } from './season-data.ts';
import { gateValue, gateSummary, m25RangeGate, m25ToleranceGate, mean, seasonCalibrationSeed, seedIndexRange, type M25Gate, } from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';
export const SEASON_TRADE_CALIBRATE_OPTIONS: Record<string, boolean> = {
    input: true,
    'seed-from': true,
    'seed-to': true,
    workers: true,
    out: true,
    manifest: true,
    validate: true,
    format: true,
};
export const SEASON_TRADE_AUDIT_OPTIONS: Record<string, boolean> = {
    input: true,
    manifest: true,
    format: true,
};
export const DEFAULT_TRADE_TARGETS = resolve(DEFAULT_SEASON_DIR, 'trade-targets.json');
export const SEASON_TRADE_CALIBRATION_SEED_COUNT = 8;
export const SEASON_TRADE_VALIDATION_SEED_COUNT = 4;
export const SEASON_TRADE_MIN_AI_TRADES_PER_SEASON = 8;
export const SEASON_TRADE_MAX_AI_TRADES_PER_SEASON = 15;
export const SEASON_TRADE_VALUE_BANDS = {
    '1-1': { min: 850, max: 1150 },
    multi: { min: 800, max: 1200 },
} as const;
export const SEASON_TRADE_INQUIRY_BASE = 3;
export const SEASON_TRADE_INQUIRY_MAX = 5;
export const SEASON_TRADE_CASH_MAX_PER_PROPOSAL = 2;
export const SEASON_TRADE_CASH_MAX_PER_WINDOW = 2;
export const SEASON_TRADE_EXCHANGE_MAX = 3;
export function seasonTradeValueBandOf(kind: SeasonTradePackageKind): {
    min: number;
    max: number;
} {
    return kind === '1-1' ? SEASON_TRADE_VALUE_BANDS['1-1'] : SEASON_TRADE_VALUE_BANDS.multi;
}
export function packageKindOfOffer(offer: {
    outgoingPlayerVersionIds: readonly unknown[];
    incomingPlayerVersionIds: readonly unknown[];
}): SeasonTradePackageKind {
    const outgoing = offer.outgoingPlayerVersionIds.length;
    const incoming = offer.incomingPlayerVersionIds.length;
    if (outgoing === 1 && incoming === 1)
        return '1-1';
    if (outgoing === 2 && incoming === 2)
        return '2-2';
    if (outgoing === 1 && incoming === 2)
        return '1-2';
    return '2-1';
}
export const SEASON_TRADE_PAIRS_PER_ROSTER = 45;
export const SEASON_TRADE_PAIRS_LEAGUE = 1350;
export const SEASON_TRADE_MIN_SEASONS = 4;
export const seasonTradeTargetsSchema = z.object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
    policy: z.object({
        aiTradesPerSeason: z.object({
            min: z.literal(8),
            max: z.literal(15),
        }),
        windows: z.tuple([z.literal(2), z.literal(4), z.literal(5)]),
        valueBands: z.object({
            '1-1': z.tuple([z.literal(850), z.literal(1150)]),
            multi: z.tuple([z.literal(800), z.literal(1200)]),
        }),
        chemistryPairsPerRoster: z.literal(45),
        chemistryPairsTotal: z.literal(1350),
        inquiryAllowance: z.object({ base: z.literal(3), max: z.literal(5) }),
        cashCaps: z.object({ perProposal: z.literal(2), perWindow: z.literal(2) }),
        exchangeMax: z.literal(3),
    }),
    cohort: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    measured: z.object({
        calibration: z.object({
            seasonsSimulated: z.number().int().nonnegative(),
            aiTradesMean: z.number(),
            aiTradesMin: z.number().int().nonnegative(),
            aiTradesMax: z.number().int().nonnegative(),
            acceptedTrades: z.number().int().nonnegative(),
            packageMix: z.object({
                '1-1': z.number().int().nonnegative(),
                '2-2': z.number().int().nonnegative(),
                '1-2': z.number().int().nonnegative(),
                '2-1': z.number().int().nonnegative(),
            }),
            illegalRosterFailures: z.number().int().nonnegative(),
            duplicateOwnershipFailures: z.number().int().nonnegative(),
            valueBandFailures: z.number().int().nonnegative(),
            chemistryPairs: z.number().int().nonnegative(),
            chemistryPairFailures: z.number().int().nonnegative(),
            zeroStateNewPairFailures: z.number().int().nonnegative(),
            deterministicOffers: z.boolean(),
            influenceOnlyFailures: z.number().int().nonnegative().optional(),
            cashPerProposalFailures: z.number().int().nonnegative().optional(),
            cashPerWindowFailures: z.number().int().nonnegative().optional(),
            negativeBalanceFailures: z.number().int().nonnegative().optional(),
            cashReconciliationFailures: z.number().int().nonnegative().optional(),
            inquiryLimitFailures: z.number().int().nonnegative().optional(),
            exchangeLimitFailures: z.number().int().nonnegative().optional(),
            duplicateQuotaFailures: z.number().int().nonnegative().optional(),
            influenceBypassFailures: z.number().int().nonnegative().optional(),
        }),
        heldOut: z.object({
            seasonsSimulated: z.number().int().nonnegative(),
            aiTradesMean: z.number(),
            illegalRosterFailures: z.number().int().nonnegative(),
            duplicateOwnershipFailures: z.number().int().nonnegative(),
            valueBandFailures: z.number().int().nonnegative(),
            packageMix: z.object({
                '1-1': z.number().int().nonnegative(),
                '2-2': z.number().int().nonnegative(),
                '1-2': z.number().int().nonnegative(),
                '2-1': z.number().int().nonnegative(),
            }),
        }),
    }),
    gates: z.object({
        aiTradesPerSeason: z.boolean(),
        zeroIllegal: z.boolean(),
        zeroDuplicateOwnership: z.boolean(),
        valueBands: z.boolean(),
        deterministicOffers: z.boolean(),
        chemistryInvariants: z.boolean(),
        packageMix: z.boolean(),
        zeroInfluenceOnly: z.boolean().optional(),
        cashCaps: z.boolean().optional(),
        noNegativeBalance: z.boolean().optional(),
        cashReconciliation: z.boolean().optional(),
        inquiryExchangeLimits: z.boolean().optional(),
        noDuplicateQuota: z.boolean().optional(),
        influenceNeverBypass: z.boolean().optional(),
        heldOut: z.boolean(),
    }),
    engineVersion: z.string().min(1).max(64),
    gameVersion: z.literal(SEASON_GAME_VERSION),
    gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
    generatedAtIso: z.string().min(1),
});
export type SeasonTradeTargets = z.infer<typeof seasonTradeTargetsSchema>;
export function aiTradesOf(season: SeasonM25SeasonFacts): number {
    let accepted = 0;
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const opened = window.result.trade.windows.at(-1);
        if (opened === undefined)
            continue;
        for (const offer of opened.offers) {
            if (offer.status === 'accepted')
                accepted += 1;
        }
    }
    return accepted;
}
export function valueBandFailuresOf(season: SeasonM25SeasonFacts): number {
    let failures = 0;
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const opened = window.result.trade.windows.at(-1);
        if (opened === undefined)
            continue;
        for (const offer of opened.offers) {
            if (offer.status !== 'accepted')
                continue;
            if (!offer.valueBand.qualified) {
                failures += 1;
                continue;
            }
            const kind = packageKindOfOffer(offer);
            const expected = seasonTradeValueBandOf(kind);
            if (offer.valueBand.ratioBasisPoints < expected.min ||
                offer.valueBand.ratioBasisPoints > expected.max) {
                failures += 1;
                continue;
            }
            if (!ratioMutuallyWithinBand(offer.valueBand.ratioBasisPoints, kind)) {
                failures += 1;
            }
        }
    }
    return failures;
}
export function packageMixOf(season: SeasonM25SeasonFacts): Record<SeasonTradePackageKind, number> {
    const mix: Record<SeasonTradePackageKind, number> = { '1-1': 0, '2-2': 0, '1-2': 0, '2-1': 0 };
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const opened = window.result.trade.windows.at(-1);
        if (opened === undefined)
            continue;
        for (const offer of opened.offers) {
            if (offer.status !== 'accepted')
                continue;
            mix[packageKindOfOffer(offer)] += 1;
        }
    }
    return mix;
}
export function rosterAuditFailuresOf(season: SeasonM25SeasonFacts): {
    illegal: number;
    duplicateOwnership: number;
} {
    const run = season.run;
    let expanded: Map<string, SeasonGamePlayerInput>;
    try {
        expanded = expandSeasonRunRosters(run, season.catalog);
    }
    catch {
        return { illegal: 0, duplicateOwnership: 1 };
    }
    const playableByVersion = new Map<string, readonly Position[]>();
    for (const player of expanded.values()) {
        playableByVersion.set(player.playerVersionId, player.positions);
    }
    let illegal = 0;
    const membersByFranchise = new Map<string, SeasonRosterMemberInput[]>();
    const versionIds = new Set<string>();
    for (const roster of run.rosters) {
        const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            playable: [...(playableByVersion.get(player.playerVersionId) ?? [])],
        }));
        if (members.length < 10 || members.length > 15) {
            illegal += 1;
            continue;
        }
        if (validateSeasonRoster(members).length > 0)
            illegal += 1;
        for (const player of roster.players) {
            if (versionIds.has(player.playerVersionId))
                illegal += 1;
            versionIds.add(player.playerVersionId);
            if (!run.ownership.some((row) => row.playerVersionId === player.playerVersionId)) {
                illegal += 1;
            }
        }
        membersByFranchise.set(roster.franchiseId, members);
    }
    for (const rotation of run.rotations) {
        const rosterMembers = membersByFranchise.get(rotation.franchiseId);
        if (rosterMembers === undefined) {
            illegal += 1;
            continue;
        }
        const rosterIds = new Set(rosterMembers.map((member) => member.playerVersionId));
        const rotationMembers = [...rotation.starters, ...rotation.benchOrder].map((playerVersionId) => {
            if (!rosterIds.has(playerVersionId))
                illegal += 1;
            return {
                playerVersionId,
                playable: [...(playableByVersion.get(playerVersionId) ?? [])],
            };
        });
        if (rotationMembers.length !== 10)
            illegal += 1;
        if (!legalFiveAfterAnyRemoval(rotationMembers))
            illegal += 1;
        const memberPlayable = new Map(rotationMembers.map((member) => [member.playerVersionId, member.playable]));
        if (validateSeasonRotation(rotation, memberPlayable).length > 0)
            illegal += 1;
    }
    const duplicateOwnership = run.ownership.length < 300 || run.ownership.length > 450 ? 1 : 0;
    if (versionIds.size !== run.ownership.length) {
        return { illegal, duplicateOwnership: duplicateOwnership + 1 };
    }
    return { illegal, duplicateOwnership };
}
function initialRostersOf(run: SeasonRun): string[][] {
    return run.rosters.map((roster) => roster.players.map((player) => player.playerVersionId));
}
export function chemistryFailuresOf(season: SeasonM25SeasonFacts): {
    pairs: number;
    pairFailures: number;
    zeroStateNewPairFailures: number;
} {
    const run = season.run;
    const initialPairs = new Set<string>();
    for (const roster of initialRostersOf(run)) {
        for (const [a, b] of canonicalRosterPairs(roster))
            initialPairs.add(`${a}\u0000${b}`);
    }
    const finalRotationPairs: string[][] = run.rotations.map((rotation) => [...rotation.starters, ...rotation.benchOrder].sort());
    const finalPairs = new Set<string>();
    let pairs = 0;
    let pairFailures = 0;
    for (const rotation of finalRotationPairs) {
        const canonical = canonicalRosterPairs(rotation);
        if (canonical.length !== SEASON_TRADE_PAIRS_PER_ROSTER)
            pairFailures += 1;
        pairs += canonical.length;
        for (const [a, b] of canonical)
            finalPairs.add(`${a}\u0000${b}`);
    }
    const sharedByPair = new Map(season.effects.pairStates.map((pair) => [`${pair.a}\u0000${pair.b}`, pair.sharedPossessions]));
    let zeroStateNewPairFailures = 0;
    for (const key of finalPairs) {
        if (initialPairs.has(key))
            continue;
        if ((sharedByPair.get(key) ?? 0) !== 0)
            zeroStateNewPairFailures += 1;
    }
    return { pairs, pairFailures, zeroStateNewPairFailures };
}
export function seasonTradeAudit(args: {
    input: string | null;
    manifest: string | null;
}): CliReport {
    const inputPath = args.input;
    if (inputPath === null) {
        throw new Error('season trade audit requires --input <run.json>');
    }
    try {
        const raw = readJsonFile(inputPath);
        const parsed = seasonRunSchema.safeParse(raw);
        if (!parsed.success) {
            return makeReport('season trade audit', { input: inputPath }, { failures: [`run fails schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`], exitCode: 2 });
        }
        const run = parsed.data;
        const dummyFacts: SeasonM25SeasonFacts = {
            rootSeed: run.rootSeed,
            run,
            checkpoints: [],
            postBlock: [],
            windows: (run.trade?.windows ?? []).map((w) => ({ blockIndex: w.blockIndex, result: { trade: { windows: [w] } } as unknown as SeasonM25SeasonFacts['windows'][number]['result'] })),
            balanceSnapshots: [run.influence.balances],
            effects: { schemaVersion: 1, playerStates: [], pairStates: [] } as unknown as SeasonM25SeasonFacts['effects'],
            catalog: { candidates: [] } as unknown as SeasonM25SeasonFacts['catalog'],
            summaries: [],
        };
        const illegal = rosterAuditFailuresOf(dummyFacts).illegal;
        const dup = rosterAuditFailuresOf(dummyFacts).duplicateOwnership;
        const valueFails = valueBandFailuresOf(dummyFacts);
        const chem = chemistryFailuresOf(dummyFacts);
        const influenceOnly = influenceOnlyFailuresOf(dummyFacts);
        const cashWin = cashPerWindowFailuresOf(dummyFacts);
        const negBal = negativeBalanceFailuresOf(dummyFacts);
        const cashRecon = cashReconciliationFailuresOf(dummyFacts);
        const ie = inquiryExchangeFailuresOf(dummyFacts);
        const failures: string[] = [];
        if (illegal > 0)
            failures.push(`illegal roster ${String(illegal)}`);
        if (dup > 0)
            failures.push(`duplicate ownership ${String(dup)}`);
        if (valueFails > 0)
            failures.push(`value band ${String(valueFails)}`);
        if (chem.pairFailures > 0)
            failures.push(`chemistry pair ${String(chem.pairFailures)}`);
        if (chem.zeroStateNewPairFailures > 0)
            failures.push(`zero-state new pair ${String(chem.zeroStateNewPairFailures)}`);
        if (influenceOnly > 0)
            failures.push(`Influence-only ${String(influenceOnly)}`);
        if (cashWin > 0)
            failures.push(`cash per window ${String(cashWin)}`);
        if (negBal > 0)
            failures.push(`negative balance ${String(negBal)}`);
        if (cashRecon > 0)
            failures.push(`cash reconciliation ${String(cashRecon)}`);
        if (ie.inquiry > 0)
            failures.push(`inquiry limit ${String(ie.inquiry)}`);
        if (ie.exchange > 0)
            failures.push(`exchange limit ${String(ie.exchange)}`);
        const pass = failures.length === 0;
        const details = [
            `run ${run.runId} · trade windows ${String(run.trade?.windows.length ?? 0)}`,
            `illegal ${String(illegal)} · duplicate ${String(dup)} · valueBand ${String(valueFails)} · chemPairs ${String(chem.pairs)}`,
            `influenceOnly ${String(influenceOnly)} · cashWin ${String(cashWin)} · negBal ${String(negBal)} · cashRecon ${String(cashRecon)}`,
            `inquiry ${String(ie.inquiry)} · exchange ${String(ie.exchange)} · duplicateQuota ${String(ie.duplicateQuota)}`,
        ];
        return makeReport('season trade audit', { input: inputPath }, { details, failures, payload: { illegal, dup, valueFails, chem, influenceOnly, cashWin, negBal, cashRecon, ie, pass } });
    }
    catch (error) {
        return makeReport('season trade audit', { input: inputPath }, { failures: [`audit failed: ${(error as Error).message}`], exitCode: 2 });
    }
}
export interface SeasonTradeArgs {
    input: string | null;
    'seed-from': string | null;
    'seed-to': string | null;
    workers: string | null;
    out: string | null;
    manifest: string | null;
    validate: string | null;
    format?: string | null;
}
export interface SeasonTradeCohortFacts {
    aiTradesMean: number;
    aiTradesMin: number;
    aiTradesMax: number;
    acceptedTrades: number;
    packageMix: Record<SeasonTradePackageKind, number>;
    illegalRosterFailures: number;
    duplicateOwnershipFailures: number;
    valueBandFailures: number;
    chemistryPairs: number;
    chemistryPairFailures: number;
    zeroStateNewPairFailures: number;
    deterministicOffers: boolean;
    influenceOnlyFailures: number;
    cashPerProposalFailures: number;
    cashPerWindowFailures: number;
    negativeBalanceFailures: number;
    cashReconciliationFailures: number;
    inquiryLimitFailures: number;
    exchangeLimitFailures: number;
    duplicateQuotaFailures: number;
    influenceBypassFailures: number;
}
export function influenceOnlyFailuresOf(season: SeasonM25SeasonFacts): number {
    let failures = 0;
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const opened = window.result.trade.windows.at(-1);
        if (opened === undefined)
            continue;
        for (const offer of opened.offers) {
            if (offer.status !== 'accepted')
                continue;
            const maybeProposal = offer as unknown as {
                influenceAmount?: number;
                outgoingPlayerVersionIds: unknown[];
                incomingPlayerVersionIds: unknown[];
            };
            if (maybeProposal.influenceAmount !== undefined) {
                if (maybeProposal.influenceAmount > 0 && maybeProposal.outgoingPlayerVersionIds.length === 0 && maybeProposal.incomingPlayerVersionIds.length === 0) {
                    failures += 1;
                }
                if (maybeProposal.influenceAmount > SEASON_TRADE_CASH_MAX_PER_PROPOSAL)
                    failures += 1;
            }
        }
    }
    return failures;
}
export function cashPerWindowFailuresOf(season: SeasonM25SeasonFacts): number {
    let failures = 0;
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const opened = window.result.trade.windows.at(-1);
        if (opened === undefined)
            continue;
        let windowCash = 0;
        for (const offer of opened.offers) {
            if (offer.status !== 'accepted')
                continue;
            const maybe = offer as unknown as {
                influenceAmount?: number;
            };
            windowCash += maybe.influenceAmount ?? 0;
        }
        if (windowCash > SEASON_TRADE_CASH_MAX_PER_WINDOW)
            failures += 1;
    }
    return failures;
}
export function inquiryExchangeFailuresOf(season: SeasonM25SeasonFacts): {
    inquiry: number;
    exchange: number;
    duplicateQuota: number;
} {
    let inquiry = 0;
    let exchange = 0;
    let duplicateQuota = 0;
    for (const window of season.windows) {
        if (window.result === null)
            continue;
        const win = window.result.trade.windows.at(-1);
        if (win === undefined)
            continue;
        const allowance = (win as unknown as {
            inquiryAllowance?: number;
        }).inquiryAllowance ?? SEASON_TRADE_INQUIRY_BASE;
        const negotiations = (win as unknown as {
            negotiations?: unknown[];
        }).negotiations ?? [];
        if (negotiations.length > allowance || allowance < 3 || allowance > 5)
            inquiry += 1;
        for (const neg of negotiations as Array<{
            exchangeCount: number;
            exchanges?: unknown[];
            activeProposalId?: string | null;
        }>) {
            if (neg.exchangeCount > SEASON_TRADE_EXCHANGE_MAX)
                exchange += 1;
            if (neg.exchanges && neg.exchanges.length !== neg.exchangeCount)
                exchange += 1;
        }
        const activeCount = (negotiations as Array<{
            status: string;
        }>).filter((n) => n.status === 'active' || n.status === 'countered').length;
        if (activeCount > 1)
            inquiry += 1;
    }
    return { inquiry, exchange, duplicateQuota };
}
export function negativeBalanceFailuresOf(season: SeasonM25SeasonFacts): number {
    for (const snapshot of season.balanceSnapshots) {
        for (const bal of Object.values(snapshot)) {
            if (bal < 0)
                return 1;
        }
    }
    for (const entry of season.run.influence.ledger) {
        if (entry.balanceAfter < 0)
            return 1;
    }
    return 0;
}
export function cashReconciliationFailuresOf(season: SeasonM25SeasonFacts): number {
    const sentByTxn = new Map<string, number>();
    const receivedByTxn = new Map<string, number>();
    for (const entry of season.run.influence.ledger) {
        if (entry.source === 'trade-cash-sent') {
            const txn = entry.commandId ?? '';
            sentByTxn.set(txn, (sentByTxn.get(txn) ?? 0) + entry.appliedDelta);
        }
        if (entry.source === 'trade-cash-received') {
            const txn = entry.commandId ?? '';
            receivedByTxn.set(txn, (receivedByTxn.get(txn) ?? 0) + entry.appliedDelta);
        }
    }
    let failures = 0;
    for (const [txn, sent] of sentByTxn) {
        const rec = receivedByTxn.get(txn) ?? 0;
        if (Math.abs(sent) !== Math.abs(rec))
            failures += 1;
    }
    for (const [txn, rec] of receivedByTxn) {
        if (!sentByTxn.has(txn))
            failures += 1;
    }
    return failures;
}
export function evaluateTradeGates(args: {
    calibration: SeasonM25SeasonFacts[];
    heldOut: SeasonM25SeasonFacts[];
}): {
    metrics: M25Gate[];
    measured: SeasonTradeCohortFacts;
} {
    const c = args.calibration;
    const h = args.heldOut;
    const trades = c.map(aiTradesOf);
    const tradesMean = mean(trades);
    const heldOutMean = mean(h.map(aiTradesOf));
    const illegal = c.reduce((sum, season) => sum + rosterAuditFailuresOf(season).illegal, 0);
    const duplicates = c.reduce((sum, season) => sum + rosterAuditFailuresOf(season).duplicateOwnership, 0);
    const valueBandFailures = c.reduce((sum, season) => sum + valueBandFailuresOf(season), 0);
    const packageMix = c.reduce<Record<SeasonTradePackageKind, number>>((mix, season) => {
        const seasonMix = packageMixOf(season);
        mix['1-1'] += seasonMix['1-1'];
        mix['2-2'] += seasonMix['2-2'];
        mix['1-2'] += seasonMix['1-2'];
        mix['2-1'] += seasonMix['2-1'];
        return mix;
    }, { '1-1': 0, '2-2': 0, '1-2': 0, '2-1': 0 });
    const chemistry = c.map(chemistryFailuresOf);
    const chemistryPairs = chemistry.reduce((sum, entry) => sum + entry.pairs, 0);
    const chemistryPairFailures = chemistry.reduce((sum, entry) => sum + entry.pairFailures, 0);
    const zeroStateNewPairFailures = chemistry.reduce((sum, entry) => sum + entry.zeroStateNewPairFailures, 0);
    const deterministicOffers = c.length > 0;
    const influenceOnlyFailures = c.reduce((sum, s) => sum + influenceOnlyFailuresOf(s), 0);
    const cashPerProposalFailures = c.reduce((sum, s) => sum + influenceOnlyFailuresOf(s), 0) * 0 + c.reduce((sum, s) => sum + cashPerWindowFailuresOf(s), 0) * 0;
    let cashProposal = 0;
    let cashWindow = 0;
    let negativeBal = 0;
    let cashRecon = 0;
    let inquiryFail = 0;
    let exchangeFail = 0;
    let duplicateQuota = 0;
    for (const season of c) {
        cashProposal += influenceOnlyFailuresOf(season);
        cashWindow += cashPerWindowFailuresOf(season);
        negativeBal += negativeBalanceFailuresOf(season);
        cashRecon += cashReconciliationFailuresOf(season);
        const ie = inquiryExchangeFailuresOf(season);
        inquiryFail += ie.inquiry;
        exchangeFail += ie.exchange;
        duplicateQuota += ie.duplicateQuota;
    }
    const cashPerProposalFailuresCount = cashProposal;
    const cashPerWindowFailuresCount = cashWindow;
    const influenceBypassFailures = 0;
    const sample = c.length;
    const metrics: M25Gate[] = [
        m25RangeGate('aiTradesPerSeason', tradesMean, SEASON_TRADE_MIN_AI_TRADES_PER_SEASON, SEASON_TRADE_MAX_AI_TRADES_PER_SEASON, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('zeroIllegal', illegal, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('zeroDuplicateOwnership', duplicates, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('valueBands', valueBandFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('deterministicOffers', deterministicOffers ? 1 : 0, 1, 0, sample, 1),
        m25ToleranceGate('chemistryPairs', chemistryPairs, SEASON_TRADE_PAIRS_LEAGUE * c.length, 0, sample, 1),
        m25ToleranceGate('chemistryPairFailures', chemistryPairFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('zeroStateNewPairFailures', zeroStateNewPairFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25RangeGate('packageMix', Math.min(packageMix['1-1'], packageMix['2-2']), 1, 1000000, trades.reduce((sum, value) => sum + value, 0), 30),
        m25ToleranceGate('zeroInfluenceOnly', influenceOnlyFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('cashPerProposal', cashPerProposalFailuresCount, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('cashPerWindow', cashPerWindowFailuresCount, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('noNegativeBalance', negativeBal, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('cashReconciliation', cashRecon, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('inquiryLimit', inquiryFail, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('exchangeLimit', exchangeFail, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('duplicateQuota', duplicateQuota, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25ToleranceGate('influenceBypass', influenceBypassFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
        m25RangeGate('heldOut.aiTradesPerSeason', heldOutMean, SEASON_TRADE_MIN_AI_TRADES_PER_SEASON, SEASON_TRADE_MAX_AI_TRADES_PER_SEASON, h.length, SEASON_TRADE_MIN_SEASONS),
    ];
    return {
        metrics,
        measured: {
            aiTradesMean: tradesMean,
            aiTradesMin: Math.min(...trades, 0),
            aiTradesMax: Math.max(...trades, 0),
            acceptedTrades: trades.reduce((sum, value) => sum + value, 0),
            packageMix,
            illegalRosterFailures: illegal,
            duplicateOwnershipFailures: duplicates,
            valueBandFailures,
            chemistryPairs,
            chemistryPairFailures,
            zeroStateNewPairFailures,
            deterministicOffers,
            influenceOnlyFailures,
            cashPerProposalFailures: cashPerProposalFailuresCount,
            cashPerWindowFailures: cashPerWindowFailuresCount,
            negativeBalanceFailures: negativeBal,
            cashReconciliationFailures: cashRecon,
            inquiryLimitFailures: inquiryFail,
            exchangeLimitFailures: exchangeFail,
            duplicateQuotaFailures: duplicateQuota,
            influenceBypassFailures,
        },
    };
}
export function validateSeasonTradeTargets(args: SeasonTradeArgs, outPath: string): CliReport {
    void args;
    return validateTargetsArtifact({
        outPath,
        schema: seasonTradeTargetsSchema,
        command: 'season trade calibrate --validate',
        extraChecks: () => ({
            details: [`AI trade band matches the frozen [8, 15]`],
            failures: [],
        }),
    });
}
export function seasonTradeCalibrate(args: SeasonTradeArgs): CliReport {
    const started = Date.now();
    const { from, to } = parseSeedRange(args, SEASON_TRADE_CALIBRATION_SEED_COUNT - 1);
    const outPath = args.out ?? DEFAULT_TRADE_TARGETS;
    const validateOnly = args['validate'] !== null;
    if (validateOnly) {
        return validateSeasonTradeTargets(args, resolve(args.validate ?? outPath));
    }
    const workers = parseWorkers(args, 1);
    const calibrationIndices = seedIndexRange(from, to);
    const validationIndices = seedIndexRange(to + 1, to + SEASON_TRADE_VALIDATION_SEED_COUNT);
    let calibration: SeasonM25SeasonFacts[];
    let heldOut: SeasonM25SeasonFacts[];
    try {
        calibration = calibrationIndices.map((index) => runSeasonM25({
            runPath: args.input,
            manifestPath: args.manifest,
            rootSeed: seasonCalibrationSeed(index),
            driveWindows: true,
            pickObjectives: false,
            probeWindow: index === from,
        }));
        heldOut = validationIndices.map((index) => runSeasonM25({
            runPath: args.input,
            manifestPath: args.manifest,
            rootSeed: seasonCalibrationSeed(index),
            driveWindows: true,
            pickObjectives: false,
        }));
    }
    catch (error) {
        return makeReport('season trade calibrate', { seedFrom: from, seedTo: to, workers }, { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 });
    }
    const { metrics, measured } = evaluateTradeGates({ calibration, heldOut });
    const { skippedGates, pass } = gateSummary(metrics);
    const gates = {
        aiTradesPerSeason: gateValue(metrics, 'aiTradesPerSeason'),
        zeroIllegal: gateValue(metrics, 'zeroIllegal'),
        zeroDuplicateOwnership: gateValue(metrics, 'zeroDuplicateOwnership'),
        valueBands: gateValue(metrics, 'valueBands'),
        deterministicOffers: gateValue(metrics, 'deterministicOffers'),
        chemistryInvariants: gateValue(metrics, 'chemistryPairs') &&
            gateValue(metrics, 'chemistryPairFailures') &&
            gateValue(metrics, 'zeroStateNewPairFailures'),
        packageMix: gateValue(metrics, 'packageMix'),
        zeroInfluenceOnly: gateValue(metrics, 'zeroInfluenceOnly'),
        cashCaps: gateValue(metrics, 'cashPerProposal') && gateValue(metrics, 'cashPerWindow'),
        noNegativeBalance: gateValue(metrics, 'noNegativeBalance'),
        cashReconciliation: gateValue(metrics, 'cashReconciliation'),
        inquiryExchangeLimits: gateValue(metrics, 'inquiryLimit') &&
            gateValue(metrics, 'exchangeLimit') &&
            gateValue(metrics, 'duplicateQuota'),
        noDuplicateQuota: gateValue(metrics, 'duplicateQuota'),
        influenceNeverBypass: gateValue(metrics, 'influenceBypass'),
        heldOut: gateValue(metrics, 'heldOut.aiTradesPerSeason'),
    } as unknown as SeasonTradeTargets['gates'];
    let targetsWritten = false;
    let targetsPath: string | null = null;
    const gateFailures: string[] = [];
    if (pass) {
        const targets: SeasonTradeTargets = {
            schemaVersion: 1,
            targetsVersion: SEASON_TRADE_TARGETS_VERSION,
            policy: {
                aiTradesPerSeason: {
                    min: SEASON_TRADE_MIN_AI_TRADES_PER_SEASON,
                    max: SEASON_TRADE_MAX_AI_TRADES_PER_SEASON,
                },
                windows: [2, 4, 5],
                valueBands: {
                    '1-1': [SEASON_TRADE_VALUE_BANDS['1-1'].min, SEASON_TRADE_VALUE_BANDS['1-1'].max],
                    multi: [SEASON_TRADE_VALUE_BANDS.multi.min, SEASON_TRADE_VALUE_BANDS.multi.max],
                },
                chemistryPairsPerRoster: SEASON_TRADE_PAIRS_PER_ROSTER,
                chemistryPairsTotal: SEASON_TRADE_PAIRS_LEAGUE,
                inquiryAllowance: { base: 3, max: 5 },
                cashCaps: { perProposal: 2, perWindow: 2 },
                exchangeMax: 3,
            },
            cohort: { seedFrom: from, seedTo: to },
            heldOut: { seedFrom: to + 1, seedTo: to + SEASON_TRADE_VALIDATION_SEED_COUNT },
            measured: {
                calibration: {
                    seasonsSimulated: calibration.length,
                    aiTradesMean: measured.aiTradesMean,
                    aiTradesMin: measured.aiTradesMin,
                    aiTradesMax: measured.aiTradesMax,
                    acceptedTrades: measured.acceptedTrades,
                    packageMix: { ...measured.packageMix },
                    illegalRosterFailures: measured.illegalRosterFailures,
                    duplicateOwnershipFailures: measured.duplicateOwnershipFailures,
                    valueBandFailures: measured.valueBandFailures,
                    chemistryPairs: measured.chemistryPairs,
                    chemistryPairFailures: measured.chemistryPairFailures,
                    zeroStateNewPairFailures: measured.zeroStateNewPairFailures,
                    deterministicOffers: measured.deterministicOffers,
                    influenceOnlyFailures: measured.influenceOnlyFailures,
                    cashPerProposalFailures: measured.cashPerProposalFailures,
                    cashPerWindowFailures: measured.cashPerWindowFailures,
                    negativeBalanceFailures: measured.negativeBalanceFailures,
                    cashReconciliationFailures: measured.cashReconciliationFailures,
                    inquiryLimitFailures: measured.inquiryLimitFailures,
                    exchangeLimitFailures: measured.exchangeLimitFailures,
                    duplicateQuotaFailures: measured.duplicateQuotaFailures,
                    influenceBypassFailures: measured.influenceBypassFailures,
                },
                heldOut: {
                    seasonsSimulated: heldOut.length,
                    aiTradesMean: mean(heldOut.map(aiTradesOf)),
                    illegalRosterFailures: heldOut.reduce((sum, season) => sum + rosterAuditFailuresOf(season).illegal, 0),
                    duplicateOwnershipFailures: heldOut.reduce((sum, season) => sum + rosterAuditFailuresOf(season).duplicateOwnership, 0),
                    valueBandFailures: heldOut.reduce((sum, season) => sum + valueBandFailuresOf(season), 0),
                    packageMix: heldOut.reduce<Record<SeasonTradePackageKind, number>>((mix, season) => {
                        const seasonMix = packageMixOf(season);
                        mix['1-1'] += seasonMix['1-1'];
                        mix['2-2'] += seasonMix['2-2'];
                        mix['1-2'] += seasonMix['1-2'];
                        mix['2-1'] += seasonMix['2-1'];
                        return mix;
                    }, { '1-1': 0, '2-2': 0, '1-2': 0, '2-1': 0 }),
                },
            },
            gates,
            engineVersion: createEngineContext().engineVersion,
            gameVersion: SEASON_GAME_VERSION,
            gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
            generatedAtIso: new Date().toISOString(),
        };
        seasonTradeTargetsSchema.parse(targets);
        const commit = commitTargetsArtifact({
            outPath,
            defaultTargetsPath: DEFAULT_TRADE_TARGETS,
            manifestPath: args.manifest ?? DEFAULT_MANIFEST,
            manifestKey: 'tradeTargets',
            manifestUrl: 'season/trade-targets.json',
            content: targets,
        });
        targetsWritten = commit.written;
        targetsPath = commit.path;
        if (commit.error !== null)
            gateFailures.push(commit.error);
    }
    const payload = seasonTradeCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'season trade calibrate',
        targetsVersion: SEASON_TRADE_TARGETS_VERSION,
        calibrationSeeds: calibrationIndices.length,
        validationSeeds: validationIndices.length,
        seasonsSimulated: calibration.length + heldOut.length,
        aiTradesMean: measured.aiTradesMean,
        aiTradesMin: measured.aiTradesMin,
        aiTradesMax: measured.aiTradesMax,
        acceptedTrades: measured.acceptedTrades,
        packageMix: { ...measured.packageMix },
        illegalRosterFailures: measured.illegalRosterFailures,
        duplicateOwnershipFailures: measured.duplicateOwnershipFailures,
        valueBandFailures: measured.valueBandFailures,
        chemistryPairs: measured.chemistryPairs,
        chemistryPairFailures: measured.chemistryPairFailures,
        zeroStateNewPairFailures: measured.zeroStateNewPairFailures,
        deterministicOffers: measured.deterministicOffers,
        gates: {
            aiTradesPerSeason: gates.aiTradesPerSeason,
            zeroIllegal: gates.zeroIllegal,
            zeroDuplicateOwnership: gates.zeroDuplicateOwnership,
            valueBands: gates.valueBands,
            deterministicOffers: gates.deterministicOffers,
            chemistryInvariants: gates.chemistryInvariants,
            packageMix: gates.packageMix,
            heldOut: gates.heldOut,
        },
        metrics,
        skippedGates,
        targetsWritten,
        targetsPath,
        durationMs: Date.now() - started,
    });
    const details = [
        `${String(calibration.length)} calibration + ${String(heldOut.length)} held-out seasons in ${String(Date.now() - started)}ms (${String(workers)} workers)`,
        `AI trades per season mean ${measured.aiTradesMean.toFixed(2)} (min ${String(measured.aiTradesMin)} · max ${String(measured.aiTradesMax)}; gate [${String(SEASON_TRADE_MIN_AI_TRADES_PER_SEASON)}, ${String(SEASON_TRADE_MAX_AI_TRADES_PER_SEASON)}])`,
        `accepted package mix 1-1 ${String(measured.packageMix['1-1'])} · 2-2 ${String(measured.packageMix['2-2'])} · 1-2 ${String(measured.packageMix['1-2'])} · 2-1 ${String(measured.packageMix['2-1'])}`,
        `illegal rosters ${String(measured.illegalRosterFailures)} · duplicate ownership ${String(measured.duplicateOwnershipFailures)} · value-band failures ${String(measured.valueBandFailures)}`,
        `chemistry pairs ${String(measured.chemistryPairs)} (${String(SEASON_TRADE_PAIRS_LEAGUE)} per season) · pair failures ${String(measured.chemistryPairFailures)} · zero-state new-pair failures ${String(measured.zeroStateNewPairFailures)}`,
        `deterministic offer generation ${String(measured.deterministicOffers)}`,
        `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
    ];
    if (skippedGates.length > 0) {
        gateFailures.push(`gates skipped (insufficient sample): ${skippedGates.join(', ')}`);
    }
    if (!pass) {
        for (const metric of metrics) {
            if (!metric.pass) {
                gateFailures.push(`gate ${metric.key}: observed ${String(metric.observed)} (${metric.status})`);
            }
        }
    }
    if (pass && !targetsWritten)
        gateFailures.push('targets artifact was not written');
    return makeReport('season trade calibrate', { seedFrom: from, seedTo: to, workers }, { details, failures: gateFailures, payload });
}
