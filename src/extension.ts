import * as vscode from 'vscode';
import { AzureDevOpsAuthProvider } from './authentication/authProvider';
import { AzureDevOpsClient } from './api/azureDevOpsClient';
import { ConfigManager } from './utils/configManager';
import { ConnectionStatusProvider } from './views/connectionStatusProvider';
import { PipelinesTreeProvider } from './views/pipelinesTreeView';
import { RunsTreeProvider } from './views/runsTreeView';
import { StagesTreeProvider } from './views/stagesTreeView';
import { ServiceConnectionsTreeProvider } from './views/serviceConnectionsTreeView';
import { PipelineCommands } from './commands/pipelineCommands';
import { ServiceConnectionCommands } from './commands/serviceConnectionCommands';
import { PipelineCodeLensProvider } from './providers/pipelineCodeLensProvider';
import { WhatsNewPanel } from './webviews/whatsNewPanel';

let authProvider: AzureDevOpsAuthProvider;
let client: AzureDevOpsClient;
let configManager: ConfigManager;
let connectionStatusProvider: ConnectionStatusProvider;
let pipelinesProvider: PipelinesTreeProvider;
let runsProvider: RunsTreeProvider;
let stagesProvider: StagesTreeProvider;
let serviceConnectionsProvider: ServiceConnectionsTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {

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
    connectionStatusProvider = new ConnectionStatusProvider(authProvider, configManager);
    pipelinesProvider = new PipelinesTreeProvider(client);
    runsProvider = new RunsTreeProvider(client);
    stagesProvider = new StagesTreeProvider(client);
    serviceConnectionsProvider = new ServiceConnectionsTreeProvider(client);

    // Register tree views
    const connectionStatusTreeView = vscode.window.createTreeView('azurePipelinesConnection', {
        treeDataProvider: connectionStatusProvider
    });

    const pipelinesTreeView = vscode.window.createTreeView('azurePipelines', {
        treeDataProvider: pipelinesProvider,
        showCollapseAll: true
    });

    const runsTreeView = vscode.window.createTreeView('azurePipelinesRuns', {
        treeDataProvider: runsProvider,
        showCollapseAll: true
    });

    const stagesTreeView = vscode.window.createTreeView('azurePipelinesStages', {
        treeDataProvider: stagesProvider,
        showCollapseAll: true
    });

    const serviceConnectionsTreeView = vscode.window.createTreeView('azurePipelinesServiceConnections', {
        treeDataProvider: serviceConnectionsProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(connectionStatusTreeView, pipelinesTreeView, runsTreeView, stagesTreeView, serviceConnectionsTreeView);

    // Register CodeLens provider for YAML pipelines
    const codeLensProvider = new PipelineCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'yaml', pattern: '**/*.{yml,yaml}' },
            codeLensProvider
        )
    );

    // Initialize commands
    const pipelineCommands = new PipelineCommands(client, pipelinesProvider, runsProvider, stagesProvider, codeLensProvider);
    pipelineCommands.register(context);

    const serviceConnectionCommands = new ServiceConnectionCommands(client, serviceConnectionsProvider);
    serviceConnectionCommands.register(context);

    // Register authentication commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azurePipelines.signIn', async () => {
            await authProvider.signIn();
            connectionStatusProvider.refresh();
            await setupAfterAuth();
        }),
        vscode.commands.registerCommand('azurePipelines.signOut', async () => {
            await authProvider.signOut();
            await configManager.clear();
            connectionStatusProvider.refresh();
            pipelinesProvider.refresh();
            runsProvider.refresh();
            stagesProvider.clear();
            serviceConnectionsProvider.refresh();
            updateStatusBar();
        }),
        vscode.commands.registerCommand('azurePipelines.selectOrganization', async () => {
            const isAuth = await authProvider.isAuthenticated();
            if (!isAuth) {
                vscode.window.showWarningMessage('Please sign in first');
                return;
            }
            await configManager.promptForConfiguration();
            connectionStatusProvider.refresh();
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

    // Show What's New panel if this is a new version
    // This will automatically check if user has seen the current announcement
    await WhatsNewPanel.show(context);

    // Register command to manually show What's New panel
    context.subscriptions.push(
        vscode.commands.registerCommand('azurePipelines.showWhatsNew', async () => {
            await WhatsNewPanel.forceShow(context);
        })
    );

    // Set up auto-refresh for runs, pipelines, and stages (every 30 seconds)
    const refreshInterval = setInterval(async () => {
        const isAuthenticated = await authProvider.isAuthenticated();
        if (isAuthenticated && configManager.isConfigured()) {
            runsProvider.refresh();
            pipelinesProvider.refresh();
            // Only refresh stages if there's a current run loaded
            if (stagesProvider.getCurrentRun()) {
                stagesProvider.refresh();
            }
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
            connectionStatusProvider.refresh();
            updateStatusBar();
            return;
        }
    }

    // Refresh views
    connectionStatusProvider.refresh();
    pipelinesProvider.refresh();
    runsProvider.refresh();
    serviceConnectionsProvider.refresh();
    updateStatusBar();
}

/**
 * Update status bar
 */
async function updateStatusBar(): Promise<void> {
    const isAuthenticated = await authProvider.isAuthenticated();
    const orgName = configManager.getOrganizationName();
    const projectName = configManager.getProjectName();

    if (!isAuthenticated) {
        statusBarItem.text = '$(sign-in) Sign in to Azure DevOps';
        statusBarItem.tooltip = 'Click to sign in with your Microsoft account';
        statusBarItem.command = 'azurePipelines.signIn';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.show();
    } else if (orgName && projectName) {
        statusBarItem.text = `$(azure-devops) ${orgName} / ${projectName}`;
        statusBarItem.tooltip = 'Click to change organization/project';
        statusBarItem.command = 'azurePipelines.selectOrganization';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.show();
    } else {
        statusBarItem.text = '$(warning) Select Organization';
        statusBarItem.tooltip = 'Click to select an organization and project';
        statusBarItem.command = 'azurePipelines.selectOrganization';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.show();
    }
}

export function deactivate() {}
