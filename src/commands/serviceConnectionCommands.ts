import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { ServiceEndpoint } from '../models/types';
import { ServiceConnectionsTreeProvider } from '../views/serviceConnectionsTreeView';
import { ServiceConnectionPanel } from '../webviews/serviceConnectionPanel';
import { LicenseManager } from '../services/licenseManager';

export class ServiceConnectionCommands {
    constructor(
        private client: AzureDevOpsClient,
        private provider: ServiceConnectionsTreeProvider
    ) {}

    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('azurePipelines.refreshServiceConnections', () =>
                this.refreshConnections()
            ),
            vscode.commands.registerCommand('azurePipelines.createServiceConnection', () =>
                this.createConnection()
            ),
            vscode.commands.registerCommand('azurePipelines.editServiceConnection', (connection: ServiceEndpoint) =>
                this.editConnection(connection)
            ),
            vscode.commands.registerCommand('azurePipelines.deleteServiceConnection', (connection: ServiceEndpoint) =>
                this.deleteConnection(connection)
            ),
            vscode.commands.registerCommand('azurePipelines.viewServiceConnectionDetails', (connection: ServiceEndpoint) =>
                this.viewDetails(connection)
            ),
            vscode.commands.registerCommand('azurePipelines.clickServiceConnection', (connection: ServiceEndpoint) =>
                this.viewDetails(connection)
            )
        );
    }

    private refreshConnections(): void {
        this.provider.refresh();
    }

    private async createConnection(): Promise<void> {
        if (!LicenseManager.getInstance().isPremium()) {
            LicenseManager.getInstance().showUpgradePrompt('Create Service Connection');
            return;
        }
        const type = await vscode.window.showQuickPick([
            { label: 'Azure Resource Manager', value: 'AzureRM' },
            { label: 'Generic', value: 'Generic' },
            { label: 'GitHub', value: 'GitHub' },
            { label: 'Docker Registry', value: 'DockerRegistry' },
            { label: 'Kubernetes', value: 'Kubernetes' }
        ], {
            placeHolder: 'Select connection type'
        });

        if (!type) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter connection name',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name is required';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            let connectionData: any;

            switch (type.value) {
                case 'Generic':
                    connectionData = await this.createGenericConnection(name);
                    break;
                case 'AzureRM':
                    vscode.window.showInformationMessage('Azure RM connections require complex setup. Please use Azure DevOps portal.');
                    return;
                default:
                    vscode.window.showInformationMessage(`${type.label} connections require complex setup. Please use Azure DevOps portal.`);
                    return;
            }

            if (connectionData) {
                await this.client.createServiceEndpoint(connectionData);
                vscode.window.showInformationMessage(`Service connection '${name}' created successfully`);
                this.provider.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create connection: ${error}`);
        }
    }

    private async createGenericConnection(name: string): Promise<any> {
        const url = await vscode.window.showInputBox({
            prompt: 'Enter server URL',
            placeHolder: 'https://your-server.com'
        });

        if (!url) {
            return null;
        }

        const username = await vscode.window.showInputBox({
            prompt: 'Enter username',
            placeHolder: 'username'
        });

        if (!username) {
            return null;
        }

        const password = await vscode.window.showInputBox({
            prompt: 'Enter password',
            password: true
        });

        if (!password) {
            return null;
        }

        const config = this.client.getConfig();
        const projectId = await this.getProjectId();

        return {
            name,
            type: 'Generic',
            url,
            authorization: {
                parameters: {
                    username,
                    password
                },
                scheme: 'UsernamePassword'
            },
            isShared: false,
            isReady: true,
            serviceEndpointProjectReferences: [{
                projectReference: {
                    id: projectId,
                    name: config.projectName
                },
                name
            }]
        };
    }

    private async editConnection(connection: ServiceEndpoint): Promise<void> {
        if (!LicenseManager.getInstance().isPremium()) {
            LicenseManager.getInstance().showUpgradePrompt('Edit Service Connection');
            return;
        }
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            value: connection.name
        });

        if (!newName || newName === connection.name) {
            return;
        }

        try {
            // Prepare update payload with required fields
            const updated = {
                id: connection.id,
                name: newName,
                type: connection.type,
                url: connection.url,
                description: connection.description || '',
                authorization: connection.authorization,
                isShared: connection.isShared,
                isReady: connection.isReady,
                owner: connection.owner || 'Library',
                serviceEndpointProjectReferences: connection.serviceEndpointProjectReferences || []
            };
            
            await this.client.updateServiceEndpoint(connection.id, updated);
            vscode.window.showInformationMessage(`Connection renamed to '${newName}'`);
            this.provider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update connection: ${error}`);
        }
    }

    private async deleteConnection(connection: ServiceEndpoint): Promise<void> {
        if (!LicenseManager.getInstance().isPremium()) {
            LicenseManager.getInstance().showUpgradePrompt('Delete Service Connection');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(
            `Delete service connection '${connection.name}'?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        try {
            const projectId = await this.getProjectId();
            await this.client.deleteServiceEndpoint(connection.id, projectId);
            vscode.window.showInformationMessage(`Connection '${connection.name}' deleted`);
            this.provider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete connection: ${error}`);
        }
    }

    private async viewDetails(connection: ServiceEndpoint): Promise<void> {
        ServiceConnectionPanel.show(connection, this.client, () => this.provider.refresh());
    }

    private async getProjectId(): Promise<string> {
        const config = this.client.getConfig();
        const projects = await this.client.getProjects(config.organizationUrl);
        const project = projects.find(p => p.name === config.projectName);
        return project?.id || '';
    }
}
