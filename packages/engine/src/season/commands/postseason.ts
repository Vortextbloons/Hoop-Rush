import type {
  Position,
  SeasonAdvancePostseasonCommand,
  SeasonFastForwardPostseasonCommand,
  SeasonInsufficientRehabResourcesRejection,
  SeasonInvalidRotationRejection,
  SeasonInvalidStageRejection,
  SeasonPostseasonState,
  SeasonPostseasonSummary,
  SeasonRun,
  SeasonRunStage,
  SeasonSpectatePostseasonGameCommand,
  SeasonStartPostseasonCommand,
  SeasonSubmitPostseasonRotationCommand,
  SeasonUnavailablePlayerRejection,
  SeasonWrongGameRejection,
} from '@hoop-rush/data-contracts';
import {
  SEASON_ROUND_COUNT,
  franchiseIdSchema,
  normalizeEvolutionState,
  playInGameIdOf,
} from '@hoop-rush/data-contracts';
import { expandSeasonRunRosters } from '../block.ts';
import { rehabPriceOf } from '../evolution.ts';
import { seasonFranchiseLegalFiveFacts } from '../health.ts';
import { applyRiskyRehabOutcome, seasonPlayerAvailable } from '../injuries.ts';
import { SEASON_INFLUENCE_FLOOR, applySeasonInfluenceSpend } from '../influence.ts';
import {
  POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
  SeasonPostseasonContextError,
  SeasonPostseasonInvariantError,
  rollPostseasonRehabOutcome,
  seasonPostseasonApplyGameResult,
  seasonPostseasonHumanEliminated,
  seasonPostseasonHumanPlaysGame,
  seasonPostseasonNextGame,
  seasonPostseasonSetRankings,
  seasonPostseasonStageOf,
  seasonPostseasonUpcomingGames,
  simulateSeasonPostseasonGame,
  type SeasonPostseasonRankingsInput,
} from '../postseason.ts';
import { legalFiveExists, type SeasonRosterMemberInput } from '../roster-rules.ts';
import { seasonRotationSetDigest, validateSeasonRotation } from '../rotation.ts';
import { rankSeasonPostseason } from '../tiebreakers.ts';
import { seasonTransactionEntry } from '../transactions.ts';
import {
  SeasonRunCommandNotImplementedError,
  acceptedCommand,
  advanceRunState,
  baseValidation,
  deriveAwardsIfNeeded,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
const REQUIRED_POSTSEASON_STAGE: SeasonRunStage = 'play-in';
function postseasonInvalidStageRejection(run: SeasonRun): SeasonInvalidStageRejection {
  return {
    code: 'invalid-stage',
    requiredStage: REQUIRED_POSTSEASON_STAGE,
    currentStage: run.stage,
  };
}
export function handleStartPostseason(
  command: SeasonStartPostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage !== 'regular-season' || run.cursor.completedRounds < SEASON_ROUND_COUNT) {
    const rejection: SeasonInvalidStageRejection = {
      code: 'invalid-stage',
      requiredStage: 'regular-season',
      currentStage: run.stage,
    };
    return rejectedCommand(command, rejection, run);
  }
  let postseason: SeasonPostseasonState;
  try {
    const rankings =
      context.rankings ??
      ((input: SeasonPostseasonRankingsInput) => {
        const ranked = rankSeasonPostseason(input.league, input.standings, input.seed);
        return { east: ranked.east.topTen, west: ranked.west.topTen };
      });
    const rankingResult = rankings({
      league: run.league,
      standings: run.standings,
      seed: run.rootSeed,
    });
    postseason = seasonPostseasonSetRankings(run.postseason, run.league, rankingResult);
  } catch (error) {
    if (error instanceof SeasonPostseasonInvariantError) {
      return rejectedCommand(command, { code: 'integrity-failure', reason: error.message }, run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, stage: 'play-in', postseason });
  return acceptedCommand(
    command,
    {
      stage: 'play-in',
      postseasonSeed: postseason.seed,
      nextGameId: playInGameIdOf('east', 'seven-eight'),
    },
    next,
    null,
  );
}
export function handleAdvancePostseason(
  command: SeasonAdvancePostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedCommand(command, postseasonInvalidStageRejection(run), run);
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'advance-postseason requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  const positions = new Map<string, readonly Position[]>();
  for (const player of expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  const target = command.targetGameId;
  if (target !== undefined) {
    const upcoming = seasonPostseasonUpcomingGames(run.postseason);
    if (!upcoming.includes(target)) {
      const next = seasonPostseasonNextGame(run.postseason);
      if (next.kind === 'integrity-failure') {
        return rejectedCommand(command, { code: 'integrity-failure', reason: next.reason }, run);
      }
      if (next.kind === 'complete') {
        return rejectedCommand(
          command,
          { code: 'integrity-failure', reason: 'the postseason is complete' },
          run,
        );
      }
      return rejectedCommand(
        command,
        { code: 'wrong-game', targetGameId: target, nextGameId: next.gameId },
        run,
      );
    }
  }
  const humanFranchiseId = context.humanFranchiseId;
  let current = run;
  const advanced: string[] = [];
  const summaries: SeasonPostseasonSummary[] = [];
  let humanWait: string | null = null;
  let integrityReason: string | null = null;
  let forfeitedHumanGame = false;
  for (;;) {
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind === 'integrity-failure') {
      integrityReason = decision.reason;
      break;
    }
    if (decision.kind === 'complete') break;
    const gameId = decision.gameId;
    if (
      humanFranchiseId !== null &&
      seasonPostseasonHumanPlaysGame(current.postseason, gameId, humanFranchiseId)
    ) {
      if (command.forfeit === true) {
        const outcome = simulateSeasonPostseasonGame(
          {
            run: current,
            effects: current.effects,
            expanded,
            catalog: context.catalog,
            profile: context.profile,
            gameId,
            humanFranchiseId,
            forfeitHumanGame: true,
          },
          { resolver: context.postseasonGameResolver },
        );
        if (outcome.kind === 'integrity-failure') {
          integrityReason = outcome.reason;
          break;
        }
        current = {
          ...current,
          postseason: seasonPostseasonApplyGameResult(
            current.postseason,
            outcome.facts,
            current.league,
            current.standings,
          ),
          health: outcome.nextHealth,
          effects: outcome.nextEffects,
        };
        advanced.push(gameId);
        summaries.push(outcome.summary);
        forfeitedHumanGame = true;
        break;
      }
      const humanRotation = current.rotations.find(
        (rotation) => rotation.franchiseId === humanFranchiseId,
      );
      const minutesOnUnavailable = (humanRotation?.targetMinutes ?? []).some(
        (entry) =>
          entry.minutes > 0 && !seasonPlayerAvailable(current.health, entry.playerVersionId),
      );
      const legalFacts = seasonFranchiseLegalFiveFacts(
        current,
        humanFranchiseId,
        current.health,
        positions,
      );
      if (minutesOnUnavailable || !legalFacts.legal) {
        humanWait = gameId;
        break;
      }
    }
    const outcome = simulateSeasonPostseasonGame(
      {
        run: current,
        effects: current.effects,
        expanded,
        catalog: context.catalog,
        profile: context.profile,
        gameId,
        humanFranchiseId,
      },
      { resolver: context.postseasonGameResolver },
    );
    if (outcome.kind === 'integrity-failure') {
      integrityReason = outcome.reason;
      break;
    }
    current = {
      ...current,
      postseason: seasonPostseasonApplyGameResult(
        current.postseason,
        outcome.facts,
        current.league,
        current.standings,
      ),
      health: outcome.nextHealth,
      effects: outcome.nextEffects,
    };
    advanced.push(gameId);
    summaries.push(outcome.summary);
    if (target !== undefined && gameId === target) break;
  }
  if (command.forfeit === true && !forfeitedHumanGame && integrityReason === null) {
    integrityReason = 'forfeit requested, but the human franchise has no upcoming game';
  }
  if (integrityReason !== null) {
    return rejectedCommand(command, { code: 'integrity-failure', reason: integrityReason }, run);
  }
  const stage = seasonPostseasonStageOf(current.postseason);
  const championFranchiseId = current.postseason.championFranchiseId;
  if (stage === 'completed' && championFranchiseId === null) {
    throw new Error(`postseason completed without champion for ${command.commandId}`);
  }
  const completion =
    stage === 'completed' && championFranchiseId !== null
      ? {
          championFranchiseId,
          almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
          finalizedAtStateRevision: run.stateRevision + 1,
        }
      : null;
  const withAwards = deriveAwardsIfNeeded(current, context, stage);
  const nextRun = advanceRunState({ ...withAwards, stage, completion });
  const after = seasonPostseasonNextGame(nextRun.postseason);
  const nextGameIdAfter = after.kind === 'game' ? after.gameId : null;
  const humanNext =
    nextGameIdAfter !== null &&
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(nextRun.postseason, nextGameIdAfter, humanFranchiseId);
  const nextDecision = humanWait !== null || humanNext ? 'rotation' : 'none';
  return acceptedCommand(
    command,
    {
      stage,
      advancedGameIds: advanced,
      nextDecision,
      nextGameId: humanWait ?? (humanNext ? nextGameIdAfter : null),
      aiNextGameId: nextDecision === 'rotation' ? null : nextGameIdAfter,
    },
    nextRun,
    null,
    summaries,
  );
}
export function handleSubmitPostseasonRotation(
  command: SeasonSubmitPostseasonRotationCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedCommand(command, postseasonInvalidStageRejection(run), run);
  }
  const next = seasonPostseasonNextGame(run.postseason);
  if (next.kind === 'integrity-failure') {
    return rejectedCommand(command, { code: 'integrity-failure', reason: next.reason }, run);
  }
  if (next.kind === 'complete') {
    return rejectedCommand(
      command,
      { code: 'integrity-failure', reason: 'the postseason is complete' },
      run,
    );
  }
  if (command.targetGameId !== next.gameId) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: next.gameId,
    };
    return rejectedCommand(command, rejection, run);
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (humanFranchiseId === null) {
    throw new SeasonRunCommandNotImplementedError(
      'submit-postseason-rotation requires a human franchise (the command layer supplies it)',
    );
  }
  if (!seasonPostseasonHumanPlaysGame(run.postseason, command.targetGameId, humanFranchiseId)) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: next.gameId,
    };
    return rejectedCommand(command, rejection, run);
  }
  const payload = command.rotation;
  if (payload.franchiseId !== humanFranchiseId) {
    const rejection: SeasonInvalidRotationRejection = {
      code: 'invalid-rotation',
      franchiseId: payload.franchiseId,
      reasons: [
        `rotation targets ${payload.franchiseId} but the human franchise is ${humanFranchiseId}`,
      ],
    };
    return rejectedCommand(command, rejection, run);
  }
  if (context.catalog === undefined) {
    throw new SeasonPostseasonContextError(
      'submit-postseason-rotation requires the draft catalog (context.catalog)',
    );
  }
  const humanRoster = run.rosters.find((roster) => roster.franchiseId === humanFranchiseId);
  const memberPlayable = new Map<string, readonly Position[]>();
  for (const player of humanRoster?.players ?? []) {
    const candidate = context.catalog.candidates.find(
      (entry) => entry.playerVersionId === player.playerVersionId,
    );
    memberPlayable.set(player.playerVersionId, candidate?.positions.playable ?? []);
  }
  const rotationFailures = validateSeasonRotation(payload.rotation, memberPlayable);
  if (rotationFailures.length > 0) {
    return rejectedCommand(
      command,
      { code: 'invalid-rotation', franchiseId: payload.franchiseId, reasons: rotationFailures },
      run,
    );
  }
  const rostered = new Set((humanRoster?.players ?? []).map((player) => player.playerVersionId));
  for (const playerVersionId of [
    ...payload.rotation.starters,
    ...payload.rotation.benchOrder,
    ...payload.rotation.closingFive,
  ]) {
    if (!rostered.has(playerVersionId)) {
      const rejection: SeasonUnavailablePlayerRejection = {
        code: 'unavailable-player',
        playerVersionId,
        reason: 'not-on-roster',
      };
      return rejectedCommand(command, rejection, run);
    }
  }
  for (const entry of payload.rotation.targetMinutes) {
    if (entry.minutes > 0 && !seasonPlayerAvailable(run.health, entry.playerVersionId)) {
      const rejection: SeasonUnavailablePlayerRejection = {
        code: 'unavailable-player',
        playerVersionId: entry.playerVersionId,
        reason: 'injured',
      };
      return rejectedCommand(command, rejection, run);
    }
  }
  {
    const availableMembers: SeasonRosterMemberInput[] = [];
    for (const player of humanRoster?.players ?? []) {
      const playable = memberPlayable.get(player.playerVersionId);
      if (playable === undefined || playable.length === 0) continue;
      if (seasonPlayerAvailable(run.health, player.playerVersionId)) {
        availableMembers.push({ playerVersionId: player.playerVersionId, playable });
      }
    }
    if (!legalFiveExists(availableMembers)) {
      return rejectedCommand(
        command,
        {
          code: 'invalid-rotation',
          franchiseId: payload.franchiseId,
          reasons: [
            `only ${String(availableMembers.length)} players available; the rotation cannot field a legal five`,
          ],
        },
        run,
      );
    }
  }
  let health = run.health;
  let influence = run.influence;
  let transactions = run.transactions;
  const rehabInjuryId = payload.riskyRehabInjuryId;
  if (rehabInjuryId !== undefined) {
    const injury = run.health.injuries.find((entry) => entry.injuryId === rehabInjuryId);
    const active =
      injury !== undefined &&
      injury.franchiseId === humanFranchiseId &&
      injury.sameGameReturned !== true &&
      injury.missedGamesRemaining > 0;
    if (injury === undefined || !active) {
      return rejectedCommand(
        command,
        {
          code: 'integrity-failure',
          reason: `risky-rehab injury ${rehabInjuryId} is not an active injury of ${humanFranchiseId}`,
        },
        run,
      );
    }
    if (run.influence.rehabs[rehabInjuryId] !== undefined) {
      return rejectedCommand(
        command,
        { code: 'integrity-failure', reason: `injury ${rehabInjuryId} was already rehabilitated` },
        run,
      );
    }
    const humanFidRehab = franchiseIdSchema.parse(humanFranchiseId);
    const balance = run.influence.balances[humanFidRehab] ?? 0;
    const postseasonRehabCost = rehabPriceOf(
      normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice
        ?.executiveId ?? null,
    );
    if (balance < SEASON_INFLUENCE_FLOOR + postseasonRehabCost) {
      const rejection: SeasonInsufficientRehabResourcesRejection = {
        code: 'insufficient-rehab-resources',
        franchiseId: humanFidRehab,
        balance,
        required: postseasonRehabCost,
      };
      return rejectedCommand(command, rejection, run);
    }
    const outcome = rollPostseasonRehabOutcome(run.rootSeed, rehabInjuryId);
    health = applyRiskyRehabOutcome(health, rehabInjuryId, outcome);
    const spend = applySeasonInfluenceSpend({
      influence,
      franchiseId: humanFranchiseId,
      source: 'risky-rehab',
      requestedDelta: -postseasonRehabCost,
      blockIndex: null,
      commandId: command.commandId,
      explanation: `Spent ${String(postseasonRehabCost)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
      injuryId: rehabInjuryId,
      rehabOutcome: outcome,
    });
    influence = spend.influence;
    transactions = [
      ...transactions,
      seasonTransactionEntry({
        transactionId: `txn-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: humanFranchiseId,
        type: 'influence-spend',
        blockIndex: null,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { purpose: 'risky-rehab', injuryId: rehabInjuryId, outcome },
        explanation: `Spent ${String(postseasonRehabCost)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
      }),
    ];
  }
  const rotations = run.rotations.map((rotation) =>
    rotation.franchiseId === humanFranchiseId ? payload.rotation : rotation,
  );
  const nextRun = advanceRunState({ ...run, rotations, health, influence, transactions });
  return acceptedCommand(
    command,
    {
      targetGameId: command.targetGameId,
      franchiseId: payload.franchiseId,
      rotationDigest: seasonRotationSetDigest([payload.rotation]),
    },
    nextRun,
    null,
  );
}
export function handleSpectatePostseasonGame(
  command: SeasonSpectatePostseasonGameCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedCommand(command, postseasonInvalidStageRejection(run), run);
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'spectate-postseason-game requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const decision = seasonPostseasonNextGame(run.postseason);
  if (decision.kind === 'integrity-failure') {
    return rejectedCommand(command, { code: 'integrity-failure', reason: decision.reason }, run);
  }
  if (decision.kind === 'complete') {
    return rejectedCommand(
      command,
      { code: 'integrity-failure', reason: 'the postseason is complete' },
      run,
    );
  }
  if (command.targetGameId !== decision.gameId) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: decision.gameId,
    };
    return rejectedCommand(command, rejection, run);
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(run.postseason, command.targetGameId, humanFranchiseId)
  ) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: decision.gameId,
    };
    return rejectedCommand(command, rejection, run);
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  const outcome = simulateSeasonPostseasonGame(
    {
      run,
      effects: run.effects,
      expanded,
      catalog: context.catalog,
      profile: context.profile,
      gameId: command.targetGameId,
      humanFranchiseId,
    },
    { resolver: context.postseasonGameResolver },
  );
  if (outcome.kind === 'integrity-failure') {
    return rejectedCommand(command, { code: 'integrity-failure', reason: outcome.reason }, run);
  }
  const current = {
    ...run,
    postseason: seasonPostseasonApplyGameResult(
      run.postseason,
      outcome.facts,
      run.league,
      run.standings,
    ),
    health: outcome.nextHealth,
    effects: outcome.nextEffects,
  };
  const stage = seasonPostseasonStageOf(current.postseason);
  const championFranchiseId = current.postseason.championFranchiseId;
  if (stage === 'completed' && championFranchiseId === null) {
    throw new Error(`postseason completed without champion for ${command.commandId}`);
  }
  const completion =
    stage === 'completed' && championFranchiseId !== null
      ? {
          championFranchiseId,
          almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
          finalizedAtStateRevision: run.stateRevision + 1,
        }
      : null;
  const withAwards = deriveAwardsIfNeeded(current, context, stage);
  const nextRun = advanceRunState({ ...withAwards, stage, completion });
  const after = seasonPostseasonNextGame(nextRun.postseason);
  const nextGameIdAfter = after.kind === 'game' ? after.gameId : null;
  const humanNext =
    nextGameIdAfter !== null &&
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(nextRun.postseason, nextGameIdAfter, humanFranchiseId);
  return acceptedCommand(
    command,
    {
      stage,
      advancedGameIds: [command.targetGameId],
      nextDecision: humanNext ? 'rotation' : 'none',
      nextGameId: humanNext ? nextGameIdAfter : null,
      aiNextGameId: humanNext ? null : nextGameIdAfter,
    },
    nextRun,
    null,
    [outcome.summary],
  );
}
export function handleFastForwardPostseason(
  command: SeasonFastForwardPostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedCommand(command, postseasonInvalidStageRejection(run), run);
  }
  if (command.targetGameId !== undefined) {
    const upcoming = seasonPostseasonUpcomingGames(run.postseason);
    if (!upcoming.includes(command.targetGameId)) {
      return rejectedCommand(
        command,
        {
          code: 'integrity-failure',
          reason: `fast-forward target ${command.targetGameId} is not an upcoming postseason game`,
        },
        run,
      );
    }
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (
    humanFranchiseId !== null &&
    !seasonPostseasonHumanEliminated(run.postseason, humanFranchiseId)
  ) {
    return rejectedCommand(
      command,
      {
        code: 'integrity-failure',
        reason: `the human franchise ${humanFranchiseId} still has postseason decisions; fast-forward requires elimination`,
      },
      run,
    );
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'fast-forward-postseason requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  let current = run;
  const summaries: SeasonPostseasonSummary[] = [];
  let integrityReason: string | null = null;
  for (;;) {
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind === 'integrity-failure') {
      integrityReason = decision.reason;
      break;
    }
    if (decision.kind === 'complete') break;
    const outcome = simulateSeasonPostseasonGame(
      {
        run: current,
        effects: current.effects,
        expanded,
        catalog: context.catalog,
        profile: context.profile,
        gameId: decision.gameId,
        humanFranchiseId,
      },
      { resolver: context.postseasonGameResolver },
    );
    if (outcome.kind === 'integrity-failure') {
      integrityReason = outcome.reason;
      break;
    }
    current = {
      ...current,
      postseason: seasonPostseasonApplyGameResult(
        current.postseason,
        outcome.facts,
        current.league,
        current.standings,
      ),
      health: outcome.nextHealth,
      effects: outcome.nextEffects,
    };
    summaries.push(outcome.summary);
  }
  if (integrityReason !== null) {
    return rejectedCommand(command, { code: 'integrity-failure', reason: integrityReason }, run);
  }
  const championFranchiseId = current.postseason.championFranchiseId;
  if (championFranchiseId === null) {
    return rejectedCommand(
      command,
      { code: 'integrity-failure', reason: 'the tournament finished without a champion' },
      run,
    );
  }
  const completion = {
    championFranchiseId,
    almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
    finalizedAtStateRevision: run.stateRevision + 1,
  };
  const withAwards = deriveAwardsIfNeeded(current, context, 'completed');
  const nextRun = advanceRunState({ ...withAwards, stage: 'completed', completion });
  return acceptedCommand(
    command,
    {
      stage: 'completed',
      championFranchiseId,
    },
    nextRun,
    null,
    summaries,
  );
}
