import { describe, expect, it } from 'vitest';
import { isNavItemActive, type NavItem } from './nav-items';
const hub: NavItem = {
    id: 'hub',
    label: 'Hub',
    href: '/season/run',
    icon: {} as NavItem['icon'],
};
const team: NavItem = {
    id: 'team',
    label: 'Team',
    href: '/season/run/team',
    icon: {} as NavItem['icon'],
};
const league: NavItem = {
    id: 'league',
    label: 'League',
    href: '/season/run/league',
    icon: {} as NavItem['icon'],
};
describe('isNavItemActive', () => {
    it('highlights only the hub on the hub route', () => {
        expect(isNavItemActive(hub, '/season/run')).toBe(true);
        expect(isNavItemActive(team, '/season/run')).toBe(false);
    });
    it('does not treat child routes as the hub', () => {
        expect(isNavItemActive(hub, '/season/run/team')).toBe(false);
        expect(isNavItemActive(team, '/season/run/team')).toBe(true);
    });
    it('normalizes trailing slashes', () => {
        expect(isNavItemActive(team, '/season/run/team/')).toBe(true);
        expect(isNavItemActive(hub, '/season/run/')).toBe(true);
        expect(isNavItemActive(hub, '/season/run/team/')).toBe(false);
    });
    it('keeps the hub active on checkpoint recaps', () => {
        expect(isNavItemActive(hub, '/season/run/checkpoint')).toBe(true);
        expect(isNavItemActive(team, '/season/run/checkpoint')).toBe(false);
    });
    it('keeps the league tab active on team detail routes', () => {
        expect(isNavItemActive(league, '/season/run/league')).toBe(true);
        expect(isNavItemActive(league, '/season/run/teams')).toBe(true);
        expect(isNavItemActive(hub, '/season/run/teams')).toBe(false);
        expect(isNavItemActive(team, '/season/run/teams')).toBe(false);
    });
});
