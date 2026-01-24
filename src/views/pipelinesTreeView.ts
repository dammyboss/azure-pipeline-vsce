import * as vscode from 'vscode';
import * as path from 'path';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline, PipelineRun, RunResult, RunStatus } from '../models/types';

export interface PipelineFilter {
    name?: string;
    folder?: string;
    status?: string[]; // succeeded, failed, inProgress, partiallySucceeded, etc.
}

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

    private getStatusIcon(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
        if (!this.pipeline.latestRun) {
            // No runs yet - use default icon
            return new vscode.ThemeIcon('repo');
        }

        const run = this.pipeline.latestRun;

        // API returns lowercase strings, so we need case-insensitive comparison
        const statusStr = String(run.status || '').toLowerCase();
        const resultStr = String(run.result || '').toLowerCase();

        // Debug log for in-progress detection
        if (statusStr.includes('progress') || statusStr === 'notstarted') {
            console.log(`Pipeline ${this.pipeline.name} is running: status="${statusStr}", result="${resultStr}"`);
        }

        // Check if running
        if (statusStr === 'inprogress' || statusStr === 'notstarted') {
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
        }

        // Check result
        if (resultStr === 'succeeded') {
            // Check if there are any warnings in the run
            // Even succeeded runs can have warnings -> show orange
            if (this.pipeline.hasWarnings) {
                console.log(`Pipeline ${this.pipeline.name} has warnings - showing orange icon`);
                const iconPath = vscode.Uri.file(
                    path.join(__dirname, '..', '..', 'resources', 'icons', 'status-partial.svg')
                );
                return { light: iconPath, dark: iconPath };
            }
            const iconPath = vscode.Uri.file(
                path.join(__dirname, '..', '..', 'resources', 'icons', 'status-success.svg')
            );
            return { light: iconPath, dark: iconPath };
        }

        if (resultStr === 'failed') {
            const iconPath = vscode.Uri.file(
                path.join(__dirname, '..', '..', 'resources', 'icons', 'status-failed.svg')
            );
            return { light: iconPath, dark: iconPath };
        }

        if (resultStr === 'partiallysucceeded') {
            // PartiallySucceeded means some tasks failed but run continued - ORANGE
            console.log(`Pipeline ${this.pipeline.name} is PartiallySucceeded (${run.result}) - showing orange icon`);
            const iconPath = vscode.Uri.file(
                path.join(__dirname, '..', '..', 'resources', 'icons', 'status-partial.svg')
            );
            return { light: iconPath, dark: iconPath };
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
    private currentFilter: PipelineFilter = {};

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
            const config = this.client.getConfig();
            if (!config.organizationUrl || !config.projectName) {
                return [];
            }

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

            // Apply filters
            const filteredPipelines = pipelinesWithStatus.filter(pipeline => this.matchesFilter(pipeline));

            // Group by folder
            const grouped = this.groupByFolder(filteredPipelines);

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

    /**
     * Show filter dialog
     */
    async showFilterDialog(): Promise<void> {
        const options = [
            { label: '$(search) Filter by Name', value: 'name' },
            { label: '$(folder) Filter by Folder', value: 'folder' },
            { label: '$(filter) Filter by Status', value: 'status' },
            { label: '$(clear-all) Clear All Filters', value: 'clear' }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select filter type'
        });

        if (!selected) {
            return;
        }

        switch (selected.value) {
            case 'name':
                await this.filterByName();
                break;
            case 'folder':
                await this.filterByFolder();
                break;
            case 'status':
                await this.filterByStatus();
                break;
            case 'clear':
                this.clearFilters();
                break;
        }
    }

    private async filterByName() {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter pipeline name',
            value: this.currentFilter.name,
            placeHolder: 'Pipeline name'
        });

        if (name !== undefined) {
            this.currentFilter.name = name || undefined;
            this.refresh();
        }
    }

    private async filterByFolder() {
        const folder = await vscode.window.showInputBox({
            prompt: 'Enter folder name',
            value: this.currentFilter.folder,
            placeHolder: 'Folder name'
        });

        if (folder !== undefined) {
            this.currentFilter.folder = folder || undefined;
            this.refresh();
        }
    }

    private async filterByStatus() {
        const statuses = [
            { label: '✓ Succeeded', value: 'succeeded', picked: this.currentFilter.status?.includes('succeeded') },
            { label: '✗ Failed', value: 'failed', picked: this.currentFilter.status?.includes('failed') },
            { label: '● In Progress', value: 'inProgress', picked: this.currentFilter.status?.includes('inProgress') },
            { label: '⚠ Partially Succeeded', value: 'partiallySucceeded', picked: this.currentFilter.status?.includes('partiallySucceeded') },
            { label: '○ Canceled', value: 'canceled', picked: this.currentFilter.status?.includes('canceled') },
            { label: '⚪ No Runs', value: 'noRuns', picked: this.currentFilter.status?.includes('noRuns') }
        ];

        const selected = await vscode.window.showQuickPick(statuses, {
            placeHolder: 'Select statuses to filter',
            canPickMany: true
        });

        if (selected && selected.length > 0) {
            this.currentFilter.status = selected.map(s => s.value);
            this.refresh();
        }
    }

    clearFilters() {
        this.currentFilter = {};
        this.refresh();
    }

    hasActiveFilters(): boolean {
        return Object.keys(this.currentFilter).length > 0;
    }

    getFilterDescription(): string {
        const parts: string[] = [];

        if (this.currentFilter.name) {
            parts.push(`Name: ${this.currentFilter.name}`);
        }

        if (this.currentFilter.folder) {
            parts.push(`Folder: ${this.currentFilter.folder}`);
        }

        if (this.currentFilter.status && this.currentFilter.status.length > 0) {
            parts.push(`Status: ${this.currentFilter.status.join(', ')}`);
        }

        return parts.join(' | ') || 'No filters';
    }

    private matchesFilter(pipeline: PipelineWithStatus): boolean {
        // Filter by name
        if (this.currentFilter.name) {
            if (!pipeline.name.toLowerCase().includes(this.currentFilter.name.toLowerCase())) {
                return false;
            }
        }

        // Filter by folder
        if (this.currentFilter.folder) {
            const pipelineFolder = pipeline.folder || '';
            if (!pipelineFolder.toLowerCase().includes(this.currentFilter.folder.toLowerCase())) {
                return false;
            }
        }

        // Filter by status
        if (this.currentFilter.status && this.currentFilter.status.length > 0) {
            if (!pipeline.latestRun && !this.currentFilter.status.includes('noRuns')) {
                return false;
            }

            if (pipeline.latestRun) {
                const runStatus = String(pipeline.latestRun.result || pipeline.latestRun.status).toLowerCase();
                if (!this.currentFilter.status.some(s => runStatus === s.toLowerCase())) {
                    return false;
                }
            }
        }

        return true;
    }
}
