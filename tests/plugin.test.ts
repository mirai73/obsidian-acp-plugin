/**
 * Basic plugin tests to verify setup
 */

import { DEFAULT_SETTINGS } from '../src/types/plugin';

describe('ACP Chat Plugin Settings', () => {
  test('should have correct default settings structure', () => {
    expect(DEFAULT_SETTINGS).toBeDefined();
    expect(DEFAULT_SETTINGS.agents).toEqual([]);
    expect(DEFAULT_SETTINGS.permissions).toBeDefined();
    expect(DEFAULT_SETTINGS.ui).toBeDefined();
    expect(DEFAULT_SETTINGS.connection).toBeDefined();
  });

  test('should have correct permission defaults', () => {
    expect(DEFAULT_SETTINGS.permissions?.requireConfirmation).toBe(true);
    expect(DEFAULT_SETTINGS.permissions?.logOperations).toBe(true);
    expect(DEFAULT_SETTINGS.permissions?.showPermissionDialog).toBe(true);
    expect(DEFAULT_SETTINGS.permissions?.allowedPaths).toEqual([]);
    expect(DEFAULT_SETTINGS.permissions?.deniedPaths).toEqual([]);
    expect(DEFAULT_SETTINGS.permissions?.readOnlyPaths).toEqual([]);
  });

  test('should have correct UI defaults', () => {
    expect(DEFAULT_SETTINGS.ui?.theme).toBe('auto');
    expect(DEFAULT_SETTINGS.ui?.showTimestamps).toBe(true);
    expect(DEFAULT_SETTINGS.ui?.enableMarkdown).toBe(true);
  });

  test('should have correct connection defaults', () => {
    expect(DEFAULT_SETTINGS.connection?.autoReconnect).toBe(true);
    expect(DEFAULT_SETTINGS.connection?.reconnectInterval).toBe(30);
    expect(DEFAULT_SETTINGS.connection?.maxReconnectAttempts).toBe(3);
    expect(DEFAULT_SETTINGS.connection?.connectionTimeout).toBe(10);
  });
});
