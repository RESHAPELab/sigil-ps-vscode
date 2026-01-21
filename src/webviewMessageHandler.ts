import * as vscode from 'vscode';
import { post } from 'axios';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateWithGitHub, GitHubUser } from './auth';
import getApiUrl from './apiConfig';
import { ChatViewProvider } from './chatViewProvider';

const MAX_HISTORY_LENGTH = 6;
const GOOD = 1;
const BAD = 0;
const GOOD_REASONS: string[] = ["Helpful", "Accurate", "Well Explained"];
const BAD_REASONS: string[] = ["Incorrect", "Not Helpful", "Confusing"];

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    conversationId?: string;
}

export interface FileContext {
    fileName: string;
    content: string;
    isSelection: boolean;
}

export class WebviewMessageHandler {
    private conversationHistory: ChatMessage[] = [];
    private currentConversationId: string | undefined;
    private githubUser: GitHubUser | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private viewProvider: ChatViewProvider
    ) {
        this.setupMessageHandlers();
    }

    private setupMessageHandlers() {
        // Set up message handler in extension.ts
    }

    public async handleMessage(message: any) {
        try {
            switch (message.command) {
                case 'sendMessage':
                    await this.handleSendMessage(message.data);
                    break;
                case 'getFileContext':
                    await this.handleGetFileContext();
                    break;
                case 'submitFeedback':
                    await this.handleSubmitFeedback(message.data);
                    break;
                case 'requestAuth':
                    await this.handleRequestAuth();
                    break;
                case 'clearHistory':
                    this.handleClearHistory();
                    break;
                default:
                    console.warn('Unknown message command:', message.command);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.viewProvider.postMessage({
                command: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleRequestAuth() {
        this.githubUser = await authenticateWithGitHub(this.context);
        if (this.githubUser) {
            this.viewProvider.postMessage({
                command: 'authStatus',
                authenticated: true,
                user: {
                    login: this.githubUser.login,
                    name: this.githubUser.name
                }
            });
        } else {
            this.viewProvider.postMessage({
                command: 'authStatus',
                authenticated: false
            });
        }
    }

    private async handleSendMessage(data: { message: string; includeFileContext?: boolean }) {
        // Ensure authenticated
        if (!this.githubUser) {
            this.githubUser = await authenticateWithGitHub(this.context);
            if (!this.githubUser) {
                this.viewProvider.postMessage({
                    command: 'error',
                    error: 'Authentication required. Please sign in with GitHub.'
                });
                return;
            }
        }

        // Get file context if requested (default: filename-only; content only if explicitly enabled)
        let code = '';
        if (data.includeFileContext === true) {
            code = await this.getCurrentFileContext();
        } else {
            code = await this.getCurrentFileNameContext();
        }

        // Generate conversation ID if needed
        if (!this.currentConversationId) {
            this.currentConversationId = uuidv4();
        }

        // Add user message to history
        const userMessage: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: data.message,
            timestamp: Date.now(),
            conversationId: this.currentConversationId
        };
        this.conversationHistory.push(userMessage);

        // Send user message to webview
        this.viewProvider.postMessage({
            command: 'messageAdded',
            message: userMessage
        });

        // Prepare history for API
        const history: string[] = [];
        this.conversationHistory.slice(-MAX_HISTORY_LENGTH).forEach((msg) => {
            if (msg.role === 'user') {
                history.push(`User: ${msg.content}`);
            } else {
                history.push(`Sigil: ${msg.content}`);
            }
        });

        // Get configuration
        const config = vscode.workspace.getConfiguration();
        const personalize = config.get<boolean>("sigil.personalizeResponses");
        const personaConfig = config.inspect("sigil.persona");
        const defaultPersona = personaConfig?.defaultValue;
        const chosenPersona = config.get<string>("sigil.persona");
        const persona = chosenPersona !== defaultPersona ? chosenPersona : undefined;

        // Send loading state
        this.viewProvider.postMessage({
            command: 'loading',
            loading: true
        });

        try {
            // Call API
            const apiResponse = await post(`${getApiUrl()}/api/prompt`, {
                userID: this.githubUser.id,
                conversationID: this.currentConversationId,
                code,
                message: data.message,
                history,
                logChat: true,
                personalize,
                persona,
                userMetaData: {
                    login: this.githubUser.login,
                    email: this.githubUser.email,
                    name: this.githubUser.name
                }
            });

            // Add assistant message to history
            const assistantMessage: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: apiResponse.data.response,
                timestamp: Date.now(),
                conversationId: this.currentConversationId
            };
            this.conversationHistory.push(assistantMessage);

            // Send assistant message to webview
            this.viewProvider.postMessage({
                command: 'messageAdded',
                message: assistantMessage
            });

        // Send feedback data for this message
            this.viewProvider.postMessage({
                command: 'feedbackData',
                messageId: assistantMessage.id,
                data: {
                    userID: this.githubUser.id,
                    conversationID: this.currentConversationId,
                    code,
                    message: data.message,
                    response: apiResponse.data.response
                }
            });

        } catch (error) {
            console.error('Error sending message:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.viewProvider.postMessage({
                command: 'error',
                error: `Failed to send message: ${errorMessage}`
            });
        } finally {
            this.viewProvider.postMessage({
                command: 'loading',
                loading: false
            });
        }
    }

    private async handleGetFileContext() {
        const activeEditor = vscode.window.activeTextEditor;
        
        if (activeEditor) {
            const fileName = activeEditor.document.fileName.split(/[/\\]/).pop() || activeEditor.document.fileName;
            const isSelection = !activeEditor.selection.isEmpty;
            
            this.viewProvider.postMessage({
                command: 'fileContext',
                context: {
                    fileName,
                    content: '',
                    isSelection
                }
            });
        } else {
            this.viewProvider.postMessage({
                command: 'fileContext',
                context: null
            });
        }
    }

    private async getCurrentFileNameContext(): Promise<string> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return '';

        const document = activeEditor.document;
        const selection = activeEditor.selection;
        const fileName = document.fileName.split(/[/\\]/).pop() || document.fileName;

        if (!selection.isEmpty) {
            return `Current file selection (${fileName}): [selection omitted]\n\n`;
        }

        return `Current file (${fileName}): [content omitted]\n\n`;
    }

    private async getCurrentFileContext(): Promise<string> {
        let code = '';
        const activeEditor = vscode.window.activeTextEditor;
        
        if (activeEditor) {
            const document = activeEditor.document;
            const selection = activeEditor.selection;
            const fileName = document.fileName.split(/[/\\]/).pop() || document.fileName;

            if (!selection.isEmpty) {
                const selectedText = document.getText(selection);
                code = `Current file selection (${fileName}):\n${selectedText}\n\n`;
            } else {
                const fullText = document.getText();
                code = `Current file (${fileName}):\n${fullText}\n\n`;
            }
        }

        return code;
    }

    private async handleSubmitFeedback(data: {
        messageId: string;
        rating: 'good' | 'bad';
        reason: string;
    }) {
        if (!this.githubUser) {
            this.viewProvider.postMessage({
                command: 'error',
                error: 'Authentication required for feedback'
            });
            return;
        }

        // Find the message in history
        const message = this.conversationHistory.find(m => m.id === data.messageId);
        if (!message || message.role !== 'assistant') {
            this.viewProvider.postMessage({
                command: 'error',
                error: 'Message not found'
            });
            return;
        }

        // Find the previous user message
        const userMessageIndex = this.conversationHistory.findIndex(
            (m, i) => i < this.conversationHistory.indexOf(message) && m.role === 'user'
        );
        const userMessage = userMessageIndex >= 0 ? this.conversationHistory[userMessageIndex] : null;

        const config = vscode.workspace.getConfiguration();
        const personalize = config.get<boolean>("sigil.personalizeResponses");

        try {
            const code = await this.getCurrentFileContext();
            console.log('Submitting feedback to API:', {
                messageId: data.messageId,
                rating: data.rating,
                reason: data.reason,
                userID: this.githubUser.id,
                conversationID: this.currentConversationId
            });
            
            const apiResponse = await post(`${getApiUrl()}/api/feedback`, {
                rating: data.rating === 'good' ? GOOD : BAD,
                reason: data.reason,
                personalize,
                userID: this.githubUser.id,
                conversationID: this.currentConversationId || uuidv4(),
                message: userMessage?.content || '',
                response: message.content,
                code
            });

            console.log('Feedback API response:', apiResponse);

            // Verify response status
            if (apiResponse.status === 200 || apiResponse.status === 201) {
                console.log('Feedback successfully saved to database');
                this.viewProvider.postMessage({
                    command: 'feedbackSubmitted',
                    messageId: data.messageId,
                    success: true
                });

                if (personalize) {
                    // Sync settings if personalization is enabled
                    const { syncSigilSettings } = await import('./personalization.js');
                    await syncSigilSettings(this.context);
                }
            } else {
                throw new Error(`API returned status ${apiResponse.status}`);
            }

        } catch (error) {
            console.error('Error submitting feedback:', error);
            this.viewProvider.postMessage({
                command: 'feedbackSubmitted',
                messageId: data.messageId,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private handleClearHistory() {
        this.conversationHistory = [];
        this.currentConversationId = undefined;
        this.viewProvider.postMessage({
            command: 'historyCleared'
        });
    }

    public async initialize() {
        // Request authentication status
        await this.handleRequestAuth();
        
        // Send initial state
        this.viewProvider.postMessage({
            command: 'initialized',
            data: {
                conversationHistory: this.conversationHistory,
                conversationId: this.currentConversationId
            }
        });
    }
}
