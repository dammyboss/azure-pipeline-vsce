# VSCode Extension Implementation Guide for Azure DevOps Service Endpoints

## Project Structure

```
src/
├── serviceEndpoints/
│   ├── serviceEndpointManager.ts      # Core API client
│   ├── serviceEndpointTypes.ts        # Type definitions
│   ├── serviceEndpointTreeView.ts     # Tree view provider
│   ├── serviceEndpointCommands.ts     # Command handlers
│   └── serviceEndpointForms.ts        # Form dialogs
├── authentication/
│   └── authProvider.ts               # Authentication handling
└── extension.ts                      # Extension entry point
```

## 1. Core Type Definitions

```typescript
// src/serviceEndpoints/serviceEndpointTypes.ts

export interface ServiceEndpoint {
  id: string;
  name: string;
  type: string;
  url: string;
  description?: string;
  authorization: EndpointAuthorization;
  data: Record<string, any>;
  isReady: boolean;
  isShared: boolean;
  owner: 'library' | 'agentcloud';
  createdBy: IdentityRef;
  serviceEndpointProjectReferences: ServiceEndpointProjectReference[];
  operationStatus?: any;
}

export interface EndpointAuthorization {
  parameters: Record<string, string>;
  scheme: string;
}

export interface IdentityRef {
  displayName: string;
  id: string;
  uniqueName: string;
  descriptor: string;
  imageUrl?: string;
}

export interface ServiceEndpointProjectReference {
  projectReference: ProjectReference;
  name: string;
  description?: string;
}

export interface ProjectReference {
  id: string;
  name: string;
}

export interface CreateServiceEndpointRequest {
  name: string;
  type: string;
  url: string;
  description?: string;
  authorization: EndpointAuthorization;
  data: Record<string, any>;
  isShared: boolean;
  isReady: boolean;
  serviceEndpointProjectReferences: ServiceEndpointProjectReference[];
}

export interface UpdateServiceEndpointRequest extends CreateServiceEndpointRequest {
  id: string;
}

export enum ServiceEndpointType {
  AzureRM = 'AzureRM',
  Generic = 'Generic',
  GitHub = 'GitHub',
  DockerRegistry = 'DockerRegistry',
  Kubernetes = 'Kubernetes',
  AzureServiceBus = 'AzureServiceBus',
  SSH = 'SSH',
  Maven = 'Maven',
  NuGet = 'NuGet',
  Npm = 'npm',
  PythonUpload = 'PythonUpload',
  PythonDownload = 'PythonDownload'
}

export enum AuthorizationScheme {
  ServicePrincipal = 'ServicePrincipal',
  UsernamePassword = 'UsernamePassword',
  Token = 'Token',
  Certificate = 'Certificate',
  ManagedServiceIdentity = 'ManagedServiceIdentity'
}
```

## 2. Core API Client

```typescript
// src/serviceEndpoints/serviceEndpointManager.ts

import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import {
  ServiceEndpoint,
  CreateServiceEndpointRequest,
  UpdateServiceEndpointRequest
} from './serviceEndpointTypes';

export class ServiceEndpointManager {
  private axiosInstance: AxiosInstance;
  private organization: string;
  private project: string;

  constructor(organization: string, project: string, accessToken: string) {
    this.organization = organization;
    this.project = project;
    
    this.axiosInstance = axios.create({
      baseURL: `https://dev.azure.com/${organization}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=7.1'
      }
    });
  }

  async getAllEndpoints(
    filters?: {
      type?: string;
      authSchemes?: string[];
      includeFailed?: boolean;
      actionFilter?: string;
    }
  ): Promise<ServiceEndpoint[]> {
    try {
      const params = new URLSearchParams();
      params.append('api-version', '7.1');
      
      if (filters?.type) params.append('type', filters.type);
      if (filters?.includeFailed) params.append('includeFailed', 'true');
      if (filters?.actionFilter) params.append('actionFilter', filters.actionFilter);
      if (filters?.authSchemes) {
        filters.authSchemes.forEach(scheme => params.append('authSchemes', scheme));
      }

      const response = await this.axiosInstance.get(
        `/${this.project}/_apis/serviceendpoint/endpoints?${params.toString()}`
      );
      
      return response.data.value;
    } catch (error) {
      this.handleError(error, 'Failed to get service endpoints');
      throw error;
    }
  }

  async getEndpointById(endpointId: string): Promise<ServiceEndpoint> {
    try {
      const response = await this.axiosInstance.get(
        `/_apis/serviceendpoint/endpoints/${endpointId}?api-version=7.1`
      );
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get endpoint ${endpointId}`);
      throw error;
    }
  }

  async createEndpoint(request: CreateServiceEndpointRequest): Promise<ServiceEndpoint> {
    try {
      const response = await this.axiosInstance.post(
        '/_apis/serviceendpoint/endpoints?api-version=7.1',
        request
      );
      
      vscode.window.showInformationMessage(`Service endpoint "${request.name}" created successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to create endpoint "${request.name}"`);
      throw error;
    }
  }

  async updateEndpoint(endpointId: string, request: UpdateServiceEndpointRequest): Promise<ServiceEndpoint> {
    try {
      const response = await this.axiosInstance.put(
        `/_apis/serviceendpoint/endpoints/${endpointId}?api-version=7.1`,
        request
      );
      
      vscode.window.showInformationMessage(`Service endpoint "${request.name}" updated successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to update endpoint "${request.name}"`);
      throw error;
    }
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    try {
      await this.axiosInstance.delete(
        `/_apis/serviceendpoint/endpoints/${endpointId}?projectIds=${this.project}&api-version=7.1`
      );
      
      vscode.window.showInformationMessage('Service endpoint deleted successfully');
    } catch (error) {
      this.handleError(error, 'Failed to delete endpoint');
      throw error;
    }
  }

  async testEndpoint(endpointId: string): Promise<boolean> {
    try {
      // Some endpoints support test connection
      // This is a simplified example
      const endpoint = await this.getEndpointById(endpointId);
      return endpoint.isReady;
    } catch (error) {
      return false;
    }
  }

  private handleError(error: any, defaultMessage: string): void {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message || defaultMessage;
      vscode.window.showErrorMessage(`Azure DevOps API Error: ${message}`);
    } else {
      vscode.window.showErrorMessage(defaultMessage);
    }
  }
}
```

## 3. Tree View Implementation

```typescript
// src/serviceEndpoints/serviceEndpointTreeView.ts

import * as vscode from 'vscode';
import { ServiceEndpointManager } from './serviceEndpointManager';
import { ServiceEndpoint } from './serviceEndpointTypes';

export class ServiceEndpointTreeItem extends vscode.TreeItem {
  constructor(
    public readonly endpoint: ServiceEndpoint,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(endpoint.name, collapsibleState);
    
    this.tooltip = `${endpoint.type} - ${endpoint.url}`;
    this.description = endpoint.type;
    this.contextValue = 'serviceEndpoint';
    
    // Set icon based on endpoint type
    this.iconPath = this.getIconPath(endpoint.type);
    
    // Add context menu commands
    this.contextValue = 'serviceEndpoint';
  }

  private getIconPath(type: string): vscode.ThemeIcon {
    switch (type.toLowerCase()) {
      case 'azurerm':
        return new vscode.ThemeIcon('azure');
      case 'github':
        return new vscode.ThemeIcon('github');
      case 'dockerregistry':
        return new vscode.ThemeIcon('package');
      case 'kubernetes':
        return new vscode.ThemeIcon('server');
      case 'generic':
        return new vscode.ThemeIcon('plug');
      default:
        return new vscode.ThemeIcon('link');
    }
  }
}

export class ServiceEndpointTreeDataProvider implements vscode.TreeDataProvider<ServiceEndpointTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ServiceEndpointTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private serviceEndpointManager: ServiceEndpointManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ServiceEndpointTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ServiceEndpointTreeItem): Promise<ServiceEndpointTreeItem[]> {
    if (!element) {
      // Root level - show all endpoints
      try {
        const endpoints = await this.serviceEndpointManager.getAllEndpoints();
        return endpoints.map(endpoint => 
          new ServiceEndpointTreeItem(endpoint, vscode.TreeItemCollapsibleState.None)
        );
      } catch (error) {
        vscode.window.showErrorMessage('Failed to load service endpoints');
        return [];
      }
    }
    
    // No children for individual endpoints
    return [];
  }

  async getParent(element: ServiceEndpointTreeItem): Promise<ServiceEndpointTreeItem | undefined> {
    return undefined;
  }
}
```

## 4. Command Handlers

```typescript
// src/serviceEndpoints/serviceEndpointCommands.ts

import * as vscode from 'vscode';
import { ServiceEndpointManager } from './serviceEndpointManager';
import { ServiceEndpointTreeDataProvider } from './serviceEndpointTreeView';
import {
  ServiceEndpointType,
  AuthorizationScheme,
  CreateServiceEndpointRequest
} from './serviceEndpointTypes';

export class ServiceEndpointCommands {
  constructor(
    private serviceEndpointManager: ServiceEndpointManager,
    private treeDataProvider: ServiceEndpointTreeDataProvider
  ) {}

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.refresh', () => {
        this.treeDataProvider.refresh();
      }),

      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.create', async () => {
        await this.createServiceEndpoint();
      }),

      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.edit', async (endpointId: string) => {
        await this.editServiceEndpoint(endpointId);
      }),

      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.delete', async (endpointId: string) => {
        await this.deleteServiceEndpoint(endpointId);
      }),

      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.test', async (endpointId: string) => {
        await this.testServiceEndpoint(endpointId);
      }),

      vscode.commands.registerCommand('azureDevOps.serviceEndpoints.copyId', async (endpointId: string) => {
        await vscode.env.clipboard.writeText(endpointId);
        vscode.window.showInformationMessage('Endpoint ID copied to clipboard');
      })
    );
  }

  private async createServiceEndpoint(): Promise<void> {
    // Step 1: Select endpoint type
    const endpointType = await vscode.window.showQuickPick(
      Object.values(ServiceEndpointType),
      { placeHolder: 'Select endpoint type' }
    );
    
    if (!endpointType) return;

    // Step 2: Collect basic information
    const name = await vscode.window.showInputBox({
      prompt: 'Enter endpoint name',
      validateInput: (value) => value ? null : 'Name is required'
    });
    
    if (!name) return;

    const url = await vscode.window.showInputBox({
      prompt: 'Enter endpoint URL',
      placeHolder: 'https://example.com'
    });
    
    if (!url) return;

    // Step 3: Collect authorization based on type
    const authorization = await this.collectAuthorization(endpointType);
    if (!authorization) return;

    // Step 4: Create the endpoint
    const request: CreateServiceEndpointRequest = {
      name,
      type: endpointType,
      url,
      authorization,
      data: this.getDefaultDataForType(endpointType),
      isShared: false,
      isReady: true,
      serviceEndpointProjectReferences: [{
        projectReference: {
          id: 'project-id', // You'll need to get this from context
          name: 'project-name'
        },
        name
      }]
    };

    try {
      await this.serviceEndpointManager.createEndpoint(request);
      this.treeDataProvider.refresh();
    } catch (error) {
      // Error already handled by serviceEndpointManager
    }
  }

  private async collectAuthorization(endpointType: string): Promise<any> {
    switch (endpointType) {
      case ServiceEndpointType.AzureRM:
        return await this.collectAzureRMAuthorization();
      case ServiceEndpointType.Generic:
        return await this.collectGenericAuthorization();
      case ServiceEndpointType.GitHub:
        return await this.collectGitHubAuthorization();
      default:
        return await this.collectGenericAuthorization();
    }
  }

  private async collectAzureRMAuthorization(): Promise<any> {
    const tenantId = await vscode.window.showInputBox({
      prompt: 'Enter Azure Tenant ID',
      placeHolder: '00000000-0000-0000-0000-000000000000'
    });
    
    const servicePrincipalId = await vscode.window.showInputBox({
      prompt: 'Enter Service Principal ID',
      placeHolder: '00000000-0000-0000-0000-000000000000'
    });
    
    const servicePrincipalKey = await vscode.window.showInputBox({
      prompt: 'Enter Service Principal Key',
      password: true
    });

    if (!tenantId || !servicePrincipalId || !servicePrincipalKey) {
      return null;
    }

    return {
      parameters: {
        tenantid: tenantId,
        serviceprincipalid: servicePrincipalId,
        authenticationType: 'spnKey',
        serviceprincipalkey: servicePrincipalKey
      },
      scheme: AuthorizationScheme.ServicePrincipal
    };
  }

  private async collectGenericAuthorization(): Promise<any> {
    const username = await vscode.window.showInputBox({
      prompt: 'Enter username',
      placeHolder: 'username'
    });
    
    const password = await vscode.window.showInputBox({
      prompt: 'Enter password',
      password: true
    });

    if (!username || !password) {
      return null;
    }

    return {
      parameters: {
        username,
        password
      },
      scheme: AuthorizationScheme.UsernamePassword
    };
  }

  private async collectGitHubAuthorization(): Promise<any> {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter GitHub Personal Access Token',
      password: true
    });

    if (!token) {
      return null;
    }

    return {
      parameters: {
        apitoken: token
      },
      scheme: AuthorizationScheme.Token
    };
  }

  private getDefaultDataForType(endpointType: string): Record<string, any> {
    switch (endpointType) {
      case ServiceEndpointType.AzureRM:
        return {
          subscriptionId: '',
          subscriptionName: '',
          environment: 'AzureCloud',
          scopeLevel: 'Subscription',
          creationMode: 'Manual'
        };
      default:
        return {};
    }
  }

  private async editServiceEndpoint(endpointId: string): Promise<void> {
    try {
      const endpoint = await this.serviceEndpointManager.getEndpointById(endpointId);
      
      // Show edit form with current values
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new endpoint name',
        value: endpoint.name
      });
      
      if (!newName) return;

      // Update the endpoint
      const updateRequest = {
        ...endpoint,
        name: newName
      };

      await this.serviceEndpointManager.updateEndpoint(endpointId, updateRequest);
      this.treeDataProvider.refresh();
    } catch (error) {
      // Error already handled
    }
  }

  private async deleteServiceEndpoint(endpointId: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to delete this service endpoint?',
      { modal: true },
      'Delete'
    );
    
    if (confirm === 'Delete') {
      try {
        await this.serviceEndpointManager.deleteEndpoint(endpointId);
        this.treeDataProvider.refresh();
      } catch (error) {
        // Error already handled
      }
    }
  }

  private async testServiceEndpoint(endpointId: string): Promise<void> {
    const isReady = await this.serviceEndpointManager.testEndpoint(endpointId);
    
    if (isReady) {
      vscode.window.showInformationMessage('Service endpoint connection test successful');
    } else {
      vscode.window.showWarningMessage('Service endpoint connection test failed');
    }
  }
}
```

## 5. Extension Entry Point

```typescript
// src/extension.ts

import * as vscode from 'vscode';
import { ServiceEndpointManager } from './serviceEndpoints/serviceEndpointManager';
import { ServiceEndpointTreeDataProvider } from './serviceEndpoints/serviceEndpointTreeView';
import { ServiceEndpointCommands } from './serviceEndpoints/serviceEndpointCommands';
import { AuthProvider } from './authentication/authProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Azure DevOps Service Endpoints extension activated');

  // Initialize authentication
  const authProvider = new AuthProvider(context);
  
  // Wait for authentication to complete
  authProvider.authenticate().then(async (authResult) => {
    if (!authResult) {
      vscode.window.showErrorMessage('Authentication failed. Please sign in to Azure DevOps.');
      return;
    }

