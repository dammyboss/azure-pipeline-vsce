# Azure DevOps Pipelines for VSCode

Manage your Azure DevOps Pipelines directly from Visual Studio Code. View, run, monitor, and control your CI/CD pipelines without leaving your editor.

## Features

### Authentication
- OAuth 2.0 authentication using Microsoft accounts
- No Personal Access Token (PAT) required
- Secure token management using VSCode's SecretStorage API
- Automatic token refresh

### Pipeline Management
- View all pipelines in your organization/project
- Run pipelines with branch selection
- View pipeline definitions
- Group pipelines by folder
- Quick access to pipeline settings

### Pipeline Runs
- View recent pipeline runs
- Real-time status updates
- Filter runs by pipeline, branch, or status
- Auto-refresh every 30 seconds
- Color-coded status indicators:
  - Success (green)
  - Failed (red)
  - Running (blue, animated)
  - Canceled (gray)

### Run Operations
- Run pipelines with custom branch selection
- Cancel running pipelines
- Retry failed runs
- View detailed run information
- Download run logs
- Download artifacts
- Open runs in browser

### Status Bar Integration
- Shows current organization and project
- Quick access to configuration
- Click to change organization/project

## Getting Started

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Press `F5` to open a new VSCode window with the extension loaded

### First Time Setup

1. Click the Azure Pipelines icon in the Activity Bar
2. Click "Sign In" when prompted
3. Authenticate with your Microsoft account
4. Select your Azure DevOps organization
5. Select your project
6. Start managing your pipelines!

## Usage

### Viewing Pipelines

- Open the Azure Pipelines view from the Activity Bar
- Browse all pipelines in your project
- Click on a pipeline to view its recent runs

### Running a Pipeline

- Right-click on a pipeline in the Pipelines view
- Select "Run Pipeline"
- Choose a branch to run (if applicable)
- The pipeline will start and appear in the Recent Runs view

### Viewing Run Details

- Click on any run in the Recent Runs view
- View run logs by right-clicking and selecting "View Run Logs"
- Download artifacts from completed runs
- Cancel running pipelines
- Retry failed runs

### Managing Configuration

- Click the status bar item showing your org/project
- Or use Command Palette: "Azure Pipelines: Select Organization/Project"
- Choose a different organization or project

## Commands

Access these commands from the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`):

- `Azure Pipelines: Sign In to Azure DevOps` - Authenticate with Microsoft account
- `Azure Pipelines: Sign Out` - Sign out from Azure DevOps
- `Azure Pipelines: Select Organization/Project` - Change active organization/project
- `Azure Pipelines: Refresh Pipelines` - Refresh the pipelines list
- `Azure Pipelines: Refresh Runs` - Refresh the runs list

## Configuration

Configure the extension in VSCode Settings:

- `azurePipelines.autoRefreshInterval` - Auto-refresh interval in seconds (default: 30)
- `azurePipelines.maxRunsToShow` - Maximum number of recent runs to display (default: 50)
- `azurePipelines.showNotifications` - Show notifications for pipeline events (default: true)

## Development

### Project Structure

```
├── src/
│   ├── authentication/
│   │   └── authProvider.ts         # OAuth authentication
│   ├── api/
│   │   └── azureDevOpsClient.ts    # API client wrapper
│   ├── models/
│   │   └── types.ts                # TypeScript interfaces
│   ├── views/
│   │   ├── pipelinesTreeView.ts    # Pipelines tree view
│   │   └── runsTreeView.ts         # Runs tree view
│   ├── commands/
│   │   └── pipelineCommands.ts     # Command handlers
│   ├── utils/
│   │   └── configManager.ts        # Configuration management
│   └── extension.ts                # Extension entry point
├── package.json                     # Extension manifest
└── tsconfig.json                    # TypeScript configuration
```

### Building

```bash
# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Lint code
npm run lint

# Package extension
npm run package
```

### Debugging

1. Open the project in VSCode
2. Press `F5` to start debugging
3. A new Extension Development Host window will open
4. Set breakpoints in your TypeScript files
5. The extension will reload on file changes

## API Coverage

This extension uses the Azure DevOps REST API v7.0 to interact with:

- **Core Services** - Organizations, projects
- **Build API** - Pipelines, runs, artifacts
- **Distributed Task API** - Environments, agent pools
- **Git API** - Repositories, branches
- **Service Endpoint API** - Service connections

## Roadmap

Future features planned:

- WebView for detailed run visualization
- YAML editor with IntelliSense
- Pipeline templates management
- Variable and variable group management
- Approval/gate management
- Environment management
- Service connection management
- Agent pool management
- Pipeline analytics and insights
- Multi-stage pipeline visualization
- Bulk operations

## Requirements

- Visual Studio Code 1.85.0 or higher
- Azure DevOps account with appropriate permissions
- Microsoft account for authentication

## Known Issues

- None at this time

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Acknowledgments

- Built using the official Azure DevOps REST API
- Uses VSCode's built-in Microsoft authentication provider
- Icons from VSCode's Codicon library
