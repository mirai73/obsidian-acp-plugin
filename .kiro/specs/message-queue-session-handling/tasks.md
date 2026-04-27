# Implementation Plan: Message Queue & Session Handling

## Overview

Implement message queuing and session isolation in `ChatView` by extracting a `dispatchTurn()` helper, adding a `messageQueue` state array, and guarding `handleStreamingChunk` with a `sessionId` comparison. `SessionManagerImpl` already forwards `sessionId` on every chunk callback and requires no structural changes.

## Tasks

- [x] 1. Add queue state and `QueuedMessage` type to `ChatView`
  - Add `interface QueuedMessage { text: string; agentMessage: Message }` (can be a local interface in `chat-view.ts`)
  - Add `private messageQueue: QueuedMessage[] = []` to `ChatView`
  - Add `private queueIndicator: HTMLElement | null = null` to `ChatView`
  - _Requirements: 1.1, 1.3, 1.6_

- [x] 2. Implement `dispatchTurn()` and `dequeueAndDispatch()` helpers
  - [x] 2.1 Implement `dispatchTurn(text: string, agentMessage: Message): Promise<void>`
    - Capture `turnSessionId = this.currentSessionId!` at call time
    - Set `isProcessing = true`, call `updateInputState()`
    - `await this.sessionManager!.sendPrompt(turnSessionId, [agentMessage])`
    - On success: call `finalizeStreamingMessage()` only if `turnSessionId === this.currentSessionId`
    - On error: display error only if `turnSessionId === this.currentSessionId` and not a user-cancelled stop
    - In `finally`: set `isProcessing = false`, call `updateInputState()`, call `dequeueAndDispatch()`
    - _Requirements: 1.4, 4.1, 4.2, 4.3_

  - [ ]* 2.2 Write property test for stale-turn suppression (Property 10)
    - `// Feature: message-queue-session-handling, Property 10: Stale turn finalisation and errors are suppressed`
    - Generate random `turnSessionId` / `currentSessionId` pairs where they differ; assert neither `finalizeStreamingMessage` nor error display executes
    - **Validates: Requirements 4.1, 4.2**

  - [x] 2.3 Implement `dequeueAndDispatch(): void`
    - If `messageQueue.length > 0` and `this.currentSessionId` is still the active session, call `queue.shift()` and call `dispatchTurn(next.text, next.agentMessage)`
    - Call `updateQueueIndicator()` after shifting
    - _Requirements: 1.4, 5.1_

  - [ ]* 2.4 Write property test for queue drain (Property 3)
    - `// Feature: message-queue-session-handling, Property 3: Queue drains to zero after turn completion`
    - Generate random non-empty queues; simulate sequential turn completions; assert `messageQueue.length === 0` after all turns resolve
    - **Validates: Requirements 1.4**

- [x] 3. Update `handleSendMessage()` to enqueue when busy
  - If `isProcessing || messageQueue.length > 0`: push `{ text, agentMessage: userMessageForAgent }` onto `messageQueue`, call `displayMessage(userMessageForUI)`, call `updateQueueIndicator()`, and return early
  - Otherwise: call `displayMessage(userMessageForUI)` then `dispatchTurn(text, userMessageForAgent)` (remove the inline `sendPrompt` block)
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]* 3.1 Write unit tests for `handleSendMessage()` enqueue path
    - Submitting while `isProcessing = true` enqueues the message and renders the bubble immediately
    - Submitting while queue is non-empty also enqueues
    - Submitting while idle and queue empty calls `dispatchTurn` directly
    - _Requirements: 1.1, 1.3, 1.5_

  - [ ]* 3.2 Write property test for queue growth (Property 1)
    - `// Feature: message-queue-session-handling, Property 1: Queue grows by exactly one on enqueue`
    - Generate random queue states with `isProcessing = true`; submit one message; assert `messageQueue.length` increased by exactly 1
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 3.3 Write property test for FIFO render order (Property 4)
    - `// Feature: message-queue-session-handling, Property 4: Messages rendered in FIFO order`
    - Generate random sequences of messages submitted during a mock in-flight turn; assert DOM order of user bubbles matches submission order
    - **Validates: Requirements 1.5, 5.1**

- [x] 4. Implement `updateQueueIndicator()`
  - Create `queueIndicator` element lazily inside `inputContainer` if it does not exist
  - Show element with pending count text when `messageQueue.length > 0`; hide when `messageQueue.length === 0`
  - _Requirements: 1.6, 5.3_

  - [ ]* 4.1 Write property test for indicator visibility (Property 5 / Property 8)
    - `// Feature: message-queue-session-handling, Property 5: Queue indicator visibility matches queue length`
    - Generate random queue lengths (0–20); assert indicator is visible iff `length > 0`
    - **Validates: Requirements 1.6, 5.3**

- [x] 5. Update `updateInputState()` for new send-button states
  - Keep `inputField.disabled` as `false` whenever `connectionStatus.connected` is true (remove the `|| this.isProcessing` condition from `inputField.disabled`)
  - Send button icon: `square` only when `isProcessing && messageQueue.length === 0`; `arrow-right` in all other cases
  - Send button `disabled`: true only when disconnected or (not processing and input empty)
  - Update `setupEventListeners` send-button click handler: cancel only when `isProcessing && messageQueue.length === 0`; otherwise call `handleSendMessage()`
  - _Requirements: 1.2, 2.1, 2.2, 2.3_

  - [ ]* 5.1 Write unit tests for send button states
    - Not processing + empty input → arrow-right, disabled
    - Not processing + non-empty input → arrow-right, enabled
    - Processing + queue empty → square, enabled
    - Processing + queue non-empty → arrow-right, enabled
    - Disconnected → arrow-right, disabled
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 5.2 Write property test for button state consistency (Property 7)
    - `// Feature: message-queue-session-handling, Property 7: Send button state is consistent with processing and queue state`
    - Generate random `(isProcessing, queueLength, inputEmpty, connected)` tuples; assert icon and disabled match the state table
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 5.3 Write property test for input field enabled while processing (Property 2)
    - `// Feature: message-queue-session-handling, Property 2: Input field stays enabled while processing`
    - Generate random states with `isProcessing = true` and `connected = true`; assert `inputField.disabled === false`
    - **Validates: Requirements 1.2**

- [ ] 6. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add `sessionId` guard to `handleStreamingChunk()`
  - At the top of the method (after the null check), add: `if (sessionId !== this.currentSessionId) return`
  - _Requirements: 3.2, 3.3_

  - [ ]* 7.1 Write unit tests for `handleStreamingChunk()` session guard
    - Chunk with matching `sessionId` renders into `messagesContainer`
    - Chunk with mismatched `sessionId` produces no DOM change
    - _Requirements: 3.2, 3.3_

  - [ ]* 7.2 Write property test for stale chunk DOM isolation (Property 8)
    - `// Feature: message-queue-session-handling, Property 8: Stale streaming chunks produce no DOM mutation`
    - Generate random chunks with random `sessionId`s; assert only matching-session chunks mutate `messagesContainer`
    - **Validates: Requirements 3.2, 3.3**

- [x] 8. Update `initializeNewConversation()` (called by `startNewConversation()`)
  - Clear `messageQueue = []` before calling `ensureSession()`
  - Call `updateQueueIndicator()` to hide the badge
  - Clear any in-progress streaming element from `messagesContainer` (remove `.streaming-message` node if present)
  - Reset `ensureSessionPromise = null` and `currentSessionId = null` so the new session gets a fresh ID
  - _Requirements: 1.7, 3.1, 3.4_

  - [ ]* 8.1 Write unit test for `initializeNewConversation()` queue clear
    - Pre-populate queue; call `initializeNewConversation()`; assert `messageQueue.length === 0`
    - _Requirements: 1.7_

  - [ ]* 8.2 Write property test for new-session queue clear (Property 6)
    - `// Feature: message-queue-session-handling, Property 6: New session clears the queue`
    - Generate random non-empty queues; call `initializeNewConversation()`; assert `messageQueue.length === 0`
    - **Validates: Requirements 1.7**

  - [ ]* 8.3 Write property test for input enabled after session switch (Property 11)
    - `// Feature: message-queue-session-handling, Property 11: Input field remains enabled after session switch during in-flight turn`
    - Generate states with `isProcessing = true`; call `initializeNewConversation()`; assert `inputField.disabled === false` immediately after
    - **Validates: Requirements 4.3**

- [x] 9. Verify `SessionManagerImpl` forwards `sessionId` on every chunk callback
  - Read `handleStreamingUpdate` in `src/core/session-manager.ts` and confirm every `onStreamingChunk` call passes `sessionId` as the first argument
  - No code change expected; add a comment if the forwarding is already correct
  - _Requirements: 3.5, 3.7_

  - [ ]* 9.1 Write property test for sessionId forwarding (Property 9)
    - `// Feature: message-queue-session-handling, Property 9: SessionManager forwards sessionId on every chunk callback`
    - Generate random `session/update` notification params with varying `sessionId`s; assert `onStreamingChunk` is always called with the matching `sessionId`
    - **Validates: Requirements 3.5, 3.7**

- [ ] 10. Write property test for no bubble re-render on dispatch (Property 12)
  - `// Feature: message-queue-session-handling, Property 12: Dispatching a queued message does not re-render its bubble`
  - Generate messages rendered at submission time; dequeue and dispatch them; assert user bubble count for that text does not increase
  - **Validates: Requirements 5.2**

- [ ] 11. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All property-based tests use `fast-check` with a minimum of 100 iterations (`fc.assert(fc.property(...), { numRuns: 100 })`)
- Each property test is tagged with `// Feature: message-queue-session-handling, Property N: <text>`
- `dispatchTurn` captures `turnSessionId` at call time — this local variable is the sole mechanism for stale-turn suppression (Properties 10, 11)
- `SessionManagerImpl` requires no structural changes; the `sessionId` is already forwarded in every `onStreamingChunk` call
