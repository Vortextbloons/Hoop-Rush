import { seasonRotationSetDigest } from '@hoop-rush/engine';

/**
 * Canonical digest of a locked 30-rotation set (32 hex digits, the shape
 * frozen by `seasonRotationSetDigestSchema`). The engine owns the
 * authoritative implementation; this module is the UI's single import point
 * so every lock the screens build matches the worker's validation exactly.
 */
export { seasonRotationSetDigest };
