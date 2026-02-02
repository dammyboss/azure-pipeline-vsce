# Azure DevOps Pipelines for VS Code

[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=flat&logo=visual-studio-code)](https://marketplace.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/badge/GitHub-dammyboss-181717?style=flat&logo=github)](https://github.com/dammyboss)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Damilola_Onadeinde-0077B5?style=flat&logo=linkedin)](https://linkedin.com/in/damilola-onadeinde)
[![YouTube](https://img.shields.io/badge/YouTube-DevOps_with_Dami-FF0000?style=flat&logo=youtube)](https://youtube.com/@devopswithdami)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support%20My%20Work-orange?style=flat&logo=buymeacoffee)](https://buymeacoffee.com/devopswithdami)

Manage your Azure DevOps Pipelines and Service Connections directly from Visual Studio Code. View, run, monitor, and control your CI/CD pipelines without leaving your editor.

## Features

### Secure Authentication
- OAuth 2.0 authentication using Microsoft accounts
- No Personal Access Token (PAT) required
- Automatic token refresh

### Pipeline Management
- View all pipelines in your organization/project
- Run pipelines with branch selection
- Create, rename, and delete pipelines
- Group pipelines by folder
- Real-time pipeline status updates

### Pipeline Runs
- View recent pipeline runs with detailed information
- Real-time status updates (auto-refresh every 30 seconds)
- Filter runs by state, branch, user, or repository
- Color-coded status indicators with stage visualization
- View run logs and download artifacts
- Cancel running pipelines or retry failed runs

### Service Connections
- View and manage Azure service connections
- Edit connection details and settings
- View usage history for each connection
- Access Workload Identity federation details

### Developer Experience
- Intuitive tree view interface
- Status bar integration showing current org/project
- Quick access to all pipeline operations
- Detailed run information in editor panels

## Pro

Unlock the full power of Azure DevOps Pipelines for VS Code with a one-time Pro license.

### What's included

| Feature | Free | Pro |
|---------|:----:|:---:|
| Sign in & browse pipelines | ✅ | ✅ |
| View run details, logs & timeline | ✅ | ✅ |
| Run pipeline (branch selection) | ✅ | ✅ |
| Open pipelines & runs in browser | ✅ | ✅ |
| Status bar & notifications | ✅ | ✅ |
| **Edit Pipeline YAML** | — | ✅ |
| **Task Assistant** | — | ✅ |
| **Advanced run options** (variables, stages, commit) | — | ✅ |
| **Cancel & retry runs** | — | ✅ |
| **Download artifacts** | — | ✅ |
| **Create, rename & delete pipelines** | — | ✅ |
| **Create, edit & delete service connections** | — | ✅ |

### Pricing

**$9.99 — Lifetime license**
One-time payment. Includes all future updates. No subscription required.

### How to get your license

1. [Sponsor the project on GitHub](https://github.com/sponsors/dammyboss) and select the **Pro License** tier
2. You'll receive your license key via GitHub
3. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
4. Run **Azure Pipelines: Enter License Key**
5. Paste your key and press Enter — Pro features unlock immediately

> Already have a key? Just run `Azure Pipelines: Enter License Key` from the Command Palette at any time.

---

## Getting Started

### Installation

1. Install the extension from the VS Code Marketplace
2. Click the Azure Pipelines icon in the Activity Bar
3. Click "Sign In" to authenticate with your Microsoft account
4. Select your Azure DevOps organization
5. Select your project
6. Start managing your pipelines!

## Usage

### Authentication

1. Open the Azure Pipelines view from the Activity Bar
2. Click "Sign In" in the Connection section
3. Authenticate with your Microsoft account in the browser
4. Return to VS Code - you're now connected!

### Managing Pipelines

**View Pipelines:**
- Browse all pipelines in the Pipelines view
- Click on a pipeline to view its recent runs

**Run a Pipeline:**
- Right-click on a pipeline
- Select "Run Pipeline"
- Choose a branch (if applicable)
- The pipeline will start immediately

**View Run Details:**
- Click on any run in the Recent Runs view
- See detailed information including stages, duration, and status
- Filter runs by state, branch, user, or repository

**Pipeline Operations:**
- Right-click on a pipeline for options:
  - Run Pipeline
  - Rename Pipeline
  - Delete Pipeline
  - Open in Browser

### Managing Service Connections

**View Connections:**
- Browse all service connections in the Service Connections view
- Click on a connection to view details

**Connection Details:**
- View connection type and authentication method
- See usage history
- Access Workload Identity federation details
- Edit connection settings

### Changing Organization/Project

- Click the status bar item (bottom left) showing your org/project
- Or use Command Palette: "Azure Pipelines: Select Organization/Project"
- Choose a different organization or project

## Commands

Access these commands from the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`):

- `Azure Pipelines: Sign In to Azure DevOps` - Authenticate with Microsoft account
- `Azure Pipelines: Sign Out` - Sign out from Azure DevOps
- `Azure Pipelines: Select Organization/Project` - Change active organization/project
- `Azure Pipelines: Refresh Pipelines` - Refresh the pipelines list
- `Azure Pipelines: Refresh Runs` - Refresh the runs list

## Requirements

- Visual Studio Code 1.85.0 or higher
- Azure DevOps account with appropriate permissions
- Microsoft account for authentication

## Features in Detail

### Pipeline Runs View
- **Status Indicators**: Color-coded icons (green for success, red for failed, blue for running)
- **Stage Visualization**: See all stages with connected status indicators
- **Filtering**: Filter by state, branch, user, or repository
- **Auto-refresh**: Runs update automatically every 30 seconds
- **Quick Actions**: Cancel, retry, view logs, download artifacts

### Service Connections
- **Connection Management**: View and edit service connection details
- **Usage Tracking**: See which pipelines use each connection
- **Federation Details**: Access issuer and subject identifier for Workload Identity
- **Creator Information**: See who created each connection

## Support

For issues, feature requests, or contributions, please visit the [GitHub repository](https://github.com/dammyboss/azure-pipeline-vsce).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## About the Developer

**Damilola Onadeinde**  
*DevOps/AI Engineer | Cloud Infrastructure Specialist | Open Source Contributor*

Connect with me:

<a href="https://github.com/dammyboss"><img src="https://img.icons8.com/fluent/48/000000/github.png" alt="GitHub" width="40"/></a>
<a href="https://linkedin.com/in/damilola-onadeinde"><img src="https://img.icons8.com/fluent/48/000000/linkedin.png" alt="LinkedIn" width="40"/></a>
<a href="https://devopswithdami.com"><img src="https://img.icons8.com/fluent/48/000000/domain.png" alt="Portfolio" width="40"/></a>
<a href="https://youtube.com/@devopswithdami"><img src="https://img.icons8.com/fluent/48/000000/youtube-play.png" alt="YouTube" width="40"/></a>

## Support the Developer

If you find this project helpful and would like to support my work, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support%20My%20Work-orange?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/devopswithdami)

Your support helps me continue creating open-source tools and improving this project!

## License

MIT License

---

**Enjoy managing your Azure DevOps Pipelines from VS Code!**
