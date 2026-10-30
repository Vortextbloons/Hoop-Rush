import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  createCapRushDraftState,
  applyCapRushCommand,
  capRushOfferLegalCardIds,
  simulateCapRushGame,
  createEngineContext,
  ENGINE_VERSION,
  capRushUserLeagueGameOf,
  simulateCapRushLeagueSlot,
  capRushLeagueFieldOfLocked,
  buildCapRushConferenceStandings,
  type CapRushStandingsGame,
} from '@hoop-rush/engine';
import {
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  CAP_RUSH_SPIN_PURCHASES,
  POSITIONS,
  seedSchema,
  seedFromString,
  opponentBracketSchema,
  commandIdSchema,
  idSchema,
  type CapRushCommand,
} from '@hoop-rush/data-contracts';
import { loadPackagedData, PackagedData } from './commands/data-loader.ts';
const { manifest, dir } = loadPackagedData();
const data = new PackagedData(manifest, dir);
const catalog = data.draftCatalog();
const profile = data.eraProfile('2010s');
const entry = manifest.capRushBracket;
if (!entry || !manifest.draftCatalog) throw new Error('missing artifacts');
const bracket = opponentBracketSchema.parse(
  JSON.parse(readFileSync(resolve(dir, entry.url), 'utf8')),
);
const source = {
  catalogVersion: catalog.catalogVersion,
  catalogHash: manifest.draftCatalog.contentHash,
  dataVersion: catalog.dataVersion,
  ratingsVersion: catalog.ratingsVersion,
  playerVersionIdVersion: catalog.playerVersionIdVersion,
  positionNormalizationVersion: catalog.positionNormalizationVersion,
};
const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
const lockSources = { bracket, profile };
const profileEntry = manifest.eraSimulationProfiles.find((e) => e.eraId === profile.eraId);
if (profileEntry === undefined) throw new Error('missing profile');
const versionSet = {
  schemaVersion: CAP_RUSH_SCHEMA_VERSION,
  rulesVersion: CAP_RUSH_RULES_VERSION,
  salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
  seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
  engineVersion: ENGINE_VERSION,
  profileVersion: profile.profileVersion,
  dataVersion: catalog.dataVersion,
  catalogVersion: catalog.catalogVersion,
  catalogHash: source.catalogHash,
  bracketHash: entry.contentHash,
  profileHash: profileEntry.contentHash,
} as const;
const context = createEngineContext();
const runs = [];
const fullLeague = process.argv[2] === '--league';
for (const variant of ['clash', 'roulette'] as const)
  for (const strategy of ['strong', 'middle', 'budget', 'first-apron'] as const)
    for (let attempt = 0; attempt < (fullLeague ? 2 : 10); attempt++) {
      const runSeed = seedSchema.parse(
        seedFromString(`cap-rush-legal-probe-v1:${variant}:${strategy}:${String(attempt)}`),
      );
      let state = createCapRushDraftState(
        {
          command: 'create-cap-rush-draft',
          commandId: commandIdSchema.parse('probe-create'),
          runId: idSchema.parse('probe-run'),
          runSeed,
          variant,
          versionSet,
          catalog: source,
        },
        index,
        lockSources,
      );
      function apply(command: CapRushCommand) {
        const applied = applyCapRushCommand(state, command, { index, lockSources });
        if (applied.result.status !== 'accepted') throw new Error(JSON.stringify(applied.result));
        state = applied.state;
      }
      function base() {
        return {
          commandId: commandIdSchema.parse(`probe-${String(state.revision)}`),
          runId: state.runId,
          expectedRevision: state.revision,
        };
      }
      for (const slot of POSITIONS) {
        apply({ ...base(), command: 'choose-cap-rush-position', slot });
        const offer = state.offer;
        if (!offer) throw new Error('missing offer');
        const legal = new Set(capRushOfferLegalCardIds(state, index, offer.cards));
        const cards = offer.cards
          .filter((c) => legal.has(c.cardId))
          .sort(
            (a, b) =>
              a.source.originalOverall - b.source.originalOverall ||
              a.cardId.localeCompare(b.cardId),
          );
        if (strategy === 'first-apron') {
          const spent = state.picks.reduce((sum, pick) => sum + pick.card.salaryDollars, 0);
          const target = (130_000_000 - spent) / (5 - state.picks.length);
          cards.sort(
            (a, b) =>
              Math.abs(a.salaryDollars - target) - Math.abs(b.salaryDollars - target) ||
              a.cardId.localeCompare(b.cardId),
          );
        }
        const card =
          cards[
            strategy === 'strong'
              ? cards.length - 1
              : strategy === 'budget' || strategy === 'first-apron'
                ? 0
                : Math.floor(cards.length / 2)
          ];
        if (!card) throw new Error('no legal card');
        apply({
          ...base(),
          command: 'sign-cap-rush-card',
          offerId: offer.offerId,
          cardId: card.cardId,
        });
      }
      if (state.spin.status === 'pending') {
        const payroll = state.picks.reduce((sum, p) => sum + p.card.salaryDollars, 0);
        const target = state.picks
          .slice()
          .sort((a, b) => b.card.source.originalOverall - a.card.source.originalOverall)[0];
        if (target === undefined) throw new Error('missing spin target');
        if (payroll <= CAP_RUSH_SPIN_PURCHASES.standard.maxEligiblePayrollDollars)
          apply({
            ...base(),
            command: 'purchase-cap-rush-spin',
            purchase: 'standard',
            targetCardId: target.card.cardId,
          });
        else apply({ ...base(), command: 'skip-cap-rush-spin' });
      }
      apply({
        ...base(),
        command: 'lock-cap-rush-lineup',
        picks: state.picks.map((p) => ({ slot: p.slot, cardId: p.card.cardId })),
      });
      const locked = state.locked;
      if (!locked) throw new Error('missing lock');
      let wins = 0,
        margin = 0;
      const leagueGames: CapRushStandingsGame[] = [];
      for (let gameNumber = 1; gameNumber <= 82; gameNumber++) {
        const game = simulateCapRushGame({ locked, gameNumber, context });
        if (!game.audit.ok) throw new Error('audit failure');
        wins += Number(game.summary.won);
        margin += game.summary.humanPoints - game.summary.opponentPoints;
        if (fullLeague) {
          const scheduled = capRushUserLeagueGameOf(locked, gameNumber);
          leagueGames.push({
            gameId: scheduled.gameId,
            homeTeamId: scheduled.homeTeamId,
            awayTeamId: scheduled.awayTeamId,
            homePoints: game.summary.humanHome
              ? game.summary.humanPoints
              : game.summary.opponentPoints,
            awayPoints: game.summary.humanHome
              ? game.summary.opponentPoints
              : game.summary.humanPoints,
          });
          leagueGames.push(...simulateCapRushLeagueSlot({ locked, slot: gameNumber, context }));
        }
      }
      const standings = fullLeague
        ? buildCapRushConferenceStandings({
            teams: capRushLeagueFieldOfLocked(locked),
            games: leagueGames,
          })
        : null;
      const standing =
        standings === null
          ? null
          : [...standings.east.entries, ...standings.west.entries].find(
              (e) => e.teamId === locked.human.teamId,
            );
      runs.push({
        qualified: standing?.qualified ?? null,
        conferenceSeed: standing?.seed ?? null,
        variant,
        strategy,
        attempt,
        runSeed,
        franchise: state.franchise,
        payroll: locked.payrollDollars,
        tier: locked.payrollStatus,
        spin: locked.spin,
        lineup: state.picks.map((p) => ({
          slot: p.slot,
          player: p.card.source.displayName,
          version: p.card.source.playerVersionId,
          overall: p.card.source.originalOverall,
          salary: p.card.salaryDollars,
        })),
        wins,
        losses: 82 - wins,
        pointDifferential: margin,
        undefeated: wins === 82,
      });
      console.log(`${variant} ${strategy} ${String(attempt)}: ${String(wins)}`);
    }
writeFileSync(
  fullLeague
    ? 'tools/cli/benchmarks/cap-rush/legal-league-v1.json'
    : 'tools/cli/benchmarks/cap-rush/legal-v1.json',
  JSON.stringify(
    {
      protocol: 'legal-offer-policy-v1',
      fullLeague,
      attemptsPerPolicy: fullLeague ? 2 : 10,
      fieldHash: entry.contentHash,
      versionSet,
      selection:
        'PG/SG/SF/PF/C offers with no rerolls. Strong=highest legal overall; middle=median legal overall; budget=lowest legal overall; first-apron=closest legal salary to remaining 130M target per slot. Roulette buys the standard spin when eligible targeting highest overall. Production typed draft and lock commands. Independent named drafts per policy and variant. --league runs first two seeds per policy including full background league and qualification. Default runs ten user seasons; qualification not measured. No postseason simulated; championship not measured.',
      runs,
    },
    null,
    2,
  ) + '\n',
);
