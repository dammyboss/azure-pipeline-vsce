import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline, PipelineRun } from '../models/types';
import { RunsTreeProvider } from '../views/runsTreeView';
import { PipelinesTreeProvider } from '../views/pipelinesTreeView';
import { RunDetailsPanel } from '../webviews/runDetailsPanel';
import { LiveLogPanel } from '../webviews/liveLogPanel';
import { RunPipelinePanel } from '../webviews/runPipelinePanel';

/**
 * Pipeline command handlers
 */
export class PipelineCommands {
    constructor(
        private client: AzureDevOpsClient,
        private pipelinesProvider: PipelinesTreeProvider,
        private runsProvider: RunsTreeProvider
    ) {}

    /**
     * Register all pipeline commands
     */
    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('azurePipelines.runPipeline', (pipeline: Pipeline) =>
                this.runPipeline(pipeline)
            ),
            vscode.commands.registerCommand('azurePipelines.viewPipelineRuns', (pipeline: Pipeline) =>
                this.viewPipelineRuns(pipeline)
            ),
            vscode.commands.registerCommand('azurePipelines.refreshPipelines', () =>
                this.refreshPipelines()
            ),
            vscode.commands.registerCommand('azurePipelines.cancelRun', (run: PipelineRun) =>
                this.cancelRun(run)
            ),
            vscode.commands.registerCommand('azurePipelines.retryRun', (run: PipelineRun) =>
                this.retryRun(run)
            ),
            vscode.commands.registerCommand('azurePipelines.viewRunDetails', (run: PipelineRun) =>
                this.viewRunDetails(run)
            ),
            vscode.commands.registerCommand('azurePipelines.viewRunLogs', (run: PipelineRun) =>
                this.viewRunLogs(run)
            ),
            vscode.commands.registerCommand('azurePipelines.refreshRuns', () =>
                this.refreshRuns()
            ),
            vscode.commands.registerCommand('azurePipelines.openRunInBrowser', (run: PipelineRun) =>
                this.openRunInBrowser(run)
            ),
            vscode.commands.registerCommand('azurePipelines.downloadArtifacts', (run: PipelineRun) =>
                this.downloadArtifacts(run)
            ),
            vscode.commands.registerCommand('azurePipelines.filterRuns', () =>
                this.filterRuns()
            ),
            vscode.commands.registerCommand('azurePipelines.filterPipelines', () =>
                this.filterPipelines()
            ),
            vscode.commands.registerCommand('azurePipelines.openPipelineInBrowser', (pipeline: Pipeline) =>
                this.openPipelineInBrowser(pipeline)
            ),
            vscode.commands.registerCommand('azurePipelines.createPipeline', () =>
                this.createPipeline()
            ),
            vscode.commands.registerCommand('azurePipelines.renamePipeline', (pipeline: Pipeline) =>
                this.renamePipeline(pipeline)
            ),
            vscode.commands.registerCommand('azurePipelines.deletePipeline', (pipeline: Pipeline) =>
                this.deletePipeline(pipeline)
            ),
            vscode.commands.registerCommand('azurePipelines.editPipeline', (pipeline: Pipeline) =>
                this.editPipeline(pipeline)
            )
        );
    }

    /**
     * Run a pipeline - shows full run form
     */
    private async runPipeline(pipelineOrTreeItem: Pipeline | any): Promise<void> {
        try {
            // Extract pipeline from TreeItem if needed
            const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;

            // Validate pipeline ID
            if (!pipeline || !pipeline.id) {
                vscode.window.showErrorMessage('Pipeline ID is missing. Please refresh the pipelines view and try again.');
                return;
            }

            // Get the default branch from the pipeline's repository
            let sourceBranch: string | undefined;
            if (pipeline.repository?.id) {
                try {
                    const repos = await this.client.getRepositories();
                    const repo = repos.find(r => r.id === pipeline.repository?.id);
                    sourceBranch = repo?.defaultBranch;
                } catch (error) {
                    console.log('Could not get default branch:', error);
                }
            }

            // Show the run pipeline panel with form
            await RunPipelinePanel.show(this.client, pipeline, sourceBranch);

            // Refresh runs view after panel is shown
            setTimeout(() => this.runsProvider.refresh(), 1000);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to open run pipeline form: ${errorMessage}`);
        }
    }

    /**
     * View runs for a specific pipeline
     */
    private viewPipelineRuns(pipelineOrTreeItem: Pipeline | any): void {
        const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;
        this.runsProvider.setFilter(pipeline.id);
        vscode.commands.executeCommand('azurePipelinesRuns.focus');
    }

    /**
     * Refresh pipelines view
     */
    private refreshPipelines(): void {
        this.pipelinesProvider.refresh();
    }

    /**
     * Cancel a running pipeline
     */
    private async cancelRun(run: PipelineRun): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            `Cancel run ${run.buildNumber}?`,
            { modal: true },
            'Yes',
            'No'
        );

        if (confirmation !== 'Yes') {
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Canceling run: ${run.buildNumber}`,
                    cancellable: false
                },
                async () => {
                    await this.client.cancelRun(run.id);
                    vscode.window.showInformationMessage(`Run ${run.buildNumber} canceled`);
                    this.runsProvider.refresh();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to cancel run: ${errorMessage}`);
        }
    }

    /**
     * Retry a failed run
     */
    private async retryRun(run: PipelineRun): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Retrying run: ${run.buildNumber}`,
                    cancellable: false
                },
                async () => {
                    const newRun = await this.client.retryRun(run.id);
                    vscode.window.showInformationMessage(
                        `Run retried: ${newRun.buildNumber}`,
                        'View Run'
                    ).then(selection => {
                        if (selection === 'View Run') {
                            this.viewRunDetails(newRun);
                        }
                    });
                    this.runsProvider.refresh();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to retry run: ${errorMessage}`);
        }
    }

    /**
     * View run details
     */
    private async viewRunDetails(run: PipelineRun): Promise<void> {
        await RunDetailsPanel.show(this.client, run);
    }

    /**
     * View run logs
     */
    private async viewRunLogs(run: PipelineRun): Promise<void> {
        try {
            const logs = await this.client.getRunLogs(run.id);

            if (logs.length === 0) {
                vscode.window.showInformationMessage('No logs available for this run');
                return;
            }

            // Let user select which log to view
            const logItems = logs.map(log => ({
                label: `Log ${log.id}`,
                description: `${log.lineCount || 0} lines`,
                log
            }));

            const selectedLog = await vscode.window.showQuickPick(logItems, {
                placeHolder: 'Select a log to view'
            });

            if (!selectedLog) {
                return;
            }

            // Open in live log viewer
            await LiveLogPanel.show(
                this.client,
                run.id,
                selectedLog.log.id,
                `${run.buildNumber} - Log ${selectedLog.log.id}`
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load logs: ${errorMessage}`);
        }
    }

    /**
     * Refresh runs view
     */
    private refreshRuns(): void {
        this.runsProvider.refresh();
    }

    /**
     * Open run in browser
     */
    private openRunInBrowser(run: PipelineRun): void {
        if (run.url) {
            vscode.env.openExternal(vscode.Uri.parse(run.url));
        }
    }

    /**
     * Download artifacts for a run
     */
    private async downloadArtifacts(run: PipelineRun): Promise<void> {
        try {
            const artifacts = await this.client.getArtifacts(run.id);

            if (artifacts.length === 0) {
                vscode.window.showInformationMessage('No artifacts available for this run');
                return;
            }

            const artifactItems = artifacts.map(artifact => ({
                label: artifact.name,
                description: artifact.source,
                artifact
            }));

            const selectedArtifact = await vscode.window.showQuickPick(artifactItems, {
                placeHolder: 'Select an artifact to download'
            });

            if (!selectedArtifact) {
                return;
            }

            const downloadUrl = await this.client.downloadArtifact(
                run.id,
                selectedArtifact.artifact.name
            );

            vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
            vscode.window.showInformationMessage(`Downloading artifact: ${selectedArtifact.artifact.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to download artifacts: ${errorMessage}`);
        }
    }
    
    /**
     * Show filter dialog for runs
     */
    private async filterRuns(): Promise<void> {
        await this.runsProvider.showFilterDialog();
    }

    /**
     * Show filter dialog for pipelines
     */
    private async filterPipelines(): Promise<void> {
        await this.pipelinesProvider.showFilterDialog();
    }

    /**
     * Open pipeline in browser
     */
    private async openPipelineInBrowser(pipelineOrTreeItem: Pipeline | any): Promise<void> {
        try {
            const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;
            const config = this.client.getConfig();
            const pipelineUrl = `${config.organizationUrl}/${config.projectName}/_build?definitionId=${pipeline.id}`;
            vscode.env.openExternal(vscode.Uri.parse(pipelineUrl));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open pipeline in browser: ${error}`);
        }
    }

    /**
     * Create new pipeline with wizard
     */
    private async createPipeline(): Promise<void> {
        try {
            // Step 1: Get repositories
            const repositories = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Loading repositories...',
                    cancellable: false
                },
                async () => await this.client.getRepositories()
            );

            if (repositories.length === 0) {
                vscode.window.showErrorMessage('No repositories found in the project');
                return;
            }

            // Step 2: Select repository
            const repoItems = repositories.map(repo => ({
                label: repo.name,
                description: repo.defaultBranch?.replace('refs/heads/', '') || 'main',
                detail: repo.remoteUrl,
                repo
            }));

            const selectedRepo = await vscode.window.showQuickPick(repoItems, {
                placeHolder: 'Select a repository for the pipeline',
                ignoreFocusOut: true
            });

            if (!selectedRepo) {
                return;
            }

            // Step 3: Select or enter YAML file path
            const yamlPathChoice = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(search) Browse for YAML file',
                        value: 'browse'
                    },
                    {
                        label: '$(edit) Enter YAML file path manually',
                        value: 'manual'
                    }
                ],
                {
                    placeHolder: 'How would you like to specify the YAML file?',
                    ignoreFocusOut: true
                }
            );

            if (!yamlPathChoice) {
                return;
            }

            let yamlPath: string | undefined;

            if (yamlPathChoice.value === 'browse') {
                // Get default branch
                const defaultBranch = selectedRepo.repo.defaultBranch?.replace('refs/heads/', '') || 'main';

                // Load items from repository
                const items = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Loading files from repository...',
                        cancellable: false
                    },
                    async () => await this.client.getRepositoryItems(selectedRepo.repo.id, '/', defaultBranch, 'full')
                );

                // Filter for YAML/YML files
                const yamlFiles = items.filter(item =>
                    !item.isFolder &&
                    (item.path.endsWith('.yml') || item.path.endsWith('.yaml'))
                );

                if (yamlFiles.length === 0) {
                    vscode.window.showWarningMessage('No YAML files found in repository. Please enter path manually.');
                    yamlPath = await vscode.window.showInputBox({
                        prompt: 'Enter the path to the pipeline YAML file',
                        value: '/azure-pipelines.yml',
                        placeHolder: '/path/to/pipeline.yml',
                        ignoreFocusOut: true,
                        validateInput: (value) => {
                            if (!value || !value.startsWith('/')) {
                                return 'Path must start with /';
                            }
                            if (!value.endsWith('.yml') && !value.endsWith('.yaml')) {
                                return 'Path must end with .yml or .yaml';
                            }
                            return null;
                        }
                    });
                } else {
                    const yamlFileItems = yamlFiles.map(file => ({
                        label: file.path.split('/').pop() || file.path,
                        description: file.path,
                        detail: `Size: ${file.size || 0} bytes`,
                        path: file.path
                    }));

                    const selectedFile = await vscode.window.showQuickPick(yamlFileItems, {
                        placeHolder: 'Select a YAML file for the pipeline',
                        ignoreFocusOut: true
                    });

                    if (!selectedFile) {
                        return;
                    }

                    yamlPath = selectedFile.path;
                }
            } else {
                // Manual entry
                yamlPath = await vscode.window.showInputBox({
                    prompt: 'Enter the path to the pipeline YAML file',
                    value: '/azure-pipelines.yml',
                    placeHolder: '/path/to/pipeline.yml',
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || !value.startsWith('/')) {
                            return 'Path must start with /';
                        }
                        if (!value.endsWith('.yml') && !value.endsWith('.yaml')) {
                            return 'Path must end with .yml or .yaml';
                        }
                        return null;
                    }
                });
            }

            if (!yamlPath) {
                return;
            }

            // Step 4: Enter pipeline name
            const pipelineName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the pipeline',
                placeHolder: 'My Pipeline',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Pipeline name cannot be empty';
                    }
                    return null;
                }
            });

            if (!pipelineName) {
                return;
            }

            // Step 5: Optional folder
            const folderChoice = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(folder) Place in root',
                        value: 'root'
                    },
                    {
                        label: '$(folder) Specify folder path',
                        value: 'custom'
                    }
                ],
                {
                    placeHolder: 'Where should the pipeline be placed?',
                    ignoreFocusOut: true
                }
            );

            if (!folderChoice) {
                return;
            }

            let folder: string | null | undefined;

            if (folderChoice.value === 'custom') {
                const folderInput = await vscode.window.showInputBox({
                    prompt: 'Enter folder path (e.g., /MyFolder or MyFolder)',
                    placeHolder: '/MyFolder',
                    ignoreFocusOut: true
                });

                if (folderInput === undefined) {
                    return;
                }

                // Normalize folder path
                if (folderInput && !folderInput.startsWith('/') && !folderInput.startsWith('\\')) {
                    folder = '/' + folderInput;
                } else {
                    folder = folderInput;
                }
            } else {
                folder = null; // null represents root in Azure DevOps API
            }

            // Step 6: Create the pipeline
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Creating pipeline: ${pipelineName}`,
                    cancellable: false
                },
                async () => {
                    const newPipeline = await this.client.createPipeline(
                        pipelineName,
                        yamlPath!,
                        selectedRepo.repo.id,
                        selectedRepo.repo.name,
                        folder
                    );

                    vscode.window.showInformationMessage(
                        `Pipeline created successfully: ${newPipeline.name}`,
                        'View Pipeline',
                        'Run Pipeline'
                    ).then(async (selection) => {
                        if (selection === 'View Pipeline') {
                            this.openPipelineInBrowser(newPipeline);
                        } else if (selection === 'Run Pipeline') {
                            await this.runPipeline(newPipeline);
                        }
                    });

                    // Refresh pipelines view
                    this.pipelinesProvider.refresh();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to create pipeline: ${errorMessage}`);
        }
    }

    /**
     * Rename/move pipeline
     */
    private async renamePipeline(pipelineOrTreeItem: Pipeline | any): Promise<void> {
        try {
            const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;

            if (!pipeline || !pipeline.id) {
                vscode.window.showErrorMessage('Pipeline ID is missing');
                return;
            }

            // Step 1: Enter new name
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new pipeline name',
                value: pipeline.name,
                placeHolder: 'Pipeline name',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Name cannot be empty.';
                    }
                    return null;
                }
            });

            if (!newName || newName === pipeline.name) {
                // User cancelled or name unchanged, ask about folder only
                if (newName === undefined) {
                    return;
                }
            }

            // Step 2: Select folder (optional)
            const folderChoice = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(folder) Keep current folder',
                        description: pipeline.folder || '\\',
                        value: 'keep'
                    },
                    {
                        label: '$(folder) Move to root',
                        value: 'root'
                    },
                    {
                        label: '$(folder) Specify folder path',
                        value: 'custom'
                    }
                ],
                {
                    placeHolder: 'Select folder location',
                    ignoreFocusOut: true
                }
            );

            if (!folderChoice) {
                return;
            }

            let newFolder: string | undefined;

            if (folderChoice.value === 'root') {
                newFolder = '\\';
            } else if (folderChoice.value === 'custom') {
                newFolder = await vscode.window.showInputBox({
                    prompt: 'Enter folder path (e.g., \\MyFolder)',
                    value: pipeline.folder || '\\',
                    placeHolder: '\\MyFolder',
                    ignoreFocusOut: true
                });

                if (newFolder === undefined) {
                    return;
                }

                // Normalize folder path to start with backslash
                if (newFolder && !newFolder.startsWith('\\')) {
                    newFolder = '\\' + newFolder;
                }
            } else {
                // Keep current folder
                newFolder = undefined;
            }

            // Only update if something changed
            if ((newName && newName !== pipeline.name) || newFolder !== undefined) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Updating pipeline...',
                        cancellable: false
                    },
                    async () => {
                        await this.client.updatePipeline(
                            pipeline.id,
                            newName && newName !== pipeline.name ? newName : undefined,
                            newFolder
                        );

                        vscode.window.showInformationMessage(
                            `Pipeline updated successfully: ${newName || pipeline.name}`
                        );

                        // Refresh pipelines view
                        this.pipelinesProvider.refresh();
                    }
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update pipeline: ${errorMessage}`);
        }
    }

    /**
     * Delete pipeline
     */
    private async deletePipeline(pipelineOrTreeItem: Pipeline | any): Promise<void> {
        try {
            const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;

            if (!pipeline || !pipeline.id) {
                vscode.window.showErrorMessage('Pipeline ID is missing');
                return;
            }

            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete pipeline "${pipeline.name}"? This action cannot be undone.`,
                { modal: true },
                'Delete',
                'Cancel'
            );

            if (confirmation !== 'Delete') {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Deleting pipeline: ${pipeline.name}`,
                    cancellable: false
                },
                async () => {
                    await this.client.deletePipeline(pipeline.id);
                    vscode.window.showInformationMessage(`Pipeline deleted: ${pipeline.name}`);

                    // Refresh pipelines view
                    this.pipelinesProvider.refresh();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to delete pipeline: ${errorMessage}`);
        }
    }

    /**
     * Edit pipeline (opens YAML file in editor)
     */
    private async editPipeline(pipelineOrTreeItem: Pipeline | any): Promise<void> {
        try {
            const pipeline: Pipeline = (pipelineOrTreeItem as any).pipeline || pipelineOrTreeItem;

            if (!pipeline || !pipeline.id) {
                vscode.window.showErrorMessage('Pipeline ID is missing');
                return;
            }

            // Get the pipeline to find its YAML file path
            const pipelineDetails = await this.client.getPipeline(pipeline.id);

            if (!pipelineDetails.repository?.id) {
                vscode.window.showErrorMessage('Pipeline repository information not found');
                return;
            }

            // Get the YAML content
            const yaml = await this.client.getPipelineYaml(pipeline.id);

            // Open in VSCode editor with YAML language support
            const doc = await vscode.workspace.openTextDocument({
                content: yaml,
                language: 'yaml'
            });

            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Active
            });

            vscode.window.showInformationMessage(
                'Note: This is a read-only view. To modify the pipeline, edit the YAML file in your repository.'
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to edit pipeline: ${errorMessage}`);
        }
    }
}
