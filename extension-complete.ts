// Complete extension.ts implementation
import * as vscode from 'vscode';
import { ServiceEndpointManager } from './serviceEndpoints/serviceEndpointManager';
import { ServiceEndpointTreeDataProvider } from './serviceEndpoints/serviceEndpointTreeView';
import { ServiceEndpointCommands } from './serviceEndpoints/serviceEndpointCommands';

export function activate(context: vscode.ExtensionContext) {
  console.log('Azure DevOps Service Endpoints extension activated');

  // Configuration
  const config = vscode.workspace.getConfiguration('azureDevOps');
  const organization = config.get<string>('organization') || '';
  const project = config.get<string>('project') || '';
  const accessToken = config.get<string>('accessToken') || '';

  if (!organization || !project || !accessToken) {
    vscode.window.showErrorMessage(
      'Please configure Azure DevOps settings in your workspace settings. ' +
      'Required: organization, project, and accessToken.'
    );
    return;
  }

  // Initialize services
  const serviceEndpointManager = new ServiceEndpointManager(organization, project, accessToken);
  const treeDataProvider = new ServiceEndpointTreeDataProvider(serviceEndpointManager);
  const commands = new ServiceEndpointCommands(serviceEndpointManager, treeDataProvider);

  // Register tree view
  const treeView = vscode.window.createTreeView('azureDevOpsServiceEndpoints', {
    treeDataProvider,
    showCollapseAll: true
  });

  // Register commands
  commands.registerCommands(context);

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('azureDevOps.serviceEndpoints.refresh', () => {
      treeDataProvider.refresh();
    })
  );

  // Register configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('azureDevOps')) {
        vscode.window.showInformationMessage(
          'Azure DevOps configuration changed. Please reload the window.'
        );
      }
    })
  );

  // Initial load
  treeDataProvider.refresh();
}

export function deactivate() {
  console.log('Azure DevOps Service Endpoints extension deactivated');
}