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

        new RunDetailsPanel(panel, client, run);
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
            const doc = await vscode.workspace.openTextDocument({
                content,
                language: 'log'
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load log: ${error}`);
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
        const duration = this.run.finishedDate 
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
        .job {
            padding: 10px 16px 10px 40px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .job:hover { background: var(--vscode-list-hoverBackground); }
        .task {
            padding: 8px 16px 8px 60px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
        }
        .task:hover { background: var(--vscode-list-hoverBackground); }
        .task-icon {
            width: 16px;
            height: 16px;
            border-radius: 50%;
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
    </style>
</head>
<body>
    <div class="header">
        <div class="title">
            ${this.run.pipeline?.name || this.run.name || 'Pipeline Run'} - ${this.run.buildNumber || this.run.name}
        </div>
        <div class="meta">
            <span class="status">${this.run.result || this.run.status}</span>
            <span>Branch: ${this.run.sourceBranch?.replace('refs/heads/', '') || 'N/A'}</span>
            <span>Duration: ${duration}</span>
            <span>Started: ${new Date(this.run.createdDate).toLocaleString()}</span>
            ${this.run.requestedBy?.displayName ? `<span>By: ${this.run.requestedBy.displayName}</span>` : ''}
        </div>
    </div>

    <div class="actions">
        <button onclick="refresh()">🔄 Refresh</button>
        ${isRunning ? '<button onclick="cancel()">⏹️ Cancel</button>' : ''}
        ${this.run.result === 'failed' ? '<button onclick="retry()">🔁 Retry</button>' : ''}
        <button class="secondary" onclick="openInBrowser()">🌐 Open in Browser</button>
    </div>

    <div class="summary-section">
        <h3 style="margin: 0 0 12px 0;">Summary</h3>
        <div class="summary-grid">
            <div class="summary-item">
                <span class="summary-label">Repository</span>
                <span class="summary-value">${(this.run as any).repository?.name || 'N/A'}</span>
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
                <span class="summary-value">${this.run.requestedBy?.displayName || (this.run as any).requestedFor?.displayName || 'System'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Started</span>
                <span class="summary-value">${new Date(this.run.createdDate).toLocaleString()}</span>
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

    ${hasTimeline ? `
    <div class="timeline">
        <h3 style="margin-bottom: 15px;">Timeline</h3>
        ${stages.map(stage => this.renderStage(stage)).join('')}
    </div>
    ` : ''}

    ${this.renderIssues(records)}

    <script>
        const vscode = acquireVsCodeApi();
        
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
        
        function viewLog(logId) {
            vscode.postMessage({ command: 'viewLog', logId });
        }
        
        function toggleStage(element) {
            element.closest('.stage').classList.toggle('expanded');
        }
        
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
        return stages.map(stage => ({
            ...stage,
            jobs: records.filter(r => r.type === 'Job' && r.parentId === stage.id).map(job => ({
                ...job,
                tasks: records.filter(r => r.type === 'Task' && r.parentId === job.id)
            }))
        }));
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

        return `
            <div class="job">
                <div class="stage-icon ${icon}">${this.getIconSymbol(job.result || job.state)}</div>
                <span style="flex: 1;">${job.name}</span>
                <span class="stage-duration">${duration}</span>
                ${job.log ? `<span class="log-link" onclick="viewLog(${job.log.id})">📄 View Log</span>` : ''}
            </div>
            ${job.tasks.map((task: any) => this.renderTask(task)).join('')}
        `;
    }

    private renderTask(task: any): string {
        const icon = this.getStatusIcon(task.result || task.state);
        const duration = task.startTime && task.finishTime
            ? this.formatDuration(new Date(task.startTime), new Date(task.finishTime))
            : '';

        return `
            <div class="task">
                <div class="task-icon ${icon}"></div>
                <span style="flex: 1;">${task.name}</span>
                <span class="stage-duration">${duration}</span>
                ${task.log ? `<span class="log-link" onclick="viewLog(${task.log.id})">📄 Log</span>` : ''}
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
