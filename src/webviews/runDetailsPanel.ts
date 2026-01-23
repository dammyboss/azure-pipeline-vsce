import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { PipelineRun, TimelineRecord } from '../models/types';

export class RunDetailsPanel {
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private refreshInterval?: NodeJS.Timeout;

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private run: PipelineRun
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.update();
        
        // Auto-refresh if running
        if (this.run.status === 'inProgress' || this.run.status === 'notStarted') {
            this.startAutoRefresh();
        }

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'refresh':
                        await this.update();
                        break;
                    case 'cancel':
                        await this.cancelRun();
                        break;
                    case 'retry':
                        await this.retryRun();
                        break;
                    case 'viewLog':
                        await this.viewLog(message.logId);
                        break;
                    case 'openInBrowser':
                        vscode.env.openExternal(vscode.Uri.parse(this.run.url));
                        break;
                    case 'runNew':
                        await this.runNewPipeline();
                        break;
                    case 'downloadLogs':
                        await this.downloadLogs();
                        break;
                    case 'editPipeline':
                        vscode.env.openExternal(vscode.Uri.parse(this.run.url.replace('/_build/results', '/_build/definition')));
                        break;
                    case 'loadTests':
                        await this.loadTestResults();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static async show(client: AzureDevOpsClient, run: PipelineRun) {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        const panel = vscode.window.createWebviewPanel(
            'runDetails',
            `Run: ${run.buildNumber || run.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Fetch the latest run data to ensure we have accurate status
        try {
            const freshRun = await client.getRun(run.id);
            new RunDetailsPanel(panel, client, freshRun);
        } catch (error) {
            console.error('Failed to fetch run details, using cached data:', error);
            new RunDetailsPanel(panel, client, run);
        }
    }

    private startAutoRefresh() {
        this.refreshInterval = setInterval(async () => {
            try {
                // Refresh run data
                this.run = await this.client.getRun(this.run.id);
                await this.update();
                
                // Stop auto-refresh if completed
                if (this.run.status === 'completed') {
                    this.stopAutoRefresh();
                }
            } catch (error) {
                console.error('Auto-refresh failed:', error);
                // Stop auto-refresh on error
                this.stopAutoRefresh();
            }
        }, 5000);
    }

    private stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
    }

    private async update() {
        // Use the run data we already have, don't fetch again
        const timeline = await this.client.getRunTimeline(this.run.id);
        const logs = await this.client.getRunLogs(this.run.id);
        
        this.panel.webview.html = this.getHtmlContent(timeline.records || [], logs);
    }

    private async cancelRun() {
        try {
            await this.client.cancelRun(this.run.id);
            vscode.window.showInformationMessage('Run canceled');
            await this.update();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to cancel run: ${error}`);
        }
    }

    private async retryRun() {
        try {
            const newRun = await this.client.retryRun(this.run.id);
            vscode.window.showInformationMessage(`Run retried: ${newRun.buildNumber}`);
            this.run = newRun;
            await this.update();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to retry run: ${error}`);
        }
    }

    private async viewLog(logId: number) {
        try {
            const content = await this.client.getLogContent(this.run.id, logId);
            // Send log content to webview for inline display
            this.panel.webview.postMessage({
                command: 'showLog',
                logId: logId,
                content: content
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load log: ${error}`);
        }
    }

    private async runNewPipeline() {
        try {
            const pipelineId = this.run.pipeline?.id || this.run.definition?.id;
            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not found');
                return;
            }

            const branch = this.run.sourceBranch?.replace('refs/heads/', '') || 'main';
            const newRun = await this.client.runPipeline(pipelineId, { branch });
            vscode.window.showInformationMessage(`New run started: ${newRun.name}`);

            // Optionally open the new run
            const openNew = await vscode.window.showInformationMessage(
                'Run started successfully',
                'View New Run'
            );
            if (openNew === 'View New Run') {
                RunDetailsPanel.show(this.client, newRun);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start new run: ${error}`);
        }
    }

    private async downloadLogs() {
        try {
            const logs = await this.client.getRunLogs(this.run.id);
            if (logs.length === 0) {
                vscode.window.showInformationMessage('No logs available for this run');
                return;
            }

            // Get all log content
            let allLogs = `Pipeline Run: ${this.run.buildNumber}\n`;
            allLogs += `Status: ${this.run.result || this.run.status}\n`;
            allLogs += `Started: ${this.run.createdDate}\n\n`;
            allLogs += '='.repeat(80) + '\n\n';

            for (const log of logs) {
                const content = await this.client.getLogContent(this.run.id, log.id);
                allLogs += `\n\n${'='.repeat(80)}\n`;
                allLogs += `Log ID: ${log.id}\n`;
                allLogs += `${'='.repeat(80)}\n\n`;
                allLogs += content;
            }

            // Create a new text document with all logs
            const doc = await vscode.workspace.openTextDocument({
                content: allLogs,
                language: 'log'
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to download logs: ${error}`);
        }
    }

    private async loadTestResults() {
        try {
            const testRuns = await this.client.getTestRuns(this.run.id);

            this.panel.webview.postMessage({
                command: 'showTestResults',
                testRuns: testRuns
            });
        } catch (error) {
            this.panel.webview.postMessage({
                command: 'showTestResults',
                testRuns: [],
                error: String(error)
            });
        }
    }

    private getErrorHtml(error: string): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
        }
        .error {
            padding: 20px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
        }
    </style>
</head>
<body>
    <div class="error">
        <h3>Unable to load run details</h3>
        <p>This run may not have detailed timeline information available.</p>
        <p><a href="${this.run.url}">View in browser</a></p>
    </div>
</body>
</html>`;
    }

    private getHtmlContent(records: TimelineRecord[], logs: any[]): string {
        const statusColor = this.getStatusColor(this.run.result || this.run.status);
        const isRunning = this.run.status === 'inProgress' || this.run.status === 'notStarted';
        
        const stages = this.buildStageHierarchy(records);
        const duration = this.run.finishedDate && this.run.createdDate
            ? this.formatDuration(new Date(this.run.createdDate), new Date(this.run.finishedDate))
            : 'In progress...';
        
        const hasTimeline = stages.length > 0;

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
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        .title { font-size: 24px; font-weight: 600; margin-bottom: 10px; }
        .meta { display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px; color: var(--vscode-descriptionForeground); }
        .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            background: ${statusColor};
            color: white;
        }
        .actions {
            margin: 20px 0;
            display: flex;
            gap: 10px;
        }
        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .summary-section {
            margin: 20px 0;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 12px;
        }
        .summary-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .summary-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            font-weight: 600;
        }
        .summary-value {
            font-size: 14px;
            color: var(--vscode-foreground);
        }
        .timeline { margin-top: 20px; }
        .stage {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 10px;
            overflow: hidden;
        }
        .stage-header {
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .stage-header:hover { background: var(--vscode-list-hoverBackground); }
        .stage-icon {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .stage-name { flex: 1; font-weight: 600; }
        .stage-duration { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .stage-body { display: none; padding: 0; }
        .stage.expanded .stage-body { display: block; }
        .stage.expanded .expand-icon::before { content: '▼'; }
        .expand-icon::before { content: '▶'; margin-right: 5px; }

        /* Enhanced Job Styles with Collapsible Support */
        .job-container {
            border-top: 1px solid var(--vscode-panel-border);
        }
        .job {
            padding: 10px 16px 10px 40px;
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            position: relative;
        }
        .job:hover { background: var(--vscode-list-hoverBackground); }
        .job-expand-icon {
            position: absolute;
            left: 20px;
            font-size: 10px;
            transition: transform 0.2s;
        }
        .job-container.expanded .job-expand-icon {
            transform: rotate(90deg);
        }
        .job-tasks {
            display: none;
            background: var(--vscode-editor-background);
        }
        .job-container.expanded .job-tasks {
            display: block;
        }
        .job-info {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }

        /* Enhanced Task Styles */
        .task {
            padding: 8px 16px 8px 70px;
            border-top: 1px solid rgba(128, 128, 128, 0.2);
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
            position: relative;
        }
        .task::before {
            content: '';
            position: absolute;
            left: 48px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--vscode-panel-border);
        }
        .task:last-child::before {
            bottom: 50%;
        }
        .task::after {
            content: '';
            position: absolute;
            left: 48px;
            top: 50%;
            width: 12px;
            height: 2px;
            background: var(--vscode-panel-border);
        }
        .task:hover { background: var(--vscode-list-hoverBackground); }
        .task-icon {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            position: relative;
            z-index: 1;
        }
        .task-name {
            flex: 1;
            min-width: 0;
        }
        .task-name-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .success { background: #28a745; }
        .failed { background: #dc3545; }
        .running { background: #007acc; animation: pulse 1.5s infinite; }
        .warning { background: #ffa500; }
        .canceled { background: #6c757d; }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .log-link {
            margin-left: auto;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 12px;
        }
        .log-link:hover { text-decoration: underline; }

        /* Top Header with Run New button and menu */
        .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .run-new-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
        }
        .run-new-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .menu-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            position: relative;
        }
        .menu-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .dropdown-menu {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            min-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
        }
        .dropdown-menu.show {
            display: block;
        }
        .dropdown-item {
            padding: 10px 16px;
            cursor: pointer;
            font-size: 13px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .dropdown-item:last-child {
            border-bottom: none;
        }
        .dropdown-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .dropdown-divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 4px 0;
        }

        .issues {
            margin-top: 20px;
            padding: 16px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
        }
        .issue {
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .issue:last-child { border-bottom: none; }
        .issue-type { font-weight: 600; margin-right: 8px; }
        .error { color: #dc3545; }
        .warning-text { color: #ffa500; }
        
        /* Stages & Jobs Tile Styles */
        .stages-jobs-section {
            margin: 20px 0;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 16px;
        }
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
            border-bottom: 2px solid transparent;
        }
        .tab.active {
            color: var(--vscode-foreground);
            border-bottom-color: var(--vscode-focusBorder);
        }
        .tab:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .stage-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
        }
        .stage-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            background: var(--vscode-editor-background);
        }
        .stage-card-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
        }
        .stage-card-title {
            font-weight: 600;
            font-size: 16px;
            flex: 1;
        }
        .stage-card-status {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            color: white;
        }
        .stage-card-duration {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
        .scanning-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
        }
        .scanning-card-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .scanning-card-icon {
            color: #007acc;
        }
        .scanning-card-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            font-size: 12px;
        }
        .scanning-stat {
            text-align: center;
        }
        .scanning-stat-value {
            font-weight: 600;
            font-size: 18px;
        }
        .scanning-stat-label {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        .jobs-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .job-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            background: var(--vscode-editor-background);
        }
        .job-item-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        .job-item-name {
            font-weight: 600;
            flex: 1;
        }
        .job-item-duration {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .job-item-tasks {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
        }

        /* Inline Log Viewer Styles */
        .log-viewer-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            animation: fadeIn 0.2s ease-in;
        }
        .log-viewer-overlay.active {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .log-viewer-panel {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 90%;
            max-width: 1200px;
            height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            animation: slideUp 0.3s ease-out;
        }
        .log-viewer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .log-viewer-title {
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .log-viewer-live-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 2px 8px;
            background: #dc3545;
            color: white;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .log-viewer-live-badge::before {
            content: '';
            width: 6px;
            height: 6px;
            background: white;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }
        .log-viewer-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 20px;
            padding: 0 8px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .log-viewer-close:hover {
            opacity: 1;
        }
        .log-viewer-content {
            flex: 1;
            overflow: auto;
            padding: 16px 20px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
        }
        .log-viewer-content pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .log-line {
            padding: 2px 0;
        }
        .log-line-number {
            display: inline-block;
            width: 50px;
            text-align: right;
            margin-right: 16px;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none;
        }
        .log-line-content {
            color: var(--vscode-editor-foreground);
        }
        .log-loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideUp {
            from {
                transform: translateY(20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
    </style>
</head>
<body>
    <div class="header" style="position: relative;">
        <div class="title">
            ${this.run.pipeline?.name || this.run.definition?.name || this.run.name || 'Pipeline Run'} - ${this.run.buildNumber || this.run.name}
        </div>
        <div class="meta">
            <span class="status">${this.run.result || this.run.status}</span>
            <span>Branch: ${this.run.sourceBranch?.replace('refs/heads/', '') || 'N/A'}</span>
            <span>Duration: ${duration}</span>
            <span>Started: ${this.run.createdDate ? new Date(this.run.createdDate).toLocaleString() : 'N/A'}</span>
            ${this.run.requestedBy?.displayName || this.run.requestedFor?.displayName ? `<span>By: ${this.run.requestedBy?.displayName || this.run.requestedFor?.displayName}</span>` : ''}
        </div>
        <div class="header-actions" style="position: absolute; top: 0; right: 0;">
            <button class="run-new-btn" onclick="runNew()">Run new</button>
            <div style="position: relative;">
                <button class="menu-button" onclick="toggleMenu(event)">⋮</button>
                <div class="dropdown-menu" id="dropdownMenu">
                    <div class="dropdown-item" onclick="downloadLogs()">Download logs</div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" onclick="editPipeline()">Edit pipeline</div>
                    <div class="dropdown-item" onclick="openInBrowser()">Open in browser</div>
                </div>
            </div>
        </div>
    </div>

    <div class="actions">
        <button onclick="refresh()">🔄 Refresh</button>
        ${isRunning ? '<button onclick="cancel()">⏹️ Cancel</button>' : ''}
        ${this.run.result === 'failed' || this.run.result === 'partiallySucceeded' ? '<button onclick="retry()">🔁 Retry</button>' : ''}
    </div>

    <div class="summary-section">
        <div class="tabs" style="margin-bottom: 16px;">
            <div class="tab active" onclick="switchSummaryTab('summary')">Summary</div>
            <div class="tab" onclick="switchSummaryTab('tests')">Tests</div>
        </div>
        <div class="tab-content active" id="summary-tab-content">
            <div class="summary-grid">
            <div class="summary-item">
                <span class="summary-label">Repository</span>
                <span class="summary-value">${this.run.repository?.id || this.run.repository?.name || 'N/A'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Branch</span>
                <span class="summary-value">${this.run.sourceBranch?.replace('refs/heads/', '') || 'N/A'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Commit</span>
                <span class="summary-value">${this.run.sourceVersion?.substring(0, 8) || 'N/A'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Triggered by</span>
                <span class="summary-value">${this.run.requestedBy?.displayName || this.run.requestedFor?.displayName || 'System'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Started</span>
                <span class="summary-value">${this.run.createdDate ? new Date(this.run.createdDate).toLocaleString() : 'N/A'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Duration</span>
                <span class="summary-value">${duration}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Status</span>
                <span class="summary-value">${this.run.result || this.run.status}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Run ID</span>
                <span class="summary-value">#${this.run.id}</span>
            </div>
        </div>
        </div>
        <div class="tab-content" id="tests-tab-content">
            <div id="test-runs-container" style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">
                Loading test results...
            </div>
        </div>
    </div>

    ${hasTimeline ? `
    <div class="stages-jobs-section">
        <h3 style="margin: 0 0 16px 0;">Stage & Job Details</h3>
        <div class="tabs">
            <div class="tab active" onclick="switchTab('stages')">Stages</div>
            <div class="tab" onclick="switchTab('jobs')">Jobs</div>
        </div>
        <div class="tab-content active" id="stages-tab">
            ${this.renderStagesTab(stages)}
        </div>
        <div class="tab-content" id="jobs-tab">
            ${this.renderJobsTab(stages)}
        </div>
    </div>
    ` : ''}

    ${hasTimeline ? `
    <div class="timeline">
        <h3 style="margin-bottom: 15px;">Timeline</h3>
        ${stages.map(stage => this.renderStage(stage)).join('')}
    </div>
    ` : ''}

    ${this.renderIssues(records)}

    <!-- Inline Log Viewer -->
    <div class="log-viewer-overlay" id="logViewerOverlay">
        <div class="log-viewer-panel">
            <div class="log-viewer-header">
                <div class="log-viewer-title" id="logViewerTitle">Task Log</div>
                <button class="log-viewer-close" onclick="closeLogViewer()">×</button>
            </div>
            <div class="log-viewer-content" id="logViewerContent">
                <div class="log-loading">Loading log...</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let logStreamInterval = null;
        let currentLogId = null;
        let isStreaming = false;

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function retry() {
            vscode.postMessage({ command: 'retry' });
        }

        function openInBrowser() {
            vscode.postMessage({ command: 'openInBrowser' });
        }

        function runNew() {
            vscode.postMessage({ command: 'runNew' });
        }

        function downloadLogs() {
            vscode.postMessage({ command: 'downloadLogs' });
            closeMenu();
        }

        function editPipeline() {
            vscode.postMessage({ command: 'editPipeline' });
            closeMenu();
        }

        function toggleMenu(event) {
            event.stopPropagation();
            const menu = document.getElementById('dropdownMenu');
            menu.classList.toggle('show');
        }

        function closeMenu() {
            const menu = document.getElementById('dropdownMenu');
            menu.classList.remove('show');
        }

        function switchSummaryTab(tabName) {
            const tabs = document.querySelectorAll('.summary-section .tab');
            tabs.forEach(tab => tab.classList.remove('active'));

            const activeTab = Array.from(tabs).find(tab =>
                tab.getAttribute('onclick') === \`switchSummaryTab('\${tabName}')\`
            );
            if (activeTab) activeTab.classList.add('active');

            document.getElementById('summary-tab-content')?.classList.toggle('active', tabName === 'summary');
            document.getElementById('tests-tab-content')?.classList.toggle('active', tabName === 'tests');

            if (tabName === 'tests') {
                loadTestResults();
            }
        }

        async function loadTestResults() {
            const container = document.getElementById('test-runs-container');
            container.innerHTML = '<div style="padding: 20px; text-align: center;">Loading test results...</div>';
            vscode.postMessage({ command: 'loadTests' });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            closeMenu();
        });

        function viewLog(logId, taskName = null, taskStatus = null) {
            // Show log viewer with loading state
            const overlay = document.getElementById('logViewerOverlay');
            const content = document.getElementById('logViewerContent');
            const title = document.getElementById('logViewerTitle');

            currentLogId = logId;
            title.innerHTML = taskName || 'Task Log';
            content.innerHTML = '<div class="log-loading">Loading log...</div>';
            overlay.classList.add('active');

            // Check if we should stream (task is running)
            const shouldStream = taskStatus && (taskStatus.toLowerCase() === 'inprogress' || taskStatus.toLowerCase() === 'running');

            if (shouldStream) {
                startLogStreaming(logId, taskName);
            } else {
                stopLogStreaming();
            }

            // Request log content from extension
            vscode.postMessage({ command: 'viewLog', logId });
        }

        function startLogStreaming(logId, taskName) {
            isStreaming = true;
            const title = document.getElementById('logViewerTitle');
            title.innerHTML = \`\${taskName || 'Task Log'} <span class="log-viewer-live-badge">Live</span>\`;

            // Refresh logs every 3 seconds
            logStreamInterval = setInterval(() => {
                if (currentLogId === logId) {
                    vscode.postMessage({ command: 'viewLog', logId });
                }
            }, 3000);
        }

        function stopLogStreaming() {
            if (logStreamInterval) {
                clearInterval(logStreamInterval);
                logStreamInterval = null;
            }
            isStreaming = false;
        }

        function closeLogViewer() {
            const overlay = document.getElementById('logViewerOverlay');
            overlay.classList.remove('active');
            stopLogStreaming();
            currentLogId = null;
        }

        function toggleStage(element) {
            element.closest('.stage').classList.toggle('expanded');
        }

        function toggleJob(element) {
            event.stopPropagation();
            element.closest('.job-container').classList.toggle('expanded');
        }

        function switchTab(tabName) {
            // Update tabs
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            // Activate selected tab
            const tabs = document.querySelectorAll('.tab');
            for (let i = 0; i < tabs.length; i++) {
                if (tabs[i].getAttribute('onclick') === "switchTab('" + tabName + "')") {
                    tabs[i].classList.add('active');
                    break;
                }
            }
            document.getElementById(tabName + '-tab')?.classList.add('active');
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'showLog') {
                const content = document.getElementById('logViewerContent');
                const wasScrolledToBottom = content.scrollHeight - content.scrollTop === content.clientHeight ||
                                           content.scrollHeight - content.scrollTop - content.clientHeight < 50;

                // Format log content with line numbers
                const lines = message.content.split('\\n');
                const formattedLines = lines.map((line, index) => {
                    const lineNum = index + 1;
                    const escapedLine = line
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    return \`<div class="log-line"><span class="log-line-number">\${lineNum}</span><span class="log-line-content">\${escapedLine}</span></div>\`;
                }).join('');

                content.innerHTML = formattedLines || '<div class="log-loading">No log content available</div>';

                // Auto-scroll to bottom if we were already at the bottom or if streaming
                if (isStreaming || wasScrolledToBottom) {
                    setTimeout(() => {
                        content.scrollTop = content.scrollHeight;
                    }, 100);
                }
            } else if (message.command === 'showTestResults') {
                const container = document.getElementById('test-runs-container');
                if (message.error) {
                    container.innerHTML = \`<div style="padding: 20px; text-align: center; color: var(--vscode-errorForeground);">Failed to load test results: \${message.error}</div>\`;
                    return;
                }

                const testRuns = message.testRuns || [];
                if (testRuns.length === 0) {
                    container.innerHTML = '<div style="padding: 20px; text-align: center;">No test results available for this run</div>';
                    return;
                }

                let html = '<div style="padding: 16px;">';
                testRuns.forEach(run => {
                    const passRate = run.totalTests > 0 ? ((run.passedTests / run.totalTests) * 100).toFixed(1) : 0;
                    const statusColor = run.state === 'Completed' ? (run.passedTests === run.totalTests ? '#28a745' : '#dc3545') : '#007acc';

                    html += \`
                        <div style="border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 16px; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                                <div style="width: 12px; height: 12px; border-radius: 50%; background: \${statusColor};"></div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; font-size: 14px;">\${run.name || 'Test Run #' + run.id}</div>
                                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">State: \${run.state || 'Unknown'}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 20px; font-weight: 600;">\${passRate}%</div>
                                    <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">Pass Rate</div>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-size: 13px;">
                                <div>
                                    <div style="color: var(--vscode-descriptionForeground);">Total</div>
                                    <div style="font-weight: 600;">\${run.totalTests || 0}</div>
                                </div>
                                <div>
                                    <div style="color: var(--vscode-descriptionForeground);">Passed</div>
                                    <div style="font-weight: 600; color: #28a745;">\${run.passedTests || 0}</div>
                                </div>
                                <div>
                                    <div style="color: var(--vscode-descriptionForeground);">Failed</div>
                                    <div style="font-weight: 600; color: #dc3545;">\${(run.unanalyzedTests || 0) + (run.incompleteTests || 0)}</div>
                                </div>
                                <div>
                                    <div style="color: var(--vscode-descriptionForeground);">Duration</div>
                                    <div style="font-weight: 600;">\${run.completedDate && run.startedDate ? formatDuration(run.startedDate, run.completedDate) : 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    \`;
                });
                html += '</div>';
                container.innerHTML = html;
            }
        });

        function formatDuration(start, end) {
            const diff = new Date(end) - new Date(start);
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);

            if (hours > 0) {
                return \`\${hours}h \${minutes % 60}m\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${seconds % 60}s\`;
            } else {
                return \`\${seconds}s\`;
            }
        }

        // Close log viewer when clicking outside the panel
        document.getElementById('logViewerOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'logViewerOverlay') {
                closeLogViewer();
            }
        });

        // Auto-expand first stage
        document.querySelector('.stage')?.classList.add('expanded');
    </script>
</body>
</html>`;
    }

    private buildStageHierarchy(records: TimelineRecord[]): any[] {
        if (!records || records.length === 0) {
            return [];
        }

        const stages = records.filter(r => r.type === 'Stage');

        const hierarchy = stages.map(stage => {
            // Get phases for this stage
            const phases = records.filter(r => r.type === 'Phase' && r.parentId === stage.id);

            // Get jobs from all phases in this stage
            const jobs: any[] = [];
            for (const phase of phases) {
                const phaseJobs = records.filter(r => r.type === 'Job' && r.parentId === phase.id);
                jobs.push(...phaseJobs);
            }

            // Also check for jobs directly under the stage (in case there's no phase)
            const directJobs = records.filter(r => r.type === 'Job' && r.parentId === stage.id);
            jobs.push(...directJobs);

            const jobsWithTasks = jobs.map(job => {
                const tasks = records.filter(r => r.type === 'Task' && r.parentId === job.id);
                return {
                    ...job,
                    tasks: tasks
                };
            });

            return {
                ...stage,
                jobs: jobsWithTasks
            };
        });

        return hierarchy;
    }

    private renderStage(stage: any): string {
        const icon = this.getStatusIcon(stage.result || stage.state);
        const duration = stage.startTime && stage.finishTime
            ? this.formatDuration(new Date(stage.startTime), new Date(stage.finishTime))
            : '';

        return `
            <div class="stage">
                <div class="stage-header" onclick="toggleStage(this)">
                    <span class="expand-icon"></span>
                    <div class="stage-icon ${icon}">${this.getIconSymbol(stage.result || stage.state)}</div>
                    <span class="stage-name">${stage.name}</span>
                    <span class="stage-duration">${duration}</span>
                </div>
                <div class="stage-body">
                    ${stage.jobs.map((job: any) => this.renderJob(job)).join('')}
                </div>
            </div>
        `;
    }

    private renderJob(job: any): string {
        const icon = this.getStatusIcon(job.result || job.state);
        const duration = job.startTime && job.finishTime
            ? this.formatDuration(new Date(job.startTime), new Date(job.finishTime))
            : '';
        const hasTasks = job.tasks && job.tasks.length > 0;
        const taskCount = hasTasks ? job.tasks.length : 0;
        const completedTasks = hasTasks ? job.tasks.filter((t: any) => t.result === 'succeeded').length : 0;

        return `
            <div class="job-container ${hasTasks ? 'expanded' : ''}">
                <div class="job" onclick="toggleJob(this)">
                    ${hasTasks ? '<span class="job-expand-icon">▶</span>' : ''}
                    <div class="job-info">
                        <div class="stage-icon ${icon}">${this.getIconSymbol(job.result || job.state)}</div>
                        <span style="flex: 1;">
                            ${job.name}
                            ${hasTasks ? `<span style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: 8px;">(${completedTasks}/${taskCount} tasks)</span>` : ''}
                        </span>
                        <span class="stage-duration">${duration}</span>
                        ${job.log ? `<span class="log-link" onclick="event.stopPropagation(); viewLog(${job.log.id}, '${job.name.replace(/'/g, "\\'")}', '${job.result || job.state}')">📄 View Log</span>` : ''}
                    </div>
                </div>
                ${hasTasks ? `
                <div class="job-tasks">
                    ${job.tasks.map((task: any) => this.renderTask(task)).join('')}
                </div>
                ` : ''}
            </div>
        `;
    }

    private renderTask(task: any): string {
        const icon = this.getStatusIcon(task.result || task.state);
        const duration = task.startTime && task.finishTime
            ? this.formatDuration(new Date(task.startTime), new Date(task.finishTime))
            : '';
        const status = task.result || task.state || 'pending';
        const statusText = String(status).toLowerCase();

        return `
            <div class="task">
                <div class="task-icon ${icon}"></div>
                <div class="task-name">
                    <div class="task-name-text" title="${task.name}">${task.name}</div>
                    ${statusText === 'inprogress' ? '<div style="font-size: 11px; color: var(--vscode-descriptionForeground);">Running...</div>' : ''}
                </div>
                <span class="stage-duration">${duration}</span>
                ${task.log ? `<span class="log-link" onclick="viewLog(${task.log.id}, '${task.name.replace(/'/g, "\\'")}', '${status}')">📄 Log</span>` : ''}
            </div>
        `;
    }

    private renderStagesTab(stages: any[]): string {
        if (stages.length === 0) {
            return '<p>No stage information available.</p>';
        }

        return `
            <div class="stage-cards">
                ${stages.map(stage => this.renderStageCard(stage)).join('')}
            </div>
        `;
    }

    private renderStageCard(stage: any): string {
        const status = stage.result || stage.state;
        const statusColor = this.getStatusColor(status);
        const icon = this.getStatusIcon(status);
        const duration = stage.startTime && stage.finishTime
            ? this.formatDuration(new Date(stage.startTime), new Date(stage.finishTime))
            : 'In progress...';

        // Mock scanning data - in a real implementation, this would come from API
        const hasScanning = stage.name.toLowerCase().includes('build') || stage.name.toLowerCase().includes('test');
        
        return `
            <div class="stage-card">
                <div class="stage-card-header">
                    <div class="stage-icon ${icon}">${this.getIconSymbol(status)}</div>
                    <div class="stage-card-title">${stage.name}</div>
                    <div class="stage-card-status" style="background: ${statusColor}">
                        ${status}
                    </div>
                </div>
                <div class="stage-card-duration">Duration: ${duration}</div>
                
                ${hasScanning ? this.renderScanningCard() : ''}
                
                ${stage.jobs && stage.jobs.length > 0 ? `
                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 12px;">
                        Jobs: ${stage.jobs.length}
                    </div>
                ` : ''}
            </div>
        `;
    }

    private renderScanningCard(): string {
        // Mock scanning data - in a real implementation, this would come from security scanning API
        return `
            <div class="scanning-card">
                <div class="scanning-card-title">
                    <span class="scanning-card-icon">🔍</span>
                    Source Code Scanning
                </div>
                <div class="scanning-card-stats">
                    <div class="scanning-stat">
                        <div class="scanning-stat-value">0</div>
                        <div class="scanning-stat-label">Critical</div>
                    </div>
                    <div class="scanning-stat">
                        <div class="scanning-stat-value">2</div>
                        <div class="scanning-stat-label">High</div>
                    </div>
                    <div class="scanning-stat">
                        <div class="scanning-stat-value">5</div>
                        <div class="scanning-stat-label">Medium</div>
                    </div>
                </div>
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px;">
                    Last scanned: Just now
                </div>
            </div>
        `;
    }

    private renderJobsTab(stages: any[]): string {
        if (stages.length === 0) {
            return '<p>No job information available.</p>';
        }

        // Flatten all jobs from all stages
        const allJobs: any[] = [];
        stages.forEach(stage => {
            if (stage.jobs && stage.jobs.length > 0) {
                stage.jobs.forEach((job: any) => {
                    allJobs.push({ ...job, stageName: stage.name });
                });
            }
        });

        if (allJobs.length === 0) {
            return '<p>No job information available.</p>';
        }

        return `
            <div class="jobs-list">
                ${allJobs.map(job => this.renderJobItem(job)).join('')}
            </div>
        `;
    }

    private renderJobItem(job: any): string {
        const status = job.result || job.state;
        const statusColor = this.getStatusColor(status);
        const icon = this.getStatusIcon(status);
        const duration = job.startTime && job.finishTime
            ? this.formatDuration(new Date(job.startTime), new Date(job.finishTime))
            : 'In progress...';

        const taskCount = job.tasks ? job.tasks.length : 0;

        return `
            <div class="job-item">
                <div class="job-item-header">
                    <div class="stage-icon ${icon}" style="width: 16px; height: 16px; font-size: 10px;">
                        ${this.getIconSymbol(status)}
                    </div>
                    <div class="job-item-name">${job.name}</div>
                    <div class="stage-card-status" style="background: ${statusColor}; font-size: 10px; padding: 2px 6px;">
                        ${status}
                    </div>
                </div>
                <div class="job-item-duration">
                    <div>Stage: ${job.stageName}</div>
                    <div>Duration: ${duration}</div>
                </div>
                ${taskCount > 0 ? `
                    <div class="job-item-tasks">
                        Tasks: ${taskCount}
                    </div>
                ` : ''}
                ${job.log ? `
                    <div style="margin-top: 8px;">
                        <span class="log-link" onclick="viewLog(${job.log.id})" style="font-size: 11px;">
                            📄 View Log
                        </span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    private renderIssues(records: TimelineRecord[]): string {
        const allIssues = records.flatMap(r => r.issues || []);
        if (allIssues.length === 0) return '';

        return `
            <div class="issues">
                <h3 style="margin-bottom: 10px;">Issues (${allIssues.length})</h3>
                ${allIssues.map(issue => `
                    <div class="issue">
                        <span class="issue-type ${issue.type}">${issue.type.toUpperCase()}</span>
                        <span>${issue.message}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    private getStatusIcon(status: string): string {
        const s = String(status).toLowerCase();
        if (s === 'succeeded') return 'success';
        if (s === 'failed') return 'failed';
        if (s === 'inprogress') return 'running';
        if (s === 'partiallysucceeded') return 'warning';
        if (s === 'canceled' || s === 'cancelled') return 'canceled';
        return 'canceled';
    }

    private getIconSymbol(status: string): string {
        const s = String(status).toLowerCase();
        if (s === 'succeeded') return '✓';
        if (s === 'failed') return '✗';
        if (s === 'inprogress') return '●';
        if (s === 'partiallysucceeded') return '⚠';
        return '○';
    }

    private getStatusColor(status: string): string {
        const s = String(status).toLowerCase();
        if (s === 'succeeded') return '#28a745';
        if (s === 'failed') return '#dc3545';
        if (s === 'inprogress' || s === 'notstarted') return '#007acc';
        if (s === 'partiallysucceeded') return '#ffa500';
        return '#6c757d';
    }

    private formatDuration(start: Date, end: Date): string {
        const ms = end.getTime() - start.getTime();
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    public dispose() {
        this.stopAutoRefresh();
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
