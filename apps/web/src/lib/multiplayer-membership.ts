import { idSchema, type Id } from '@hoop-rush/data-contracts';

export interface MembershipSchema<TMembership extends { roomId: string }> {
  safeParse(
    value: unknown,
  ): { success: true; data: TMembership } | { success: false; error?: unknown };
}

export interface MembershipStore<TMembership extends { roomId: string }> {
  save(membership: TMembership): void;
  load(roomId: string): TMembership | null;
  loadLastRoomId(): Id | null;
}

export function createMembershipStore<TMembership extends { roomId: string }>(options: {
  prefix: string;
  lastRoomKey: string;
  schema: MembershipSchema<TMembership>;
}): MembershipStore<TMembership> {
  return {
    save(membership) {
      try {
        localStorage.setItem(`${options.prefix}${membership.roomId}`, JSON.stringify(membership));
        localStorage.setItem(options.lastRoomKey, membership.roomId);
      } catch {}
    },
    load(roomId) {
      try {
        const parsedRoomId = idSchema.safeParse(roomId);
        if (!parsedRoomId.success) return null;
        const raw = localStorage.getItem(`${options.prefix}${parsedRoomId.data}`);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        const result = options.schema.safeParse(parsed);
        if (!result.success) return null;
        if (result.data.roomId !== parsedRoomId.data) return null;
        return result.data;
      } catch {
        return null;
      }
    },
    loadLastRoomId() {
      try {
        const raw = localStorage.getItem(options.lastRoomKey);
        if (raw === null) return null;
        const parsed = idSchema.safeParse(raw);
        if (!parsed.success) return null;
        return parsed.data;
      } catch {
        return null;
      }
    },
  };
}
