# Design Document: Message Queue & Session Handling

## Overview

This feature adds two complementary improvements to the Obsidian ACP chat plugin:

1. **Message Queuing** — users can submit messages while an agent turn is in-flight. Submitted messages are held in a FIFO queue, rendered immediately in the chat timeline, and dispatched automatically once the active turn completes.

2. **Session Isolation** — when a new session is started, streaming chunks from the previous session's still-running agent turn are silently discarded from the UI. The old turn continues running in the background and its chunks continue to feed the old session's data store; they are simply not rendered in the new session's view.

Both improvements are confined to `ChatView` (`src/ui/chat-view.ts`) and `SessionManagerImpl` (`src/core/session-manager.ts`). No protocol-level changes are required.

---

## Architecture

### Current Flow

```
User submits message
  → handleSendMessage()
    → ensureSession()
    → displayMessage(userMsg)          // render user bubble
    → isProcessing = true
    → sessionManager.sendPrompt()      // awaits agent turn
      ← session/update notifications  → handleStreamingChunk()
    ← PromptResult
    → finalizeStreamingMessage()
    → isProcessing = false
```

### New Flow (with queue)

```
User submits message
  → handleSendMessage()
    → if (isProcessing || queue non-empty)
        enqueue message
        displayMessage(userMsg)        // render immediately
        updateQueueIndicator()
        return
    → displayMessage(userMsg)
    → dispatchTurn(message)            // extracted helper

dispatchTurn(message)
  → isProcessing = true
  → updateInputState()
  → sessionManager.sendPrompt()
    ← session/update notifications  → handleStreamingChunk()  (filtered by sessionId)
  ← PromptResult / error
  → if (sessionId === activeSessionId)
      finalizeStreamingMessage()
  → isProcessing = false
  → dequeueAndDispatch()             // drain queue

dequeueAndDispatch()
  → if (queue non-empty && sessionId still active)
      next = queue.shift()
      updateQueueIndicator()
      dispatchTurn(next)
```

### Session Isolation Flow

```
startNewConversation()
  → newSessionId = await ensureSession()   // sets this.currentSessionId
  → messagesContainer.empty()
  → (old agent turn continues in background)

handleStreamingChunk(sessionId, chunk)
  → if (sessionId !== this.currentSessionId) return  // discard stale chunk
  → render chunk

dispatchTurn() completion handler
  → if (turnSessionId !== this.currentSessionId) return  // suppress finalisation
```

---

## Components and Interfaces

### ChatView changes (`src/ui/chat-view.ts`)

#### New private state

```typescript
private messageQueue: Array<{ text: string; agentMessage: Message }> = [];
private queueIndicator: HTMLElement | null = null;
```

#### New / modified methods

| Method | Change |
|---|---|
| `handleSendMessage()` | If `isProcessing` or queue non-empty, enqueue and return; otherwise call `dispatchTurn()` |
| `dispatchTurn(text, agentMessage)` | Extracted async helper that owns the `sendPrompt` call, finalisation, and queue drain |
| `dequeueAndDispatch()` | Pops the next item from `messageQueue` and calls `dispatchTurn()` |
| `handleStreamingChunk(sessionId, chunk)` | Guard: discard if `sessionId !== this.currentSessionId` |
| `updateInputState()` | Send button shows cancel icon only when `isProcessing && queue.length === 0`; shows send icon when `isProcessing && queue.length > 0` |
| `updateQueueIndicator()` | Shows/hides badge with pending count |
| `initializeNewConversation()` | Clears `messageQueue` and resets `queueIndicator` before calling `ensureSession()` |

#### Send button state table

| Condition | Button icon | Button enabled |
|---|---|---|
| Not processing, input empty | arrow-right | disabled |
| Not processing, input non-empty | arrow-right | enabled |
| Processing, queue empty | square (cancel) | enabled |
| Processing, queue non-empty | arrow-right (enqueue) | enabled |
| Disconnected | arrow-right | disabled |

### SessionManagerImpl changes (`src/core/session-manager.ts`)

#### `handleStreamingUpdate(params)`

The method already passes `sessionId` to `onStreamingChunk`. No structural change is needed — the `sessionId` is already forwarded on every call. The `ChatView` is responsible for filtering.

#### `sendPrompt()` — no cancellation on session switch

The existing `sendPrompt` implementation does not cancel the underlying JSON-RPC request when a new session is started. This is the correct behaviour: the old turn continues running, its `session/update` notifications continue arriving, and `handleStreamingUpdate` continues accumulating them into the old session's `messages` array. The `ChatView` discards them from the UI via the `sessionId` guard.

---

## Data Models

### MessageQueue entry

```typescript
interface QueuedMessage {
  /** The plain text the user typed (used for display deduplication) */
  text: string;
  /** The full agent-facing Message (may include resource_link context) */
  agentMessage: Message;
}
```

The queue is a plain `Array<QueuedMessage>` held as private state on `ChatView`. It is not persisted.

### ChatView state additions

```typescript
// Existing
private isProcessing: boolean;
private currentSessionId: string | null;

// New
private messageQueue: QueuedMessage[] = [];
private queueIndicator: HTMLElement | null = null;
```

### Turn ownership tracking

When `dispatchTurn` is called it captures the session ID at call time:

```typescript
private async dispatchTurn(text: string, agentMessage: Message): Promise<void> {
  const turnSessionId = this.currentSessionId!;
  this.isProcessing = true;
  this.updateInputState();
  try {
    await this.sessionManager!.sendPrompt(turnSessionId, [agentMessage]);
    if (turnSessionId === this.currentSessionId) {
      this.finalizeStreamingMessage();
    }
  } catch (error) {
    if (turnSessionId === this.currentSessionId) {
      // show error
    }
  } finally {
    this.isProcessing = false;
    this.updateInputState();
    this.dequeueAndDispatch();
  }
}
```

The `turnSessionId` local variable is the key mechanism for stale-turn suppression (Requirements 4.1, 4.2, 4.3).

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Queue grows by exactly one on enqueue

*For any* ChatView state where `isProcessing` is true or the queue is non-empty, submitting a new message must increase `messageQueue.length` by exactly one.

**Validates: Requirements 1.1, 1.3**

---

### Property 2: Input field stays enabled while processing

*For any* ChatView state where `isProcessing` is true, `inputField.disabled` must be `false`.

**Validates: Requirements 1.2**

---

### Property 3: Queue drains to zero after turn completion

*For any* non-empty message queue, after the current turn completes the queue must eventually reach length zero (assuming no new messages are submitted and the session remains active).

**Validates: Requirements 1.4**

---

### Property 4: Messages rendered in FIFO order

*For any* sequence of messages submitted while a turn is in-flight, the order of user message bubbles in the chat timeline must equal the order in which the messages were submitted.

**Validates: Requirements 1.5, 5.1**

---

### Property 5: Queue indicator visibility matches queue length

*For any* ChatView state, the queue indicator is visible if and only if `messageQueue.length > 0`.

**Validates: Requirements 1.6, 5.3**

---

### Property 6: New session clears the queue

*For any* ChatView state with a non-empty message queue, calling `initializeNewConversation` must result in `messageQueue.length === 0`.

**Validates: Requirements 1.7**

---

### Property 7: Send button state is consistent with processing and queue state

*For any* combination of `(isProcessing, messageQueue.length, inputField.value.trim() === "")`, the send button's icon and `disabled` attribute must match the following table:
- not processing + empty input → arrow-right, disabled
- not processing + non-empty input → arrow-right, enabled
- processing + queue empty → square (cancel), enabled
- processing + queue non-empty → arrow-right (enqueue), enabled
- disconnected → arrow-right, disabled

**Validates: Requirements 2.1, 2.2, 2.3**

---

### Property 8: Stale streaming chunks produce no DOM mutation

*For any* streaming chunk whose `sessionId` does not equal `this.currentSessionId` at the time of receipt, calling `handleStreamingChunk` must not mutate the `messagesContainer` DOM.

**Validates: Requirements 3.2, 3.3**

---

### Property 9: SessionManager forwards sessionId on every chunk callback

*For any* `session/update` notification received by `SessionManagerImpl`, the `onStreamingChunk` callback must be invoked with the `sessionId` from the notification params.

**Validates: Requirements 3.5, 3.7**

---

### Property 10: Stale turn finalisation and errors are suppressed

*For any* `dispatchTurn` call where `turnSessionId !== this.currentSessionId` at resolution time, neither `finalizeStreamingMessage` nor any error display must execute.

**Validates: Requirements 4.1, 4.2**

---

### Property 11: Input field remains enabled after session switch during in-flight turn

*For any* ChatView state where a turn is in-flight, calling `initializeNewConversation` must result in `inputField.disabled === false` immediately after the call returns.

**Validates: Requirements 4.3**

---

### Property 12: Dispatching a queued message does not re-render its bubble

*For any* message that was rendered at submission time and is later dequeued and dispatched, the count of user message bubbles with that text in the DOM must not increase during dispatch.

**Validates: Requirements 5.2**

---

## Error Handling

### Turn error while queue is non-empty

If `sendPrompt` rejects for the active session, the error is displayed normally and `dequeueAndDispatch` is still called so the queue continues draining. This prevents a single error from permanently blocking queued messages.

### Turn error for a stale session

If `sendPrompt` rejects for a session that is no longer active (`turnSessionId !== this.currentSessionId`), the error is silently suppressed — no error bubble is added to the current session's UI (Requirement 4.2).

### New session started while `ensureSession` is in-flight

`initializeNewConversation` resets `ensureSessionPromise = null` and `currentSessionId = null` before calling `ensureSession`. Any concurrent `dispatchTurn` that was awaiting the old `ensureSession` will capture a stale `turnSessionId` and its finalisation will be suppressed.

### Queue cleared on session switch

`initializeNewConversation` empties `messageQueue` before the new session is established, so queued messages from the old session are never dispatched to the new session (Requirement 1.7).

---

## Testing Strategy

### Unit tests

Unit tests cover specific examples and edge cases:

- Submitting a message while `isProcessing = true` enqueues it and renders the bubble immediately.
- Submitting a message while `isProcessing = false` and queue is empty dispatches it directly.
- `handleStreamingChunk` with a matching `sessionId` renders the chunk.
- `handleStreamingChunk` with a mismatched `sessionId` produces no DOM change.
- `initializeNewConversation` clears the queue.
- Send button shows cancel icon when processing with empty queue.
- Send button shows send icon when processing with non-empty queue.
- Send button is disabled when input is empty and not processing.
- Error from a stale turn is not displayed in the current session.

### Property-based tests

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) (already available in the JS/TS ecosystem) with a minimum of **100 iterations** per property.

Each test is tagged with a comment in the format:
`// Feature: message-queue-session-handling, Property N: <property text>`

| Property | Test description |
|---|---|
| P1 | Generate random message sequences submitted during a mock in-flight turn; assert DOM order matches submission order |
| P2 | Generate random queue states with `isProcessing = true`; submit a message; assert `queue.length` increased by 1 |
| P3 | Generate random non-empty queues; simulate turn completions; assert queue reaches 0 |
| P4 | Generate random chunks with random `sessionId`s; assert only matching-session chunks mutate the DOM |
| P5 | Generate random queue states; call `initializeNewConversation`; assert queue is empty |
| P6 | Generate random turn completions with stale session IDs; assert no DOM mutations occur |
| P7 | Generate random `(isProcessing, queueLength, inputEmpty)` triples; assert button state matches the state table |
| P8 | Generate random queue lengths; assert indicator visibility equals `length > 0` |

Property tests are co-located with unit tests in `tests/chat-view.test.ts` and `tests/session-manager.test.ts`.
