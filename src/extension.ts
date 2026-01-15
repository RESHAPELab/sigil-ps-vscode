import * as vscode from 'vscode';
import { post } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticateWithGitHub } from './auth';
import { syncSigilSettings, updateOptIn, updatePersonalization } from './personalization';
import getApiUrl from "./apiConfig";

const MAX_HISTORY_LENGTH = 6;
const GOOD = 1;
const BAD = 0;
const GOOD_REASONS: string[] = ["Helpful", "Accurate", "Well Explained"];
const BAD_REASONS: string[] = ["Incorrect", "Not Helpful", "Confusing"];
const FEEDBACK_BUTTON_TEXT = "💬 Provide Feedback to Sigil";
const academicIntegrityWelcomeMessage = `SIGIL-PS Academic Integrity Notice

Welcome to SIGIL-PS, your course's approved tutoring assistant.

This tool was designed to support your learning by providing guided help based on research into how computer science students best seek help. You are encouraged to use SIGIL-PS whenever you need assistance.

⚠️ Important: Using unapproved AI tools such as GitHub Copilot, ChatGPT, or other code-generation assistants may constitute an academic integrity violation in this course. These tools can provide solutions without supporting your learning, and their use may be indistinguishable from plagiarism.

✅ What you should do:
Use SIGIL-PS to ask questions, get hints, and develop understanding.
Follow its guidance to practice problem solving, rather than copying answers.
Reach out to your instructor if you're unsure about what tools are allowed.

By continuing, you acknowledge that you understand these guidelines and agree to use SIGIL-PS responsibly.`;

// Webview panel variable
let sigilWebviewPanel: vscode.WebviewPanel | undefined = undefined;
let conversationHistory: Array<{ role: string; content: string; files?: string[] }> = [];
let currentConversationId: string | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    // Display a welcome pop-up to guide users on getting started with Sigil
    if (!context.globalState.get('sigilPSHasShownWelcome')) {
        vscode.window.showInformationMessage(academicIntegrityWelcomeMessage, { modal: true });
        context.globalState.update('sigilPSHasShownWelcome', true);
    }

    // Logic for collecting and sending feedback to the server
    vscode.commands.registerCommand('sigil-ps.handleFeedback', async (args) => {
        try {
            console.log('Arguments:', args);

            const rating = await vscode.window.showQuickPick(['Good', 'Bad'], {
                placeHolder: 'How was the response?'
            });

            if (!rating) {
                return;
            }

            const ratingEnum = rating === 'Good' ? GOOD : BAD;

            const reasons = ratingEnum === GOOD ? [...GOOD_REASONS, "Other"] : [...BAD_REASONS, "Other"];

            const selectedReason = await vscode.window.showQuickPick(reasons, {
                placeHolder: `Why was this response ${rating}?`
            });

            let customReason = selectedReason;
            if (selectedReason === "Other") {
                customReason = await vscode.window.showInputBox({
                    placeHolder: "Please provide additional details"
                });
            }

            if (!customReason) {
                return;
            }

            let config = vscode.workspace.getConfiguration();
            let personalize = config.get<boolean>("sigil.personalizeResponses");

            const apiResponse = await post(`${getApiUrl()}/api/feedback`, { rating: ratingEnum, reason: customReason, personalize, ...args });
            console.log('API Response:', apiResponse.data);

            if (personalize) {
                await syncSigilSettings(context);

                vscode.window.showInformationMessage(
                    'Thank you for your feedback! Personalization has been updated.',
                    'Open Personalization Settings'
                ).then(selection => {
                    if (selection === 'Open Personalization Settings') {
                        vscode.commands.executeCommand('sigil-ps.openPersonalization');
                    }
                }
                );
            } else {
                vscode.window.showInformationMessage("Thank you for your feedback!");
            }

        } catch (error) {
            console.error('Error posting feedback:', error);
            vscode.window.showErrorMessage('An error occurred while posting feedback. Please try again later.');
        }
    });

    // Handles responses to chat prompts
    const chatHandler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
        console.log("User message:", request.prompt);
        console.log("Token:", token);
        console.log("References:", request.references);
        console.log("Context:", chatContext);

        let code = "";

        // Automatically include current file and selection context (replaces Copilot's "Current file" feature)
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const document = activeEditor.document;
            const selection = activeEditor.selection;
            const fileName = document.fileName.split(/[/\\]/).pop() || document.fileName;

            // Check if there's a selection (non-empty)
            if (!selection.isEmpty) {
                const selectedText = document.getText(selection);
                code += `Current file selection (${fileName}):\n${selectedText}\n\n`;
            } else {
                // If no selection, include the entire current file
                const fullText = document.getText();
                code += `Current file (${fileName}):\n${fullText}\n\n`;
            }
        }

        console.log("\nRelevant references: ");

        // Process file references from VSCode's native chat UI (drag-and-drop, file picker, etc.)
        request.references.forEach((ref) => {
            if (ref.value instanceof vscode.Location) {
                console.log(ref, "is a Location");
                console.log(ref.id, "-", ref.value);

                const uri = ref.value.uri;
                const range = ref.value.range;

                // Use VSCode's native workspace API to find the document
                const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());

                if (document) {
                    const fileName = uri.path.split("/").pop() || uri.path.split("\\").pop() || uri.fsPath;
                    const selectedText = document.getText(range);
                    code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + "):\n" + selectedText + "\n";
                } else {
                    // If document isn't open, try to read from filesystem using native Node.js APIs
                    try {
                        const fileContent = fs.readFileSync(uri.fsPath, 'utf8');
                        const fileName = uri.path.split("/").pop() || uri.path.split("\\").pop() || uri.fsPath;
                        // Extract the range if possible, otherwise include full file
                        if (range && !range.isEmpty) {
                            const lines = fileContent.split('\n');
                            const rangeText = lines.slice(range.start.line, range.end.line + 1).join('\n');
                            code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + "):\n" + rangeText + "\n";
                        } else {
                            code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + "):\n" + fileContent + "\n";
                        }
                    } catch (error) {
                        console.error("Error reading file:", error);
                    }
                }
            } else if (ref.value instanceof vscode.Uri) {
                console.log(ref, "is a URI");
                console.log(ref.id, "-", ref.value);

                const uri = ref.value;

                try {
                    // Use native Node.js filesystem API to read file content
                    const fileContent = fs.readFileSync(uri.fsPath, 'utf8');
                    const fileName = uri.path.split("/").pop() || uri.path.split("\\").pop() || uri.fsPath;
                    code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + "):\n" + fileContent + "\n";
                } catch (error) {
                    console.error("Error reading file:", error);
                    // Try to find it in open documents as fallback
                    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
                    if (document) {
                        const fileName = uri.path.split("/").pop() || uri.path.split("\\").pop() || uri.fsPath;
                        code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + "):\n" + document.getText() + "\n";
                    }
                }
            }
        });
        console.log("Final code:");
        console.log(code);

        let history: string[] = [];
        let conversationId: string | undefined = undefined;

        chatContext.history.slice(-MAX_HISTORY_LENGTH).forEach((item) => {
            if (item instanceof vscode.ChatRequestTurn) {
                history.push("User: " + item.prompt);
            } else if (item instanceof vscode.ChatResponseTurn) {
                let fullMessage = '';
                item.response.forEach(r => {
                    const mdPart = r as vscode.ChatResponseMarkdownPart;

                    let content = mdPart.value.value;

                    if (content) {
                        const match = content.match(/\[\]\( conversation_id:(\S+) \)/);

                        if (match && !conversationId) {
                            conversationId = match[1] ?? undefined;
                            content = content.replace(/\[\]\( conversation_id:(\S+) \)/, '');
                        }

                        fullMessage += content;
                    }
                });

                history.push("Sigil: " + fullMessage);
            }
        });

        console.log("Chat history:", history);

        let githubUser = await authenticateWithGitHub(context);

        if (!githubUser) {
            vscode.window.showErrorMessage("Sigil: Authentication required to chat");
            return;
        }

        let config = vscode.workspace.getConfiguration();
        let personalize = config.get<boolean>("sigil.personalizeResponses");

        let personaConfig = config.inspect("sigil.persona");
        let defaultPersona = personaConfig?.defaultValue;
        let chosenPersona = config.get<string>("sigil.persona");

        console.log("Persona config:", personaConfig);

        let persona = undefined;

        if (chosenPersona !== defaultPersona) {
            persona = chosenPersona;
        }

        try {
            // if we didn't find conversation ID in the history, create a new one in this message
            if (!conversationId) {
                conversationId = uuidv4();
                // this is so silly but we put the conversation id as a blank link that won't show up in MD
                stream.markdown(`[]( conversation_id:${conversationId} )`);
            }

            // get Sigil response
            const apiResponse = await post(`${getApiUrl()}/api/prompt`,
                {
                    userID: githubUser?.id, conversationID: conversationId,
                    code, message: request.prompt, history, personalize, persona, logChat: true,
                    userMetaData: {
                        login: githubUser.login,
                        email: githubUser.email,
                        name: githubUser.name
                    }
                });
            stream.markdown(apiResponse.data.response);

            // set up feedback button
            var args = {
                userID: githubUser?.id, conversationID: conversationId,
                code: code, message: request.prompt, response: apiResponse.data.response
            };
            stream.button({
                command: 'sigil-ps.handleFeedback',
                title: vscode.l10n.t(FEEDBACK_BUTTON_TEXT),
                arguments: [args]
            });
        } catch (err) {
            console.log(err);
            stream.markdown("I'm sorry, I'm having trouble connecting to the server. Please try again later.");
        }

        return;
    };

    // create participant
    const tutor = vscode.chat.createChatParticipant("sigil-ps.Sigil", chatHandler);

    // add icon to participant
    tutor.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images/avatar.jpeg');

    // Personalization management

    // Sync user settings with backend
    syncSigilSettings(context);

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('sigil.personalizedPrompt')) {
            const config = vscode.workspace.getConfiguration();
            const personalization = config.get<string>('sigil.personalizedPrompt');

            if (personalization) {
                updatePersonalization(context, personalization);
            }
        }

        if (e.affectsConfiguration('sigil.fieldStudyOptIn')) {
            const config = vscode.workspace.getConfiguration();
            const newOptIn = config.get<boolean>('sigil.fieldStudyOptIn');

            if (newOptIn !== undefined) {
                updateOptIn(context, newOptIn);
            }
        }
    });

    // Allow user to manage personalization
    context.subscriptions.push(
        vscode.commands.registerCommand('sigil-ps.openPersonalization', async () => {
            console.log("API URL:", getApiUrl());
            vscode.window.showInformationMessage('Opening Sigil Personalization settings...');

            await syncSigilSettings(context);

            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                '@ext:RESHAPELab.sigil-ps'
            );
        })
    );

    const personalizationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    personalizationStatusBarItem.text = '$(gear) Sigil Personalization';
    personalizationStatusBarItem.tooltip = 'View or modify your personalization settings for Sigil';
    personalizationStatusBarItem.command = 'sigil-ps.openPersonalization';
    personalizationStatusBarItem.show();

    context.subscriptions.push(personalizationStatusBarItem);

    // Register command to open Sigil chat webview
    context.subscriptions.push(
        vscode.commands.registerCommand('sigil-ps.openChat', () => {
            getOrCreateWebviewPanel(context);
        })
    );
}

// Function to create/return webview panel
function getOrCreateWebviewPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
    if (sigilWebviewPanel) {
        sigilWebviewPanel.reveal();
        return sigilWebviewPanel;
    }

    const panel = vscode.window.createWebviewPanel(
        'sigilChat',
        'Sigil Chat',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        }
    );

    panel.webview.html = getWebviewContent(context, panel.webview);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await handleWebviewMessage(context, message.text, message.attachedFiles || []);
                    break;
                case 'attachFile':
                    await handleFileAttachment(panel);
                    break;
                case 'getCurrentFile':
                    await sendCurrentFileContext(panel);
                    break;
                case 'provideFeedback':
                    await handleWebviewFeedback(message.args);
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    panel.onDidDispose(() => {
        sigilWebviewPanel = undefined;
    }, null, context.subscriptions);

    sigilWebviewPanel = panel;
    return panel;
}

// Function to get webview HTML content
function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'main.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Sigil Chat</title>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h2>Sigil - Your Programming Tutor</h2>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <div class="chat-input-container">
            <div class="file-attachments" id="file-attachments"></div>
            <div class="input-row">
                <button id="attach-file-btn" class="attach-btn" title="Attach File">📎</button>
                <button id="attach-current-file-btn" class="attach-btn" title="Include Current File">📄</button>
                <textarea id="message-input" placeholder="Ask Sigil a question..."></textarea>
                <button id="send-btn">Send</button>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
}

// Handle messages from webview
async function handleWebviewMessage(context: vscode.ExtensionContext, messageText: string, attachedFiles: string[]) {
    if (!sigilWebviewPanel) {
        return;
    }

    // Add user message to chat
    sigilWebviewPanel.webview.postMessage({
        command: 'addMessage',
        role: 'user',
        content: messageText,
        files: attachedFiles
    });

    conversationHistory.push({ role: 'user', content: messageText, files: attachedFiles });

    // Get current file context
    let code = "";
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const document = activeEditor.document;
        const selection = activeEditor.selection;
        const fileName = document.fileName.split(/[/\\]/).pop() || document.fileName;

        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            code += `Current file selection (${fileName}):\n${selectedText}\n\n`;
        } else {
            const fullText = document.getText();
            code += `Current file (${fileName}):\n${fullText}\n\n`;
        }
    }

    // Process attached files
    for (const filePath of attachedFiles) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const fileName = path.basename(filePath);
            code += `\nFile: ${fileName}\n${fileContent}\n\n`;
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
        }
    }

    // Show loading indicator
    sigilWebviewPanel.webview.postMessage({
        command: 'addMessage',
        role: 'assistant',
        content: 'Thinking...',
        loading: true
    });

    // Authenticate and send to API
    const githubUser = await authenticateWithGitHub(context);
    if (!githubUser) {
        sigilWebviewPanel.webview.postMessage({
            command: 'addMessage',
            role: 'error',
            content: 'Authentication required. Please sign in with GitHub.'
        });
        return;
    }

    try {
        if (!currentConversationId) {
            currentConversationId = uuidv4();
        }

        const config = vscode.workspace.getConfiguration();
        const personalize = config.get<boolean>("sigil.personalizeResponses");
        const personaConfig = config.inspect("sigil.persona");
        const chosenPersona = config.get<string>("sigil.persona");
        const persona = chosenPersona !== personaConfig?.defaultValue ? chosenPersona : undefined;

        // Build history from conversationHistory
        const history: string[] = [];
        conversationHistory.slice(-MAX_HISTORY_LENGTH).forEach((item) => {
            if (item.role === 'user') {
                history.push("User: " + item.content);
            } else if (item.role === 'assistant') {
                history.push("Sigil: " + item.content);
            }
        });

        const apiResponse = await post(`${getApiUrl()}/api/prompt`, {
            userID: githubUser.id,
            conversationID: currentConversationId,
            code,
            message: messageText,
            history,
            personalize,
            persona,
            logChat: true,
            userMetaData: {
                login: githubUser.login,
                email: githubUser.email,
                name: githubUser.name
            }
        });

        const responseContent = apiResponse.data.response;

        // Update message with response
        sigilWebviewPanel.webview.postMessage({
            command: 'updateLastMessage',
            content: responseContent,
            loading: false
        });

        // Add to conversation history
        conversationHistory.push({ role: 'assistant', content: responseContent });

        // Store feedback args for later use
        if (sigilWebviewPanel) {
            (sigilWebviewPanel as any).lastFeedbackArgs = {
                userID: githubUser.id,
                conversationID: currentConversationId,
                code: code,
                message: messageText,
                response: responseContent
            };
        }
    } catch (error) {
        console.error('Error:', error);
        sigilWebviewPanel.webview.postMessage({
            command: 'updateLastMessage',
            content: "I'm sorry, I'm having trouble connecting to the server. Please try again later.",
            loading: false
        });
    }
}

// Handle file attachment
async function handleFileAttachment(panel: vscode.WebviewPanel) {
    const files = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        openLabel: 'Attach to Sigil'
    });

    if (files && files.length > 0) {
        const filePaths = files.map(f => f.fsPath);
        panel.webview.postMessage({
            command: 'addAttachedFiles',
            files: filePaths
        });
    }
}

// Send current file context
async function sendCurrentFileContext(panel: vscode.WebviewPanel) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const document = activeEditor.document;
        const fileName = document.fileName.split(/[/\\]/).pop() || document.fileName;
        panel.webview.postMessage({
            command: 'addAttachedFiles',
            files: [document.fileName],
            label: `Current file: ${fileName}`
        });
    } else {
        vscode.window.showInformationMessage('No active file to attach.');
    }
}

// Handle feedback from webview
async function handleWebviewFeedback(args: any) {
    await vscode.commands.executeCommand('sigil-ps.handleFeedback', args);
}

export function deactivate() { }

