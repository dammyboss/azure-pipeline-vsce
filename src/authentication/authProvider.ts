import * as vscode from 'vscode';
import axios from 'axios';

/**
 * Authentication Provider for Azure DevOps using Microsoft Authentication
 * Uses VSCode's built-in Microsoft authentication to avoid PAT tokens
 */
export class AzureDevOpsAuthProvider {
    private static readonly SCOPES = [
        '499b84ac-1321-427f-aa17-267ca6975798/.default' // Azure DevOps scope
    ];

    private session: vscode.AuthenticationSession | undefined;
    private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<vscode.AuthenticationSession | undefined>();
    public readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Sign in to Azure DevOps using Microsoft authentication
     * Shows account picker, then tenant picker if user has multiple tenants
     */
    async signIn(): Promise<vscode.AuthenticationSession> {
        try {
            // Step 1: Get all available Microsoft accounts
            const session = await vscode.authentication.getSession(
                'microsoft',
                AzureDevOpsAuthProvider.SCOPES,
                {
                    clearSessionPreference: true,
                    forceNewSession: true
                }
            );

            if (!session) {
                throw new Error('Failed to create authentication session');
            }

            // Step 2: Ask if user wants to switch tenant
            const switchTenant = await vscode.window.showQuickPick(
                [
                    { label: 'Use primary tenant', value: false },
                    { label: 'Switch to different tenant', value: true }
                ],
                { placeHolder: 'Do you want to switch to a different tenant?' }
            );

            if (!switchTenant || !switchTenant.value) {
                // Use current session
                this.session = session;
                await this.context.secrets.store('ado-session-id', this.session.id);
                this.onDidChangeSessionEmitter.fire(this.session);
                vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', true);
                vscode.window.showInformationMessage('Successfully signed in to Azure DevOps');
                return this.session;
            }

            // Step 3: Fetch and show available tenants with loading indicator
            const tenants = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Azure DevOps",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Discovering available tenants..." });
                return await this.fetchAvailableTenants(session.accessToken);
            });

            let tenantId: string | undefined;

            if (tenants.length > 0) {
                // Show tenant picker with friendly names
                interface TenantQuickPickItem extends vscode.QuickPickItem {
                    tenantId: string;
                }

                const tenantItems: TenantQuickPickItem[] = tenants.map(tenant => ({
                    label: tenant.displayName || tenant.tenantId,
                    description: tenant.defaultDomain || tenant.tenantId,
                    detail: `Tenant ID: ${tenant.tenantId}`,
                    tenantId: tenant.tenantId
                }));

                // Add manual entry option at the end
                tenantItems.push({
                    label: '$(edit) Enter Tenant ID Manually',
                    description: 'If your tenant is not listed above',
                    detail: 'Manually enter a tenant ID (GUID format)',
                    tenantId: 'manual'
                });

                const selectedTenant = await vscode.window.showQuickPick(tenantItems, {
                    placeHolder: 'Select the tenant containing your Azure DevOps organization',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (!selectedTenant) {
                    throw new Error('Tenant selection cancelled');
                }

                if (selectedTenant.tenantId === 'manual') {
                    // Fall back to manual entry
                    const manualTenantId = await vscode.window.showInputBox({
                        prompt: 'Enter Tenant ID (you can find this in Azure Portal)',
                        placeHolder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
                        validateInput: (value) => {
                            if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
                                return 'Please enter a valid tenant ID (GUID format)';
                            }
                            return null;
                        }
                    });

                    if (!manualTenantId) {
                        throw new Error('Tenant selection cancelled');
                    }
                    tenantId = manualTenantId;
                } else {
                    tenantId = selectedTenant.tenantId;
                }
            } else {
                // Fallback to manual entry if auto-detection failed
                tenantId = await vscode.window.showInputBox({
                    prompt: 'Enter Tenant ID (you can find this in Azure Portal)',
                    placeHolder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
                    validateInput: (value) => {
                        if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
                            return 'Please enter a valid tenant ID (GUID format)';
                        }
                        return null;
                    }
                });

                if (!tenantId) {
                    throw new Error('Tenant selection cancelled');
                }
            }

            // Step 4: Re-authenticate with selected tenant
            this.session = await vscode.authentication.getSession(
                'microsoft',
                [`${AzureDevOpsAuthProvider.SCOPES[0]}`, `VSCODE_TENANT:${tenantId}`],
                { forceNewSession: true }
            );

            if (this.session) {
                await this.context.secrets.store('ado-session-id', this.session.id);
                await this.context.secrets.store('ado-tenant-id', tenantId);
                this.onDidChangeSessionEmitter.fire(this.session);

                vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', true);
                vscode.window.showInformationMessage('Successfully signed in to Azure DevOps');

                return this.session;
            }

            throw new Error('Failed to create authentication session');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to sign in: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Sign out from Azure DevOps
     * Completely clears the session - next sign-in will show account picker
     */
    async signOut(): Promise<void> {
        if (this.session) {
            // Clear our stored session data
            await this.context.secrets.delete('ado-session-id');
            await this.context.secrets.delete('ado-tenant-id');

            this.session = undefined;
            this.onDidChangeSessionEmitter.fire(undefined);

            vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', false);

            vscode.window.showInformationMessage('Successfully signed out from Azure DevOps');
        } else {
            vscode.window.showInformationMessage('Already signed out');
        }
    }

    /**
     * Get current authentication session
     */
    async getSession(): Promise<vscode.AuthenticationSession | undefined> {
        if (this.session) {
            return this.session;
        }

        // Try to restore session from stored session ID
        try {
            const storedSessionId = await this.context.secrets.get('ado-session-id');
            if (storedSessionId) {
                const sessions = await vscode.authentication.getSession(
                    'microsoft',
                    AzureDevOpsAuthProvider.SCOPES,
                    { silent: true }
                );

                if (sessions) {
                    this.session = sessions;
                    this.onDidChangeSessionEmitter.fire(this.session);
                    vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', true);
                    return this.session;
                }
            }
        } catch (error) {
            console.error('Failed to restore session:', error);
        }

        return undefined;
    }

    /**
     * Get access token for Azure DevOps API calls
     */
    async getAccessToken(): Promise<string> {
        const session = await this.getSession();
        if (!session) {
            throw new Error('Not authenticated. Please sign in first.');
        }
        return session.accessToken;
    }

    /**
     * Check if user is currently authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        const session = await this.getSession();
        return session !== undefined;
    }

    /**
     * Get current user information
     */
    async getUserInfo(): Promise<{ name: string; email: string; id: string } | undefined> {
        const session = await this.getSession();
        if (!session) {
            return undefined;
        }

        return {
            name: session.account.label,
            email: session.account.id,
            id: session.account.id
        };
    }

    /**
     * Fetch all available tenants the user has access to
     * Uses Microsoft Graph API and Azure Management API for comprehensive tenant discovery
     */
    private async fetchAvailableTenants(accessToken: string): Promise<Array<{tenantId: string, displayName?: string, defaultDomain?: string}>> {
        try {
            // First, get a Graph API token to query tenant information
            const graphSession = await vscode.authentication.getSession(
                'microsoft',
                ['https://graph.microsoft.com/.default'],
                { createIfNone: false, silent: true }
            );

            if (!graphSession) {
                throw new Error('Could not get Graph API session');
            }

            // Use Microsoft Graph API to list organizations the user has access to
            const orgResponse = await axios.get('https://graph.microsoft.com/v1.0/organization', {
                headers: {
                    'Authorization': `Bearer ${graphSession.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const orgs = orgResponse.data.value || [];

            // Also try to get Azure Management token to list all tenants
            let azureTenants: any[] = [];
            try {
                const azureSession = await vscode.authentication.getSession(
                    'microsoft',
                    ['https://management.azure.com/.default'],
                    { createIfNone: false, silent: true }
                );

                if (azureSession) {
                    const tenantsResponse = await axios.get('https://management.azure.com/tenants?api-version=2020-01-01', {
                        headers: {
                            'Authorization': `Bearer ${azureSession.accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    azureTenants = tenantsResponse.data.value || [];
                }
            } catch (azureError) {
                console.log('Could not fetch Azure Management tenants, using Graph API only');
            }

            // Merge and deduplicate tenants
            const tenantMap = new Map<string, {tenantId: string, displayName?: string, defaultDomain?: string}>();

            // Add from Graph API (home tenant)
            orgs.forEach((org: any) => {
                tenantMap.set(org.id, {
                    tenantId: org.id,
                    displayName: org.displayName,
                    defaultDomain: org.verifiedDomains?.find((d: any) => d.isDefault)?.name
                });
            });

            // Add from Azure Management API (all accessible tenants)
            azureTenants.forEach((tenant: any) => {
                if (!tenantMap.has(tenant.tenantId)) {
                    tenantMap.set(tenant.tenantId, {
                        tenantId: tenant.tenantId,
                        displayName: tenant.displayName,
                        defaultDomain: tenant.domains?.[0] || tenant.defaultDomain
                    });
                }
            });

            const tenants = Array.from(tenantMap.values());
            console.log(`Found ${tenants.length} available tenants`);

            return tenants;
        } catch (error: any) {
            console.error('Failed to fetch available tenants:', error);
            // Return empty array to fallback to manual entry
            return [];
        }
    }

    /**
     * Initialize authentication state on extension activation
     */
    async initialize(): Promise<void> {
        try {
            const session = await this.getSession();
            if (session) {
                vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', true);
            } else {
                vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', false);
            }
        } catch (error) {
            console.error('Failed to initialize authentication:', error);
            vscode.commands.executeCommand('setContext', 'azurePipelines.signedIn', false);
        }
    }

    /**
     * Register authentication change listeners
     */
    registerListeners(): vscode.Disposable[] {
        return [
            // Listen for authentication changes
            vscode.authentication.onDidChangeSessions(async (e) => {
                if (e.provider.id === 'microsoft') {
                    const session = await this.getSession();
                    this.onDidChangeSessionEmitter.fire(session);
                }
            })
        ];
    }
}
