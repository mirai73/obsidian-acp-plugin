/**
 * Mock implementation of Obsidian API for testing
 */

export class Plugin {
	app: any;
	manifest: any;

	constructor(app: any, manifest: any) {
		this.app = app;
		this.manifest = manifest;
	}

	onload() {}
	onunload() {}
	loadData() {
		return Promise.resolve({});
	}
	saveData() {
		return Promise.resolve();
	}
	addRibbonIcon() {
		return { addClass: jest.fn() };
	}
	addStatusBarItem() {
		return { setText: jest.fn() };
	}
	addCommand() {}
	addSettingTab() {}
	registerDomEvent() {}
	registerInterval() {}
}

export class Notice {
	constructor(message: string) {}
}

export class Modal {
	constructor(app: any) {}
	open() {}
	close() {}
}

export class PluginSettingTab {
	constructor(app: any, plugin: any) {}
	display() {}
}

export class Setting {
	setName = jest.fn().mockReturnThis();
	setDesc = jest.fn().mockReturnThis();
	addText = jest.fn().mockReturnThis();
	addToggle = jest.fn().mockReturnThis();
	addButton = jest.fn().mockReturnThis();
	addColorPicker = jest.fn().mockReturnThis();
	addSearch = jest.fn().mockReturnThis();
	addDropdown = jest.fn().mockReturnThis();
	addTextArea = jest.fn().mockReturnThis();
	addSlider = jest.fn().mockReturnThis();
}

export class ItemView {
	containerEl: any = {
		children: [
			null,
			{ empty: jest.fn(), addClass: jest.fn(), createDiv: jest.fn() },
		],
	};

	constructor(leaf: any) {}

	getViewType() {
		return 'mock-view';
	}
	getDisplayText() {
		return 'Mock View';
	}
	getIcon() {
		return 'mock-icon';
	}
	onOpen() {
		return Promise.resolve();
	}
	onClose() {
		return Promise.resolve();
	}
}

export class WorkspaceLeaf {
	setViewState() {
		return Promise.resolve();
	}
}

export class Component {}

export class MarkdownRenderer {
	static renderMarkdown() {}
}
