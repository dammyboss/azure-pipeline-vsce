import * as vscode from 'vscode';

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
     * Always shows account picker for user to select account
     */
    async signIn(): Promise<vscode.AuthenticationSession> {
        try {
            // Request authentication using VSCode's Microsoft authentication provider
            // Always force account picker to show for explicit sign-in
            this.session = await vscode.authentication.getSession(
                'microsoft',
                AzureDevOpsAuthProvider.SCOPES,
                {
                    clearSessionPreference: true,
                    forceNewSession: true
                }
            );

            if (this.session) {
                await this.context.secrets.store('ado-session-id', this.session.id);
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
