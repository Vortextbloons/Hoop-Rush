import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import {
  buildSeasonNavGroups,
  isPostseasonStage,
  seasonMobileNavOf,
  type SeasonNavIcons,
} from './season-nav';

const icon = (() => {}) as unknown as Component<{ class?: string }>;
const icons: SeasonNavIcons = {
  gameday: icon,
  team: icon,
  league: icon,
  bracket: icon,
  frontOffice: icon,
};

function childIds(groups: ReturnType<typeof buildSeasonNavGroups>): string[] {
  return groups.flatMap((group) => group.children.map((child) => child.id));
}

function groupOf(
  groups: ReturnType<typeof buildSeasonNavGroups>,
  id: string,
): ReturnType<typeof buildSeasonNavGroups>[number] | undefined {
  return groups.find((group) => group.id === id);
}

describe('buildSeasonNavGroups', () => {
  it('groups regular-season destinations into four clusters', () => {
    const groups = buildSeasonNavGroups(icons, {
      stage: 'regular-season',
      freeAgencyVisible: false,
    });
    expect(groups.map((group) => group.id)).toEqual(['gameday', 'team', 'league', 'office']);
    expect(groupOf(groups, 'league')?.children.map((child) => child.id)).toEqual([
      'league',
      'schedule',
      'leaders',
    ]);
    expect(groupOf(groups, 'office')?.children.map((child) => child.id)).toEqual(['trades']);
    expect(groupOf(groups, 'office')?.href).toBe('/season/run/trades');
  });

  it('replaces the league landing with the bracket and keeps sub-tabs during postseason', () => {
    const groups = buildSeasonNavGroups(icons, {
      stage: 'playoffs',
      freeAgencyVisible: false,
    });
    expect(groupOf(groups, 'league')?.href).toBe('/season/run/postseason');
    expect(groupOf(groups, 'league')?.children.map((child) => child.id)).toEqual([
      'postseason',
      'league',
      'schedule',
      'leaders',
    ]);
    expect(childIds(groups)).not.toContain('trades');
  });

  it('keeps trades out of the postseason while surfacing free agency in both stages', () => {
    const regular = buildSeasonNavGroups(icons, {
      stage: 'regular-season',
      freeAgencyVisible: true,
    });
    const office = regular.find((group) => group.id === 'office');
    expect(office?.children.map((child) => child.id)).toEqual(['trades', 'free-agency']);

    const postseason = buildSeasonNavGroups(icons, { stage: 'play-in', freeAgencyVisible: true });
    const postseasonOffice = postseason.find((group) => group.id === 'office');
    expect(postseasonOffice?.children.map((child) => child.id)).toEqual(['free-agency']);
    expect(postseasonOffice?.href).toBe('/season/run/free-agency');
  });

  it('omits the front office entirely when nothing is open', () => {
    const groups = buildSeasonNavGroups(icons, {
      stage: 'playoffs',
      freeAgencyVisible: false,
    });
    expect(groups.map((group) => group.id)).toEqual(['gameday', 'team', 'league']);
  });
});

describe('seasonMobileNavOf', () => {
  it('splits groups into primary landings and non-landing overflow links', () => {
    const groups = buildSeasonNavGroups(icons, {
      stage: 'regular-season',
      freeAgencyVisible: true,
    });
    const { primary, overflow } = seasonMobileNavOf(groups);
    expect(primary.map((item) => item.id)).toEqual(['gameday', 'team', 'league', 'office']);
    expect(overflow.map((item) => item.id)).toEqual(['schedule', 'leaders', 'free-agency']);
    const landingHrefs = new Set(groups.map((group) => group.href));
    expect(overflow.every((item) => item.href !== null)).toBe(true);
    const overflowHrefs = overflow.flatMap((item) => (item.href === null ? [] : [item.href]));
    expect(overflowHrefs.every((href) => !landingHrefs.has(href))).toBe(true);
  });
});

describe('isPostseasonStage', () => {
  it('treats play-in, playoffs, and completed as postseason', () => {
    expect(isPostseasonStage('play-in')).toBe(true);
    expect(isPostseasonStage('playoffs')).toBe(true);
    expect(isPostseasonStage('completed')).toBe(true);
    expect(isPostseasonStage('regular-season')).toBe(false);
    expect(isPostseasonStage(null)).toBe(false);
  });
});
