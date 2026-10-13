import type {
  HavocAuthoritativeChannel,
  HavocGameInput,
  HavocMutationId,
  HavocParticipant,
  HavocTeamInput,
  Position,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  playerIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  buildHavocEffectiveProfile,
  buildHavocGameInput,
  buildHavocParticipant,
  buildHavocSourcePlayer,
  buildHavocTeamInput,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocGame } from './game.ts';
import { auditHavocGame } from './audit.ts';
import { havocGameInputDigest, havocGameResultDigest, havocGameTapeDigest } from './digests.ts';

export interface ScenarioSlot {
  slot: Position;
  mutations: HavocMutationId[];
  ratings?: Partial<SimulationRatings>;
  tendencies?: Partial<SimulationTendencies>;
  overall?: number;
  heightInches?: number | null;
  physical?: {
    heightInches?: number;
    wingspanDeltaInches?: number;
    reachUnits?: number;
  };
  authoritativeChannels?: HavocAuthoritativeChannel[];
  clone?: boolean;
}

export function scenarioInstanceId(index: number): string {
  return `hvi-${(index + 16).toString(16).padStart(32, '0')}`;
}

export function buildScenarioTeam(
  side: 'human' | 'opponent',
  slots: readonly ScenarioSlot[],
): HavocTeamInput {
  const base = side === 'human' ? 1 : 101;
  const starters: HavocParticipant[] = slots.map((entry, index) => {
    const source = buildHavocSourcePlayer({
      playerId: playerIdSchema.parse(`p-${side}-scn-${String(index + 1)}`),
      displayName: `${side} ${entry.slot}`,
      positions: [entry.slot],
      originalOverall: entry.overall ?? (side === 'human' ? 88 - index : 80),
      profile: {
        ratings: { ...SIMULATION_RATINGS, ...entry.ratings },
        tendencies: { ...SIMULATION_TENDENCIES, ...entry.tendencies },
      },
      physical: {
        heightInches: entry.heightInches === undefined ? 78 : entry.heightInches,
        weightLbs: 215,
      },
    });
    const baseEffective = buildHavocEffectiveProfile(source, {
      authoritativeChannels: entry.authoritativeChannels ?? [],
    });
    const effective =
      entry.physical === undefined
        ? baseEffective
        : buildHavocEffectiveProfile(source, {
            authoritativeChannels: entry.authoritativeChannels ?? [],
            physical: { ...baseEffective.physical, ...entry.physical },
          });
    return buildHavocParticipant({
      instanceId: scenarioInstanceId(base + index),
      kind: 'starter',
      slot: entry.slot,
      source,
      mutationPackage: entry.mutations.map((mutationId) => ({ mutationId })),
      effective,
    });
  });
  const replacements: HavocParticipant[] = starters.map((starter, index) =>
    buildHavocParticipant({
      instanceId: scenarioInstanceId(base + 10 + index),
      kind: 'replacement',
      slot: starter.slot,
      ownerInstanceId: starter.instanceId,
      source: starter.source,
      mutationPackage: [],
      effective: buildHavocEffectiveProfile(starter.source),
    }),
  );
  const clones: HavocParticipant[] = starters
    .filter((_starter, index) => {
      const entry = slots[index];
      return (
        entry !== undefined && (entry.clone === true || entry.mutations.includes('clone-army'))
      );
    })
    .map((starter, cloneIndex) =>
      buildHavocParticipant({
        instanceId: scenarioInstanceId(base + 20 + cloneIndex),
        kind: 'clone',
        slot: starter.slot,
        ownerInstanceId: starter.instanceId,
        source: starter.source,
        mutationPackage: [],
        effective: starter.effective,
      }),
    );
  return buildHavocTeamInput(side, { starters, replacements, clones });
}

export function buildScenarioInput(
  human: HavocTeamInput,
  away: HavocTeamInput,
  seedText: string,
  gameNumber = 1,
): HavocGameInput {
  return buildHavocGameInput({
    seed: seedSchema.parse(seedFromString(seedText)),
    gameNumber,
    home: human,
    away,
    humanSide: 'home',
  });
}

export interface ScenarioRun {
  input: HavocGameInput;
  result: ReturnType<typeof simulateHavocGame>['result'];
  tape: ReturnType<typeof simulateHavocGame>['tape'];
  inputDigest: string;
  resultDigest: string;
  tapeDigest: string;
}

export interface ScenarioOptions {
  /** Overrides the era profile pace (used to force clock scenarios). */
  pace?: number;
}

function applyOptions(input: HavocGameInput, options?: ScenarioOptions): HavocGameInput {
  if (options?.pace === undefined) return input;
  return {
    ...input,
    profile: {
      ...input.profile,
      parameters: { ...input.profile.parameters, pace: options.pace },
    },
  };
}

export function runScenario(
  human: HavocTeamInput,
  away: HavocTeamInput,
  seedText: string,
  gameNumber = 1,
  options?: ScenarioOptions,
): ScenarioRun {
  const input = applyOptions(buildScenarioInput(human, away, seedText, gameNumber), options);
  const simulation = simulateHavocGame(input, createEngineContext());
  const audit = auditHavocGame(input, simulation.result, simulation.tape);
  if (!audit.ok) {
    throw new Error(
      `havoc scenario audit failed for ${seedText}: ${audit.findings
        .slice(0, 3)
        .map((finding) => `${finding.code}:${finding.message}`)
        .join(' | ')}`,
    );
  }
  return {
    input,
    result: simulation.result,
    tape: simulation.tape,
    inputDigest: havocGameInputDigest(input),
    resultDigest: havocGameResultDigest(simulation.result),
    tapeDigest: havocGameTapeDigest(simulation.tape),
  };
}

export function searchScenario(
  runs: number,
  human: HavocTeamInput,
  away: HavocTeamInput,
  predicate: (run: ScenarioRun) => boolean,
  seedPrefix = 'havoc-scn',
  options?: ScenarioOptions,
): ScenarioRun | null {
  for (let index = 0; index < runs; index += 1) {
    const run = runScenario(human, away, `${seedPrefix}-${String(index)}`, 1, options);
    if (predicate(run)) return run;
  }
  return null;
}
