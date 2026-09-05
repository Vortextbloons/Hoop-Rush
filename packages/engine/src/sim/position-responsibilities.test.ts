import { describe, expect, it } from 'vitest';
import { buildEraSimulationProfile, buildLegalSimulationTeam } from '@hoop-rush/test-fixtures';
import { ENGINE_CONSTANTS } from './constants.ts';
import {
  boundResponsibilityModifiers,
  responsibilityModifiersForSlot,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';
import { prepareTeam } from './prepare.ts';
const profile = buildEraSimulationProfile();
describe('assigned-position responsibility modifiers', () => {
  it('has the expected slot directionality', () => {
    const g = ENGINE_CONSTANTS.positionResponsibility.G;
    const f = ENGINE_CONSTANTS.positionResponsibility.F;
    const c = ENGINE_CONSTANTS.positionResponsibility.C;
    expect(g.initiation).toBeGreaterThan(f.initiation);
    expect(f.initiation).toBeGreaterThan(c.initiation);
    expect(g.pnrHandler).toBeGreaterThan(f.pnrHandler);
    expect(f.pnrHandler).toBeGreaterThan(c.pnrHandler);
    expect(c.rollMan).toBeGreaterThan(f.rollMan);
    expect(f.rollMan).toBeGreaterThan(g.rollMan);
    expect(c.postUp).toBeGreaterThan(f.postUp);
    expect(f.postUp).toBeGreaterThan(g.postUp);
    expect(c.rebounding).toBeGreaterThan(f.rebounding);
    expect(f.rebounding).toBeGreaterThan(g.rebounding);
    expect(c.rimProtection).toBeGreaterThan(f.rimProtection);
    expect(f.rimProtection).toBeGreaterThan(g.rimProtection);
  });
  it('clamps out-of-band coefficients to the bounded range', () => {
    const wild: PositionResponsibilityModifiers = {
      initiation: 2,
      pnrHandler: -1,
      rollMan: 0.5,
      postUp: 1,
      rebounding: 1,
      rimProtection: 1,
    };
    const bounded = boundResponsibilityModifiers(wild, 0.12);
    expect(bounded.initiation).toBe(1.12);
    expect(bounded.pnrHandler).toBe(0.88);
    expect(bounded.rollMan).toBe(0.88);
    expect(bounded.postUp).toBe(1);
  });
  it('exposes deterministic per-slot modifiers through prepareTeam without mutating inputs', () => {
    const team = buildLegalSimulationTeam();
    const snapshot = JSON.stringify(team);
    const prep = prepareTeam(team, profile);
    expect(JSON.stringify(team)).toBe(snapshot);
    team.players.forEach((player, slot) => {
      expect(prep.positionModifiers.get(player.playerId)).toEqual(
        responsibilityModifiersForSlot(slot),
      );
    });
    const again = prepareTeam(team, profile);
    team.players.forEach((player) => {
      expect(again.positionModifiers.get(player.playerId)).toEqual(
        prep.positionModifiers.get(player.playerId),
      );
    });
  });
});
