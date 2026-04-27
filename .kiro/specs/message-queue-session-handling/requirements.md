# Requirements Document

## Introduction

This feature adds two improvements to the Obsidian ACP chat plugin:

1. **Message Queuing**: Users can type and submit the next message while the current request is still being processed by the agent. Queued messages are held and dispatched automatically once the active request completes, preserving conversation flow without forcing the user to wait. 

2. **Session Isolation for Streaming**: When a new session is started (via "New Conversation"), any in-flight streaming chunks from the previous session must not appear in the new session's UI, but should continue feeding in the session in the background. Currently, old-session chunks continue to render into the chat view after a session switch.

## Glossary

- **Chat_View**: The Obsidian `ItemView` component (`src/ui/chat-view.ts`) that renders the chat UI and handles user input.
- **Session_Manager**: The `SessionManagerImpl` class (`src/core/session-manager.ts`) that manages ACP session lifecycle and routes streaming updates.
- **Message_Queue**: An ordered list of pending user messages that have been submitted but not yet dispatched to the agent.
- **Active_Session_ID**: The session identifier currently bound to the Chat_View, set when a session is created or switched.
- **Streaming_Chunk**: A partial content update delivered via `session/update` notification during an active agent turn.
- **Current_Turn**: The single in-flight `session/prompt` request that is actively being processed by the agent.
- **Stale_Chunk**: A Streaming_Chunk whose `sessionId` does not match the Active_Session_ID at the time the chunk is received by the Chat_View.

---

## Requirements

### Requirement 1: Message Queue — Accepting Messages During Processing

**User Story:** As a user, I want to type and send my next message while the agent is still responding, so that I can maintain my train of thought without waiting for the current response to finish.

#### Acceptance Criteria

1. WHILE the Chat_View is processing a Current_Turn, THE Chat_View SHALL accept and enqueue submitted messages rather than discarding them.
2. WHILE the Chat_View is processing a Current_Turn, THE Chat_View SHALL keep the input field enabled so the user can compose and submit messages.
3. WHEN a message is submitted and the Message_Queue is non-empty or a Current_Turn is active, THE Chat_View SHALL append the message to the Message_Queue.
4. WHEN a Current_Turn completes (successfully or with an error), THE Chat_View SHALL dequeue the next message from the Message_Queue and dispatch it as a new turn.
5. THE Chat_View SHALL display each queued message in the chat timeline immediately upon submission, in the order submitted, before the agent responds to it.
6. WHEN the Message_Queue contains one or more messages, THE Chat_View SHALL display a visual indicator showing the number of pending queued messages.
7. WHEN a new session is started, THE Chat_View SHALL discard all messages currently in the Message_Queue.

---

### Requirement 2: Message Queue — Send Button Behaviour

**User Story:** As a user, I want the send button to reflect whether I can send or cancel, so that I always have clear control over the conversation.

#### Acceptance Criteria

1. WHILE the Chat_View is processing a Current_Turn and the Message_Queue is empty, THE Chat_View SHALL display the send button in "cancel" state (stop icon) to allow cancellation.
2. WHILE the Chat_View is processing a Current_Turn and the Message_Queue is non-empty, THE Chat_View SHALL display the send button in "send" state (arrow icon) to allow queuing additional messages.
3. WHEN the input field is empty and no Current_Turn is active, THE Chat_View SHALL disable the send button.

---

### Requirement 3: Session Isolation — Discarding Stale Streaming Chunks

**User Story:** As a user, I want starting a new conversation to immediately show a clean chat, so that responses from the previous session never appear in the new session's UI.

#### Acceptance Criteria

1. WHEN a new session is started, THE Chat_View SHALL record the new Active_Session_ID before any streaming chunks from the new session can arrive.
2. WHEN a Streaming_Chunk is received by the Chat_View, THE Chat_View SHALL compare the chunk's `sessionId` to the Active_Session_ID.
3. IF a Streaming_Chunk's `sessionId` does not match the Active_Session_ID, THEN THE Chat_View SHALL silently discard the chunk without rendering it, while the previous session's agent processing continues uninterrupted in the background.
4. WHEN a new session is started, THE Chat_View SHALL clear any in-progress streaming message element from the UI before rendering new content.
5. THE Session_Manager SHALL forward the `sessionId` field on every Streaming_Chunk callback so the Chat_View can perform session identity checks.
6. WHEN a new session is started, THE Session_Manager SHALL continue processing and receiving Streaming_Chunks for the previous session without cancelling or interrupting the underlying agent turn.
7. WHILE a previous session's agent turn is still in-flight after a new session has been started, THE Session_Manager SHALL route Streaming_Chunks for the previous session to the Chat_View with the original `sessionId`, allowing the Chat_View to identify and discard them.

---

### Requirement 4: Session Isolation — Stale Turn Completion

**User Story:** As a user, I want finalisation logic from an old session (markdown rendering, error display) to be suppressed after I start a new session, so that the new session's UI is not polluted.

#### Acceptance Criteria

1. WHEN a `session/prompt` call resolves or rejects for a session that is no longer the Active_Session_ID, THE Chat_View SHALL suppress the finalisation of any streaming message element for that stale turn.
2. IF a `session/prompt` call for a stale session resolves with an error, THEN THE Chat_View SHALL not display the error message in the UI.
3. WHEN a new session is started while a Current_Turn is in-flight, THE Chat_View SHALL not await or block on the completion of the stale turn before accepting new user input.

---

### Requirement 5: Queue Visibility and Ordering

**User Story:** As a user, I want to see my queued messages appear in the chat in the order I sent them, so that the conversation history is coherent.

#### Acceptance Criteria

1. THE Chat_View SHALL display queued user messages in the chat timeline in first-in, first-out (FIFO) order.
2. WHEN a queued message is dispatched as a new turn, THE Chat_View SHALL not re-render the user message bubble (it was already rendered at submission time).
3. IF the Message_Queue is empty and no Current_Turn is active, THEN THE Chat_View SHALL hide the queue indicator.
