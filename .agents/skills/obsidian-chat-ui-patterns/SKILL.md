# Obsidian Chat UI Patterns Skill

## Description:

Patterns and best practices for creating minimalist, high-performance chat interfaces within Obsidian, particularly for integration with the Agent Client Protocol (ACP).

## Patterns:

### 1. Compact Permission Requests

Always prefer a single-line, row-based layout for permission requests in the chat timeline.

- **Icon**: Use '⚠️' as a visual cue.
- **Summary**: Combine the operation and resource (e.g., `write_file: notes/project.md`).
- **Inline Actions**: Provide compact buttons like 'Allow Once' or 'Always Allow'.
- **Persistence**: Leave the row in the timeline after selection, replacing buttons with the user's choice (e.g., `(Allow Once)`).

### 2. Integrated Mode Selector

Position agent modes (Architect, Code, Debug, etc.) directly below the chat input.

- **Styling**: Minimalist text-only selector (uppercase, 8-10px font size).
- **Behavior**: Auto-switch modes based on the current session context but allow user override.

### 3. Proactive Lifecycles

Don't wait for user input to prepare the assistant.

- **Session Create**: Automatic session creation on chat view load or agent connection.
- **Auto-Connect**: Automatically start enabled agents on plugin startup using `onLayoutReady`.

### 4. Interactive Slash Commands

Provide immediate feedback when typing a trigger character.

- **Dropdown**: Show a filterable list when '/' is typed at the start of a message.
- **Navigation**: Support ArrowUp/ArrowDown, Enter, and Escape for keyboard-only interaction.
- **Cleanup**: Remove unnecessary icons from the command list to maintain a minimalist aesthetic.

### 5. Obsidian-Native Look & Feel

- Use `var(--acp-primary-color)` for accents.
- Use `mod-cta` for primary actions and `mod-warning` for deletions.
- Respect Obsidian's current theme (Light/Dark) via the `ThemeManager`.

---

_Created by Antigravity during the Obsidian-Sample-Plugin refinement phase._
