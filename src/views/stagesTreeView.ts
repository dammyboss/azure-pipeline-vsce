import * as vscode from 'vscode';
import * as path from 'path';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { PipelineRun, Timeline, TimelineRecord } from '../models/types';
import { formatDurationBetween } from '../utils/formatDuration';

/**
 * Tree item for stages view
 */
export class StageTreeItem extends vscode.TreeItem {
    constructor(
        public readonly record: TimelineRecord,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly run?: PipelineRun
    ) {
        super(record.name || 'Unknown', collapsibleState);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = this.getContextValue();
        this.iconPath = this.getStatusIcon();

        // Add command to view log when clicking on items with logs
        if (record.log?.url) {
            this.command = {
                command: 'azurePipelines.viewStageLog',
                title: 'View Log',
                arguments: [{ record, run }]
            };
        }
    }

    private buildTooltip(): string {
        const lines = [
            `Name: ${this.record.name || 'Unknown'}`,
            `Type: ${this.record.type}`,
            `State: ${this.record.state}`,
            `Result: ${this.record.result || 'N/A'}`
        ];

        if (this.record.startTime) {
            lines.push(`Started: ${new Date(this.record.startTime).toLocaleString()}`);
        }

        if (this.record.finishTime) {
            lines.push(`Finished: ${new Date(this.record.finishTime).toLocaleString()}`);
        }

        return lines.join('\n');
    }

    private buildDescription(): string {
        // Show duration if available
        if (this.record.startTime && this.record.finishTime) {
            return formatDurationBetween(this.record.startTime, this.record.finishTime);
        }

        return '';
    }

    private getContextValue(): string {
        return this.record.type.toLowerCase();
    }

    private getStatusIcon(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
        const state = (this.record.state || '').toLowerCase();
        const result = (this.record.result || '').toLowerCase();

        // Check if in progress
        if (state === 'inprogress' || state === 'pending') {
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
        }

        // Check result
        if (result === 'succeeded') {
            const iconPath = vscode.Uri.file(
                path.join(__dirname, '..', '..', 'resources', 'icons', 'status-success.svg')
            );
            return { light: iconPath, dark: iconPath };
        }

        if (result === 'failed') {
            const iconPath = vscode.Uri.file(
                path.join(__dirname, '..', '..', 'resources', 'icons', 'status-failed.svg')
            );
            return { light: iconPath, dark: iconPath };
        }

        if (result === 'partiallysucceeded') {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        }

        if (result === 'canceled' || result === 'cancelled') {
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.gray'));
        }

        if (result === 'skipped') {
            return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('charts.gray'));
        }

        return new vscode.ThemeIcon('circle-outline');
    }
}

/**
 * TreeView provider for stages
 */
export class StagesTreeProvider implements vscode.TreeDataProvider<StageTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StageTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentRun?: PipelineRun;
    private timeline?: Timeline;
    private allRecords: TimelineRecord[] = [];

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
    getTreeItem(element: StageTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (stages, jobs, or tasks)
     */
    async getChildren(element?: StageTreeItem): Promise<StageTreeItem[]> {
        if (!this.currentRun || !this.timeline) {
            return [];
        }

        if (!element) {
            // Top level: Show stages
            const stages = this.allRecords.filter(
                record => record.type === 'Stage' && !record.parentId
            );

            return stages
                .sort((a, b) => (a.order || 0) - (b.order || 0))
                .map(record => new StageTreeItem(
                    record,
                    this.hasChildren(record)
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None,
                    this.currentRun
                ));
        } else {
            // Show children of this element (Jobs or Tasks)
            const children = this.allRecords
                .filter(record => record.parentId === element.record.id && record.name !== 'Checkpoint')
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            return children.map(record => new StageTreeItem(
                record,
                this.hasChildren(record)
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                this.currentRun
            ));
        }
    }

    /**
     * Check if a record has children
     */
    private hasChildren(record: TimelineRecord): boolean {
        return this.allRecords.some(r => r.parentId === record.id && r.name !== 'Checkpoint');
    }

    /**
     * Load stages for a specific run
     */
    async loadStages(run: PipelineRun): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: `Loading stages for build ${run.buildNumber}`,
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ increment: 0 });

                    this.currentRun = run;
                    this.timeline = await this.client.getRunTimeline(run.id);

                    if (this.timeline && this.timeline.records) {
                        this.allRecords = this.timeline.records;
                    } else {
                        this.allRecords = [];
                    }

                    this._onDidChangeTreeData.fire();
                    progress.report({ increment: 100 });
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load stages: ${error}`);
            this.allRecords = [];
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Clear the stages view
     */
    clear(): void {
        this.currentRun = undefined;
        this.timeline = undefined;
        this.allRecords = [];
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get current run
     */
    getCurrentRun(): PipelineRun | undefined {
        return this.currentRun;
    }
}
