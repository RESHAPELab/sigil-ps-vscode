# Tiamat VS Code
**Version: 0.2.0**

Tiamat is a LLM-based conversational agent for VS Code intended for use by novice programming students. To best serve this population, it implements guards to coach, model, and scaffold computational thinking skills.

## Features

### Copilot Chat Participant
This extension contributes a chat participant for Copilot, which implements the intended behavior through a third-party backend. Simply mention `@tiamat` before your chat message to activate it.

### File Context
Tiamat can currently accept context from your files in two different ways:
1. You can provide the content of the file you are currently working on, as indicated by the "Current file" label in the Copilot window. You can also focus on a specific part of your code by simply highlighting it.
2. You can explicitly reference other files in your message by typing `#` and then the file name. When you do this, an autocomplete should appear to help you select files.

## Requirements

- [VS Code](https://code.visualstudio.com/download)
- [Node.js with npm/npx](https://nodejs.org/en/download/package-manager)

## For Users

If you are here because you want to use this extension, here's how you install it.

### Obtain a .vsix file

In order to manually install the extension to VS Code, you will need a .vsix file. These can be found in the `/builds` directory of this repository. Download the file corresponding to the version you want, ideally the latest version. It will be named something like `tiamat-x.x.x.vsix`.

### Install the .vsix file

Once you have the file, follow these steps to install it:
1. Open VS Code
2. Open the Command Palette (`Ctrl+Shift+P` or `F1`)
3. Search for and select: Extensions: Install from VSIX...
4. Select the .vsix file you downloaded.
5. If prompted, restart VS Code.

### Confirm Installation

If the extension is installed successfully, a "Tiamat Personalization" option should appear in the status bar. Additionally, you can simply try prompting the chatbot to ensure it is working properly.

## For Developers

### Getting Started

Before you get started, make sure you have Node.js, npm/npx, and VS Code installed.

Once you've cloned the repository to your local machine, navigate to the directory and run `npm install` to set up your environment with all of the required packages.

### Configuring the extension

Before running the extension, you'll have to set up a `config.ts` file. Copy `src/config.template.ts`, rename it to `config.ts`, and fill in the required values.

### Running and Debugging the Extension

Once everything is set up, open the project in VS Code. Navigate to the "Run and Debug" tab by clicking the icon or by pressing `Ctrl+Shift+D`. Ensure the "Run Extension" option is selected in the dropdown and click the play button, or press `F5`. A new VS Code window should open up, which will be running the extension.

![Run and Debug Panel](/images/how_to_run.png)

In this new window, [open a Copilot window](https://code.visualstudio.com/docs/copilot/getting-started-chat#:~:text=Press%20Ctrl%2BI%20on%20your,make%20the%20port%20number%20configurable.), and type `@tiamat` before your message. If everything is set up correctly, it should be automatically highlighted, as shown below.

![Talking to Tiamat](/images/chat_panel.png)

## Extension Settings

This extension contributes a few settings related to personalization of the chatbot's behavior. These include:

- **Persona**: allows you to select different personas for the chatbot to embody. This could depend on factors such as your skill level, preferred personality, etc.
- **Personalized prompt**: allows you to set custom instructions for the chatbot to follow specifically for you, within its base guidelines.
- **Personalized responses**: when this is enabled, your personalized prompt will be used. Additionally, this will cuase your personalized prompt to change in order to better fit your needs whenever you provide feedback.

## Known Issues

None yet.

## Release Notes

This section provides a simple overview of changes that are being made to this extension with each release. See full [CHANGELOG.md](./CHANGELOG.md) for more details.

### 0.2.0
- Added persona support
- Introduced default “Tiamat” persona and an “Advanced” persona

### 0.1.0
- Initial release
- Basic chatbot functionality and personalization

## Questions?

If you have any questions, feel free to reach out to [@pehilbert](https://github.com/pehilbert).