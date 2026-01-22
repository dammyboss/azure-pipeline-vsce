# Azure DevOps Service Endpoints (Connection Strings) API Reference

## Overview
Service endpoints (also known as service connections) in Azure DevOps allow communication with external services like Azure, GitHub, Kubernetes, Docker registries, and other third-party services. They securely store authentication credentials and connection details.

## REST API Base URL
```
https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints
```

## API Version
Use API version `7.1` for all operations.

## Authentication
Required scope: `vso.serviceendpoint_manage` (for create, update, delete) or `vso.serviceendpoint` (for read operations).

## Core Operations

### 1. Create Service Endpoint
**POST** `https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints?api-version=7.1`

#### Request Body
```json
{
  "data": {
    "subscriptionId": "1272a66f-e2e8-4e88-ab43-487409186c3f",
    "subscriptionName": "subscriptionName",
    "environment": "AzureCloud",
    "scopeLevel": "Subscription",
    "creationMode": "Manual"
  },
  "name": "MyNewARMServiceEndpoint",
  "type": "AzureRM",
  "url": "https://management.azure.com/",
  "authorization": {
    "parameters": {
      "tenantid": "1272a66f-e2e8-4e88-ab43-487409186c3f",
      "serviceprincipalid": "1272a66f-e2e8-4e88-ab43-487409186c3f",
      "authenticationType": "spnKey",
      "serviceprincipalkey": "SomePassword"
    },
    "scheme": "ServicePrincipal"
  },
  "isShared": false,
  "isReady": true,
  "serviceEndpointProjectReferences": [
    {
      "projectReference": {
        "id": "c7e5f0b3-71fa-4429-9fb3-3321963a7c06",
        "name": "TestProject"
      },
      "name": "MyNewARMServiceEndpoint"
    }
  ]
}
```

#### Common Service Endpoint Types
- **AzureRM**: Azure Resource Manager connections
- **Generic**: Generic service connections with username/password
- **GitHub**: GitHub repository connections
- **DockerRegistry**: Docker registry connections
- **Kubernetes**: Kubernetes cluster connections
- **AzureServiceBus**: Azure Service Bus connections
- **SSH**: SSH connections

### 2. Get Service Endpoints
**GET** `https://dev.azure.com/{organization}/{project}/_apis/serviceendpoint/endpoints?api-version=7.1`

#### Optional Query Parameters
- `type`: Filter by endpoint type (e.g., "Generic", "AzureRM")
- `authSchemes`: Filter by authorization schemes
- `endpointIds`: Filter by specific endpoint IDs
- `owner`: Filter by owner ("library", "agentcloud")
- `includeFailed`: Include failed endpoints (true/false)
- `includeDetails`: Include more details (internal use)
- `actionFilter`: Permission filter ("none", "manage", "use", "view")

#### Example Response
```json
{
  "count": 1,
  "value": [
    {
      "data": {},
      "id": "5e47a0d8-c745-44f8-8f93-784f18ff31c4",
      "name": "MyNewServiceEndpoint",
      "type": "Generic",
      "url": "https://myserver",
      "createdBy": { ... },
      "description": "",
      "authorization": {
        "parameters": {
          "username": "myusername"
        },
        "scheme": "UsernamePassword"
      },
      "isShared": false,
      "isReady": true,
      "owner": "Library",
      "serviceEndpointProjectReferences": [...]
    }
  ]
}
```

### 3. Get Service Endpoint Details
**GET** `https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints/{endpointId}?api-version=7.1`

### 4. Update Service Endpoint
**PUT** `https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints/{endpointId}?api-version=7.1`

#### Optional Query Parameter
- `operation`: Operation type for specific update scenarios

#### Request Body
Same structure as Create, but includes the endpoint ID.

### 5. Delete Service Endpoint
**DELETE** `https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints/{endpointId}?projectIds={projectIds}&api-version=7.1`

#### Required Parameters
- `projectIds`: Array of project IDs from which endpoint needs to be deleted

#### Optional Parameter
- `deep`: Delete the service principal created by endpoint (true/false)

### 6. Get Service Endpoints By Names
**GET** `https://dev.azure.com/{organization}/{project}/_apis/serviceendpoint/endpoints?endpointNames={endpointNames}&api-version=7.1`

### 7. Get Service Endpoints With Refreshed Authentication
**GET** `https://dev.azure.com/{organization}/{project}/_apis/serviceendpoint/endpoints?includeDetails=true&api-version=7.1`

### 8. Share Service Endpoint
**POST** `https://dev.azure.com/{organization}/_apis/serviceendpoint/endpoints/{endpointId}/share?api-version=7.1`

## Authorization Schemes

### 1. ServicePrincipal (for AzureRM)
```json
{
  "authorization": {
    "parameters": {
      "tenantid": "tenant-id",
      "serviceprincipalid": "service-principal-id",
      "authenticationType": "spnKey",
      "serviceprincipalkey": "password"
    },
    "scheme": "ServicePrincipal"
  }
}
```

### 2. UsernamePassword (for Generic endpoints)
```json
{
  "authorization": {
    "parameters": {
      "username": "myusername",
      "password": "mypassword"
    },
    "scheme": "UsernamePassword"
  }
}
```

### 3. Token (for GitHub, etc.)
```json
{
  "authorization": {
    "parameters": {
      "apitoken": "your-token"
    },
    "scheme": "Token"
  }
}
```

### 4. Certificate (for certificate-based auth)
```json
{
  "authorization": {
    "parameters": {
      "certificate": "base64-encoded-certificate",
      "certificatePassword": "password"
    },
    "scheme": "Certificate"
  }
}
```

## Common Service Endpoint Types and Their Data

### Azure Resource Manager (AzureRM)
```json
{
  "type": "AzureRM",
  "url": "https://management.azure.com/",
  "data": {
    "subscriptionId": "subscription-id",
    "subscriptionName": "subscription-name",
    "environment": "AzureCloud",
    "scopeLevel": "Subscription",
    "creationMode": "Manual"
  }
}
```

### Generic Service Endpoint
```json
{
  "type": "Generic",
  "url": "https://your-server.com",
  "data": {}
}
```

### GitHub Service Endpoint
```json
{
  "type": "GitHub",
  "url": "https://github.com",
  "data": {
    "AccessToken": "your-github-token"
  }
}
```

### Docker Registry
```json
{
  "type": "DockerRegistry",
  "url": "https://index.docker.io/v1/",
  "data": {
    "registrytype": "DockerHub"
  }
}
```

## Implementation Examples

### TypeScript/JavaScript Example
```typescript
import * as vscode from 'vscode';
import axios from 'axios';

class AzureDevOpsServiceEndpointManager {
  private organization: string;
  private project: string;
  private accessToken: string;

  constructor(organization: string, project: string, accessToken: string) {
    this.organization = organization;
    this.project = project;
    this.accessToken = accessToken;
  }

  async getServiceEndpoints(): Promise<any[]> {
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/serviceendpoint/endpoints?api-version=7.1`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.value;
  }

  async createServiceEndpoint(endpointData: any): Promise<any> {
    const url = `https://dev.azure.com/${this.organization}/_apis/serviceendpoint/endpoints?api-version=7.1`;
    
    const response = await axios.post(url, endpointData, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  async updateServiceEndpoint(endpointId: string, endpointData: any): Promise<any> {
    const url = `https://dev.azure.com/${this.organization}/_apis/serviceendpoint/endpoints/${endpointId}?api-version=7.1`;
    
    const response = await axios.put(url, endpointData, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  async deleteServiceEndpoint(endpointId: string, projectId: string): Promise<void> {
    const url = `https://dev.azure.com/${this.organization}/_apis/serviceendpoint/endpoints/${endpointId}?projectIds=${projectId}&api-version=7.1`;
    
    await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });
  }
}
```

## VSCode Extension Integration

### 1. Authentication
Use Azure DevOps Personal Access Token (PAT) or OAuth 2.0 for authentication.

### 2. Tree View Implementation
```typescript
export class ServiceEndpointsTreeDataProvider implements vscode.TreeDataProvider<ServiceEndpointItem> {
  private _onDidChangeTreeData = new EventEmitter<ServiceEndpointItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private serviceEndpointManager: AzureDevOpsServiceEndpointManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ServiceEndpointItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ServiceEndpointItem): Promise<ServiceEndpointItem[]> {
    if (!element) {
      // Root level - show all service endpoints
      const endpoints = await this.serviceEndpointManager.getServiceEndpoints();
      return endpoints.map(endpoint => new ServiceEndpointItem(
        endpoint.name,
        endpoint.type,
        endpoint.id,
        endpoint.isReady ? 'ready' : 'not-ready'
      ));
    }
    return [];
  }
}
```

### 3. Command Palette Integration
```typescript
export function activate(context: vscode.ExtensionContext) {
  const serviceEndpointManager = new AzureDevOpsServiceEndpointManager(
    'your-organization',
    'your-project',
    'your-access-token'
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('azureDevOps.serviceEndpoints.refresh', () => {
      // Refresh tree view
    }),
    vscode.commands.registerCommand('azureDevOps.serviceEndpoints.create', async () => {
      // Show create dialog
      const name = await vscode.window.showInputBox({ prompt: 'Enter endpoint name' });
      const type = await vscode.window.showQuickPick(['AzureRM', 'Generic', 'GitHub'], {
        placeHolder: 'Select endpoint type'
      });
      // ... more input collection
    }),
    vscode.commands.registerCommand('azureDevOps.serviceEndpoints.edit', async (endpointId: string) => {
      // Edit existing endpoint
    }),
    vscode.commands.registerCommand('azureDevOps.serviceEndpoints.delete', async (endpointId: string) => {
      // Delete endpoint with confirmation
    })
  );
}
```

## Error Handling

### Common HTTP Status Codes
- **200 OK**: Success
- **201 Created**: Resource created successfully
- **204 No Content**: Delete successful
- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Authentication failed
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **409 Conflict**: Resource conflict

### Error Response Example
```json
{
  "$id": "1",
  "innerException": null,
  "message": "Service endpoint with name 'MyEndpoint' already exists.",
  "typeName": "Microsoft.VisualStudio.Services.ServiceEndpoints.WebApi.ServiceEndpointExistsException, Microsoft.VisualStudio.Services.ServiceEndpoints.WebApi",
  "typeKey": "ServiceEndpointExistsException",
  "errorCode": 0,
  "eventId": 3000
}
```

## Best Practices

1. **Secure Storage**: Never store credentials in code. Use VSCode's SecretStorage or Azure Key Vault.
2. **Input Validation**: Validate all user inputs before making API calls.
3. **Error Handling**: Implement comprehensive error handling and user feedback.
4. **Rate Limiting**: Implement retry logic with exponential backoff.
5. **Caching**: Cache frequently accessed endpoints to reduce API calls.
6. **Permissions**: Check user permissions before allowing operations.

## Additional Resources

1. **Official Documentation**: https://learn.microsoft.com/en-us/rest/api/azure/devops/serviceendpoint/endpoints
2. **Service Endpoint Types**: https://learn.microsoft.com/en-us/azure/devops/pipelines/library/service-endpoints
3. **CLI Reference**: https://learn.microsoft.com/en-us/cli/azure/devops/service-endpoint
4. **Authentication Guide**: https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance

## Next Steps for Your VSCode Extension

1. Implement authentication flow (PAT or OAuth)
2. Create tree view for service endpoints
3. Add CRUD operations (Create, Read, Update, Delete)
4. Implement form dialogs for endpoint creation/editing
5. Add validation and error handling
6. Test with different endpoint types
7. Add filtering and search capabilities
8. Implement bulk operations