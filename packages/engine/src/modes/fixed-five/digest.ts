import type { ContentHash, FixedFiveCommand, FixedFiveCompetitionResult, FixedFiveLineupEntry, FixedFiveVersionLocks, Seed, } from '@hoop-rush/data-contracts';
import { canonicalJson, contentHashSchema, seasonDigestHex } from '@hoop-rush/data-contracts';
export interface FixedFiveDigestInput {
    rootSeed: Seed;
    versions: FixedFiveVersionLocks;
    lineups: {
        p1: FixedFiveLineupEntry;
        p2: FixedFiveLineupEntry;
    };
    acceptedCommands: FixedFiveCommand[];
    result: FixedFiveCompetitionResult;
    aggregates?: unknown;
}
const DIGESTED_COMMAND_KINDS: ReadonlySet<FixedFiveCommand['payload']['kind']> = new Set([
    'reroll',
    'classic-pick',
    'duel-claim',
    'sandbox-place',
    'sandbox-remove',
    'sandbox-lock',
    'timeout-autopick',
]);
export function isFixedFiveGameInputCommand(command: FixedFiveCommand): boolean {
    return DIGESTED_COMMAND_KINDS.has(command.payload.kind);
}
export function gameInputCommands(commands: FixedFiveCommand[]): FixedFiveCommand[] {
    return [...commands]
        .sort((a, b) => a.ordinal - b.ordinal)
        .filter((command) => isFixedFiveGameInputCommand(command));
}
export function canonicalFixedFiveDigestPayload(input: FixedFiveDigestInput): Record<string, unknown> {
    return {
        rootSeed: input.rootSeed,
        versions: input.versions,
        lineups: input.lineups,
        acceptedCommands: gameInputCommands(input.acceptedCommands),
        result: input.result,
        aggregates: input.aggregates ?? null,
    };
}
export function fixedFiveResultDigest(input: FixedFiveDigestInput): ContentHash {
    const material = canonicalJson(canonicalFixedFiveDigestPayload(input));
    return contentHashSchema.parse(`${seasonDigestHex(`fixed-five-digest-v1:${material}`)}${seasonDigestHex(`fixed-five-digest-v2:${material}`)}`);
}
export function verifyFixedFiveDigest(input: FixedFiveDigestInput, expectedDigest: string): boolean {
    return fixedFiveResultDigest(input) === expectedDigest;
}
