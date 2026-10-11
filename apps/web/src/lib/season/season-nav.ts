import type { Component } from 'svelte';
import type { NavItem } from '$lib/nav-items';

export type SeasonNavStage = 'regular-season' | 'play-in' | 'playoffs' | 'completed' | null;

export interface SeasonNavIcons {
  gameday: Component<{ class?: string }>;
  team: Component<{ class?: string }>;
  league: Component<{ class?: string }>;
  bracket: Component<{ class?: string }>;
  frontOffice: Component<{ class?: string }>;
}

export interface SeasonNavGroup {
  id: string;
  label: string;
  icon: Component<{ class?: string }>;
  href: string;
  children: NavItem[];
}

export interface SeasonNavFacts {
  stage: SeasonNavStage;
  freeAgencyVisible: boolean;
}

export function isPostseasonStage(stage: SeasonNavStage): boolean {
  return stage === 'play-in' || stage === 'playoffs' || stage === 'completed';
}

export function buildSeasonNavGroups(
  icons: SeasonNavIcons,
  facts: SeasonNavFacts,
): SeasonNavGroup[] {
  const postseason = isPostseasonStage(facts.stage);
  const gameday: NavItem = { id: 'hub', label: 'Gameday', href: '/season/run', icon: icons.gameday };
  const team: NavItem = { id: 'team', label: 'Team', href: '/season/run/team', icon: icons.team };
  const standings: NavItem = {
    id: 'league',
    label: 'Standings',
    href: '/season/run/league',
    icon: icons.league,
  };
  const schedule: NavItem = {
    id: 'schedule',
    label: 'Schedule',
    href: '/season/run/schedule',
    icon: icons.league,
  };
  const honors: NavItem = {
    id: 'leaders',
    label: 'Honors',
    href: '/season/run/leaders',
    icon: icons.league,
  };
  const trades: NavItem = {
    id: 'trades',
    label: 'Trades',
    href: '/season/run/trades',
    icon: icons.frontOffice,
  };
  const freeAgency: NavItem = {
    id: 'free-agency',
    label: 'Free Agency',
    href: '/season/run/free-agency',
    icon: icons.frontOffice,
  };
  const groups: SeasonNavGroup[] = [
    { id: 'gameday', label: 'Gameday', icon: icons.gameday, href: '/season/run', children: [gameday] },
    { id: 'team', label: 'Team', icon: icons.team, href: '/season/run/team', children: [team] },
    {
      id: 'league',
      label: 'League',
      icon: icons.league,
      href: postseason ? '/season/run/postseason' : '/season/run/league',
      children: [standings, schedule, honors],
    },
  ];
  if (postseason) {
    const bracket: NavItem = {
      id: 'postseason',
      label: 'Bracket',
      href: '/season/run/postseason',
      icon: icons.bracket,
    };
    groups[2]!.children.unshift(bracket);
  }
  const officeChildren: NavItem[] = [];
  if (!postseason) officeChildren.push(trades);
  if (facts.freeAgencyVisible) officeChildren.push(freeAgency);
  if (officeChildren.length > 0) {
    groups.push({
      id: 'office',
      label: 'Front Office',
      icon: icons.frontOffice,
      href: officeChildren[0]?.href ?? '/season/run/trades',
      children: officeChildren,
    });
  }
  return groups;
}

export interface SeasonMobileNav {
  primary: NavItem[];
  overflow: NavItem[];
}

export function seasonMobileNavOf(groups: readonly SeasonNavGroup[]): SeasonMobileNav {
  const primary: NavItem[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    href: group.href,
    icon: group.icon,
  }));
  const landing = new Set(groups.map((group) => group.href));
  const overflow = groups
    .flatMap((group) => group.children)
    .filter((child) => child.href !== null && !landing.has(child.href));
  return { primary, overflow };
}
