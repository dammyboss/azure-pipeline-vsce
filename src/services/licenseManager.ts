import * as vscode from 'vscode';
import axios from 'axios';

export interface LicenseStatus {
    isPremium: boolean;
    globalFreeMode: boolean;
    expiresAt?: string;
    cachedAt?: string;
}

const CACHE_KEY = 'azurePipelines.licenseStatus';
const LICENSE_KEY_STORE = 'azurePipelines.licenseKey';
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class LicenseManager {
    private static instance: LicenseManager;
    private status: LicenseStatus | null = null;
    private secretStorage: vscode.SecretStorage;

    private constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
    }

    static getInstance(secretStorage?: vscode.SecretStorage): LicenseManager {
        if (!LicenseManager.instance) {
            if (!secretStorage) {
                throw new Error('LicenseManager not initialized');
            }
            LicenseManager.instance = new LicenseManager(secretStorage);
        }
        return LicenseManager.instance;
    }

    private getApiUrl(): string {
        const config = vscode.workspace.getConfiguration('azurePipelines');
        return config.get<string>('licenseApiUrl', 'https://ado-pipeline-vsce-payment.vercel.app');
    }

    async activate(): Promise<void> {
        await this.loadCachedStatus();
        await this.refreshInBackground();
    }

    /**
     * Returns true if the user has access to all features.
     * True when: devMode is on, globalFreeMode is on, or a valid premium license is cached within the grace period.
     * Defaults to true when no status exists (everything stays free until a backend is deployed and flips globalFreeMode off).
     */
    isPremium(): boolean {
        const config = vscode.workspace.getConfiguration('azurePipelines');
        if (config.get<boolean>('devMode', false)) {
            return true;
        }

        if (!this.status) {
            return true;
        }

        if (this.status.globalFreeMode) {
            return true;
        }

        if (this.status.isPremium && this.status.cachedAt) {
            const cachedTime = new Date(this.status.cachedAt).getTime();
            if (Date.now() - cachedTime < GRACE_PERIOD_MS) {
                return true;
            }
        }

        return false;
    }

    async enterLicenseKey(): Promise<void> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Azure Pipelines Pro license key',
            placeHolder: 'APV-XXXX-XXXX-XXXX-XXXX',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'License key cannot be empty';
                }
                return undefined;
            }
        });

        if (!key) {
            return;
        }

        const trimmedKey = key.trim();
        await this.secretStorage.store(LICENSE_KEY_STORE, trimmedKey);

        const valid = await this.validateKey(trimmedKey);
        if (valid) {
            vscode.window.showInformationMessage('License activated! All Pro features are now unlocked.');
        } else {
            vscode.window.showErrorMessage('Invalid or expired license key. Please check and try again.');
            await this.secretStorage.delete(LICENSE_KEY_STORE);
        }
    }

    async clearLicense(): Promise<void> {
        await this.secretStorage.delete(LICENSE_KEY_STORE);
        await this.secretStorage.delete(CACHE_KEY);
        this.status = null;
        vscode.window.showInformationMessage('License cleared. Pro features are now locked.');
    }

    showUpgradePrompt(featureName: string): void {
        vscode.window.showInformationMessage(
            `"${featureName}" is a Pro feature. Upgrade to unlock.`,
            'Upgrade to Pro',
            'Enter License Key'
        ).then(selection => {
            if (selection === 'Upgrade to Pro') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/dammyboss/azure-pipeline-vsce#pro'));
            } else if (selection === 'Enter License Key') {
                this.enterLicenseKey();
            }
        });
    }

    private async validateKey(key: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.getApiUrl()}/api/validate`, { key });

            if (response.status !== 200) {
                this.updateStatus({ isPremium: false, globalFreeMode: false });
                return false;
            }

            const data = response.data as { valid?: boolean; globalFreeMode?: boolean; expiresAt?: string };
            this.updateStatus({
                isPremium: data.valid === true,
                globalFreeMode: data.globalFreeMode || false,
                expiresAt: data.expiresAt
            });
            return data.valid === true;
        } catch {
            return this.isPremium();
        }
    }

    private async refreshInBackground(): Promise<void> {
        try {
            const apiUrl = this.getApiUrl();
            const statusResponse = await axios.get(`${apiUrl}/api/status`);

            if (statusResponse.status === 200) {
                const data = statusResponse.data as { globalFreeMode?: boolean };
                if (this.status) {
                    this.status.globalFreeMode = data.globalFreeMode !== false;
                    this.status.cachedAt = new Date().toISOString();
                    await this.cacheStatus();
                } else {
                    this.updateStatus({
                        isPremium: false,
                        globalFreeMode: data.globalFreeMode !== false
                    });
                }
            }

            const key = await this.secretStorage.get(LICENSE_KEY_STORE);
            if (key) {
                await this.validateKey(key);
            }
        } catch {
            // Silently fail — cached status or defaults remain in effect
        }
    }

    private updateStatus(partial: Partial<LicenseStatus>): void {
        this.status = {
            isPremium: false,
            globalFreeMode: true,
            cachedAt: new Date().toISOString(),
            ...partial
        };
        this.cacheStatus();
    }

    private async loadCachedStatus(): Promise<void> {
        const cached = await this.secretStorage.get(CACHE_KEY);
        if (cached) {
            try {
                this.status = JSON.parse(cached);
            } catch {
                this.status = null;
            }
        }
    }

    private async cacheStatus(): Promise<void> {
        if (this.status) {
            await this.secretStorage.store(CACHE_KEY, JSON.stringify(this.status));
        }
    }
}
