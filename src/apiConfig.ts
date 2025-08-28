import * as vscode from 'vscode';

const TEST_URL = 'https://sigil-api-test.lemonsand-c67bbaad.westus2.azurecontainerapps.io';
const PROD_URL = 'https://sigil-api.lemonsand-c67bbaad.westus2.azurecontainerapps.io';

export default function getApiUrl() {
    const config = vscode.workspace.getConfiguration();
    const useTest = config.get<boolean>('sigil.developerSettings.test');
    const customUrl = config.get<string>('sigil.developerSettings.apiUrl');

    if (useTest) {
        return customUrl && customUrl.trim() !== '' ? customUrl : TEST_URL;
    }

    return PROD_URL;
}