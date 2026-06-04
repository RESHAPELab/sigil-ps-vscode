import * as vscode from 'vscode';
import { post } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticateWithGitHub, GitHubUser } from './auth';
import { getApiEndpoint } from './apiConfig';
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
    attachments?: { fileName: string; content: string; }[];
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
    private disposables: vscode.Disposable[] = [];
    private readonly CONVERSATION_HISTORY_KEY = 'sigil-ps_conversationHistory';
    private readonly CONVERSATION_ID_KEY = 'sigil-ps_conversationId';

    constructor(
        private context: vscode.ExtensionContext,
        private viewProvider: ChatViewProvider
    ) {
        this.setupMessageHandlers();
        this.registerActiveEditorListener();
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
                case 'requestAuth':
                    await this.handleRequestAuth();
                    break;
                case 'clearHistory':
                    await this.handleClearHistory();
                    break;
                case 'saveState':
                    await this.saveConversationState();
                    break;
                case 'pickFiles':
                    await this.handlePickFiles();
                    break;
                case 'openContextPicker':
                    await this.handleContextPicker(message.query || '');
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

    private async handleSendMessage(data: { message: string; includeFileContext?: boolean; attachments?: { fileName: string; content: string; }[] }) {
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
            conversationId: this.currentConversationId,
            attachments: data.attachments && data.attachments.length > 0 ? data.attachments : undefined
        };
        this.conversationHistory.push(userMessage);
        await this.saveConversationState();

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
            const apiResponse = await post(getApiEndpoint('/prompt'), {
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
            await this.saveConversationState();

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

    private async handlePickFiles() {
        try {
            console.log('handlePickFiles called');
            
            // Get workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                const errorMsg = 'No workspace folder open. Please open a workspace first.';
                console.warn(errorMsg);
                this.viewProvider.postMessage({
                    command: 'error',
                    error: errorMsg
                });
                return;
            }

            const workspaceFolder = workspaceFolders[0];
            
            // Use workspace.findFiles() to get all files in workspace
            console.log('Searching workspace for files...');
            const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000);
            
            console.log(`Found ${allFiles.length} files in workspace`);
            
            if (allFiles.length === 0) {
                this.viewProvider.postMessage({
                    command: 'error',
                    error: 'No files found in workspace.'
                });
                return;
            }

            // Group files by folder structure and create quick pick items
            const fileItems: vscode.QuickPickItem[] = [];
            const fileMap = new Map<string, vscode.Uri>();
            
            for (const fileUri of allFiles) {
                const relativePath = vscode.workspace.asRelativePath(fileUri, false);
                const fileName = relativePath.split(/[/\\]/).pop() || fileUri.fsPath;
                const folderPath = relativePath.substring(0, relativePath.length - fileName.length);
                
                // VS Code's QuickPick doesn't support file icon theme icons directly
                // Setting iconPath to file URI causes SVG files to render as images
                // Use codicons in the label instead - they're the closest we can get
                const ext = fileName.split('.').pop()?.toLowerCase() || '';
                const fileIcon = this.getFileTypeCodicon(ext);
                
                // Add ALL files to the picker - no filtering by extension
                fileItems.push({
                    label: `${fileIcon} ${fileName}`,
                    description: folderPath || workspaceFolder.name,
                    detail: relativePath
                    // Don't set iconPath - it causes issues with SVG files
                });
                fileMap.set(relativePath, fileUri);
            }
            
            console.log(`Created ${fileItems.length} quick pick items`);

            // Show quick pick with searchable file and symbol list
            const selectedItems = await vscode.window.showQuickPick(fileItems, {
                canPickMany: true,
                placeHolder: `Select files or symbols from workspace (${allFiles.length} files, showing symbols)`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedItems || selectedItems.length === 0) {
                // User cancelled
                return;
            }

            // Read all selected files using VS Code APIs
            const files: { fileName: string; content: string }[] = [];
            const MAX_FILE_SIZE = 1024 * 1024; // 1MB

            for (const item of selectedItems) {
                if (!item.detail) continue;
                
                const fileUri = fileMap.get(item.detail);
                if (!fileUri) continue;

                try {
                    // Check file size using VS Code API
                    const stats = await vscode.workspace.fs.stat(fileUri);
                    if (stats.size > MAX_FILE_SIZE) {
                        this.viewProvider.postMessage({
                            command: 'error',
                            error: `File ${item.detail} exceeds 1MB size limit.`
                        });
                        continue;
                    }

                    // Read file content using VS Code API
                    const fileData = await vscode.workspace.fs.readFile(fileUri);
                    const content = Buffer.from(fileData).toString('utf8');
                    const fileName = item.detail;

                    files.push({
                        fileName,
                        content
                    });
                } catch (error) {
                    console.error(`Error reading file ${fileUri.fsPath}:`, error);
                    this.viewProvider.postMessage({
                        command: 'error',
                        error: `Failed to read file ${item.detail}: ${error instanceof Error ? error.message : String(error)}`
                    });
                }
            }

            if (files.length > 0) {
                // Send files back to webview
                this.viewProvider.postMessage({
                    command: 'filesPicked',
                    files
                });
            }
        } catch (error) {
            console.error('Error in handlePickFiles:', error);
            this.viewProvider.postMessage({
                command: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleContextPicker(query: string = '') {
        try {
            console.log('handleContextPicker called with query:', query);
            
            // Get workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.viewProvider.postMessage({
                    command: 'contextPickerResult',
                    result: null,
                    error: 'No workspace folder open.'
                });
                return;
            }

            const workspaceFolder = workspaceFolders[0];
            const items: vscode.QuickPickItem[] = [];

            // Get workspace files
            const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 500);
            
            // Add files to picker
            for (const fileUri of allFiles) {
                const relativePath = vscode.workspace.asRelativePath(fileUri, false);
                const fileName = relativePath.split(/[/\\]/).pop() || fileUri.fsPath;
                const folderPath = relativePath.substring(0, relativePath.length - fileName.length);
                
                // Filter by query if provided
                if (query && !relativePath.toLowerCase().includes(query.toLowerCase()) && 
                    !fileName.toLowerCase().includes(query.toLowerCase())) {
                    continue;
                }
                
                // Use codicons in label - QuickPick doesn't support file icon theme directly
                const ext = fileName.split('.').pop()?.toLowerCase() || '';
                const fileIcon = this.getFileTypeCodicon(ext);
                
                items.push({
                    label: `${fileIcon} ${fileName}`,
                    description: folderPath || workspaceFolder.name,
                    detail: relativePath
                });
            }

            // Get workspace symbols if query provided
            if (query) {
                try {
                    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                        'vscode.executeWorkspaceSymbolProvider',
                        query
                    );
                    
                    if (symbols && symbols.length > 0) {
                        // Add symbols to picker
                        for (const symbol of symbols.slice(0, 50)) { // Limit to 50 symbols
                            const filePath = symbol.location.uri.fsPath;
                            const relativePath = vscode.workspace.asRelativePath(symbol.location.uri, false);
                            const symbolIcon = this.getSymbolIcon(symbol.kind);
                            
                            items.push({
                                label: `${symbolIcon} ${symbol.name}`,
                                description: `${symbol.kind.toString()} in ${relativePath}`,
                                detail: `${relativePath}:${symbol.location.range.start.line + 1}`
                            });
                        }
                    }
                } catch (error) {
                    console.warn('Error fetching workspace symbols:', error);
                }
            }

            if (items.length === 0) {
                this.viewProvider.postMessage({
                    command: 'contextPickerResult',
                    result: null,
                    error: query ? `No files or symbols found matching "${query}"` : 'No files found in workspace.'
                });
                return;
            }

            // Show quick pick
            const selectedItem = await vscode.window.showQuickPick(items, {
                canPickMany: false,
                placeHolder: query ? `Select context matching "${query}"` : 'Select file or symbol from workspace',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedItem) {
                // User cancelled
                this.viewProvider.postMessage({
                    command: 'contextPickerResult',
                    result: null
                });
                return;
            }

            // Determine if it's a file or symbol (symbols have line numbers in detail)
            if (!selectedItem.detail) {
                return;
            }
            
            const isSymbol = /:\d+$/.test(selectedItem.detail);
            
            if (isSymbol) {
                // It's a symbol - extract file path and line
                const [filePath, lineStr] = selectedItem.detail.split(':');
                const line = parseInt(lineStr, 10) - 1;
                
                // Find the file URI
                const fileUri = allFiles.find(f => 
                    vscode.workspace.asRelativePath(f, false) === filePath
                );
                
                if (fileUri) {
                    // Read file and extract symbol context
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const symbolName = selectedItem.label.replace(/^\$\([^)]+\)\s+/, '');
                    
                    // Get context around the symbol (10 lines before and after)
                    const contextRange = new vscode.Range(
                        Math.max(0, line - 10),
                        0,
                        Math.min(document.lineCount - 1, line + 10),
                        0
                    );
                    const context = document.getText(contextRange);
                    
                    this.viewProvider.postMessage({
                        command: 'contextPickerResult',
                        result: {
                            type: 'symbol',
                            name: symbolName,
                            file: filePath,
                            line: line + 1,
                            context: context,
                            reference: `#${symbolName}`
                        }
                    });
                }
            } else {
                // It's a file
                const relativePath = selectedItem.detail || '';
                const fileUri = allFiles.find(f => 
                    vscode.workspace.asRelativePath(f, false) === relativePath
                );
                
                if (fileUri) {
                    // Read file content
                    const fileData = await vscode.workspace.fs.readFile(fileUri);
                    const content = Buffer.from(fileData).toString('utf8');
                    
                    this.viewProvider.postMessage({
                        command: 'contextPickerResult',
                        result: {
                            type: 'file',
                            file: relativePath,
                            content: content,
                            reference: `#${relativePath}`
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error in handleContextPicker:', error);
            this.viewProvider.postMessage({
                command: 'contextPickerResult',
                result: null,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private getSymbolIcon(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Function:
            case vscode.SymbolKind.Method:
                return '$(symbol-method)';
            case vscode.SymbolKind.Class:
                return '$(symbol-class)';
            case vscode.SymbolKind.Interface:
                return '$(symbol-interface)';
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Field:
                return '$(symbol-variable)';
            case vscode.SymbolKind.Constant:
                return '$(symbol-constant)';
            case vscode.SymbolKind.Enum:
                return '$(symbol-enum)';
            case vscode.SymbolKind.Property:
                return '$(symbol-property)';
            default:
                return '$(symbol-misc)';
        }
    }


    private getFileTypeCodicon(ext: string): string {
        // Map file extensions to VS Code codicons
        // These are the built-in icons VS Code provides
        const iconMap: { [key: string]: string } = {
            'ts': '$(file-code)',
            'tsx': '$(file-code)',
            'js': '$(file-code)',
            'jsx': '$(file-code)',
            'mjs': '$(file-code)',
            'cjs': '$(file-code)',
            'py': '$(file-code)',
            'java': '$(file-code)',
            'c': '$(file-code)',
            'cpp': '$(file-code)',
            'cc': '$(file-code)',
            'cxx': '$(file-code)',
            'h': '$(file-code)',
            'hpp': '$(file-code)',
            'hh': '$(file-code)',
            'cs': '$(file-code)',
            'go': '$(file-code)',
            'rs': '$(file-code)',
            'php': '$(file-code)',
            'rb': '$(file-code)',
            'swift': '$(file-code)',
            'kt': '$(file-code)',
            'scala': '$(file-code)',
            'clj': '$(file-code)',
            'hs': '$(file-code)',
            'elm': '$(file-code)',
            'ex': '$(file-code)',
            'exs': '$(file-code)',
            'html': '$(browser)',
            'htm': '$(browser)',
            'css': '$(file-code)',
            'scss': '$(file-code)',
            'sass': '$(file-code)',
            'less': '$(file-code)',
            'json': '$(json)',
            'xml': '$(file-code)',
            'yaml': '$(file-code)',
            'yml': '$(file-code)',
            'toml': '$(file-code)',
            'md': '$(markdown)',
            'txt': '$(file-text)',
            'pdf': '$(file-pdf)',
            'png': '$(file-media)',
            'jpg': '$(file-media)',
            'jpeg': '$(file-media)',
            'gif': '$(file-media)',
            'svg': '$(file-media)',
            'webp': '$(file-media)',
            'ico': '$(file-media)',
            'zip': '$(file-zip)',
            'tar': '$(file-zip)',
            'gz': '$(file-zip)',
            'rar': '$(file-zip)',
            '7z': '$(file-zip)',
        };
        
        return iconMap[ext] || '$(file)';
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

            const apiResponse = await post(getApiEndpoint('/feedback'), {
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

    public async recordCodeChange(document: vscode.TextDocument) {
        try {
            if (document.isUntitled || document.uri.scheme !== 'file') {
                return;
            }

            if (!this.githubUser) {
                this.githubUser = await authenticateWithGitHub(this.context);
                if (!this.githubUser) {
                    console.warn('Skipping codeChange: user not authenticated');
                    return;
                }
            }

            const content = document.getText() || '';
            const byteSize = Buffer.byteLength(content, 'utf8');
            if (byteSize > 1024 * 1024) {
                console.warn(`Skipping codeChange: ${document.fileName} exceeds 1MB`);
                return;
            }

            const filename = vscode.workspace.asRelativePath(document.uri, false) || document.fileName;

            await post(getApiEndpoint('/users/codeChange'), {
                userID: this.githubUser.id,
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
        await this.saveConversationState();
    }

    public async initialize() {
        await this.loadConversationState();
        // Request authentication status
        await this.handleRequestAuth();
        // Send initial file context
        await this.sendFileContext();

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

    private async loadConversationState() {
        const savedHistory = this.context.globalState.get<ChatMessage[]>(this.CONVERSATION_HISTORY_KEY);
        const savedConversationId = this.context.globalState.get<string | undefined>(this.CONVERSATION_ID_KEY);

        if (savedHistory && Array.isArray(savedHistory)) {
            this.conversationHistory = savedHistory;
        }

        this.currentConversationId = savedConversationId;
    }
}
