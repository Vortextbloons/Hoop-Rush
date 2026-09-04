import { commandIdSchema, seedSchema, type CommandId, type Seed } from '@hoop-rush/data-contracts';
import { randomHex } from '$lib/random-hex';
export function newSeasonId(prefix: string): CommandId {
    const random = randomHex(16);
    return commandIdSchema.parse(`${prefix}-${random}`);
}
export function seasonRootSeed(): Seed {
    return seedSchema.parse(randomHex(32));
}
