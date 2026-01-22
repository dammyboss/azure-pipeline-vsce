import * as vscode from 'vscode';
import { AzureDevOpsAuthProvider } from './authentication/authProvider';
import { AzureDevOpsClient } from './api/azureDevOpsClient';
import { ConfigManager } from './utils/configManager';
import { PipelinesTreeProvider } from './views/pipelinesTreeView';
import { RunsTreeProvider } from './views/runsTreeView';
import { ServiceConnectionsTreeProvider } from './views/serviceConnectionsTreeView';
import { PipelineCommands } from './commands/pipelineCommands';
import { ServiceConnectionCommands } from './commands/serviceConnectionCommands';

let authProvider: AzureDevOpsAuthProvider;
let client: AzureDevOpsClient;
let configManager: ConfigManager;
let pipelinesProvider: PipelinesTreeProvider;
let runsProvider: RunsTreeProvider;
let serviceConnectionsProvider: ServiceConnectionsTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Azure DevOps Pipelines extension is now active');

    // Initialize authentication provider
    authProvider = new AzureDevOpsAuthProvider(context);
    await authProvider.initialize();

    // Register authentication listeners
    context.subscriptions.push(...authProvider.registerListeners());

    // Initialize API client
    client = new AzureDevOpsClient(authProvider);

    // Initialize config manager
    configManager = new ConfigManager(context, client);

    // Initialize tree providers
    pipelinesProvider = new PipelinesTreeProvider(client);
    runsProvider = new RunsTreeProvider(client);
    serviceConnectionsProvider = new ServiceConnectionsTreeProvider(client);

    // Register tree views
    const pipelinesTreeView = vscode.window.createTreeView('azurePipelines', {
        treeDataProvider: pipelinesProvider,
        showCollapseAll: true
    });

    const runsTreeView = vscode.window.createTreeView('azurePipelinesRuns', {
        treeDataProvider: runsProvider,
        showCollapseAll: true
    });

    const serviceConnectionsTreeView = vscode.window.createTreeView('azurePipelinesServiceConnections', {
        treeDataProvider: serviceConnectionsProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(pipelinesTreeView, runsTreeView, serviceConnectionsTreeView);

    // Initialize commands
    const pipelineCommands = new PipelineCommands(client, pipelinesProvider, runsProvider);
    pipelineCommands.register(context);

    const serviceConnectionCommands = new ServiceConnectionCommands(client, serviceConnectionsProvider);
    serviceConnectionCommands.register(context);

    // Register authentication commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azurePipelines.signIn', async () => {
            await authProvider.signIn();
            await setupAfterAuth();
        }),
        vscode.commands.registerCommand('azurePipelines.signOut', async () => {
            await authProvider.signOut();
            await configManager.clear();
            pipelinesProvider.refresh();
            runsProvider.refresh();
            updateStatusBar();
        }),
        vscode.commands.registerCommand('azurePipelines.selectOrganization', async () => {
            const isAuth = await authProvider.isAuthenticated();
            if (!isAuth) {
                vscode.window.showWarningMessage('Please sign in first');
                return;
            }
            await configManager.promptForConfiguration();
            pipelinesProvider.refresh();
            runsProvider.refresh();
            updateStatusBar();
        })
    );

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'azurePipelines.selectOrganization';
    context.subscriptions.push(statusBarItem);

    // Check if already authenticated and configured
    const isAuth = await authProvider.isAuthenticated();
    if (isAuth) {
        await setupAfterAuth();
    } else {
        updateStatusBar();
    }

    // Set up auto-refresh for runs (every 30 seconds)
    const refreshInterval = setInterval(() => {
        if (configManager.isConfigured()) {
            runsProvider.refresh();
        }
    }, 30000);

    context.subscriptions.push({
        dispose: () => clearInterval(refreshInterval)
    });
}

/**
 * Setup extension after authentication
 */
async function setupAfterAuth(): Promise<void> {
    const isConfigured = await configManager.initializeClient();

    if (!isConfigured) {
        // Prompt for organization and project selection
        const configured = await configManager.promptForConfiguration();

        if (!configured) {
            vscode.window.showWarningMessage('Extension not configured. Please select an organization and project.');
            updateStatusBar();
            return;
        }
    }

    // Refresh views
    pipelinesProvider.refresh();
    runsProvider.refresh();
    serviceConnectionsProvider.refresh();
    updateStatusBar();
}

/**
 * Update status bar
 */
function updateStatusBar(): void {
    const orgName = configManager.getOrganizationName();
    const projectName = configManager.getProjectName();

    if (orgName && projectName) {
        statusBarItem.text = `$(azure-devops) ${orgName} / ${projectName}`;
        statusBarItem.tooltip = 'Click to change organization/project';
        statusBarItem.show();
    } else {
        statusBarItem.text = '$(azure-devops) Azure Pipelines';
        statusBarItem.tooltip = 'Click to configure';
        statusBarItem.show();
    }
}

export function deactivate() {
    console.log('Azure DevOps Pipelines extension is now deactivated');
}
