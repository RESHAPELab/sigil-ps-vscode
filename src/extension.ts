import * as vscode from 'vscode';
import {post} from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {authenticateWithGitHub, GitHubUser} from './auth';
import {syncSigilSettings, updateOptIn, updatePersonalization} from './personalization';
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

// Helper functions for code tracking
async function updateTrackedFiles(context?: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration();

    // Get current tracked files list
    const currentTrackedFiles = config.get<string[]>("sigil.codeTracking.trackedFiles") || [];

    // Get all files in the workspace
    const workspaceFiles = await vscode.workspace.findFiles(
        '**/*',
        '{**/node_modules/**,**/.venv/**,**/venv/**,**/env/**,**/bin/**,**/build/**,**/dist/**,**/out/**,**/target/**,**/.git/**,**/__pycache__/**,**/coverage/**,**/.pytest_cache/**,**/.mypy_cache/**,**/CMakeFiles/**,**/Debug/**,**/Release/**}'
    );

    // Filter to only include common code file extensions
    const codeFiles = workspaceFiles.filter(uri => {
        const ext = path.extname(uri.fsPath).toLowerCase();
        return ['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt'].includes(ext);
    });

    // Convert to relative paths for storage
    const relativePaths = codeFiles.map(uri => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        }
        return uri.fsPath;
    });

    // Find new files that weren't in the previous tracked list
    const newFiles = relativePaths.filter(filePath => !currentTrackedFiles.includes(filePath));

    // Update the configuration
    await config.update("sigil.codeTracking.trackedFiles", relativePaths, vscode.ConfigurationTarget.Workspace);
    
    console.log(`Updated tracked files list with ${relativePaths.length} files (${newFiles.length} new)`);

    // Send new files to API if there are any and user is authenticated
    if (newFiles.length > 0 && context) {
        try {
            const githubUser = await authenticateWithGitHub(context);
            
            if (githubUser) {
                for (const relativeFilePath of newFiles) {
                    // Find the actual URI for this relative path
                    const matchingFile = codeFiles.find(uri => {
                        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                        if (workspaceFolder) {
                            const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                            return relativePath === relativeFilePath;
                        }
                        return uri.fsPath === relativeFilePath;
                    });

                    if (matchingFile) {
                        // Try to get the document if it's already open, otherwise read from disk
                        let document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === matchingFile.fsPath);
                        
                        if (document) {
                            await sendCodeChangeToAPI(document, githubUser);
                        } else {
                            // Create a temporary document-like object for files not currently open
                            try {
                                const fileContent = fs.readFileSync(matchingFile.fsPath, 'utf8');
                                const tempDoc = {
                                    uri: matchingFile,
                                    getText: () => fileContent
                                } as vscode.TextDocument;
                                await sendCodeChangeToAPI(tempDoc, githubUser);
                            } catch (error) {
                                console.error(`[CODE TRACKING] Error reading file ${relativeFilePath}:`, error);
                            }
                        }
                    }
                }
                console.log(`[CODE TRACKING] Sent ${newFiles.length} new files to API`);
            } else {
                console.log(`[CODE TRACKING] Found ${newFiles.length} new files but user not authenticated - skipping API calls`);
            }
        } catch (error) {
            console.error('[CODE TRACKING] Error sending new files to API:', error);
        }
    }
}

async function isFileTracked(document: vscode.TextDocument): Promise<boolean> {
    const config = vscode.workspace.getConfiguration();

    const trackedFiles = config.get<string[]>("sigil.codeTracking.trackedFiles") || [];
    
    // Convert document path to relative path for comparison
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    let relativePath: string;
    
    if (workspaceFolder) {
        relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
    } else {
        relativePath = document.uri.fsPath;
    }

    return trackedFiles.includes(relativePath);
}

async function sendCodeChangeToAPI(document: vscode.TextDocument, githubUser: GitHubUser): Promise<void> {
    try {
        // TODO: Implement API call to send code changes
        // This is a stub as requested - will need to be implemented later
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        let uniqueFilePath: string;
        
        if (workspaceFolder) {
            // Get the workspace folder name and relative path
            const workspaceName = path.basename(workspaceFolder.uri.fsPath);
            const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
            uniqueFilePath = `${workspaceName}/${relativePath.replace(/\\/g, '/')}`;
        } else {
            // Fallback to just the filename if no workspace folder
            uniqueFilePath = path.basename(document.uri.fsPath);
        }
        
        const fileContent = document.getText();
        
        console.log(`[CODE TRACKING] File saved: ${uniqueFilePath}`);
        console.log(`[CODE TRACKING] Content length: ${fileContent.length} characters`);
        console.log(`[CODE TRACKING] User: ${githubUser?.login || 'unknown'}`);
        
        const apiResponse = await post(`${getApiUrl()}/api/users/codeChange`, {
            userID: githubUser?.id,
            filename: uniqueFilePath,
            filePath: document.uri.fsPath,
            content: fileContent
        });
        console.log('Code change API response:', apiResponse.data);
        
    } catch (error) {
        console.error('Error sending code change to API:', error);
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Display a welcome pop-up to guide users on getting started with Sigil
    if (!context.globalState.get('sigilPSHasShownWelcome')) {
        vscode.window.showInformationMessage(academicIntegrityWelcomeMessage, {modal: true});
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

            const apiResponse = await post(`${getApiUrl()}/api/feedback`, {rating: ratingEnum, reason: customReason, personalize, ...args});
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

        console.log("\nRelevant references: ");
        
        request.references.forEach((ref) => {
            if (ref.value instanceof vscode.Location) {
                console.log(ref, "is a Location");
                console.log(ref.id, "-", ref.value);

                const uri = ref.value.uri;
                const range = ref.value.range;

                const document = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath);

                if (document) {
                    const fileName = uri.path.split("/").pop();
                    code += (ref.modelDescription || "File provided for context") + " (" + fileName + ")" + ":\n" + document?.getText(range);
                }
            } else if (ref.value instanceof vscode.Uri) {
                console.log(ref, "is a URI");
                console.log(ref.id, "-", ref.value);

                const uri = ref.value;

                const fileContent = fs.readFileSync(uri.fsPath, 'utf8');

                console.log("File content:", fileContent);

                const fileName = uri.path.split("/").pop();
                code += "\n" + (ref.modelDescription || "File provided for context") + " (" + fileName + ")" + ":\n" + fileContent + "\n";
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
            // Update tracked files list when chat is used
            await updateTrackedFiles(context);
            
            // if we didn't find conversation ID in the history, create a new one in this message
            if (!conversationId) {
                conversationId = uuidv4();
                // this is so silly but we put the conversation id as a blank link that won't show up in MD
                stream.markdown(`[]( conversation_id:${conversationId} )`);
            }

            // get Sigil response
            const apiResponse = await post(`${getApiUrl()}/api/prompt`, 
                {userID: githubUser?.id, conversationID: conversationId, 
                    code, message: request.prompt, history, personalize, persona, logChat: true,
                    userMetaData: {
                        login: githubUser.login,
                        email: githubUser.email,
                        name: githubUser.name
                }});
            stream.markdown(apiResponse.data.response);
            
            // set up feedback button
            var args = {userID: githubUser?.id, conversationID: conversationId, 
                code: code, message: request.prompt, response: apiResponse.data.response};          
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

    // Code history

    vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const fileName = doc.uri.path.split("/").pop();
        console.log("Saved", fileName, "Content:", doc.getText());
        
        // Check if this file is being tracked
        if (await isFileTracked(doc)) {
            const githubUser = await authenticateWithGitHub(context);
            if (githubUser) {
                await sendCodeChangeToAPI(doc, githubUser);
            } else {
                console.log('[CODE TRACKING] Skipping code change tracking - user not authenticated');
            }
        }
    });

    // Personalization management

    // Sync user settings with backend
    syncSigilSettings(context);

    // Initialize code tracking
    updateTrackedFiles(context);

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

