/**
 * Debug test to check DEFAULT_SETTINGS
 */

import { DEFAULT_SETTINGS } from '../src/types/plugin';

describe('Debug DEFAULT_SETTINGS', () => {
  test('should have correct default settings structure', () => {
    console.log('DEFAULT_SETTINGS:', JSON.stringify(DEFAULT_SETTINGS, null, 2));
    
    expect(DEFAULT_SETTINGS).toHaveProperty('agents');
    expect(DEFAULT_SETTINGS).toHaveProperty('permissions');
    expect(DEFAULT_SETTINGS).toHaveProperty('ui');
    
    expect(DEFAULT_SETTINGS.agents).toEqual([]);
    expect(DEFAULT_SETTINGS.permissions?.requireConfirmation).toBe(true);
    expect(DEFAULT_SETTINGS.ui?.theme).toBe('auto');
  });
});