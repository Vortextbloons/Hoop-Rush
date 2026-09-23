import {
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  COLLECTION_TEAM_VERSION,
  collectionActiveTeamSchema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCpuConstructionFacts,
  type CollectionCpuRarityWeights,
  type CollectionCpuScoreParts,
  type CollectionDifficultyProfile,
  type CollectionRarity,
  type CollectionRarityCounts,
  type PositionUnion,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot } from '../domain/lineup.ts';
import { evaluateLineupBalance } from '../challenge/lineup-eval.ts';
import { createRng, type Rng } from '../sim/rng.ts';
import { allocateDefaultMinutes, COMPLETION_PROBE_SCAN_CAP } from './active-team.ts';
import { resolveCollectionCard, toCollectionSimulationPlayer } from './cards.ts';
import { CollectionCommandError } from './packs.ts';
import {
  collectionCpuCandidateSeed,
  collectionCpuIdentitySeed,
  collectionCpuTeamSeed,
  collectionGameSeedPaths,
} from './seeds.ts';

const STARTER_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4];
const BENCH_COUNT = COLLECTION_GAME_CPU_ROSTER_SIZE - STARTER_SLOTS.length;

function overallOf(card: CollectionCatalogCard): number {
  return card.summarySource?.overallRating ?? 60;
}

export function cpuPerCardWeights(
  catalog: CollectionCatalog,
  weights: CollectionCpuRarityWeights,
): Map<string, number> {
  const counts = new Map<CollectionRarity, number>();
  for (const card of catalog.cards) {
    counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
  }
  const perCard = new Map<string, number>();
  for (const card of catalog.cards) {
    const weight = weights[card.rarity];
    const count = counts.get(card.rarity) ?? 0;
    if (!(weight > 0) || count === 0) {
      throw new CollectionCommandError(
        'invalid-definition',
        `cpu weights miss a positive entry for ${card.rarity}`,
      );
    }
    perCard.set(card.cardId, weight / count);
  }
  return perCard;
}

function slotMaskOf(positions: PositionUnion): number {
  let mask = 0;
  for (const slot of STARTER_SLOTS) {
    if (canFillSlot(positions, slot)) mask |= 1 << slot;
  }
  return mask;
}

function maskedFeasible(
  remainingSlots: SlotIndex[],
  masks: ReadonlyArray<{ playerId: string; mask: number }>,
  usedPlayers: ReadonlySet<string>,
): boolean {
  function search(index: number, taken: Set<string>): boolean {
    if (index === remainingSlots.length) return true;
    const slot = remainingSlots[index];
    if (slot === undefined) return false;
    const bit = 1 << slot;
    let scanned = 0;
    for (const candidate of masks) {
      if (taken.has(candidate.playerId)) continue;
      if (scanned >= COMPLETION_PROBE_SCAN_CAP) break;
      scanned += 1;
      if ((candidate.mask & bit) === 0) continue;
      taken.add(candidate.playerId);
      if (search(index + 1, taken)) return true;
      taken.delete(candidate.playerId);
    }
    return false;
  }
  return search(0, new Set(usedPlayers));
}

export interface CpuTeamResult {
  team: CollectionActiveTeam;
  assignment: Array<{ slotIndex: SlotIndex; playerId: string }>;
  seedPath: string[];
}

export function generateCollectionCpuTeam(
  catalog: CollectionCatalog,
  rootSeed: string,
  gameSequence: number,
  weights: CollectionCpuRarityWeights,
): CpuTeamResult {
  const availableCards = catalog.cards;
  const uniquePlayers = new Set(availableCards.map((card) => card.playerId));
  if (uniquePlayers.size < COLLECTION_GAME_CPU_ROSTER_SIZE) {
    throw new CollectionCommandError(
      'missing-content',
      `cpu needs ${String(COLLECTION_GAME_CPU_ROSTER_SIZE)} unique players, catalog has ${String(uniquePlayers.size)}`,
    );
  }
  const perCard = cpuPerCardWeights(catalog, weights);
  const rng = createRng(collectionCpuTeamSeed(rootSeed, gameSequence));
  const pool = availableCards.map((card) => ({
    playerId: card.playerId,
    positions: card.positions,
    mask: slotMaskOf(card.positions),
    overall: overallOf(card),
    card,
    weight: perCard.get(card.cardId) ?? 0,
  }));
  const masked = pool.map((candidate) => ({ playerId: candidate.playerId, mask: candidate.mask }));
  const chosen: CollectionCatalogCard[] = [];
  const usedPlayers = new Set<string>();
  for (const [slotPosition, slot] of STARTER_SLOTS.entries()) {
    const bit = 1 << slot;
    const candidates = pool.filter((candidate) => {
      if (usedPlayers.has(candidate.playerId)) return false;
      if ((candidate.mask & bit) === 0) return false;
      const probeUsed = new Set(usedPlayers);
      probeUsed.add(candidate.playerId);
      return maskedFeasible(STARTER_SLOTS.slice(slotPosition + 1), masked, probeUsed);
    });
    if (candidates.length === 0) {
      throw new CollectionCommandError(
        'no-legal-five',
        `no completion-safe cpu candidate fills slot ${String(slot)}`,
      );
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  for (let bench = 0; bench < BENCH_COUNT; bench += 1) {
    const candidates = pool.filter((candidate) => !usedPlayers.has(candidate.playerId));
    if (candidates.length === 0) {
      throw new CollectionCommandError('missing-content', 'cpu bench ran out of unique players');
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  const assignment = assignLineup(
    chosen
      .slice(0, STARTER_SLOTS.length)
      .map((card) => ({ playerId: card.playerId, positions: card.positions })),
  );
  if (assignment === null) {
    throw new CollectionCommandError('no-legal-five', 'cpu starters cannot fill G/G/F/F/C');
  }
  const starters = chosen.slice(0, STARTER_SLOTS.length);
  const bench = chosen.slice(STARTER_SLOTS.length);
  const starterIds = new Set(starters.map((card) => card.cardId));
  const team = collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters: starters.map((card) => card.cardId),
    bench: bench.map((card) => card.cardId),
    targetMinutes: allocateDefaultMinutes(
      chosen.map((card) => ({ cardId: card.cardId, starter: starterIds.has(card.cardId) })),
    ),
  });
  return {
    team,
    assignment: assignment.map((entry) => ({
      slotIndex: entry.slotIndex,
      playerId: entry.playerId,
    })),
    seedPath: collectionGameSeedPaths(gameSequence).cpuTeam,
  };
}

const IDENTITIES = ['balanced', 'shooting', 'pressure-defense', 'interior'] as const;

function specialOf(card: CollectionCatalogCard): boolean {
  return card.family !== 'Base';
}

function compareCanonicalIds(a: readonly string[], b: readonly string[]): number {
  const left = [...a].sort();
  const right = [...b].sort();
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined || r === undefined) break;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return left.length - right.length;
}

function roundMillionths(value: number): number {
  return Math.round(value * 1_000_000);
}

function meanMillionths(total: number, count: number): number {
  return Math.round((total * 1_000_000) / count);
}

function lineupBalanceOf(cards: readonly CollectionCatalogCard[]) {
  const players = cards.map((card) => {
    const resolved = resolveCollectionCard(card, card);
    const sim = toCollectionSimulationPlayer(resolved, card);
    return {
      playerId: card.playerId,
      playerVersionId: card.cardId,
      displayName: sim.displayName,
      positions: sim.positions,
      heightInches: sim.heightInches,
      weightLbs: sim.weightLbs,
      ratings: sim.ratings,
      tendencies: sim.tendencies,
      overall: overallOf(card),
    };
  });
  return evaluateLineupBalance({
    teamId: 'collection-cpu-scoring',
    displayName: 'CPU Scoring',
    players,
  });
}

function identityFitOf(
  identity: (typeof IDENTITIES)[number],
  balance: ReturnType<typeof lineupBalanceOf>,
  balanceMean: number,
): number {
  switch (identity) {
    case 'balanced':
      return balanceMean;
    case 'shooting':
      return balance.shooting;
    case 'pressure-defense':
      return balance.defense;
    case 'interior':
      return (balance.interiorPresence + balance.rebounding + balance.defense) / 3;
  }
}

interface FiveCandidate {
  cardIds: string[];
  meanOverallMillionths: number;
  fiveCoreMillionths: number;
  identityFitMillionths: number;
  lineupScoreMillionths: number;
}

function scoreLegalFives(
  roster: readonly CollectionCatalogCard[],
  identity: (typeof IDENTITIES)[number],
  identityFitWeightBp: number,
): FiveCandidate[] {
  const scores: FiveCandidate[] = [];
  const count = roster.length;
  for (let a = 0; a < count - 4; a += 1) {
    for (let b = a + 1; b < count - 3; b += 1) {
      for (let c = b + 1; c < count - 2; c += 1) {
        for (let d = c + 1; d < count - 1; d += 1) {
          for (let e = d + 1; e < count; e += 1) {
            const five = [roster[a], roster[b], roster[c], roster[d], roster[e]].filter(
              (card): card is CollectionCatalogCard => card !== undefined,
            );
            if (five.length !== 5) continue;
            const assignment = assignLineup(
              five.map((card) => ({ playerId: card.playerId, positions: card.positions })),
            );
            if (assignment === null) continue;
            const ordered = assignment
              .slice()
              .sort((left, right) => left.slotIndex - right.slotIndex)
              .map((entry) => {
                const card = five.find((candidate) => candidate.playerId === entry.playerId);
                if (card === undefined) throw new Error('cpu scoring: assignment player missing');
                return card;
              });
            const balance = lineupBalanceOf(ordered);
            const meanOverallMillionths = meanMillionths(
              ordered.reduce((sum, card) => sum + overallOf(card), 0),
              5,
            );
            const balanceMean =
              (balance.creation +
                balance.shooting +
                balance.interiorPresence +
                balance.rebounding +
                balance.defense) /
              5;
            const balanceFloor = Math.min(
              balance.creation,
              balance.shooting,
              balance.interiorPresence,
              balance.rebounding,
              balance.defense,
            );
            const fiveCoreMillionths = Math.round(
              (55 * meanOverallMillionths +
                25 * roundMillionths(balanceMean) +
                20 * roundMillionths(balanceFloor)) /
                100,
            );
            const identityFitMillionths = roundMillionths(
              identityFitOf(identity, balance, balanceMean),
            );
            const lineupScoreMillionths = Math.round(
              (fiveCoreMillionths * (10_000 - identityFitWeightBp) +
                identityFitMillionths * identityFitWeightBp) /
                10_000,
            );
            scores.push({
              cardIds: ordered.map((card) => card.cardId),
              meanOverallMillionths,
              fiveCoreMillionths,
              identityFitMillionths,
              lineupScoreMillionths,
            });
          }
        }
      }
    }
  }
  return scores;
}

function rosterWeightBp(
  profile: CollectionDifficultyProfile,
  card: CollectionCatalogCard,
  counts: ReadonlyMap<string, { base: number; special: number }>,
): number {
  const rarityWeight =
    profile.rarityWeightsBp.find((entry) => entry.rarity === card.rarity)?.weightBp ?? 0;
  if (rarityWeight <= 0) return 0;
  const rarityCounts = counts.get(card.rarity) ?? { base: 0, special: 0 };
  const multiplierBp = profile.specialWeightMultiplierBp;
  const total = rarityCounts.base * 10_000 + rarityCounts.special * multiplierBp;
  if (total <= 0) return 0;
  const factor = specialOf(card) ? multiplierBp : 10_000;
  return Math.floor((rarityWeight * factor * 1_000_000) / total);
}

interface CandidatePoolEntry {
  playerId: string;
  positions: PositionUnion;
  mask: number;
  weight: number;
  card: CollectionCatalogCard;
}

function generateCandidateRoster(pool: CandidatePoolEntry[], rng: Rng): CollectionCatalogCard[] {
  const masked = pool.map((candidate) => ({ playerId: candidate.playerId, mask: candidate.mask }));
  const chosen: CollectionCatalogCard[] = [];
  const usedPlayers = new Set<string>();
  for (const [slotPosition, slot] of STARTER_SLOTS.entries()) {
    const bit = 1 << slot;
    const candidates = pool.filter((candidate) => {
      if (usedPlayers.has(candidate.playerId)) return false;
      if ((candidate.mask & bit) === 0) return false;
      const probeUsed = new Set(usedPlayers);
      probeUsed.add(candidate.playerId);
      return maskedFeasible(STARTER_SLOTS.slice(slotPosition + 1), masked, probeUsed);
    });
    if (candidates.length === 0) {
      throw new CollectionCommandError(
        'no-legal-five',
        `no completion-safe cpu candidate fills slot ${String(slot)}`,
      );
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  for (let benchIndex = 0; benchIndex < BENCH_COUNT; benchIndex += 1) {
    const candidates = pool.filter((candidate) => !usedPlayers.has(candidate.playerId));
    if (candidates.length === 0) {
      throw new CollectionCommandError('missing-content', 'cpu bench ran out of unique players');
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  return chosen;
}

function apportionMinutes(
  weights: readonly number[],
  caps: readonly number[],
  total: number,
): number[] {
  const minutes = weights.map(() => 0);
  let remaining = total;
  for (let guard = 0; guard < 512 && remaining > 0; guard += 1) {
    const active = weights
      .map((weight, index) => ({ weight, index }))
      .filter((entry) => (minutes[entry.index] ?? 0) < (caps[entry.index] ?? 0));
    if (active.length === 0) break;
    const sumWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
    if (sumWeight <= 0) {
      throw new CollectionCommandError('invalid-minutes', 'cpu rotation weights sum to zero');
    }
    const shares = active.map((entry) => {
      const numerator = remaining * entry.weight;
      return {
        index: entry.index,
        base: Math.floor(numerator / sumWeight),
        fraction: numerator % sumWeight,
      };
    });
    for (const share of shares) {
      minutes[share.index] = (minutes[share.index] ?? 0) + share.base;
    }
    let nextRemaining = remaining - shares.reduce((sum, share) => sum + share.base, 0);
    const order = shares
      .slice()
      .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (const share of order) {
      if (nextRemaining <= 0) break;
      if ((minutes[share.index] ?? 0) >= (caps[share.index] ?? 0)) continue;
      minutes[share.index] = (minutes[share.index] ?? 0) + 1;
      nextRemaining -= 1;
    }
    if (nextRemaining >= remaining) {
      throw new CollectionCommandError('invalid-minutes', 'cpu rotation apportionment stalled');
    }
    remaining = nextRemaining;
  }
  if (remaining !== 0) {
    throw new CollectionCommandError('invalid-minutes', 'cpu rotation minutes do not reach 240');
  }
  return minutes;
}

function meritMinutes(
  roster: ReadonlyArray<{ cardId: string; starter: boolean; overall: number }>,
  profile: CollectionDifficultyProfile,
): Array<{ cardId: string; minutes: number }> {
  const weights = roster.map((entry) => {
    const base = entry.starter ? profile.rotation.starterWeightBp : profile.rotation.benchWeightBp;
    const bonus =
      Math.max(0, entry.overall - profile.rotation.overallBonusFloor) *
      profile.rotation.overallBonusPerPointBp;
    return base + bonus;
  });
  const caps = roster.map(() => profile.rotation.maxMinutes);
  const minutes = apportionMinutes(weights, caps, 240);
  for (let index = 0; index < roster.length; index += 1) {
    if (roster[index]?.starter === true && (minutes[index] ?? 0) < 1) {
      throw new CollectionCommandError(
        'invalid-minutes',
        `cpu merit rotation starves starter ${String(roster[index]?.cardId)}`,
      );
    }
  }
  return roster.map((entry, index) => ({ cardId: entry.cardId, minutes: minutes[index] ?? 0 }));
}

export interface CpuDifficultyTeamResult {
  team: CollectionActiveTeam;
  assignment: Array<{ slotIndex: SlotIndex; playerId: string }>;
  construction: CollectionCpuConstructionFacts;
}

export function generateCollectionCpuTeamV2(
  catalog: CollectionCatalog,
  rootSeed: string,
  gameSequence: number,
  profile: CollectionDifficultyProfile,
): CpuDifficultyTeamResult {
  const availableCards = catalog.cards;
  const uniquePlayers = new Set(availableCards.map((card) => card.playerId));
  if (uniquePlayers.size < COLLECTION_GAME_CPU_ROSTER_SIZE) {
    throw new CollectionCommandError(
      'missing-content',
      `cpu needs ${String(COLLECTION_GAME_CPU_ROSTER_SIZE)} unique players, catalog has ${String(uniquePlayers.size)}`,
    );
  }
  const declarations = availableCards
    .map((card) => ({
      playerId: card.playerId,
      positions: card.positions,
      mask: slotMaskOf(card.positions),
      card,
      special: specialOf(card),
      rarityWeight:
        profile.rarityWeightsBp.find((entry) => entry.rarity === card.rarity)?.weightBp ?? 0,
    }))
    .filter((entry) => entry.rarityWeight > 0);
  const bandCounts = new Map<string, { base: number; special: number }>();
  for (const entry of declarations) {
    const counts = bandCounts.get(entry.card.rarity) ?? { base: 0, special: 0 };
    if (entry.special) counts.special += 1;
    else counts.base += 1;
    bandCounts.set(entry.card.rarity, counts);
  }
  const pool = declarations
    .map((entry) => ({
      playerId: entry.playerId,
      positions: entry.positions,
      mask: entry.mask,
      weight: rosterWeightBp(profile, entry.card, bandCounts),
      card: entry.card,
    }))
    .filter((entry) => entry.weight > 0);
  const playablePlayers = new Set(pool.map((entry) => entry.playerId));
  if (playablePlayers.size < COLLECTION_GAME_CPU_ROSTER_SIZE) {
    throw new CollectionCommandError(
      'missing-content',
      `difficulty band leaves ${String(playablePlayers.size)} unique players, need ${String(COLLECTION_GAME_CPU_ROSTER_SIZE)}`,
    );
  }
  const identityRng = createRng(
    collectionCpuIdentitySeed(rootSeed, profile.difficultyId, gameSequence),
  );
  const identity = identityRng.pick([...IDENTITIES]);

  interface ScoredCandidate {
    index: number;
    roster: CollectionCatalogCard[];
    rosterKey: string[];
    chosenFive: CollectionCatalogCard[];
    score: CollectionCpuScoreParts;
  }

  const candidates: ScoredCandidate[] = [];
  for (let index = 0; index < profile.candidateTeams; index += 1) {
    const rng = createRng(
      collectionCpuCandidateSeed(rootSeed, profile.difficultyId, gameSequence, index),
    );
    const roster = generateCandidateRoster(pool, rng);
    const generatedFive = roster.slice(0, STARTER_SLOTS.length);
    const fiveScores = scoreLegalFives(roster, identity, profile.identityFitWeightBp);
    if (fiveScores.length === 0) {
      throw new CollectionCommandError('no-legal-five', 'cpu candidate has no legal five');
    }
    const best = fiveScores.reduce((bestSoFar, candidate) => {
      if (candidate.lineupScoreMillionths > bestSoFar.lineupScoreMillionths) return candidate;
      if (candidate.lineupScoreMillionths < bestSoFar.lineupScoreMillionths) return bestSoFar;
      return compareCanonicalIds(candidate.cardIds, bestSoFar.cardIds) < 0 ? candidate : bestSoFar;
    });
    const generatedScore = fiveScores.find(
      (candidate) =>
        compareCanonicalIds(
          candidate.cardIds,
          generatedFive.map((card) => card.cardId),
        ) === 0,
    );
    const profileUsesGenerated = profile.useGeneratedStarters;
    const chosenScore = profileUsesGenerated ? (generatedScore ?? best) : best;
    const chosenCardIds = new Set(chosenScore.cardIds);
    const chosenFive = roster
      .filter((card) => chosenCardIds.has(card.cardId))
      .sort((left, right) => {
        const leftIndex = chosenScore.cardIds.indexOf(left.cardId);
        const rightIndex = chosenScore.cardIds.indexOf(right.cardId);
        return leftIndex - rightIndex;
      });
    const topEight = [...roster]
      .sort(
        (left, right) =>
          overallOf(right) - overallOf(left) || (left.cardId < right.cardId ? -1 : 1),
      )
      .slice(0, 8);
    const topEightOverallMillionths = meanMillionths(
      topEight.reduce((sum, card) => sum + overallOf(card), 0),
      topEight.length,
    );
    const rosterScoreMillionths = Math.round(
      (chosenScore.lineupScoreMillionths * 8000 + topEightOverallMillionths * 2000) / 10_000,
    );
    candidates.push({
      index,
      roster,
      rosterKey: roster.map((card) => card.cardId),
      chosenFive,
      score: {
        meanOverallMillionths: chosenScore.meanOverallMillionths,
        fiveCoreMillionths: chosenScore.fiveCoreMillionths,
        identityFitMillionths: chosenScore.identityFitMillionths,
        lineupScoreMillionths: chosenScore.lineupScoreMillionths,
        topEightOverallMillionths,
        rosterScoreMillionths,
      },
    });
  }

  let chosen: ScoredCandidate;
  if (profile.useGeneratedStarters) {
    chosen = candidates[0] as ScoredCandidate;
  } else {
    chosen = candidates.reduce((bestSoFar, candidate) => {
      if (candidate.score.rosterScoreMillionths > bestSoFar.score.rosterScoreMillionths) {
        return candidate;
      }
      if (candidate.score.rosterScoreMillionths < bestSoFar.score.rosterScoreMillionths) {
        return bestSoFar;
      }
      return compareCanonicalIds(candidate.rosterKey, bestSoFar.rosterKey) < 0
        ? candidate
        : bestSoFar;
    });
  }
  const starters = chosen.chosenFive;
  const starterIds = new Set(starters.map((card) => card.cardId));
  const bench = chosen.roster
    .filter((card) => !starterIds.has(card.cardId))
    .sort((left, right) => (left.cardId < right.cardId ? -1 : 1));
  const assignment = assignLineup(
    starters.map((card) => ({ playerId: card.playerId, positions: card.positions })),
  );
  if (assignment === null) {
    throw new CollectionCommandError('no-legal-five', 'cpu chosen starters cannot fill G/G/F/F/C');
  }
  const rosterEntries = [...starters, ...bench].map((card) => ({
    cardId: card.cardId,
    starter: starterIds.has(card.cardId),
    overall: overallOf(card),
  }));
  const targetMinutes = profile.useGeneratedStarters
    ? allocateDefaultMinutes(rosterEntries.map(({ cardId, starter }) => ({ cardId, starter })))
    : meritMinutes(rosterEntries, profile);
  const team = collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters: starters.map((card) => card.cardId),
    bench: bench.map((card) => card.cardId),
    targetMinutes,
  });
  const rarityCounts: CollectionRarityCounts = {
    Ember: 0,
    Eruption: 0,
    Apex: 0,
    Titan: 0,
    Eclipse: 0,
    Immortal: 0,
  };
  for (const card of chosen.roster) {
    rarityCounts[card.rarity] += 1;
  }
  const construction: CollectionCpuConstructionFacts = {
    difficultyVersion: profile.difficultyVersion,
    identity,
    candidateCount: candidates.length,
    chosenCandidateIndex: chosen.index,
    candidates: candidates.map((candidate) => ({
      candidateIndex: candidate.index,
      score: candidate.score,
    })),
    rarityCounts,
    specialCount: chosen.roster.filter((card) => specialOf(card)).length,
    starters: team.starters,
    bench: team.bench,
    targetMinutes: team.targetMinutes,
    closingFive: team.starters,
  };
  return {
    team,
    assignment: assignment.map((entry) => ({
      slotIndex: entry.slotIndex,
      playerId: entry.playerId,
    })),
    construction,
  };
}
