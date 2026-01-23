import * as vscode from 'vscode';
import { AzureDevOpsAuthProvider } from '../authentication/authProvider';
import { ConfigManager } from '../utils/configManager';

/**
 * Tree item for connection status
 */
class ConnectionStatusItem extends vscode.TreeItem {
    constructor(
        label: string,
        description?: string,
        command?: vscode.Command,
        iconPath?: vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.command = command;
        this.iconPath = iconPath;
    }
}

/**
 * Provides connection status and quick actions for authentication
 */
export class ConnectionStatusProvider implements vscode.TreeDataProvider<ConnectionStatusItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionStatusItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private authProvider: AzureDevOpsAuthProvider,
        private configManager: ConfigManager
    ) {
        // Listen to authentication changes
        this.authProvider.onDidChangeSession(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConnectionStatusItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConnectionStatusItem): Promise<ConnectionStatusItem[]> {
        if (element) {
            return [];
        }

        const items: ConnectionStatusItem[] = [];
        const isAuthenticated = await this.authProvider.isAuthenticated();

        if (!isAuthenticated) {
            // Not signed in - show sign-in action
            items.push(
                new ConnectionStatusItem(
                    'Not signed in',
                    'Click to sign in',
                    {
                        command: 'azurePipelines.signIn',
                        title: 'Sign In'
                    },
                    new vscode.ThemeIcon('account', new vscode.ThemeColor('notificationsWarningIcon.foreground'))
                )
            );
        } else {
            // Signed in - show user info and actions
            const userInfo = await this.authProvider.getUserInfo();
            const orgName = this.configManager.getOrganizationName();
            const projectName = this.configManager.getProjectName();

            // User account
            items.push(
                new ConnectionStatusItem(
                    userInfo?.name || 'Signed in',
                    userInfo?.email || '',
                    undefined,
                    new vscode.ThemeIcon('account', new vscode.ThemeColor('notificationsInfoIcon.foreground'))
                )
            );

            // Organization
            if (orgName) {
                items.push(
                    new ConnectionStatusItem(
                        orgName,
                        'Organization',
                        {
                            command: 'azurePipelines.selectOrganization',
                            title: 'Change Organization'
                        },
                        new vscode.ThemeIcon('organization')
                    )
                );
            } else {
                items.push(
                    new ConnectionStatusItem(
                        'No organization selected',
                        'Click to select',
                        {
                            command: 'azurePipelines.selectOrganization',
                            title: 'Select Organization'
                        },
                        new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground'))
                    )
                );
            }

            // Project
            if (projectName) {
                items.push(
                    new ConnectionStatusItem(
                        projectName,
                        'Project',
                        {
                            command: 'azurePipelines.selectOrganization',
                            title: 'Change Project'
                        },
                        new vscode.ThemeIcon('project')
                    )
                );
            }

            // Quick actions separator
            items.push(
                new ConnectionStatusItem(
                    '───────────────',
                    '',
                    undefined,
                    undefined
                )
            );

            // Change organization/project
            items.push(
                new ConnectionStatusItem(
                    'Change Organization/Project',
                    '',
                    {
                        command: 'azurePipelines.selectOrganization',
                        title: 'Change Organization/Project'
                    },
                    new vscode.ThemeIcon('gear')
                )
            );

            // Sign out
            items.push(
                new ConnectionStatusItem(
                    'Sign Out',
                    '',
                    {
                        command: 'azurePipelines.signOut',
                        title: 'Sign Out'
                    },
                    new vscode.ThemeIcon('sign-out')
                )
            );
        }

        return items;
    }
}
