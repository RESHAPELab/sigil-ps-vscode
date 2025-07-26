import apiUrl from "./config";
import { authenticateWithGitHub } from "./auth";
import {AxiosError, get, put} from "axios";
import * as vscode from 'vscode';
import { Axios } from "axios";

export async function syncPersonalization(context: vscode.ExtensionContext) {
    try {
        const githubUser = await authenticateWithGitHub(context);

        if (!githubUser) {
            vscode.window.showErrorMessage("Tiamat: Authentication required to sync personalization settings");
            return;
        }

        const result = await get(`${apiUrl}/api/personalization/${githubUser.id}`);
        const personalization = result.data.personalization || {"personalizedPrompt": ""};

        const config = vscode.workspace.getConfiguration();
        await config.update('tiamat.personalizedPrompt', personalization.personalizedPrompt, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Tiamat: Personalization settings synced successfully");
    } catch (error: AxiosError | any) {
        // No need to show a message if they simply don't have any personalization settings (404)
        // but show an error for other issues (e.g. network errors, server errors, etc.)
        if (error?.response && error?.response?.status !== 404) {
            vscode.window.showErrorMessage("Tiamat: Error syncing personalization settings");
        }
    }
}

export async function updatePersonalization(context: vscode.ExtensionContext, newPersonalization: string) {
    try {
        const githubUser = await authenticateWithGitHub(context);

        if (!githubUser) {
            vscode.window.showErrorMessage("Tiamat: Authentication required to update personalization settings");
            return;
        }

        await put(`${apiUrl}/api/personalization/${githubUser.id}`, { personalization: { personalizedPrompt: newPersonalization } });
        vscode.window.showInformationMessage("Tiamat: Personalization settings updated successfully");
    } catch (error) {
        vscode.window.showErrorMessage("Tiamat: Error updating personalization settings");
    }
}