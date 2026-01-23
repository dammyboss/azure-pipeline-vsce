import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline, PipelineRun } from '../models/types';
import { RunsTreeProvider } from '../views/runsTreeView';
import { PipelinesTreeProvider } from '../views/pipelinesTreeView';
import { RunDetailsPanel } from '../webviews/runDetailsPanel';
import { LiveLogPanel } from '../webviews/liveLogPanel';

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
            )
        );
    }

    /**
     * Run a pipeline
     */
    private async runPipeline(pipeline: Pipeline): Promise<void> {
        try {
            // Get repositories to find branches
            const repos = await this.client.getRepositories();
            const repo = repos.find(r => r.id === pipeline.repository?.id);

            let branch: string | undefined;

            if (repo) {
                // Get branches
                const branches = await this.client.getBranches(repo.id);

                const branchItems = branches.map(b => ({
                    label: b.name,
                    description: b.objectId.substring(0, 7)
                }));

                const selectedBranch = await vscode.window.showQuickPick(branchItems, {
                    placeHolder: 'Select a branch to run',
                    ignoreFocusOut: true
                });

                if (!selectedBranch) {
                    return;
                }

                branch = selectedBranch.label;
            }

            // Show progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Running pipeline: ${pipeline.name}`,
                    cancellable: false
                },
                async () => {
                    const run = await this.client.runPipeline(pipeline.id, { branch });

                    vscode.window.showInformationMessage(
                        `Pipeline run started: ${run.buildNumber}`,
                        'View Run'
                    ).then(selection => {
                        if (selection === 'View Run') {
                            this.viewRunDetails(run);
                        }
                    });

                    // Refresh runs view
                    this.runsProvider.refresh();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to run pipeline: ${errorMessage}`);
        }
    }

    /**
     * View runs for a specific pipeline
     */
    private viewPipelineRuns(pipeline: Pipeline): void {
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
}
