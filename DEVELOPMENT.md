# Development Guide

## Current Status

The Azure DevOps Pipelines VSCode extension is now functional with core features implemented:

### ✅ Completed Features

1. **Authentication**
   - OAuth 2.0 using Microsoft account (no PAT required)
   - Secure token storage
   - Automatic session restoration

2. **Azure DevOps API Client**
   - Full REST API wrapper for Azure DevOps v7.0
   - Error handling and retry logic
   - Token injection via axios interceptors

3. **Configuration Management**
   - Organization and project selection
   - Persistent storage of user preferences
   - Easy switching between organizations/projects

4. **Pipeline Management**
   - View all pipelines in a project
   - Run pipelines with branch selection
   - Grouped by folder structure

5. **Pipeline Runs**
   - View recent runs (up to 50)
   - Real-time status updates
   - Color-coded status indicators
   - Auto-refresh every 30 seconds

6. **Run Operations**
   - Run/Cancel/Retry pipelines
   - View logs in text editor
   - Download artifacts
   - Open runs in browser

7. **UI/UX**
   - TreeView for pipelines and runs
   - Status bar integration
   - Context menus
   - Command palette commands
   - Welcome view for unauthenticated users

## Testing the Extension

### Running in Development Mode

1. Open the project in VSCode
2. Press `F5` to launch Extension Development Host
3. In the new window:
   - Click the Azure Pipelines icon in the Activity Bar
   - Click "Sign In"
   - Authenticate with your Microsoft account
   - Select organization and project
   - Start using the extension!

### Debugging

- Set breakpoints in TypeScript files
- View logs in Debug Console
- Inspect variables and call stacks
- Extension reloads automatically on file changes (when using watch mode)

## Next Steps - Additional Features to Implement

### Priority 1: Enhanced Viewing & Monitoring

#### 1. WebView for Run Details
Create rich HTML views for pipeline runs:

**File to create:** [src/webviews/runDetailsPanel.ts](src/webviews/runDetailsPanel.ts)

Features:
- Multi-stage pipeline visualization
- Timeline view with stage/job/task hierarchy
- Real-time log streaming
- Artifact listing
- Test results integration
- Code coverage display

#### 2. Notifications System
**File to create:** [src/utils/notificationManager.ts](src/utils/notificationManager.ts)

Features:
- Watch specific pipelines
- Desktop notifications on status changes
- Configurable notification rules
- Failed run alerts with quick actions

#### 3. Pipeline Analytics Dashboard
**File to create:** [src/webviews/analyticsPanel.ts](src/webviews/analyticsPanel.ts)

Features:
- Success/failure rates
- Average run duration
- Trends over time
- Most active pipelines
- Charts using Chart.js

### Priority 2: YAML Editing & Pipeline Creation

#### 4. YAML Editor with IntelliSense
**Files to create:**
- [src/language/yamlCompletion.ts](src/language/yamlCompletion.ts)
- [src/language/yamlValidation.ts](src/language/yamlValidation.ts)

Features:
- Auto-completion for tasks
- Task parameter hints
- Schema validation
- Syntax highlighting
- Snippet library for common patterns

#### 5. Pipeline Templates
**File to create:** [src/templates/pipelineTemplates.ts](src/templates/pipelineTemplates.ts)

Features:
- Pre-built pipeline templates
- Template wizard
- Custom template creation
- Template sharing

### Priority 3: Variables & Configuration

#### 6. Variable Management
**File to create:** [src/views/variablesTreeView.ts](src/views/variablesTreeView.ts)

Features:
- View pipeline variables
- Add/edit/delete variables
- Secret variable management
- Variable groups
- Link variables to pipelines

#### 7. Service Connections
**File to create:** [src/views/connectionsTreeView.ts](src/views/connectionsTreeView.ts)

Features:
- List all service connections
- Create new connections (Azure, GitHub, Docker, etc.)
- Test connections
- Edit connection settings

### Priority 4: Environments & Approvals

#### 8. Environments View
**File to create:** [src/views/environmentsTreeView.ts](src/views/environmentsTreeView.ts)

Features:
- List all environments
- View environment resources
- Deployment history
- Environment variables

#### 9. Approval Management
**File to create:** [src/views/approvalsTreeView.ts](src/views/approvalsTreeView.ts)

Features:
- Pending approvals view
- Approve/reject deployments
- Add approval comments
- Configure approval gates
- Notifications for pending approvals

### Priority 5: Advanced Features

#### 10. Agent Pool Management
**File to create:** [src/views/agentPoolsTreeView.ts](src/views/agentPoolsTreeView.ts)

Features:
- View agent pools
- Check agent status
- View running jobs
- Agent capabilities
- Pool statistics

#### 11. Multi-Pipeline Operations
**File to create:** [src/commands/bulkOperations.ts](src/commands/bulkOperations.ts)

Features:
- Run multiple pipelines
- Bulk status checks
- Parallel execution monitoring
- Dependency chain visualization

#### 12. Search & Filters
**File to create:** [src/utils/searchProvider.ts](src/utils/searchProvider.ts)

Features:
- Search pipelines by name
- Filter runs by status, branch, date
- Saved filter presets
- Quick filters in views

## Code Examples for Common Extensions

### Adding a New TreeView

```typescript
// 1. Create the tree item class
export class MyTreeItem extends vscode.TreeItem {
    constructor(public readonly data: MyData) {
        super(data.name, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('symbol-class');
    }
}

// 2. Create the provider
export class MyTreeProvider implements vscode.TreeDataProvider<MyTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MyTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: MyTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: MyTreeItem): Promise<MyTreeItem[]> {
        // Fetch and return items
        return [];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

// 3. Register in extension.ts
const myTreeProvider = new MyTreeProvider(client);
const treeView = vscode.window.createTreeView('myView', {
    treeDataProvider: myTreeProvider
});
context.subscriptions.push(treeView);
```

### Adding a WebView Panel

```typescript
export class MyWebViewPanel {
    private panel: vscode.WebviewPanel | undefined;

    show() {
        this.panel = vscode.window.createWebviewPanel(
            'myView',
            'My View',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getHtmlContent();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(message => {
            // Handle message
        });
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>My View</title>
        </head>
        <body>
            <h1>Hello World</h1>
            <script>
                const vscode = acquireVsCodeApi();
                // Send message to extension
                vscode.postMessage({ command: 'myCommand' });
            </script>
        </body>
        </html>`;
    }
}
```

### Adding API Methods

```typescript
// In azureDevOpsClient.ts

/**
 * Get variable groups
 */
async getVariableGroups(): Promise<VariableGroup[]> {
    const response = await this.axiosInstance.get(
        `${this.organizationUrl}/${this.projectName}/_apis/distributedtask/variablegroups`,
        { params: { 'api-version': '7.0' } }
    );
    return response.data.value;
}
```

## Testing Guidelines

### Unit Tests
Create tests in `src/test/` directory:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    test('Authentication test', async () => {
        // Test authentication logic
    });
});
```

### Manual Testing Checklist

- [ ] Authentication flow works
- [ ] Organization/project selection works
- [ ] Pipelines load correctly
- [ ] Runs display with correct status
- [ ] Run pipeline command works
- [ ] Cancel run works
- [ ] Logs display correctly
- [ ] Artifact download works
- [ ] Auto-refresh works
- [ ] Status bar updates
- [ ] Error handling displays user-friendly messages

## Publishing

### Prepare for Publishing

1. Update `package.json`:
   - Set correct publisher name
   - Update version
   - Add repository URL
   - Add icon (create 128x128 PNG)

2. Create CHANGELOG.md

3. Package extension:
   ```bash
   npm run package
   ```

4. Test the .vsix file:
   ```bash
   code --install-extension azure-devops-pipelines-0.1.0.vsix
   ```

5. Publish to marketplace:
   ```bash
   npm run publish
   ```

## Contributing

### Code Style
- Use TypeScript strict mode
- Follow ESLint rules
- Add JSDoc comments for public APIs
- Use async/await for asynchronous operations
- Handle errors gracefully

### Git Workflow
1. Create feature branch
2. Make changes
3. Test thoroughly
4. Create pull request
5. Code review
6. Merge to main

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/)
- [VSCode Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    VSCode Extension                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐   ┌──────────────┐  ┌─────────────┐ │
│  │ TreeViews    │   │  Commands    │  │  WebViews   │ │
│  │              │   │              │  │             │ │
│  │ - Pipelines  │   │ - Run        │  │ - Details   │ │
│  │ - Runs       │   │ - Cancel     │  │ - Analytics │ │
│  │ - Envs       │   │ - Retry      │  │ - Editor    │ │
│  └──────┬───────┘   └──────┬───────┘  └──────┬──────┘ │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                   ┌────────▼────────┐                   │
│                   │  API Client     │                   │
│                   │                 │                   │
│                   │ - Axios wrapper │                   │
│                   │ - Auth inject   │                   │
│                   │ - Error handle  │                   │
│                   └────────┬────────┘                   │
│                            │                            │
│                   ┌────────▼────────┐                   │
│                   │ Auth Provider   │                   │
│                   │                 │                   │
│                   │ - OAuth 2.0     │                   │
│                   │ - Token mgmt    │                   │
│                   └─────────────────┘                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
                ┌──────────────────────┐
                │  Azure DevOps API    │
                │  (REST v7.0)         │
                └──────────────────────┘
```

## Support

For questions or issues during development:
- Check the VSCode Extension API documentation
- Review Azure DevOps REST API docs
- Check existing GitHub issues
- Create new issue with detailed description
