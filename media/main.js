const vscode = acquireVsCodeApi();

let attachedFiles = [];

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('attach-file-btn').addEventListener('click', () => {
    vscode.postMessage({ command: 'attachFile' });
});
document.getElementById('attach-current-file-btn').addEventListener('click', () => {
    vscode.postMessage({ command: 'getCurrentFile' });
});

document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message && attachedFiles.length === 0) return;

    vscode.postMessage({
        command: 'sendMessage',
        text: message,
        attachedFiles: attachedFiles
    });

    input.value = '';
    attachedFiles = [];
    updateAttachedFilesDisplay();
}

function updateAttachedFilesDisplay() {
    const container = document.getElementById('file-attachments');
    container.innerHTML = '';
    attachedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'attached-file';
        const fileName = file.split(/[/\\]/).pop();
        div.innerHTML = `
            <span>${escapeHtml(fileName)}</span>
            <button onclick="removeFile(${index})">×</button>
        `;
        container.appendChild(div);
    });
}

function removeFile(index) {
    attachedFiles.splice(index, 1);
    updateAttachedFilesDisplay();
}

window.removeFile = removeFile;

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'addMessage':
            addMessageToChat(message.role, message.content, message.files);
            break;
        case 'updateLastMessage':
            updateLastMessage(message.content);
            break;
        case 'addAttachedFiles':
            message.files.forEach(file => {
                if (!attachedFiles.includes(file)) {
                    attachedFiles.push(file);
                }
            });
            updateAttachedFilesDisplay();
            break;
    }
});

function addMessageToChat(role, content, files = []) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    let fileList = '';
    if (files && files.length > 0) {
        const fileNames = files.map(f => f.split(/[/\\]/).pop());
        fileList = `<div class="attached-files-list">Attached: ${fileNames.map(f => escapeHtml(f)).join(', ')}</div>`;
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (role === 'assistant' && content) {
        // Render markdown-like content (basic support)
        contentDiv.innerHTML = formatMessageContent(content);
    } else {
        contentDiv.textContent = content;
    }
    
    messageDiv.appendChild(contentDiv);
    if (fileList) {
        messageDiv.innerHTML += fileList;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateLastMessage(content) {
    const messagesDiv = document.getElementById('chat-messages');
    const lastMessage = messagesDiv.lastElementChild;
    if (lastMessage) {
        const contentDiv = lastMessage.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.innerHTML = formatMessageContent(content);
        }
    }
}

function formatMessageContent(text) {
    // Basic markdown-like formatting
    let formatted = escapeHtml(text);
    // Code blocks
    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
