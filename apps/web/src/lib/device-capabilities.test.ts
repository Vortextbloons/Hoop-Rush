import { describe, expect, it } from 'vitest';
import {
  LITE_ATTRIBUTE,
  LITE_MANUAL_STORAGE_KEY,
  detectLowEndDevice,
  isLiteMode,
  liteModePreferenceToStorageValue,
  readLiteModePreference,
} from './device-capabilities';

describe('lite mode storage mapping', () => {
  it('stores only explicit preferences', () => {
    expect(liteModePreferenceToStorageValue('auto')).toBeNull();
    expect(liteModePreferenceToStorageValue('on')).toBe('on');
    expect(liteModePreferenceToStorageValue('off')).toBe('off');
  });

  it('exposes the attribute and storage key contract', () => {
    expect(LITE_ATTRIBUTE).toBe('data-lite');
    expect(LITE_MANUAL_STORAGE_KEY).toBe('hoop-rush:lite-mode');
  });
});

describe('node environment fallbacks', () => {
  it('does not treat a windowless environment as low-end', () => {
    expect(detectLowEndDevice()).toBe(false);
  });

  it('defaults to auto and inactive without a DOM', () => {
    expect(readLiteModePreference()).toBe('auto');
    expect(isLiteMode()).toBe(false);
  });
});
