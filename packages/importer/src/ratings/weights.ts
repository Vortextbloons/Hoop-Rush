export const OVERALL_WEIGHTS: Record<string, Record<string, number>> = {
    PG: {
        ballHandling: 0.13,
        passing: 0.13,
        perimeterDefense: 0.12,
        threePoint: 0.12,
        speed: 0.1,
        offensiveIq: 0.1,
        midrange: 0.04,
        freeThrow: 0.05,
        consistency: 0.05,
        defensiveIq: 0.03,
        steal: 0.03,
        closeShot: 0.05,
        insideScoring: 0.05,
    },
    SG: {
        threePoint: 0.15,
        perimeterDefense: 0.12,
        midrange: 0.1,
        ballHandling: 0.1,
        speed: 0.08,
        offensiveIq: 0.08,
        steal: 0.07,
        freeThrow: 0.06,
        consistency: 0.05,
        defensiveIq: 0.05,
        insideScoring: 0.05,
        closeShot: 0.05,
        offensiveRebound: 0.04,
    },
    SF: {
        threePoint: 0.12,
        midrange: 0.1,
        perimeterDefense: 0.12,
        defensiveIq: 0.08,
        offensiveIq: 0.08,
        speed: 0.07,
        ballHandling: 0.06,
        insideScoring: 0.06,
        offensiveRebound: 0.05,
        defensiveRebound: 0.05,
        freeThrow: 0.05,
        consistency: 0.05,
        strength: 0.05,
        steal: 0.06,
    },
    PF: {
        insideScoring: 0.15,
        defensiveRebound: 0.12,
        offensiveRebound: 0.08,
        interiorDefense: 0.1,
        midrange: 0.08,
        threePoint: 0.07,
        strength: 0.08,
        offensiveIq: 0.06,
        defensiveIq: 0.06,
        freeThrow: 0.04,
        consistency: 0.05,
        closeShot: 0.06,
        vertical: 0.05,
    },
    C: {
        insideScoring: 0.18,
        defensiveRebound: 0.15,
        interiorDefense: 0.12,
        offensiveRebound: 0.08,
        strength: 0.1,
        closeShot: 0.07,
        offensiveIq: 0.06,
        defensiveIq: 0.05,
        freeThrow: 0.04,
        consistency: 0.05,
        vertical: 0.05,
        block: 0.05,
    },
};
export function isBigProfile(position: string, heightInches?: number | null): boolean {
    if (position === 'C' || position === 'PF')
        return true;
    if (position === 'SF') {
        return (heightInches ?? 0) >= 82;
    }
    return false;
}
export function computeOverall(ratings: Record<string, number>, position: string, heightInches?: number | null): number {
    const weights = OVERALL_WEIGHTS[position] ?? OVERALL_WEIGHTS['SF'] ?? {};
    let total = 0;
    for (const [key, weight] of Object.entries(weights)) {
        total += (ratings[key] ?? 50) * weight;
    }
    if (total <= 50) {
        return Math.round(total);
    }
    const deviation = total - 50;
    const isBig = isBigProfile(position, heightInches);
    const divisor = isBig ? 240 : 170;
    return Math.min(99, Math.round(50 + deviation * (1 + deviation / divisor)));
}
