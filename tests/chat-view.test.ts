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

describe('ChatView handleSendMessage() enqueue path', () => {
  let chatView: ChatView;
  let mockLeaf: WorkspaceLeaf;
  let dispatchTurnSpy: jest.SpyInstance;
  let displayMessageSpy: jest.SpyInstance;
  let updateQueueIndicatorSpy: jest.SpyInstance;

  function buildChatView() {
    mockLeaf = {} as any;
    chatView = new ChatView(mockLeaf);

    // Minimal DOM stubs
    const messagesContainer = document.createElement('div');
    (chatView as any).messagesContainer = messagesContainer;

    const inputField = document.createElement('textarea');
    (chatView as any).inputField = inputField;

    const sendButton = document.createElement('button');
    (chatView as any).sendButton = sendButton;

    // Connection is live
    (chatView as any).connectionStatus = { connected: true };

    // Stub methods that touch DOM or network
    dispatchTurnSpy = jest
      .spyOn(chatView as any, 'dispatchTurn')
      .mockResolvedValue(undefined);
    displayMessageSpy = jest
      .spyOn(chatView as any, 'displayMessage')
      .mockImplementation(() => {});
    updateQueueIndicatorSpy = jest
      .spyOn(chatView as any, 'updateQueueIndicator')
      .mockImplementation(() => {});
    jest
      .spyOn(chatView as any, 'ensureSession')
      .mockResolvedValue('session-1');
    jest
      .spyOn(chatView as any, 'autoResizeTextarea')
      .mockImplementation(() => {});
    jest
      .spyOn(chatView as any, 'getSessionMessages')
      .mockReturnValue([]);
  }

  beforeEach(() => {
    buildChatView();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Requirements 1.1, 1.3: submitting while isProcessing enqueues the message
  test('enqueues message and renders bubble immediately when isProcessing is true', async () => {
    (chatView as any).isProcessing = true;
    (chatView as any).inputField.value = 'hello';

    await (chatView as any).handleSendMessage();

    expect((chatView as any).messageQueue).toHaveLength(1);
    expect((chatView as any).messageQueue[0].text).toBe('hello');
    expect(displayMessageSpy).toHaveBeenCalledTimes(1);
    expect(updateQueueIndicatorSpy).toHaveBeenCalledTimes(1);
    expect(dispatchTurnSpy).not.toHaveBeenCalled();
  });

  // Requirements 1.1, 1.3: submitting while queue is non-empty also enqueues
  test('enqueues message when queue is already non-empty (even if not processing)', async () => {
    (chatView as any).isProcessing = false;
    (chatView as any).messageQueue = [
      { text: 'first', agentMessage: { role: 'user', content: [] } },
    ];
    (chatView as any).inputField.value = 'second';

    await (chatView as any).handleSendMessage();

    expect((chatView as any).messageQueue).toHaveLength(2);
    expect((chatView as any).messageQueue[1].text).toBe('second');
    expect(displayMessageSpy).toHaveBeenCalledTimes(1);
    expect(updateQueueIndicatorSpy).toHaveBeenCalledTimes(1);
    expect(dispatchTurnSpy).not.toHaveBeenCalled();
  });

  // Requirement 1.5: idle path calls dispatchTurn directly
  test('calls dispatchTurn directly when idle and queue is empty', async () => {
    (chatView as any).isProcessing = false;
    (chatView as any).messageQueue = [];
    (chatView as any).inputField.value = 'direct message';

    await (chatView as any).handleSendMessage();

    expect((chatView as any).messageQueue).toHaveLength(0);
    expect(displayMessageSpy).toHaveBeenCalledTimes(1);
    expect(dispatchTurnSpy).toHaveBeenCalledTimes(1);
    expect(dispatchTurnSpy).toHaveBeenCalledWith(
      'direct message',
      expect.objectContaining({ role: 'user' })
    );
    expect(updateQueueIndicatorSpy).not.toHaveBeenCalled();
  });

  // Edge case: empty input is ignored
  test('does nothing when input is empty', async () => {
    (chatView as any).isProcessing = false;
    (chatView as any).inputField.value = '   ';

    await (chatView as any).handleSendMessage();

    expect((chatView as any).messageQueue).toHaveLength(0);
    expect(displayMessageSpy).not.toHaveBeenCalled();
    expect(dispatchTurnSpy).not.toHaveBeenCalled();
  });

  // Edge case: disconnected is ignored
  test('does nothing when disconnected', async () => {
    (chatView as any).connectionStatus = { connected: false };
    (chatView as any).inputField.value = 'hello';

    await (chatView as any).handleSendMessage();

    expect(displayMessageSpy).not.toHaveBeenCalled();
    expect(dispatchTurnSpy).not.toHaveBeenCalled();
  });
});
