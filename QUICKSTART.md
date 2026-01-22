# Quick Start Guide

## Running the Extension

### 1. Open the Project

```bash
cd /Users/damilolaonadeinde/Downloads/Projects/ado-pipeline-vsce
code .
```

### 2. Start Extension Development Host

Press `F5` or:
- Open Run and Debug view (`Cmd+Shift+D` or `Ctrl+Shift+D`)
- Click "Run Extension"
- A new VSCode window will open with the extension loaded

### 3. Sign In

In the Extension Development Host window:

1. Click the Azure Pipelines icon in the Activity Bar (left sidebar)
2. You'll see a welcome message
3. Click the "Sign In" button
4. Your browser will open for Microsoft authentication
5. Sign in with your Microsoft account that has access to Azure DevOps
6. Authorize the application
7. Return to VSCode

### 4. Select Organization and Project

After signing in:

1. A quick pick menu will show your Azure DevOps organizations
2. Select your organization
3. Then select a project from that organization
4. The extension will load your pipelines and recent runs

### 5. Use the Extension

Now you can:

#### View Pipelines
- See all pipelines in the "Pipelines" view
- Pipelines are sorted by folder and name
- Click a pipeline to view its runs

#### Run a Pipeline
- Right-click any pipeline
- Select "Run Pipeline"
- Choose a branch (if applicable)
- Watch it appear in the "Recent Runs" view

#### Monitor Runs
- The "Recent Runs" view shows the 50 most recent pipeline runs
- Colored icons show status:
  - 🔵 Blue spinning = Running
  - ✅ Green = Succeeded
  - ❌ Red = Failed
  - ⭕ Gray = Canceled
- Auto-refreshes every 30 seconds

#### View Logs
- Click any run in the "Recent Runs" view
- Or right-click and select "View Run Logs"
- Select which log to view
- Logs open in a new text editor

#### Download Artifacts
- Right-click a completed run
- Select "Download Artifacts"
- Choose which artifact to download
- Your browser will open the download URL

#### Cancel a Run
- Right-click a running pipeline
- Select "Cancel Run"
- Confirm the cancellation

#### Retry a Failed Run
- Right-click a failed run
- Select "Retry Run"
- A new run will be queued

## Status Bar

The status bar (bottom of VSCode) shows:
- `$(azure-devops) OrganizationName / ProjectName`
- Click it to change organization/project

## Command Palette

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) and type:

- `Azure Pipelines: Sign In`
- `Azure Pipelines: Sign Out`
- `Azure Pipelines: Select Organization/Project`
- `Azure Pipelines: Refresh Pipelines`
- `Azure Pipelines: Refresh Runs`

## Settings

Configure in VSCode Settings (`Cmd+,` or `Ctrl+,`):

```json
{
  "azurePipelines.autoRefreshInterval": 30,  // seconds
  "azurePipelines.maxRunsToShow": 50,
  "azurePipelines.showNotifications": true
}
```

## Troubleshooting

### Extension Not Loading
- Check the Debug Console for errors
- Restart Extension Development Host (`Cmd+Shift+F5`)
- Rebuild: `npm run compile`

### Authentication Fails
- Clear VSCode authentication: `Cmd+Shift+P` → "Sign Out"
- Try signing in again
- Check you have access to Azure DevOps

### No Pipelines Show Up
- Verify you selected the correct organization and project
- Check you have permissions to view pipelines
- Click the refresh button in the Pipelines view
- Check Debug Console for API errors

### Runs Not Updating
- Check auto-refresh is enabled in settings
- Manually refresh using the refresh button
- Check network connectivity to Azure DevOps

## Development Workflow

While developing:

1. Make changes to TypeScript files
2. Save the files
3. Run `npm run watch` in terminal (auto-compiles on save)
4. Reload Extension Development Host:
   - `Cmd+R` or `Ctrl+R` in the Extension Development Host window
   - Or `Cmd+Shift+F5` from main VSCode window

## File Locations

**Source files:** `src/**/*.ts`
**Compiled files:** `out/**/*.js`
**Extension manifest:** `package.json`
**TypeScript config:** `tsconfig.json`

## Next Steps

After testing the core features:

1. Review [DEVELOPMENT.md](DEVELOPMENT.md) for adding new features
2. Try implementing:
   - WebView for run details
   - YAML editor with IntelliSense
   - Variable management
   - Approval/environment management

## Keyboard Shortcuts (in Extension Development Host)

- `Cmd/Ctrl + Shift + E` - Explorer
- `Cmd/Ctrl + Shift + D` - Debug view
- `Cmd/Ctrl + Shift + P` - Command Palette
- `Cmd/Ctrl + B` - Toggle sidebar
- Click Azure Pipelines icon - Open extension view

## Example Usage Flow

1. Open Extension Development Host (`F5`)
2. Click Azure Pipelines icon
3. Sign in with Microsoft account
4. Select org: "mycompany"
5. Select project: "my-web-app"
6. View pipelines in sidebar
7. Right-click "CI Pipeline" → Run Pipeline
8. Select branch: "main"
9. Watch run appear in "Recent Runs"
10. Click the run to see details
11. Right-click → View Run Logs
12. Monitor progress

## Tips

- Keep the Debug Console open to see extension logs
- Use breakpoints in TypeScript files for debugging
- The extension reloads automatically when using `npm run watch`
- Check network tab in Developer Tools for API issues
- Status bar shows which org/project you're connected to

## Getting Help

If you encounter issues:

1. Check Debug Console for errors
2. Review [README.md](README.md)
3. Check [DEVELOPMENT.md](DEVELOPMENT.md)
4. Review Azure DevOps API documentation
5. Check VSCode Extension API docs

Happy coding! 🚀
