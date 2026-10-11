import { it } from 'vitest';
import { generateBracket } from './generator.ts';
import { generationOptions } from './generator-testing.ts';

it('scratch bracket samples probe', () => {
  for (const samples of [8, 16]) {
    try {
      const bracket = generateBracket(generationOptions({ samplesPerBenchmark: samples }));
      const percentiles = bracket.opponents
        .filter((o) => o.opponentId !== 'lakers-1990s-opening')
        .map((o) => o.strength.percentile)
        .sort((a, b) => a - b);
      console.log(
        `SAMPLES=${String(samples)} OK min=${String(Math.min(...percentiles).toFixed(3))} max=${String(Math.max(...percentiles).toFixed(3))}`,
      );
    } catch (error) {
      console.log(`SAMPLES=${String(samples)} FAILED ${String(error).slice(0, 400)}`);
    }
  }
});
