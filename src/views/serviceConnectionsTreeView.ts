import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { ServiceEndpoint } from '../models/types';

export class ServiceConnectionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly connection: ServiceEndpoint,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(connection.name, collapsibleState);

        this.tooltip = this.buildTooltip();
        this.description = connection.type;
        this.contextValue = 'serviceConnection';
        this.iconPath = this.getIcon();
        
        // Enable click to view details
        this.command = {
            command: 'azurePipelines.clickServiceConnection',
            title: 'View Details',
            arguments: [connection]
        };
    }

    private buildTooltip(): string {
        return [
            `Name: ${this.connection.name}`,
            `Type: ${this.connection.type}`,
            `Status: ${this.connection.isReady ? 'Ready' : 'Not Ready'}`,
            `ID: ${this.connection.id}`
        ].join('\n');
    }

    private getIcon(): vscode.ThemeIcon {
        if (!this.connection.isReady) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        }
        
        // Icon based on type
        switch (this.connection.type.toLowerCase()) {
            case 'azurerm':
                return new vscode.ThemeIcon('azure', new vscode.ThemeColor('charts.blue'));
            case 'github':
                return new vscode.ThemeIcon('github');
            case 'dockerregistry':
                return new vscode.ThemeIcon('package');
            case 'kubernetes':
                return new vscode.ThemeIcon('server-environment');
            default:
                return new vscode.ThemeIcon('plug');
        }
    }
}

export class ServiceConnectionsTreeProvider implements vscode.TreeDataProvider<ServiceConnectionTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ServiceConnectionTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private connections: ServiceEndpoint[] = [];

    constructor(private client: AzureDevOpsClient) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServiceConnectionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServiceConnectionTreeItem): Promise<ServiceConnectionTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            this.connections = await this.client.getServiceEndpoints();
            
            return this.connections.map(
                conn => new ServiceConnectionTreeItem(conn, vscode.TreeItemCollapsibleState.None)
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load service connections: ${error}`);
            return [];
        }
    }

    getConnections(): ServiceEndpoint[] {
        return this.connections;
    }
}
