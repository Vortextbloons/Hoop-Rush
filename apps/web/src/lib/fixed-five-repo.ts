import { DexieFixedFiveRepository, HoopRushDatabase } from '@hoop-rush/persistence';

const db = new HoopRushDatabase();
export const fixedFiveRepository = new DexieFixedFiveRepository(db);
