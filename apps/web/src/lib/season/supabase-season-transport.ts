import type { SeasonMultiplayerTransport, SeasonRoomPublicSnapshot, SeasonRoomSettings, SeasonRoomMembership, SeasonPublicCommandEnvelope, SeasonCommandReceipt, SeasonPrivateDecisionSubmission, SeasonCheckpointAttestation, SeasonAcceptedCheckpoint, SeasonRerunRequest, SeasonIntegrityFailure2, SeasonRoomCode } from '@hoop-rush/data-contracts';

// Transport-neutral Supabase implementation stub.
// Real implementation uses @supabase/supabase-js with anonymous Auth,
// private Realtime channel, and Edge Functions for mutations.
// This stub keeps the engine/persistence packages free of Supabase imports
// and allows the web to run with a feature flag when Supabase is not configured.

export type SupabaseSeasonTransportConfig = {
    url: string;
    publishableKey: string;
    captchaSiteKey?: string;
};

export function createSupabaseSeasonTransport(_config: SupabaseSeasonTransportConfig): SeasonMultiplayerTransport {
    const notConfigured = (op: string): never => {
        throw Object.assign(new Error(`Supabase not configured: ${op} requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY`), { code: 'authorization' });
    };
    return {
        async create(_settings: SeasonRoomSettings, _rootSeed: string): Promise<SeasonRoomPublicSnapshot> {
            return notConfigured('create');
        },
        async preview(_code: string): Promise<SeasonRoomPublicSnapshot> {
            return notConfigured('preview');
        },
        async join(_code: string): Promise<SeasonRoomMembership> {
            return notConfigured('join');
        },
        async resume(_roomId: string): Promise<SeasonRoomPublicSnapshot> {
            return notConfigured('resume');
        },
        subscribe(_roomId: string, _handler: (snap: SeasonRoomPublicSnapshot) => void) {
            return { unsubscribe() {} };
        },
        async refetch(_roomId: string, _afterOrdinal: number): Promise<SeasonPublicCommandEnvelope[]> {
            return notConfigured('refetch');
        },
        async submitCommand(_envelope: SeasonPublicCommandEnvelope): Promise<SeasonCommandReceipt> {
            return notConfigured('submitCommand');
        },
        async submitPrivateDecision(_submission: SeasonPrivateDecisionSubmission) {
            return notConfigured('submitPrivateDecision');
        },
        async publishAttestation(_att: SeasonCheckpointAttestation): Promise<SeasonAcceptedCheckpoint | SeasonRerunRequest | SeasonIntegrityFailure2> {
            return notConfigured('publishAttestation');
        },
        async requestReclaim(_roomId: string, _participantId: 'p1' | 'p2') {
            return notConfigured('requestReclaim');
        },
        async surrender(_roomId: string, _participantId: 'p1' | 'p2') {
            return notConfigured('surrender');
        },
        async preDraftRemoval(_roomId: string, _targetParticipantId: 'p1' | 'p2'): Promise<SeasonRoomCode> {
            return notConfigured('preDraftRemoval');
        },
        async close(_roomId: string) {
            return notConfigured('close');
        },
    };
}

export function isSupabaseConfigured(): boolean {
    const url = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL;
    const key = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
    const flag = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_ENABLE_MULTIPLAYER;
    return Boolean(url && key && flag !== 'false');
}

export function multiplayerDisabledMessage(): string {
    return 'Multiplayer is not configured. Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_CAPTCHA_SITE_KEY and VITE_ENABLE_MULTIPLAYER=true, or continue in solo mode.';
}
