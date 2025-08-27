import * as vscode from 'vscode';
import {post} from 'axios';
import * as fs from 'fs';
import {v4 as uuidv4} from 'uuid';
import {authenticateWithGitHub} from './auth';
import {syncPersonalization, updatePersonalization} from './personalization';
import apiUrl from "./config";

const MAX_HISTORY_LENGTH = 6;
const GOOD = 1;
const BAD = 0;
const GOOD_REASONS: string[] = ["Helpful", "Accurate", "Well Explained"];
const BAD_REASONS: string[] = ["Incorrect", "Not Helpful", "Confusing"];
const FEEDBACK_BUTTON_TEXT = "💬 Provide Feedback to Sigil";
const academicIntegrityWelcomeMessage = `
SIGIL-PS Academic Integrity Notice

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
        vscode.window.showInformationMessage(academicIntegrityWelcomeMessage);
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

            const apiResponse = await post(`${apiUrl}/api/feedback`, {rating: ratingEnum, reason: customReason, personalize, ...args});
            console.log('API Response:', apiResponse.data);
            
            if (personalize) {
                await syncPersonalization(context);
                
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
        let logChat = config.get<boolean>("sigil.logChats");
        
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
            const apiResponse = await post(`${apiUrl}/api/prompt`, 
                {userID: githubUser?.id, conversationID: conversationId, 
                    code, message: request.prompt, history, personalize, persona, logChat,
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
	tutor.iconPath = vscode.Uri.joinPath(context.extensionUri, 'tutor.jpeg');

    // Personalization management

    // Sync personalization with backend
    syncPersonalization(context);

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (
            e.affectsConfiguration('sigil.personalizedPrompt')
        ) {
            const config = vscode.workspace.getConfiguration();
            const personalization = config.get<string>('sigil.personalizedPrompt');

            if (personalization) {
                updatePersonalization(context, personalization);
            }
        }
    });
    
    // Allow user to manage personalization
    context.subscriptions.push(
        vscode.commands.registerCommand('sigil-ps.openPersonalization', async () => {
            vscode.window.showInformationMessage('Opening Sigil Personalization settings...');

            await syncPersonalization(context);

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

