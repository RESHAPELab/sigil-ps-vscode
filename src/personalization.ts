import getApiUrl from "./apiConfig";
import {AxiosError, get, post, put} from "axios";
import * as vscode from 'vscode';
import { Axios } from "axios";

const ANONYMOUS_USER_ID_KEY = 'sigil-ps_anonymousUserId';

async function getAnonymousUserId(context: vscode.ExtensionContext): Promise<number> {
    let userId = context.globalState.get<number>(ANONYMOUS_USER_ID_KEY);
    
    if (!userId) {
        // Generate a random user ID between 1000000 and 999999999
        // This range avoids conflicts with typical GitHub user IDs (which are usually smaller)
        userId = Math.floor(Math.random() * (999999999 - 1000000 + 1)) + 1000000;
        await context.globalState.update(ANONYMOUS_USER_ID_KEY, userId);
    }
    
    return userId;
}

export async function syncSigilSettings(context: vscode.ExtensionContext) {
    try {
        const userId = await getAnonymousUserId(context);
        const result = await get(`${getApiUrl()}/api/personalization/${userId}`);
        const personalization = result.data.personalization || {"personalizedPrompt": ""};

        const config = vscode.workspace.getConfiguration();
        await config.update('sigil.personalizedPrompt', personalization.personalizedPrompt, vscode.ConfigurationTarget.Global);

        const optInResult = await get(`${getApiUrl()}/api/users/getFieldStudyOptInStatus/${userId}`);
        const optIn = result.data.fieldStudyOptIn || false;
        await config.update('sigil.fieldStudyOptIn', optIn, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage("Sigil: User settings synced successfully");
    } catch (error: AxiosError | any) {
        // No need to show a message if they simply don't have any personalization settings (404)
        // but show an error for other issues (e.g. network errors, server errors, etc.)
        if (error?.response && error?.response?.status !== 404) {
            vscode.window.showErrorMessage("Sigil: Error syncing user settings");
        }
    }
}

export async function updatePersonalization(context: vscode.ExtensionContext, newPersonalization: string) {
    try {
        const userId = await getAnonymousUserId(context);
        await put(`${getApiUrl()}/api/personalization/${userId}`, { personalization: { personalizedPrompt: newPersonalization } });
        vscode.window.showInformationMessage("Sigil: Personalization settings updated successfully");
    } catch (error) {
        vscode.window.showErrorMessage("Sigil: Error updating personalization settings");
    }
}

export async function updateOptIn(context: vscode.ExtensionContext, newSetting: boolean) {
    try {
        const userId = await getAnonymousUserId(context);
        await post(`${getApiUrl()}/api/users/changeFieldStudyOptInStatus`, { userID: userId, fieldStudyOptIn: newSetting });
        vscode.window.showInformationMessage("Sigil: Opt in status updated successfully");
    } catch (error) {
        vscode.window.showErrorMessage("Sigil: Error updating opt in status");
    }
}