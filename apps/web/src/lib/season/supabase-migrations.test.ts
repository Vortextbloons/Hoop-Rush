import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const migrationsDirectory = resolve(process.cwd(), '../../supabase/migrations');
describe('season multiplayer migrations', () => {
    it('applies every migration in a unique order and creates v2 rooms', () => {
        const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql'));
        const versions = migrationFiles.map((file) => file.split('_', 1)[0]);
        expect(new Set(versions).size, 'duplicate Supabase migration versions').toBe(versions.length);
        const createMigration = migrationFiles.find((file) => file.includes('season_room_create_v2_protocol'));
        expect(createMigration).toBeDefined();
        const sql = readFileSync(resolve(migrationsDirectory, createMigration!), 'utf8');
        expect(sql).toContain('room_protocol_version, multiplayer_version');
        expect(sql).toContain("2, 'season-multiplayer-v2'");
    });
});
