import * as vscode from 'vscode';
import * as path from 'path';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { PipelineRun, RunResult, RunStatus } from '../models/types';
import { FilterManager } from '../utils/filterManager';

export class RunTreeItem extends vscode.TreeItem {
    constructor(
        public readonly run: PipelineRun,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly children?: RunTreeItem[]
    ) {
        // Show build number with commit message if available
        const label = run.commitMessage
            ? `#${run.buildNumber} • ${run.commitMessage.split('\n')[0]}`
            : `${run.buildNumber || run.name}`;

        super(label, collapsibleState);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = this.getContextValue();
        this.iconPath = this.getStatusIcon();

        // Make runs clickable to view details
        if (!children) {
            this.command = {
                command: 'azurePipelines.viewRunDetails',
                title: 'View Run Details',
                arguments: [this.run]
            };
        }
    }

    private buildTooltip(): string {
        const lines = [
            `Build: ${this.run.buildNumber}`,
            `Pipeline: ${this.run.pipeline?.name || 'Unknown'}`,
            `Status: ${this.run.result || this.run.status}`
        ];

        if (this.run.sourceBranch) {
            lines.push(`Branch: ${this.run.sourceBranch.replace('refs/heads/', '')}`);
        }

        if (this.run.requestedBy) {
            lines.push(`Requested by: ${this.run.requestedBy.displayName}`);
        }

        if (this.run.finishedDate) {
            lines.push(`Finished: ${new Date(this.run.finishedDate).toLocaleString()}`);
        } else if (this.run.createdDate) {
            lines.push(`Started: ${new Date(this.run.createdDate).toLocaleString()}`);
        }

        return lines.join('\n');
    }

    private buildDescription(): string {
        const parts: string[] = [];

        if (this.run.pipeline?.name) {
            parts.push(this.run.pipeline.name);
        }

        if (this.run.sourceBranch) {
            const branch = this.run.sourceBranch.replace('refs/heads/', '');
            parts.push(`(${branch})`);
        }

        return parts.join(' ');
    }

    private getContextValue(): string {
        const statusStr = String(this.run.status || '').toLowerCase();
        const resultStr = String(this.run.result || '').toLowerCase();

        if (statusStr === 'inprogress' || statusStr === 'notstarted') {
            return 'run-running';
        }

        if (resultStr === 'succeeded') {
            return 'run-completed';
        }

        if (resultStr === 'partiallysucceeded') {
            return 'run-partially-succeeded';
        }

        if (resultStr === 'failed') {
            return 'run-failed';
        }

        if (resultStr === 'canceled') {
            return 'run-canceled';
        }

        return 'run';
    }

    private getStatusIcon(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
        const statusStr = String(this.run.status || '').toLowerCase();
        const resultStr = String(this.run.result || '').toLowerCase();

        if (statusStr === 'inprogress' || statusStr === 'notstarted') {
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
        }

        if (resultStr === 'succeeded') {
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
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        }

        if (resultStr === 'canceled') {
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.gray'));
        }

        return new vscode.ThemeIcon('circle-outline');
    }
}

export class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RunTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private runs: PipelineRun[] = [];
    private pipelineFilter?: number;
    private filterManager: FilterManager;

    constructor(private client: AzureDevOpsClient) {
        this.filterManager = new FilterManager();
        this.filterManager.onFilterChanged(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setFilter(pipelineId?: number): void {
        this.pipelineFilter = pipelineId;
        this.refresh();
    }

    clearFilter(): void {
        this.pipelineFilter = undefined;
        this.refresh();
    }

    getTreeItem(element: RunTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RunTreeItem): Promise<RunTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            const config = this.client.getConfig();
            if (!config.organizationUrl || !config.projectName) {
                return [];
            }

            this.runs = await this.client.getPipelineRuns(this.pipelineFilter, 50);

            // Fetch commit messages for runs (in parallel)
            await this.fetchCommitMessages(this.runs);

            // Apply filters
            const filteredRuns = this.runs.filter(run => this.filterManager.matchesFilter(run));

            return filteredRuns.map(
                run => new RunTreeItem(run, vscode.TreeItemCollapsibleState.None)
            );
        } catch (error) {
            console.error('Failed to load runs:', error);
            return [];
        }
    }

    /**
     * Fetch commit messages for runs in parallel
     */
    private async fetchCommitMessages(runs: PipelineRun[]): Promise<void> {
        const promises = runs.map(async (run) => {
            if (run.repository?.id && run.sourceVersion) {
                try {
                    run.commitMessage = await this.client.getCommitMessage(
                        run.repository.id,
                        run.sourceVersion
                    );
                } catch (error) {
                    // Silently fail - commit message is optional
                    console.debug(`Failed to fetch commit for run ${run.id}:`, error);
                }
            }
        });

        await Promise.all(promises);
    }

    getRuns(): PipelineRun[] {
        return this.runs;
    }
    
    async showFilterDialog(): Promise<void> {
        await this.filterManager.showFilterDialog();
    }
    
    getFilterManager(): FilterManager {
        return this.filterManager;
    }
}
