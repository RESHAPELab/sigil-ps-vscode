import * as vscode from 'vscode';

const PROD_API_BASE_URL = 'https://sigil-api.lemonsand-c67bbaad.westus2.azurecontainerapps.io';
const TEST_API_BASE_URL = 'https://sigil-api-test.lemonsand-c67bbaad.westus2.azurecontainerapps.io';

function normalizeApiBaseUrl(url: string): string {
    const trimmedUrl = url.trim().replace(/\/+$/, '');
    return trimmedUrl.endsWith('/api') ? trimmedUrl : `${trimmedUrl}/api`;
}

export default function getApiBaseUrl() {
    const config = vscode.workspace.getConfiguration();
    const useTest = config.get<boolean>('sigil.developerSettings.test');
    const customUrl = config.get<string>('sigil.developerSettings.apiUrl');
    const apiBaseUrl = config.get<string>('sigil.apiBaseUrl') || PROD_API_BASE_URL;

    if (useTest) {
        return normalizeApiBaseUrl(customUrl && customUrl.trim() !== '' ? customUrl : TEST_API_BASE_URL);
    }

    return normalizeApiBaseUrl(apiBaseUrl);
}

export function getApiEndpoint(endpoint: string) {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${getApiBaseUrl()}${normalizedEndpoint}`;
}
