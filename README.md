# SIGIL-PS
SIGIL-PS, Stepwise Instructional Guide for Independently Learning Programming Skills (or just "Sigil") is a LLM-based conversational agent for VS Code intended for use by novice programming students. To best serve this population, it implements guards to coach, model, and scaffold computational thinking skills.

## Features

### Copilot Chat Participant
This extension contributes a chat participant for Copilot, which implements the intended behavior through a third-party backend.

### File Context
Sigil can currently accept context from your files in two different ways:
1. You can provide the content of the file you are currently working on, as indicated by the "Current file" label in the Copilot window. You can also focus on a specific part of your code by simply highlighting it.
2. You can explicitly reference other files in your message by typing `#` and then the file name. When you do this, an autocomplete should appear to help you select files.

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

In this new window, [open a Copilot window](https://code.visualstudio.com/docs/copilot/getting-started-chat#:~:text=Press%20Ctrl%2BI%20on%20your,make%20the%20port%20number%20configurable.), and type `@sigil-ps` before your message. If everything is set up correctly, it should be automatically highlighted, as shown below.

![Talking to Sigil](/images/chat_panel.png)

## Extension Settings

As of now, this extension does not contribute any settings.

## Known Issues

None yet.

## Release Notes

This project is a Work In Progress.

## Following Extension Guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for developing this extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)