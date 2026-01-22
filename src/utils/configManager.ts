import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Organization, Project } from '../models/types';

/**
 * Manages Azure DevOps configuration (organization and project selection)
 */
export class ConfigManager {
    private static readonly ORG_URL_KEY = 'azurePipelines.organizationUrl';
    private static readonly ORG_NAME_KEY = 'azurePipelines.organizationName';
    private static readonly PROJECT_NAME_KEY = 'azurePipelines.projectName';

    constructor(
        private context: vscode.ExtensionContext,
        private client: AzureDevOpsClient
    ) {}

    /**
     * Get stored organization URL
     */
    getOrganizationUrl(): string | undefined {
        return this.context.globalState.get<string>(ConfigManager.ORG_URL_KEY);
    }

    /**
     * Get stored organization name
     */
    getOrganizationName(): string | undefined {
        return this.context.globalState.get<string>(ConfigManager.ORG_NAME_KEY);
    }

    /**
     * Get stored project name
     */
    getProjectName(): string | undefined {
        return this.context.globalState.get<string>(ConfigManager.PROJECT_NAME_KEY);
    }

    /**
     * Set organization
     */
    async setOrganization(orgUrl: string, orgName: string): Promise<void> {
        await this.context.globalState.update(ConfigManager.ORG_URL_KEY, orgUrl);
        await this.context.globalState.update(ConfigManager.ORG_NAME_KEY, orgName);
    }

    /**
     * Set project
     */
    async setProject(projectName: string): Promise<void> {
        await this.context.globalState.update(ConfigManager.PROJECT_NAME_KEY, projectName);
    }

    /**
     * Clear all configuration
     */
    async clear(): Promise<void> {
        await this.context.globalState.update(ConfigManager.ORG_URL_KEY, undefined);
        await this.context.globalState.update(ConfigManager.ORG_NAME_KEY, undefined);
        await this.context.globalState.update(ConfigManager.PROJECT_NAME_KEY, undefined);
    }

    /**
     * Check if configuration is complete
     */
    isConfigured(): boolean {
        return !!(this.getOrganizationUrl() && this.getProjectName());
    }

    /**
     * Prompt user to select organization and project
     */
    async promptForConfiguration(): Promise<boolean> {
        try {
            // Try automatic organization discovery first
            let organizations: Organization[] = [];
            let useManualInput = false;

            try {
                organizations = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Discovering Azure DevOps organizations...',
                        cancellable: false
                    },
                    async () => {
                        return await this.client.getOrganizations();
                    }
                );
            } catch (error) {
                console.log('Auto-discovery failed, falling back to manual input:', error);
                useManualInput = true;
            }

            let selectedOrgUrl: string = '';
            let selectedOrgName: string = '';

            if (!useManualInput && organizations && organizations.length > 0) {
                // Show discovered organizations
                const orgItems = organizations.map(org => ({
                    label: org.accountName,
                    description: org.accountUri,
                    org
                }));

                // Add manual input option
                orgItems.push({
                    label: '$(edit) Enter organization manually',
                    description: 'Type your organization name',
                    org: null as any
                });

                const selectedOrg = await vscode.window.showQuickPick(orgItems, {
                    placeHolder: 'Select an Azure DevOps organization',
                    ignoreFocusOut: true
                });

                if (!selectedOrg) {
                    return false;
                }

                if (selectedOrg.org === null) {
                    useManualInput = true;
                } else {
                    selectedOrgUrl = selectedOrg.org.accountUri;
                    selectedOrgName = selectedOrg.org.accountName;
                }
            } else {
                useManualInput = true;
            }

            // Manual organization input
            if (useManualInput) {
                const orgInput = await vscode.window.showInputBox({
                    prompt: 'Enter your Azure DevOps organization name or URL',
                    placeHolder: 'e.g., mycompany or https://dev.azure.com/mycompany',
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Organization name cannot be empty';
                        }
                        return null;
                    }
                });

                if (!orgInput) {
                    return false;
                }

                // Parse organization name from input
                let orgName = orgInput.trim();

                // If user provided a URL, extract the organization name
                if (orgName.includes('dev.azure.com/')) {
                    const match = orgName.match(/dev\.azure\.com\/([^\/]+)/);
                    if (match) {
                        orgName = match[1];
                    }
                } else if (orgName.includes('visualstudio.com')) {
                    const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
                    if (match) {
                        orgName = match[1];
                    }
                }

                // Remove any trailing slashes
                orgName = orgName.replace(/\/+$/, '');

                selectedOrgUrl = `https://dev.azure.com/${orgName}`;
                selectedOrgName = orgName;
            }

            // Verify organization by trying to get projects
            let projects: Project[];
            try {
                projects = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Loading projects from ${selectedOrgName}...`,
                        cancellable: false
                    },
                    async () => {
                        return await this.client.getProjects(selectedOrgUrl);
                    }
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Cannot access organization "${selectedOrgName}". Please verify the name and your permissions.`
                );
                return false;
            }

            if (!projects || projects.length === 0) {
                vscode.window.showErrorMessage(
                    `No projects found in organization "${selectedOrgName}". You may not have access to any projects.`
                );
                return false;
            }

            // Save organization
            await this.setOrganization(selectedOrgUrl, selectedOrgName);

            // Let user select project
            const projectItems = projects.map(project => ({
                label: project.name,
                description: project.description,
                project
            }));

            const selectedProject = await vscode.window.showQuickPick(projectItems, {
                placeHolder: 'Select a project',
                ignoreFocusOut: true
            });

            if (!selectedProject) {
                return false;
            }

            await this.setProject(selectedProject.project.name);

            // Initialize the API client with the selected configuration
            await this.client.initialize(selectedOrgUrl, selectedProject.project.name);

            vscode.window.showInformationMessage(
                `Configured: ${selectedOrgName} / ${selectedProject.project.name}`
            );

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to configure: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Initialize API client with stored configuration
     */
    async initializeClient(): Promise<boolean> {
        const orgUrl = this.getOrganizationUrl();
        const projectName = this.getProjectName();

        if (orgUrl && projectName) {
            await this.client.initialize(orgUrl, projectName);
            return true;
        }

        return false;
    }
}
