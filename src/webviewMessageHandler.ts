import * as vscode from 'vscode';
import { post } from 'axios';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
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
    private disposables: vscode.Disposable[] = [];
    private readonly CONVERSATION_HISTORY_KEY = 'sigil-ps_conversationHistory';
    private readonly CONVERSATION_ID_KEY = 'sigil-ps_conversationId';
    private readonly ANONYMOUS_USER_ID_KEY = 'sigil-ps_anonymousUserId';

    constructor(
        private context: vscode.ExtensionContext,
        private viewProvider: ChatViewProvider
    ) {
        this.setupMessageHandlers();
        this.registerActiveEditorListener();
        // Load conversation state eagerly when handler is created
        this.loadConversationState().catch(err => {
            console.error('Error loading conversation state:', err);
        });
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
                case 'clearHistory':
                    await this.handleClearHistory();
                    break;
                case 'saveState':
                    await this.saveConversationStatePrivate();
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

    private async handleSendMessage(data: { message: string; includeFileContext?: boolean; attachments?: { fileName: string; content: string; }[] }) {
        // Get file context if requested (default: filename-only; content only if explicitly enabled)
        let code = '';
        // Always include current file content
        code = await this.getCurrentFileContext();

        if (data.attachments && data.attachments.length > 0) {
            const attachmentBlocks = data.attachments.map(att => {
                return `Attached file (${att.fileName}):\n${att.content}\n\n`;
            }).join('');
            code = `${code}${attachmentBlocks}`;
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

        // Persist updated conversation state after adding the user message
        await this.saveConversationStatePrivate();

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
            // Get anonymous user ID
            const userId = await this.getAnonymousUserId();
            
            // Call API
            const apiResponse = await post(`${getApiUrl()}/api/prompt`, {
                userID: userId,
                conversationID: this.currentConversationId,
                code,
                message: data.message,
                history,
                logChat: true,
                personalize,
                persona
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

            // Persist updated conversation state after adding the assistant message
            await this.saveConversationStatePrivate();

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
                    userID: userId,
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

    private registerActiveEditorListener() {
        const editorListener = vscode.window.onDidChangeActiveTextEditor(() => {
            this.sendFileContext();
        });
        this.disposables.push(editorListener);
    }

    private async sendFileContext() {
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

    private async handleGetFileContext() {
        await this.sendFileContext();
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
            const userId = await this.getAnonymousUserId();
            const code = await this.getCurrentFileContext();
            console.log('Submitting feedback to API:', {
                messageId: data.messageId,
                rating: data.rating,
                reason: data.reason,
                userID: userId,
                conversationID: this.currentConversationId
            });

            const apiResponse = await post(`${getApiUrl()}/api/feedback`, {
                rating: data.rating === 'good' ? GOOD : BAD,
                reason: data.reason,
                personalize,
                userID: userId,
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

    public async recordCodeChange(document: vscode.TextDocument) {
        try {
            if (document.isUntitled || document.uri.scheme !== 'file') {
                return;
            }

            const userId = await this.getAnonymousUserId();
            const content = document.getText() || '';
            const byteSize = Buffer.byteLength(content, 'utf8');
            if (byteSize > 1024 * 1024) {
                console.warn(`Skipping codeChange: ${document.fileName} exceeds 1MB`);
                return;
            }

            const filename = vscode.workspace.asRelativePath(document.uri, false) || document.fileName;

            await post(`${getApiUrl()}/api/users/codeChange`, {
                userID: userId,
                filename,
                content
            });
        } catch (error) {
            console.error('Error recording code change:', error);
        }
    }

    private async handleClearHistory() {
        this.conversationHistory = [];
        this.currentConversationId = undefined;
        this.viewProvider.postMessage({
            command: 'historyCleared'
        });
        await this.saveConversationStatePrivate();
    }

    public async initialize() {
        // Load any previously persisted conversation state
        await this.loadConversationState();
        // Send initial file context
        await this.sendFileContext();

        // Send authenticated status (no auth required)
        this.viewProvider.postMessage({
            command: 'authStatus',
            authenticated: true
        });

        // Send initial state
        this.viewProvider.postMessage({
            command: 'initialized',
            data: {
                conversationHistory: this.conversationHistory,
                conversationId: this.currentConversationId
            }
        });
    }

    public async saveConversationState() {
        await this.context.globalState.update(this.CONVERSATION_HISTORY_KEY, this.conversationHistory);
        await this.context.globalState.update(this.CONVERSATION_ID_KEY, this.currentConversationId);
    }

    private async saveConversationStatePrivate() {
        await this.saveConversationState();
    }

    private async loadConversationState() {
        const savedHistory = this.context.globalState.get<ChatMessage[]>(this.CONVERSATION_HISTORY_KEY);
        const savedConversationId = this.context.globalState.get<string | undefined>(this.CONVERSATION_ID_KEY);

        if (savedHistory && Array.isArray(savedHistory)) {
            this.conversationHistory = savedHistory;
        }

        this.currentConversationId = savedConversationId;
    }

    private async getAnonymousUserId(): Promise<number> {
        let userId = this.context.globalState.get<number>(this.ANONYMOUS_USER_ID_KEY);
        
        if (!userId) {
            // Generate a random user ID between 1000000 and 999999999
            // This range avoids conflicts with typical GitHub user IDs (which are usually smaller)
            userId = Math.floor(Math.random() * (999999999 - 1000000 + 1)) + 1000000;
            await this.context.globalState.update(this.ANONYMOUS_USER_ID_KEY, userId);
        }
        
        return userId;
    }
}
