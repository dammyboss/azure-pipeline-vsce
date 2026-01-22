import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline, PipelineRun, RunResult, RunStatus } from '../models/types';

/**
 * Pipeline with latest run information
 */
interface PipelineWithStatus extends Pipeline {
    latestRun?: PipelineRun;
    hasWarnings?: boolean; // True if the latest run has warnings
}

/**
 * Tree item for pipelines view
 */
export class PipelineTreeItem extends vscode.TreeItem {
    constructor(
        public readonly pipeline: PipelineWithStatus,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(pipeline.name, collapsibleState);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = 'pipeline';
        this.iconPath = this.getStatusIcon();

        // Make it clickable to view runs
        this.command = {
            command: 'azurePipelines.viewPipelineRuns',
            title: 'View Pipeline Runs',
            arguments: [this.pipeline]
        };
    }

    private buildTooltip(): string {
        const lines = [
            `Pipeline: ${this.pipeline.name}`,
            `ID: ${this.pipeline.id}`
        ];

        if (this.pipeline.latestRun) {
            const run = this.pipeline.latestRun;
            lines.push('');
            lines.push('Latest Run:');
            lines.push(`  Build: ${run.buildNumber}`);

            // Show result with warning indicator
            const baseStatus = run.result || run.status;
            const statusText = (this.pipeline.hasWarnings && run.result === RunResult.Succeeded)
                ? `${baseStatus} (with warnings)`
                : baseStatus;
            lines.push(`  Status: ${statusText}`);

            if (run.sourceBranch) {
                lines.push(`  Branch: ${run.sourceBranch.replace('refs/heads/', '')}`);
            }

            if (run.finishedDate) {
                lines.push(`  Finished: ${new Date(run.finishedDate).toLocaleString()}`);
            } else if (run.createdDate) {
                lines.push(`  Started: ${new Date(run.createdDate).toLocaleString()}`);
            }
        }

        return lines.join('\n');
    }

    private buildDescription(): string {
        const parts: string[] = [];

        if (this.pipeline.folder) {
            parts.push(this.pipeline.folder);
        }

        // Add latest run info if available
        if (this.pipeline.latestRun) {
            const run = this.pipeline.latestRun;
            if (run.sourceBranch) {
                const branch = run.sourceBranch.replace('refs/heads/', '');
                parts.push(`(${branch})`);
            }
        }

        return parts.join(' ');
    }

    private getStatusIcon(): vscode.ThemeIcon {
        if (!this.pipeline.latestRun) {
            // No runs yet - use default icon
            return new vscode.ThemeIcon('repo');
        }

        const run = this.pipeline.latestRun;

        // API returns lowercase strings, so we need case-insensitive comparison
        const statusStr = String(run.status || '').toLowerCase();
        const resultStr = String(run.result || '').toLowerCase();

        // Check if running
        if (statusStr === 'inprogress' || statusStr === 'notstarted') {
            return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
        }

        // Check result
        if (resultStr === 'succeeded') {
            // Check if there are any warnings in the run
            // Even succeeded runs can have warnings -> show orange
            if (this.pipeline.hasWarnings) {
                console.log(`Pipeline ${this.pipeline.name} has warnings - showing orange icon`);
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
            }
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        }

        if (resultStr === 'failed') {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        }

        if (resultStr === 'partiallysucceeded') {
            // PartiallySucceeded means some tasks failed but run continued - ORANGE
            console.log(`Pipeline ${this.pipeline.name} is PartiallySucceeded (${run.result}) - showing orange icon`);
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        }

        if (resultStr === 'canceled') {
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.gray'));
        }

        return new vscode.ThemeIcon('repo');
    }
}

/**
 * TreeView provider for pipelines
 */
export class PipelinesTreeProvider implements vscode.TreeDataProvider<PipelineTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PipelineTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pipelines: PipelineWithStatus[] = [];

    constructor(private client: AzureDevOpsClient) {}

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: PipelineTreeItem): vscode.TreeItem {
        return element;
    }



    /**
     * Get children (pipelines)
     */
    async getChildren(element?: PipelineTreeItem): Promise<PipelineTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            // Fetch all pipelines
            this.pipelines = await this.client.getPipelines();

            // Fetch latest run for each pipeline (in parallel for performance)
            const pipelinesWithStatus: PipelineWithStatus[] = await Promise.all(
                this.pipelines.map(async (pipeline) => {
                    try {
                        // Get the latest run for this pipeline
                        const runs = await this.client.getPipelineRuns(pipeline.id, 1);
                        console.log(`Pipeline ${pipeline.name} (${pipeline.id}): Got ${runs?.length || 0} runs`);
                        const latestRun = runs && runs.length > 0 ? runs[0] : undefined;

                        if (latestRun) {
                            console.log(`Latest run for ${pipeline.name}:`, JSON.stringify(latestRun, null, 2));
                        }

                        // Debug log the run result - INCLUDING TYPE
                        if (latestRun) {
                            console.log(`Pipeline ${pipeline.name}: status=${latestRun.status} (type: ${typeof latestRun.status}), result=${latestRun.result} (type: ${typeof latestRun.result})`);
                            console.log(`RunResult.Succeeded=${RunResult.Succeeded}, RunResult.PartiallySucceeded=${RunResult.PartiallySucceeded}`);
                        }

                        // Check for warnings based on result type
                        let hasWarnings = false;
                        const resultStr = String(latestRun?.result || '').toLowerCase();

                        if (resultStr === 'partiallysucceeded') {
                            hasWarnings = true;
                        }

                        return {
                            ...pipeline,
                            latestRun,
                            hasWarnings
                        };
                    } catch (error) {
                        // If we can't get runs for this pipeline, just return without status
                        console.error(`Failed to get runs for pipeline ${pipeline.id}:`, error);
                        return {
                            ...pipeline,
                            latestRun: undefined,
                            hasWarnings: false
                        };
                    }
                })
            );

            // Group by folder
            const grouped = this.groupByFolder(pipelinesWithStatus);

            return grouped.map(
                pipeline => new PipelineTreeItem(pipeline, vscode.TreeItemCollapsibleState.None)
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load pipelines: ${error}`);
            return [];
        }
    }

    /**
     * Group pipelines by folder
     */
    private groupByFolder(pipelines: PipelineWithStatus[]): PipelineWithStatus[] {
        // Sort by folder and name
        return pipelines.sort((a, b) => {
            const folderA = a.folder || '';
            const folderB = b.folder || '';

            if (folderA !== folderB) {
                return folderA.localeCompare(folderB);
            }

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Get all pipelines
     */
    getPipelines(): PipelineWithStatus[] {
        return this.pipelines;
    }
}
