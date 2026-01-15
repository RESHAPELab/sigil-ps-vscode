# SIGIL-PS
SIGIL-PS, Stepwise Instructional Guide for Independently Learning Programming Skills (or just "Sigil") is a LLM-based conversational agent for VS Code intended for use by novice programming students. To best serve this population, it implements guards to coach, model, and scaffold computational thinking skills.

## Features

### VSCode Chat Participant
This extension contributes a chat participant for VSCode's native Chat view, which implements the intended behavior through a third-party backend. The extension works entirely independently of GitHub Copilot.

### File Context
Sigil automatically includes context from your files in the following ways:
1. **Current File**: The extension automatically includes the content of the file you are currently working on. If you have text selected, only the selected portion is included. If no text is selected, the entire file is included.
2. **Additional Files**: You can attach additional files to your chat message using VSCode's native chat interface. Use the file attachment button in the chat input area, or drag and drop files into the chat. These files will be automatically included as context for Sigil.

## Requirements

- [VS Code](https://code.visualstudio.com/download)
- [Node.js with npm/npx](https://nodejs.org/en/download/package-manager)

## For Developers

### Getting Started

Before you get started, make sure you have Node.js, npm/npx, and VS Code installed.

Once you've cloned the repository to your local machine, navigate to the directory and run `npm install` to set up your environment with all of the required packages.

### Configuring the extension

Before running the extension, you'll have to set up a `config.ts` file. Copy `src/config.template.ts`, rename it to `config.ts`, and fill in the required values.

### Running and Debugging the Extension

Once everything is set up, open the project in VS Code. Navigate to the "Run and Debug" tab by clicking the icon or by pressing `Ctrl+Shift+D`. Ensure the "Run Extension" option is selected in the dropdown and click the play button, or press `F5`. A new VS Code window should open up, which will be running the extension.

![Run and Debug Panel](/images/how_to_run.png)

In this new window, open VSCode's Chat view by going to **View > Chat** or pressing `Ctrl+L` (or `Cmd+L` on Mac). Type `@sigil-ps` before your message to interact with Sigil. If everything is set up correctly, it should be automatically highlighted, as shown below.

![Talking to Sigil](/images/chat_panel.png)

## Extension Settings

This extension provides the following settings:

- `sigil.persona`: The persona that Sigil will embody in its responses (default: "Default")
- `sigil.personalizeResponses`: Enable personalized responses based on feedback
- `sigil.personalizedPrompt`: Custom preferences for tailoring Sigil's responses
- `sigil.fieldStudyOptIn`: Consent to anonymous use of interactions in research publications

## Known Issues

None yet.

## Release Notes

This project is a Work In Progress.

## Following Extension Guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for developing this extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)