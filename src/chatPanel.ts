import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    public static readonly viewType = 'sigil-ps.chatPanel';
    public readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri): ChatPanel | undefined {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(column);
            return ChatPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Sigil Chat',
            column || vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'images')
                ],
                retainContextWhenHidden: true
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
        return ChatPanel.currentPanel;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                        // Webview is ready, send initial state
                        this._sendInitialState();
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        ChatPanel.currentPanel = undefined;

        // Clean up our resources
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _sendInitialState() {
        // Send initial state to webview (auth status, settings, etc.)
        this._panel.webview.postMessage({
            command: 'init',
            data: {
                // Will be populated by message handler
            }
        });
    }

    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to media folder
        const mediaPath = vscode.Uri.joinPath(this._extensionUri, 'media');
        const mediaPathOnDisk = mediaPath.fsPath;

        // Try to load the built HTML file
        let htmlContent = '';
        const indexPath = path.join(mediaPathOnDisk, 'index.html');
        
        if (fs.existsSync(indexPath)) {
            htmlContent = fs.readFileSync(indexPath, 'utf8');
            
            // Replace asset paths with webview URIs
            const assetPath = webview.asWebviewUri(mediaPath).toString();
            htmlContent = htmlContent.replace(/\/assets\//g, `${assetPath}/assets/`);
            htmlContent = htmlContent.replace(/href="\//g, `href="${assetPath}/`);
            htmlContent = htmlContent.replace(/src="\//g, `src="${assetPath}/`);
        } else {
            // Fallback HTML if build files don't exist yet
            htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sigil Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .error {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="error">
        <h2>Chat UI not built</h2>
        <p>Please build the chat UI first:</p>
        <pre>cd sigil-ps-core/ui && npm run build</pre>
        <p>Then copy the dist folder contents to sigil-ps-vscode/media/</p>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
        }

        return htmlContent;
    }
}
