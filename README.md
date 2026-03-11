# ACP Chat Plugin for Obsidian

Agent Client Protocol (ACP) integration for Obsidian, enabling AI coding assistants to interact with your vault through a standardized JSON-RPC 2.0 interface. This plugin provides a rich frontend for bringing agentic capabilities directly into your Obsidian workflow.

## Features

- **Integrated Chat Interface**: Provides a natural conversational interface within a side-panel, making it easy to message your AI agent and receive responses inline.
- **Granular Permissions & Security**: The plugin prompts for confirmation when agents attempt to modify your files. Permission access requests are seamlessly integrated into the timeline. You can restrict agent file access to specific directories using lists of allowed, denied, and read-only paths.
- **File Systems Operations Handling**: Handlers to process and read/write text files securely alongside your Obsidian ecosystem, featuring tracking and undo operations.
- **Agent Lifecycle Management**: Start, stop, connect, and disconnect different local AI agents directly from the settings menu or the command palette.
- **Theme Awareness**: Dynamic light and dark theme capabilities that respect both the system preference and your active Obsidian theme.

## How to Configure

After installing and enabling the plugin, you can access the configuration by opening up Obsidian's settings and navigating to the **ACP Chat Plugin** tab.

### 1. Agents Configuration
You can register multiple local agents to connect to Obsidian via ACP. Provide the agent with a name, the executable command it uses to run, and any needed arguments.
- Enable/disable each agent on the fly.
- Provide environment variables or working directories for the agent run environment.

### 2. Permissions
Security is a top priority; AI assistants can read and write files on disk! Adjust your boundaries using these configuration options:
- **Allowed Paths**: Paths your agent can freely access.
- **Denied Paths**: Paths strict off-limits to the agent.
- **Read-Only Paths**: Paths the agent can read but not change.
- **Show Permission Dialog**: By default, you will be prompted to approve operations inside the chat interface. You can disable this if you completely trust your agent.
- **Log Operations**: Maintain a history of agent actions.

### 3. UI Settings
Customize the visual footprint to match your needs:
- Theme settings (dark, light, or auto) and custom colors.
- Adjust base font sizes to display chats more legibly.
- Toggle visibility of message timestamps.
- Enable rendering markdown responses inside the chat.

### 4. Connection Configuration
Configure the robustness of the connection with the running ACP clients.
- Auto-reconnect handling and intervals.
- Connection timeouts to prevent stalled commands.

## Available Commands

Use the Obsidian Command Palette (`Cmd/Ctrl + P`) to launch actions:
- `Open ACP Chat` / `Toggle ACP Chat Panel`: Quick bindings to reveal or focus the chat view.
- `Focus ACP Chat Input`: Directly set focus onto the message box.
- `Clear ACP Chat History`: Wipes the current chat history.
- `Connect / Disconnect All ACP Agents`: Batch lifecycle controls for your configured agents.
- `Undo Last ACP File Operation`: Roll back an unintended change from your agent.
- `Toggle ACP Theme`: Toggle light/dark UI themes dynamically.

## Installation

### Manually installing the plugin

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest GitHub Release.
2. Copy them into your vault's plugins folder: `[YourVault]/.obsidian/plugins/acp-chat-plugin/`.
3. Reload Obsidian and enable the **ACP Chat Plugin** under Settings > Community Plugins.

## Development

- Make sure you have NodeJS v16+ installed.
- Run `npm install` or `pnpm install` to download dependencies.
- Use `npm run dev` to start building and watching for changes.
- Ensure your plugin files are written/symlinked into the `.obsidian/plugins/` folder to test natively in Obsidian.
