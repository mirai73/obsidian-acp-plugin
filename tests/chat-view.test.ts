/**
 * @jest-environment jsdom
 */
import { WorkspaceLeaf, ItemView } from 'obsidian';

// Mock Obsidian modules BEFORE importing ChatView
jest.mock('obsidian', () => {
  return {
    ItemView: class MockItemView {
      containerEl: any = {
        children: [
          null,
          { empty: jest.fn(), addClass: jest.fn(), createDiv: jest.fn() },
        ],
      };
      constructor(leaf: any) {}
    },
    SuggestModal: class MockSuggestModal {
      constructor(app: any) {}
    },
    setIcon: jest.fn(),
    Notice: jest.fn(),
    Component: class MockComponent {},
    MarkdownRenderer: {
      renderMarkdown: jest.fn(),
    },
  };
});

import { ChatView, CHAT_VIEW_TYPE } from '../src/ui/chat-view';
import { ACPClientImpl } from '../src/core/acp-client-impl';
import { SessionManagerImpl } from '../src/core/session-manager';

describe('ChatView', () => {
  let chatView: ChatView;
  let mockLeaf: WorkspaceLeaf;
  let mockClient: jest.Mocked<ACPClientImpl>;
  let mockSessionManager: jest.Mocked<SessionManagerImpl>;

  beforeEach(() => {
    mockLeaf = {
      containerEl: document.createElement('div'),
    } as any;

    chatView = new ChatView(mockLeaf);

    // Mock ACPClientImpl
    mockClient = {
      setSessionManager: jest.fn(),
      getAllConnectionStatuses: jest.fn().mockReturnValue(new Map()),
      getConnectionStatus: jest
        .fn()
        .mockReturnValue({ connected: true, agentName: 'Test Agent' }),
      getConnectedAgents: jest.fn().mockReturnValue(['agent-1']),
    } as any;

    // Mock SessionManagerImpl
    mockSessionManager = {
      setJsonRpcClient: jest.fn(),
      createSession: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
      getSessionInfo: jest.fn().mockReturnValue({}),
    } as any;

    // Mock internal properties
    (chatView as any).acpClient = mockClient;
    (chatView as any).sessionManager = mockSessionManager;

    // Setup container for ChatView
    const contentEl = document.createElement('div');
    // Add createDiv to mock contentEl
    contentEl.createDiv = jest.fn().mockImplementation((cls) => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      return div;
    });
    contentEl.createEl = jest.fn().mockImplementation((tag, options) => {
      const el = document.createElement(tag);
      if (options?.cls) el.className = options.cls;
      return el;
    });
    contentEl.empty = jest.fn();
    contentEl.addClass = jest.fn();

    (chatView as any).containerEl = {
      children: [null, contentEl],
    };
  });

  test('should initialize agentNameEl in createChatInterface', () => {
    const container = (chatView as any).containerEl.children[1];

    // Add helper to container for createSpan
    container.createSpan = jest.fn().mockImplementation((options) => {
      const span = document.createElement('span');
      if (options?.cls) span.className = options.cls;
      if (options?.text) span.textContent = options.text;
      return span;
    });

    (chatView as any).createChatInterface(container);

    expect((chatView as any).agentNameEl).toBeDefined();
    expect((chatView as any).agentNameEl.textContent).toBe('Test Agent');
  });

  test('updateAgentNameDisplay should update the element text', () => {
    const container = (chatView as any).containerEl.children[1];
    // Add helper to container for createSpan
    container.createSpan = jest.fn().mockImplementation((options) => {
      const span = document.createElement('span');
      if (options?.cls) span.className = options.cls;
      if (options?.text) span.textContent = options.text;
      return span;
    });

    (chatView as any).createChatInterface(container);

    // Change agent name in mock
    mockClient.getConnectionStatus.mockReturnValue({
      connected: true,
      agentName: 'New Agent Name',
    });

    (chatView as any).updateAgentNameDisplay();

    expect((chatView as any).agentNameEl.textContent).toBe('New Agent Name');
  });

  test('updateAgentNameDisplay should handle None when no agent', () => {
    const container = (chatView as any).containerEl.children[1];
    // Add helper to container for createSpan
    container.createSpan = jest.fn().mockImplementation((options) => {
      const span = document.createElement('span');
      if (options?.cls) span.className = options.cls;
      if (options?.text) span.textContent = options.text;
      return span;
    });

    (chatView as any).createChatInterface(container);

    (chatView as any).currentAgentId = null;
    (chatView as any).updateAgentNameDisplay();

    expect((chatView as any).agentNameEl.textContent).toBe('None');
  });
});
