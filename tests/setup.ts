/**
 * Jest test setup file
 * Configures global test environment and mocks
 */

// Mock Obsidian API for testing
jest.mock('obsidian', () => ({
  Plugin: class MockPlugin {
    app: any;
    manifest: any;
    constructor(app: any, manifest: any) {
      this.app = app;
      this.manifest = manifest;
    }
    onload() {}
    onunload() {}
    loadData() { return Promise.resolve({}); }
    saveData() { return Promise.resolve(); }
    addRibbonIcon() { return { addClass: jest.fn() }; }
    addStatusBarItem() { return { setText: jest.fn() }; }
    addCommand() {}
    addSettingTab() {}
    registerDomEvent() {}
    registerInterval() {}
  },
  Notice: jest.fn(),
  Modal: class MockModal {
    constructor(app: any) {}
    open() {}
    close() {}
  },
  PluginSettingTab: class MockPluginSettingTab {
    constructor(app: any, plugin: any) {}
    display() {}
  },
  Setting: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDesc: jest.fn().mockReturnThis(),
    addText: jest.fn().mockReturnThis(),
    addToggle: jest.fn().mockReturnThis(),
    addButton: jest.fn().mockReturnThis(),
    addColorPicker: jest.fn().mockReturnThis(),
    addSearch: jest.fn().mockReturnThis(),
    addDropdown: jest.fn().mockReturnThis(),
    addTextArea: jest.fn().mockReturnThis(),
  })),
}));

// Global test timeout
jest.setTimeout(10000);

export {};