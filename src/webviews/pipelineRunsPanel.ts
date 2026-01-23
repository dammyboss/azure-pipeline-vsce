import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline, PipelineRun, Timeline } from '../models/types';
import { formatTimeAgo, formatDurationBetween } from '../utils/formatDuration';

interface PipelineRunFilter {
    searchText?: string;
    state?: string[];
    branch?: string[];
    requestedFor?: string[];
    repository?: string[];
}

/**
 * Panel for displaying all runs for a specific pipeline
 */
export class PipelineRunsPanel {
    private static currentPanel: PipelineRunsPanel | undefined;
    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private runs: PipelineRun[] = [];
    private currentFilter: PipelineRunFilter = {};

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private pipeline: Pipeline
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'openRun':
                        await this.handleOpenRun(message.runId);
                        break;
                    case 'refresh':
                        await this.updateContent();
                        break;
                    case 'updateFilter':
                        this.currentFilter = message.filter;
                        await this.updateContent();
                        break;
                    case 'clearFilter':
                        this.currentFilter = {};
                        await this.updateContent();
                        break;
                }
            },
            null,
            this.disposables
        );

        this.updateContent();
    }

    public static async show(
        client: AzureDevOpsClient,
        pipeline: Pipeline
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (PipelineRunsPanel.currentPanel) {
            PipelineRunsPanel.currentPanel.panel.reveal(column);
            PipelineRunsPanel.currentPanel.pipeline = pipeline;
            await PipelineRunsPanel.currentPanel.updateContent();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'pipelineRuns',
            `${pipeline.name} - Runs`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        PipelineRunsPanel.currentPanel = new PipelineRunsPanel(panel, client, pipeline);
    }

    private async handleOpenRun(runId: number) {
        try {
            // Find the run in our cached list
            const run = this.runs.find(r => r.id === runId);
            if (run) {
                // Open run details panel directly
                const { RunDetailsPanel } = await import('./runDetailsPanel');
                await RunDetailsPanel.show(this.client, run);
            } else {
                vscode.window.showErrorMessage('Run not found');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open run details: ${error}`);
        }
    }

    private async updateContent() {
        try {
            // Fetch runs for this pipeline
            this.runs = await this.client.getPipelineRuns(this.pipeline.id, 50);

            // Fetch commit messages and timeline for each run (in parallel)
            const runsWithTimelines = await Promise.all(
                this.runs.map(async run => {
                    try {
                        // Fetch commit message if available
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

                        // Fetch timeline
                        const timeline = await this.client.getRunTimeline(run.id);
                        return { run, timeline };
                    } catch (error) {
                        return { run, timeline: null };
                    }
                })
            );

            this.panel.webview.html = this.getHtmlContent(runsWithTimelines);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load pipeline runs: ${error}`);
        }
    }

    private getStageStatus(timeline: Timeline | null): Array<{ name: string; result: string }> {
        if (!timeline || !timeline.records) {
            return [];
        }

        // Filter for stage records
        const stages = timeline.records.filter(
            record => record.type === 'Stage'
        );

        return stages.map(stage => ({
            name: stage.name || 'Unknown',
            result: stage.result || stage.state || 'Unknown'
        }));
    }

    private getStatusIcon(result: string): string {
        const resultLower = result.toLowerCase();
        if (resultLower === 'succeeded') {
            return '<span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background-color: #107c10; color: white; font-size: 11px; font-weight: bold;">✓</span>';
        } else if (resultLower === 'failed') {
            return '<span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background-color: #d13438; color: white; font-size: 11px; font-weight: bold;">✗</span>';
        } else if (resultLower === 'partiallysucceeded') {
            return '<span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background-color: #ff8c00; color: white; font-size: 11px; font-weight: bold;">!</span>';
        } else if (resultLower === 'canceled' || resultLower === 'cancelled') {
            return '<span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background-color: #605e5c; color: white; font-size: 11px;">○</span>';
        } else if (resultLower === 'inprogress') {
            return '<span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background-color: #0078d4; color: white; font-size: 11px;">●</span>';
        }
        return '<span style="color: var(--vscode-descriptionForeground); font-size: 16px;">-</span>';
    }

    private formatTimeAgo(date: Date | string | undefined): string {
        if (!date) {
            return '-';
        }
        return formatTimeAgo(date);
    }

    private formatDuration(startTime: Date | string, finishTime?: Date | string): string {
        if (!finishTime) {
            return '-';
        }
        return formatDurationBetween(startTime, finishTime);
    }

    private getRunStatusIcon(run: PipelineRun): string {
        const result = (run.result || run.status || '').toLowerCase();
        return this.getStatusIcon(result);
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private matchesFilter(run: PipelineRun): boolean {
        // Filter by search text (run number or build number)
        if (this.currentFilter.searchText) {
            const searchLower = this.currentFilter.searchText.toLowerCase();
            const buildNumber = (run.buildNumber || '').toLowerCase();
            const runId = String(run.id).toLowerCase();
            if (!buildNumber.includes(searchLower) && !runId.includes(searchLower)) {
                return false;
            }
        }

        // Filter by state
        if (this.currentFilter.state && this.currentFilter.state.length > 0) {
            const runState = (run.result || run.status || '').toLowerCase();
            if (!this.currentFilter.state.some(s => s.toLowerCase() === runState)) {
                return false;
            }
        }

        // Filter by branch
        if (this.currentFilter.branch && this.currentFilter.branch.length > 0) {
            const branch = (run.sourceBranch || '').replace('refs/heads/', '').toLowerCase();
            if (!this.currentFilter.branch.some(b => branch.includes(b.toLowerCase()))) {
                return false;
            }
        }

        // Filter by requested for
        if (this.currentFilter.requestedFor && this.currentFilter.requestedFor.length > 0) {
            const requestedFor = (run.requestedFor?.displayName || run.requestedBy?.displayName || '').toLowerCase();
            if (!this.currentFilter.requestedFor.some(u => requestedFor.includes(u.toLowerCase()))) {
                return false;
            }
        }

        // Filter by repository
        if (this.currentFilter.repository && this.currentFilter.repository.length > 0) {
            const repoName = (run.repository?.name || '').toLowerCase();
            if (!this.currentFilter.repository.some(r => repoName.includes(r.toLowerCase()))) {
                return false;
            }
        }

        return true;
    }

    private getHtmlContent(runsWithTimelines: Array<{ run: PipelineRun; timeline: Timeline | null }>): string {
        // Apply filters
        const filteredRuns = runsWithTimelines.filter(({ run }) => this.matchesFilter(run));

        // Extract unique values for filter dropdowns
        const uniqueBranches = [...new Set(runsWithTimelines
            .map(({ run }) => run.sourceBranch?.replace('refs/heads/', '') || '')
            .filter(b => b)
        )].sort();

        const uniqueUsers = [...new Set(runsWithTimelines
            .map(({ run }) => run.requestedFor?.displayName || run.requestedBy?.displayName || '')
            .filter(u => u)
        )].sort();

        const uniqueRepositories = [...new Set(runsWithTimelines
            .map(({ run }) => run.repository?.name || '')
            .filter(r => r)
        )].sort();

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header-title {
            font-size: 20px;
            font-weight: 600;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 6px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .filter-search {
            flex: 1;
            min-width: 250px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }

        .filter-search:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .filter-dropdown {
            position: relative;
            display: inline-block;
        }

        .filter-dropdown-btn {
            padding: 8px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .filter-dropdown-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-dropdown-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .filter-dropdown-content {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            min-width: 180px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            max-height: 300px;
            overflow-y: auto;
        }

        .filter-dropdown.open .filter-dropdown-content {
            display: block;
        }

        .filter-option {
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-option:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .filter-option input[type="checkbox"] {
            cursor: pointer;
        }

        .filter-clear-btn {
            padding: 6px 12px;
            background: transparent;
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }

        .filter-clear-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .runs-table {
            width: 100%;
            border-collapse: collapse;
        }

        .runs-table th {
            text-align: left;
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .runs-table td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 13px;
        }

        .run-row {
            cursor: pointer;
            transition: background 0.1s;
        }

        .run-row:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .run-description {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .run-number {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }

        .run-message {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .run-trigger {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .stages {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .stage-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .time-info {
            text-align: right;
        }

        .time-ago {
            font-size: 13px;
            color: var(--vscode-foreground);
        }

        .duration {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state-text {
            font-size: 16px;
            margin-bottom: 8px;
        }

        .empty-state-subtext {
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">${this.escapeHtml(this.pipeline.name)}</div>
        <div class="header-actions">
            <button class="btn btn-secondary" onclick="refresh()">Refresh</button>
        </div>
    </div>

    <div class="filter-bar">
        <input
            type="text"
            class="filter-search"
            id="searchInput"
            placeholder="Filter by pipeline name or run number"
            value="${this.escapeHtml(this.currentFilter.searchText || '')}"
            oninput="updateSearchFilter(this.value)"
        />

        <div class="filter-dropdown" id="stateDropdown">
            <button class="filter-dropdown-btn ${this.currentFilter.state && this.currentFilter.state.length > 0 ? 'active' : ''}" onclick="toggleDropdown('stateDropdown')">
                State <span>▼</span>
            </button>
            <div class="filter-dropdown-content">
                <div class="filter-option">
                    <input type="checkbox" id="state-succeeded" value="succeeded" ${this.currentFilter.state?.includes('succeeded') ? 'checked' : ''} onchange="updateStateFilter()">
                    <label for="state-succeeded">✓ Succeeded</label>
                </div>
                <div class="filter-option">
                    <input type="checkbox" id="state-failed" value="failed" ${this.currentFilter.state?.includes('failed') ? 'checked' : ''} onchange="updateStateFilter()">
                    <label for="state-failed">✗ Failed</label>
                </div>
                <div class="filter-option">
                    <input type="checkbox" id="state-partiallySucceeded" value="partiallySucceeded" ${this.currentFilter.state?.includes('partiallySucceeded') ? 'checked' : ''} onchange="updateStateFilter()">
                    <label for="state-partiallySucceeded">⚠ Partially Succeeded</label>
                </div>
                <div class="filter-option">
                    <input type="checkbox" id="state-inProgress" value="inProgress" ${this.currentFilter.state?.includes('inProgress') ? 'checked' : ''} onchange="updateStateFilter()">
                    <label for="state-inProgress">● In Progress</label>
                </div>
                <div class="filter-option">
                    <input type="checkbox" id="state-canceled" value="canceled" ${this.currentFilter.state?.includes('canceled') ? 'checked' : ''} onchange="updateStateFilter()">
                    <label for="state-canceled">○ Canceled</label>
                </div>
            </div>
        </div>

        <div class="filter-dropdown" id="branchDropdown">
            <button class="filter-dropdown-btn ${this.currentFilter.branch && this.currentFilter.branch.length > 0 ? 'active' : ''}" onclick="toggleDropdown('branchDropdown')">
                Branch <span>▼</span>
            </button>
            <div class="filter-dropdown-content">
                ${uniqueBranches.length > 0 ? uniqueBranches.map((branch, index) => `
                    <div class="filter-option">
                        <input type="checkbox" id="branch-${index}" value="${this.escapeHtml(branch)}" ${this.currentFilter.branch?.includes(branch) ? 'checked' : ''} onchange="updateBranchFilter()">
                        <label for="branch-${index}">${this.escapeHtml(branch)}</label>
                    </div>
                `).join('') : '<div class="filter-option" style="opacity: 0.6;">No branches available</div>'}
            </div>
        </div>

        <div class="filter-dropdown" id="requestedForDropdown">
            <button class="filter-dropdown-btn ${this.currentFilter.requestedFor && this.currentFilter.requestedFor.length > 0 ? 'active' : ''}" onclick="toggleDropdown('requestedForDropdown')">
                Requested for <span>▼</span>
            </button>
            <div class="filter-dropdown-content">
                ${uniqueUsers.length > 0 ? uniqueUsers.map((user, index) => `
                    <div class="filter-option">
                        <input type="checkbox" id="user-${index}" value="${this.escapeHtml(user)}" ${this.currentFilter.requestedFor?.includes(user) ? 'checked' : ''} onchange="updateRequestedForFilter()">
                        <label for="user-${index}">${this.escapeHtml(user)}</label>
                    </div>
                `).join('') : '<div class="filter-option" style="opacity: 0.6;">No users available</div>'}
            </div>
        </div>

        <div class="filter-dropdown" id="repositoryDropdown">
            <button class="filter-dropdown-btn ${this.currentFilter.repository && this.currentFilter.repository.length > 0 ? 'active' : ''}" onclick="toggleDropdown('repositoryDropdown')">
                Repository <span>▼</span>
            </button>
            <div class="filter-dropdown-content">
                ${uniqueRepositories.length > 0 ? uniqueRepositories.map((repo, index) => `
                    <div class="filter-option">
                        <input type="checkbox" id="repo-${index}" value="${this.escapeHtml(repo)}" ${this.currentFilter.repository?.includes(repo) ? 'checked' : ''} onchange="updateRepositoryFilter()">
                        <label for="repo-${index}">${this.escapeHtml(repo)}</label>
                    </div>
                `).join('') : '<div class="filter-option" style="opacity: 0.6;">No repositories available</div>'}
            </div>
        </div>

        ${(this.currentFilter.searchText || this.currentFilter.state || this.currentFilter.branch || this.currentFilter.requestedFor || this.currentFilter.repository) ? `
            <button class="filter-clear-btn" onclick="clearAllFilters()">✕ Clear</button>
        ` : ''}
    </div>

    ${filteredRuns.length > 0 ? `
        <table class="runs-table">
            <thead>
                <tr>
                    <th>Description</th>
                    <th style="width: 280px; padding-left: 40px;">Stages</th>
                    <th style="width: 120px; text-align: right;">Time</th>
                </tr>
            </thead>
            <tbody>
                ${filteredRuns.map(({ run, timeline }) => {
                    const stages = this.getStageStatus(timeline);
                    // Use finishedDate or finishTime, fallback to createdDate or startTime or queueTime
                    const endTime = run.finishedDate || run.finishTime || run.createdDate || run.startTime || run.queueTime;
                    const startTimeValue = run.createdDate || run.startTime || run.queueTime;
                    const finishTimeValue = run.finishedDate || run.finishTime;

                    const timeAgo = endTime ? this.formatTimeAgo(endTime) : '-';
                    const duration = startTimeValue && finishTimeValue
                        ? this.formatDuration(startTimeValue, finishTimeValue)
                        : (startTimeValue && !finishTimeValue ? 'In progress' : '-');

                    // Get the user who triggered the run - check multiple possible fields
                    const triggeredBy = run.requestedBy?.displayName ||
                                       run.requestedFor?.displayName ||
                                       (run as any).requestedBy?.name ||
                                       (run as any).requestedFor?.name ||
                                       'Unknown';

                    // Get branch information
                    const branch = run.sourceBranch?.replace('refs/heads/', '') || '';

                    // Get repository information
                    const repository = run.repository?.name || this.pipeline.repository?.name || '';

                    // Get first line of commit message
                    const commitMessage = run.commitMessage ? run.commitMessage.split('\n')[0] : '';

                    return `
                        <tr class="run-row" onclick="openRun(${run.id})">
                            <td>
                                <div class="run-description">
                                    ${this.getRunStatusIcon(run)}
                                    <div>
                                        <div class="run-number">#${this.escapeHtml(run.buildNumber || String(run.id))}</div>
                                        ${commitMessage ? `<div class="run-message">${this.escapeHtml(commitMessage)}</div>` : (run.name && run.name !== run.buildNumber ? `<div class="run-message">${this.escapeHtml(run.name)}</div>` : '')}
                                        <div class="run-trigger">
                                            <span>Manually run by</span>
                                            <span style="font-weight: 500;">${this.escapeHtml(triggeredBy)}</span>
                                            ${repository ? `<span>•</span><span>${this.escapeHtml(repository)}</span>` : ''}
                                            ${branch ? `<span>•</span><span>${this.escapeHtml(branch)}</span>` : ''}
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td style="padding-left: 40px;">
                                <div class="stages">
                                    ${stages.length > 0
                                        ? stages.map(stage => `<div class="stage-icon" title="${this.escapeHtml(stage.name)}: ${this.escapeHtml(stage.result)}">${this.getStatusIcon(stage.result)}</div>`).join('')
                                        : '<span style="color: var(--vscode-descriptionForeground);">-</span>'
                                    }
                                </div>
                            </td>
                            <td>
                                <div class="time-info">
                                    <div class="time-ago">${timeAgo}</div>
                                    <div class="duration">${duration}</div>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : `
        <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-text">No runs found</div>
            <div class="empty-state-subtext">This pipeline hasn't been run yet</div>
        </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        let currentFilter = ${JSON.stringify(this.currentFilter)};

        function openRun(runId) {
            vscode.postMessage({ command: 'openRun', runId });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function toggleDropdown(dropdownId) {
            const dropdown = document.getElementById(dropdownId);
            const allDropdowns = document.querySelectorAll('.filter-dropdown');

            // Close all other dropdowns
            allDropdowns.forEach(d => {
                if (d.id !== dropdownId) {
                    d.classList.remove('open');
                }
            });

            dropdown.classList.toggle('open');
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.filter-dropdown')) {
                document.querySelectorAll('.filter-dropdown').forEach(d => {
                    d.classList.remove('open');
                });
            }
        });

        function updateSearchFilter(value) {
            currentFilter.searchText = value || undefined;
            applyFilter();
        }

        function updateStateFilter() {
            const states = [];
            document.querySelectorAll('[id^="state-"]:checked').forEach(checkbox => {
                states.push(checkbox.value);
            });
            currentFilter.state = states.length > 0 ? states : undefined;
            applyFilter();
        }

        function updateBranchFilter() {
            const branches = [];
            document.querySelectorAll('[id^="branch-"]:checked').forEach(checkbox => {
                branches.push(checkbox.value);
            });
            currentFilter.branch = branches.length > 0 ? branches : undefined;
            applyFilter();
        }

        function updateRequestedForFilter() {
            const users = [];
            document.querySelectorAll('[id^="user-"]:checked').forEach(checkbox => {
                users.push(checkbox.value);
            });
            currentFilter.requestedFor = users.length > 0 ? users : undefined;
            applyFilter();
        }

        function updateRepositoryFilter() {
            const repos = [];
            document.querySelectorAll('[id^="repo-"]:checked').forEach(checkbox => {
                repos.push(checkbox.value);
            });
            currentFilter.repository = repos.length > 0 ? repos : undefined;
            applyFilter();
        }

        function clearAllFilters() {
            currentFilter = {};
            vscode.postMessage({ command: 'clearFilter' });
        }

        function applyFilter() {
            vscode.postMessage({ command: 'updateFilter', filter: currentFilter });
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        PipelineRunsPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
