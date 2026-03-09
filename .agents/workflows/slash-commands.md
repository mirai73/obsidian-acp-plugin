---
description: Implement a new Slash Command in the ACP Chat View
---

Follow these steps to add a new command to the `/` dropdown manually:

1.  **Define the Command in `ChatView.ts`**:
    Add the new command to the `commands` array at the top of the `ChatView` class:
    ```typescript
    private readonly commands = [
      ...
      { text: 'Custom Action', command: '/custom' },
      ...
    ];
    ```

2.  **Define the Keyboard Behavior (Optional)**:
    If the command requires specific keyboard interactions, update `navigateCommandDropdown` or ensure the `Enter` handler correctly captures it.

3.  **Implement the Command's Business Logic**:
    Update `handleSlashCommand` to include a case for your new command:
    ```typescript
    private async handleSlashCommand(text: string): Promise<void> {
      const parts = text.split(' ');
      const command = parts[0].toLowerCase();
      
      switch (command) {
        ...
        case '/custom':
          // Your custom logic here
          break;
        ...
      }
    }
    ```

4.  **Test the Filter**:
    Type `/` and start typing the name or command key to ensure it appears correctly in the dropdown.
