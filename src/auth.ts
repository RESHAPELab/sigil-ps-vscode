import * as vscode from 'vscode';

interface GitHubUser {
    login: string;
    id: number;
    name: string;
    email: string;
}

export async function getUserData(accessToken: string) {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            'Authorization': `token ${accessToken}`
        }
    });

    if (!response.ok) {
        console.error(`Token verification failed: ${response.statusText}`);
        return null;
    }

    // Type assertion to tell TypeScript what the response shape is
    const data = (await response.json()) as GitHubUser;
    return data;
}

export async function authenticateWithGitHub(context: vscode.ExtensionContext): Promise<GitHubUser | null> {
    let cachedToken = context.globalState.get<string>("tiamatAccessToken");

    if (cachedToken) {
        const data = await getUserData(cachedToken);
        if (data) {
            return data;
        } else {
            console.warn("Cached token is invalid. Re-authenticating...");
        }
    }

    try {
        const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
        if (session) {
            vscode.window.showInformationMessage(`Authenticated as ${session.account.label}`);
            await context.globalState.update("tiamatUserId", session.account.id);
            await context.globalState.update("tiamatAccessToken", session.accessToken);
            return await getUserData(session.accessToken);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Authentication failed.`);
        console.error(error);
    }

    return null;
}
