import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sigil-ps.chatView';
    private _view?: vscode.WebviewView;
    private _messageHandler?: (message: any) => void;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public setMessageHandler(handler: (message: any) => void) {
        this._messageHandler = handler;
        // Do not register additional listeners here; resolveWebviewView owns the single listener.
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'images')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                        // Webview is ready
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    default:
                        // Forward to message handler if set
                        if (this._messageHandler) {
                            this._messageHandler(message);
                        }
                }
            }
        );
    }

    public postMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public get webview() {
        return this._view?.webview;
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
