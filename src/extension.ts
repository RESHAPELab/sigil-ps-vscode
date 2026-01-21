import * as vscode from 'vscode';
import { post } from 'axios';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateWithGitHub } from './auth';
import { syncSigilSettings, updateOptIn, updatePersonalization } from './personalization';
import getApiUrl from "./apiConfig";
import { ChatViewProvider } from './chatViewProvider';
import { WebviewMessageHandler } from './webviewMessageHandler';

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

    // Create and register the chat view provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );

    // Set up webview message handler
    const messageHandler = new WebviewMessageHandler(context, chatViewProvider);
    
    // Set up message handler - it will be connected when the view is resolved
    chatViewProvider.setMessageHandler((message) => {
        messageHandler.handleMessage(message);
        // Initialize when webview sends ready message
        if (message.command === 'ready') {
            messageHandler.initialize();
        }
    });

    // Register command to focus/reveal the chat view
    const toggleCommand = vscode.commands.registerCommand('sigil-ps.toggleChat', () => {
        vscode.commands.executeCommand('workbench.view.extension.sigil-ps-sidebar');
    });

    context.subscriptions.push(toggleCommand);

    // Track code changes on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            messageHandler.recordCodeChange(document);
        })
    );

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
}

export function deactivate() { }

