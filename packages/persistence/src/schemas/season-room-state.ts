import { z } from 'zod';
import { seasonCheckpointAttestationSchema, seasonDeadlineSchema, seasonRoomMemberPrivateSnapshotSchema, seasonRoomPublicSnapshotSchema, } from '@hoop-rush/data-contracts';
export const storedSeasonRoomStateSchema = z.object({
    roomId: z.string().min(1).max(64),
    publicSnapshot: seasonRoomPublicSnapshotSchema,
    memberPrivateSnapshot: seasonRoomMemberPrivateSnapshotSchema.nullable(),
    deadline: seasonDeadlineSchema.nullable(),
    attestation: seasonCheckpointAttestationSchema.nullable(),
    updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonRoomState = z.infer<typeof storedSeasonRoomStateSchema>;
