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
                    case 'viewLog':
                        await this.viewLog(message.logId);
                        break;
                    case 'openInBrowser':
                        vscode.env.openExternal(vscode.Uri.parse(this.run.url));
                        break;
                    case 'runNew':
                        await this.runNewPipeline();
                        break;
                    case 'rerunFailedJobs':
                        await this.rerunFailedJobs();
                        break;
                    case 'downloadLogs':
                        await this.downloadLogs();
                        break;
                    case 'editPipeline':
                        await this.editPipelineYaml();
                        break;
                    case 'viewYaml':
                        await this.viewFullYaml();
                        break;
                    case 'loadTests':
                        await this.loadTestResults();
                        break;
                    case 'runPipeline':
                        await this.handleRunPipeline(message.data);
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

            // Fetch pipeline data for the form
            const [pipeline, branches, variables, stages] = await Promise.all([
                this.client.getPipeline(pipelineId),
                this.fetchBranches(pipelineId),
                this.fetchVariables(pipelineId),
                this.fetchStages(pipelineId)
            ]);

            // Send data to webview to show the modal form
            this.panel.webview.postMessage({
                command: 'showRunPipelineForm',
                data: {
                    pipeline,
                    branches,
                    variables,
                    stages,
                    defaultBranch: this.run.sourceBranch?.replace('refs/heads/', '') || 'main'
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open run pipeline form: ${error}`);
        }
    }

    private async rerunFailedJobs() {
        try {
            const pipelineId = this.run.pipeline?.id || this.run.definition?.id;
            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not found');
                return;
            }

            // Get timeline to find failed stages/jobs
            const timeline = await this.client.getRunTimeline(this.run.id);
            if (!timeline || !timeline.records) {
                vscode.window.showErrorMessage('No timeline information available');
                return;
            }

            // Find failed stages
            const failedStages = timeline.records
                .filter(record =>
                    (record.type === 'Stage' || record.type === 'Job') &&
                    record.result?.toLowerCase() === 'failed'
                )
                .map(record => record.name || 'Unknown');

            if (failedStages.length === 0) {
                vscode.window.showInformationMessage('No failed jobs found in this run');
                return;
            }

            // Fetch pipeline data for the form
            const [pipeline, branches, variables, stages] = await Promise.all([
                this.client.getPipeline(pipelineId),
                this.fetchBranches(pipelineId),
                this.fetchVariables(pipelineId),
                this.fetchStages(pipelineId)
            ]);

            // Identify which stages to run (only the failed ones)
            const stagesToRun = stages
                .filter(stage => failedStages.some(failedStage =>
                    failedStage.toLowerCase().includes(stage.name.toLowerCase())
                ))
                .map(stage => stage.name);

            // Send data to webview to show the modal form with only failed stages pre-selected
            this.panel.webview.postMessage({
                command: 'showRunPipelineForm',
                data: {
                    pipeline,
                    branches,
                    variables,
                    stages,
                    defaultBranch: this.run.sourceBranch?.replace('refs/heads/', '') || 'main',
                    preselectStages: stagesToRun.length > 0 ? stagesToRun : undefined,
                    isRerunFailedJobs: true
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rerun failed jobs: ${error}`);
        }
    }

    private async fetchBranches(pipelineId: number): Promise<string[]> {
        try {
            const pipeline = await this.client.getPipeline(pipelineId);
            if (!pipeline.repository?.id) {
                return ['main', 'master', 'develop'];
            }
            const branches = await this.client.getBranches(pipeline.repository.id);
            return branches.map(b => b.name.replace('refs/heads/', ''));
        } catch (error) {
            return ['main', 'master', 'develop'];
        }
    }

    private async fetchVariables(pipelineId: number): Promise<Record<string, any>> {
        try {
            return await this.client.getPipelineVariables(pipelineId);
        } catch (error) {
            return {};
        }
    }

    private async fetchStages(pipelineId: number): Promise<Array<{ name: string; dependsOn?: string[] }>> {
        try {
            const yaml = await this.client.getPipelineYaml(pipelineId);

            console.log('Fetching stages from YAML...');
            console.log('YAML length:', yaml.length);
            console.log('First 500 chars of YAML:', yaml.substring(0, 500));

            // Extract stages with their dependencies
            const stages: Array<{ name: string; dependsOn?: string[] }> = [];
            const lines = yaml.split('\n');

            let currentStage: { name: string; dependsOn?: string[] } | null = null;
            let inDependsOn = false;
            let inStagesSection = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Check if we're entering the stages section
                if (line.match(/^stages:\s*$/)) {
                    inStagesSection = true;
                    console.log('Found stages: section at line', i);
                    continue;
                }

                // Only look for stage definitions if we're in the stages section
                // OR if there's no explicit stages: keyword (single-stage pipelines might not have it)

                // Match stage definition: - stage: StageName or -stage:StageName
                // More flexible regex that handles various whitespace scenarios
                const stageMatch = line.match(/^\s*-\s*stage:\s*(.+)$/i);
                if (stageMatch) {
                    if (currentStage) {
                        stages.push(currentStage);
                    }
                    const stageName = stageMatch[1].trim().replace(/['"]/g, '').replace(/#.*$/, '').trim();
                    currentStage = {
                        name: stageName
                    };
                    inDependsOn = false;
                    console.log('Found stage:', stageName, 'at line', i);
                    continue;
                }

                // Match dependsOn (single line): dependsOn: value or dependsOn:[value]
                if (currentStage && line.match(/^\s*dependsOn:\s*(.+)$/)) {
                    const dependsMatch = line.match(/^\s*dependsOn:\s*(.+)$/);
                    if (dependsMatch) {
                        const depValue = dependsMatch[1].trim();
                        if (depValue.startsWith('[')) {
                            // Array format: dependsOn: [stage1, stage2]
                            const deps = depValue
                                .replace(/[\[\]]/g, '')
                                .split(',')
                                .map(d => d.trim().replace(/['"]/g, ''))
                                .filter(d => d.length > 0);
                            currentStage.dependsOn = deps;
                            console.log('Found dependsOn (array):', deps);
                        } else if (depValue.toLowerCase() !== 'null' && depValue !== '[]') {
                            // Single value: dependsOn: stage1
                            currentStage.dependsOn = [depValue.replace(/['"]/g, '')];
                            console.log('Found dependsOn (single):', depValue);
                        }
                        inDependsOn = false;
                    }
                    continue;
                }

                // Match dependsOn (multi-line array start)
                if (currentStage && line.match(/^\s*dependsOn:\s*$/)) {
                    inDependsOn = true;
                    currentStage.dependsOn = [];
                    console.log('Found dependsOn (multi-line) at line', i);
                    continue;
                }

                // Match array items under dependsOn
                if (inDependsOn && line.match(/^\s*-\s*(.+)$/)) {
                    const itemMatch = line.match(/^\s*-\s*(.+)$/);
                    if (itemMatch && currentStage) {
                        const dep = itemMatch[1].trim().replace(/['"]/g, '');
                        if (!currentStage.dependsOn) {
                            currentStage.dependsOn = [];
                        }
                        currentStage.dependsOn.push(dep);
                        console.log('Added dependsOn item:', dep);
                    }
                    continue;
                }

                // Check if we've left the dependsOn section
                if (inDependsOn && line.match(/^\s*\w+:/)) {
                    inDependsOn = false;
                }
            }

            // Add the last stage if exists
            if (currentStage) {
                stages.push(currentStage);
            }

            console.log('Total stages found:', stages.length);
            console.log('Stages:', stages);

            return stages;
        } catch (error) {
            console.error('Error fetching stages:', error);
            return [];
        }
    }

    private async handleRunPipeline(data: any) {
        try {
            const pipelineId = this.run.pipeline?.id || this.run.definition?.id;
            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not found');
                return;
            }

            const options: any = { branch: data.branch };

            if (data.variables && Object.keys(data.variables).length > 0) {
                options.variables = data.variables;
            }

            if (data.stagesToRun && data.stagesToRun.length > 0) {
                const allStages = data.allStages || [];
                const stagesToSkip = allStages.filter((s: string) => !data.stagesToRun.includes(s));
                if (stagesToSkip.length > 0) {
                    options.stagesToSkip = stagesToSkip;
                }
            }

            const newRun = await this.client.runPipeline(pipelineId, options);
            vscode.window.showInformationMessage(`Pipeline run started: ${newRun.buildNumber || newRun.name}`);

            const viewRun = await vscode.window.showInformationMessage(
                'Pipeline run started successfully',
                'View Run'
            );

            if (viewRun === 'View Run') {
                RunDetailsPanel.show(this.client, newRun);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run pipeline: ${error}`);
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

    private async editPipelineYaml() {
        try {
            const pipelineId = this.run.pipeline?.id || this.run.definition?.id;
            if (!pipelineId) {
                vscode.window.showErrorMessage('Pipeline ID not found');
                return;
            }

            const yaml = await this.client.getPipelineYaml(pipelineId);

            // Open in VSCode editor with YAML language support for full IntelliSense
            const doc = await vscode.workspace.openTextDocument({
                content: yaml,
                language: 'yaml'
            });
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside
            });

            vscode.window.showInformationMessage('Note: This is a read-only view of the pipeline YAML from the repository.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load pipeline YAML: ${error}`);
        }
    }

    private async viewFullYaml() {
        try {
            // Log ID 1 typically contains the expanded YAML for the pipeline run
            const expandedYaml = await this.client.getLogContent(this.run.id, 1);

            // Open in VSCode editor
            const doc = await vscode.workspace.openTextDocument({
                content: expandedYaml,
                language: 'yaml'
            });
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load full YAML: ${error}`);
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
        .rerun-failed-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
        }
        .rerun-failed-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
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

        /* Run Pipeline Modal Styles */
        .run-pipeline-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2000;
        }
        .run-pipeline-modal.show {
            display: block;
        }
        .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.2s ease-in;
        }
        .modal-panel {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 600px;
            max-width: 90vw;
            background: var(--vscode-editor-background);
            border-left: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            animation: slideInRight 0.3s ease-out;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
        }
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
            }
            to {
                transform: translateX(0);
            }
        }
        .modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .modal-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .modal-subtitle {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 24px;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            opacity: 0.7;
            transition: opacity 0.2s, background 0.2s;
        }
        .modal-close:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .modal-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px 24px;
        }
        .modal-footer {
            padding: 16px 24px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            background: var(--vscode-editor-background);
        }
        .modal-section {
            margin-bottom: 24px;
        }
        .modal-section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .modal-form-group {
            margin-bottom: 16px;
        }
        .modal-label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 6px;
        }
        .modal-label-description {
            display: block;
            font-size: 12px;
            font-weight: 400;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .modal-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        .modal-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .modal-divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 20px 0;
        }
        .modal-info-text {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .modal-expandable-section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 12px;
        }
        .modal-expandable-header {
            padding: 12px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .modal-expandable-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .modal-expandable-title {
            font-weight: 600;
            font-size: 14px;
        }
        .modal-expandable-arrow {
            font-size: 12px;
            transition: transform 0.2s;
        }
        .modal-expandable-section.expanded .modal-expandable-arrow {
            transform: rotate(90deg);
        }
        .modal-expandable-content {
            display: none;
            padding: 16px;
        }
        .modal-expandable-section.expanded .modal-expandable-content {
            display: block;
        }
        .modal-checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .modal-checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .modal-checkbox-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .modal-checkbox-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 400;
            font-size: 13px;
        }
        .modal-variable-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .modal-variable-item {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 12px;
            align-items: center;
        }
        .modal-variable-name {
            font-size: 13px;
            font-weight: 500;
        }
        .modal-button {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }
        .modal-button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .modal-button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .modal-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .modal-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
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
            ${this.run.result?.toLowerCase() === 'failed' ? `
                <button class="rerun-failed-btn" onclick="rerunFailedJobs()">Rerun failed jobs</button>
            ` : ''}
            <button class="run-new-btn" onclick="runNew()">Run new</button>
            <div style="position: relative;">
                <button class="menu-button" onclick="toggleMenu(event)">⋮</button>
                <div class="dropdown-menu" id="dropdownMenu">
                    <div class="dropdown-item" onclick="refresh()">Refresh</div>
                    <div class="dropdown-item" onclick="downloadLogs()">Download logs</div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" onclick="editPipeline()">Edit pipeline</div>
                    <div class="dropdown-item" onclick="viewYaml()">View full YAML</div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" onclick="openInBrowser()">Open in browser</div>
                </div>
            </div>
        </div>
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

    <!-- Run Pipeline Modal -->
    <div class="run-pipeline-modal" id="runPipelineModal">
        <div class="modal-overlay" onclick="closeRunPipelineModal()"></div>
        <div class="modal-panel">
            <div class="modal-header">
                <div>
                    <div class="modal-title">Run pipeline</div>
                    <div class="modal-subtitle">Select parameters below and manually run the pipeline</div>
                </div>
                <button class="modal-close" onclick="closeRunPipelineModal()">×</button>
            </div>
            <div class="modal-content">
                <div class="modal-section">
                    <div class="modal-section-title">Pipeline version</div>
                    <div class="modal-form-group">
                        <label class="modal-label">
                            Select pipeline version by branch/tag
                            <span class="modal-label-description">Select the pipeline to run by branch, commit, or tag</span>
                        </label>
                        <select class="modal-input" id="modalBranchSelect"></select>
                    </div>
                    <div class="modal-form-group">
                        <label class="modal-label">Commit</label>
                        <input type="text" class="modal-input" id="modalCommitInput" placeholder="Leave empty to use latest commit">
                    </div>
                </div>

                <div class="modal-divider"></div>

                <div class="modal-section">
                    <div class="modal-section-title">Pipeline artifacts</div>
                    <div class="modal-info-text">No pipeline artifacts found.</div>
                </div>

                <div class="modal-divider"></div>

                <div class="modal-section">
                    <div class="modal-section-title">Advanced options</div>

                    <div class="modal-expandable-section" id="modalStagesSection">
                        <div class="modal-expandable-header" onclick="toggleModalSection(this)">
                            <div class="modal-expandable-title">Stages to run</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-checkbox-group" id="modalStagesGroup"></div>
                        </div>
                    </div>

                    <div class="modal-info-text" id="modalNoStagesText" style="display: none;">Run as configured</div>

                    <div class="modal-expandable-section">
                        <div class="modal-expandable-header" onclick="toggleModalSection(this)">
                            <div class="modal-expandable-title">Resources</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-info-text">1 repository, 0 build runs, 0 container images, 0 package runs</div>
                        </div>
                    </div>

                    <div class="modal-expandable-section" id="modalVariablesSection">
                        <div class="modal-expandable-header" onclick="toggleModalSection(this)">
                            <div class="modal-expandable-title">Variables</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-variable-list" id="modalVariablesGroup"></div>
                        </div>
                    </div>

                    <div class="modal-info-text" id="modalNoVariablesText" style="display: none; margin-top: 12px;">
                        This pipeline has no defined variables
                    </div>
                </div>

                <div class="modal-form-group" style="margin-top: 24px;">
                    <div class="modal-checkbox-item">
                        <input type="checkbox" id="modalEnableDiagnostics">
                        <label for="modalEnableDiagnostics">Enable system diagnostics</label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-button secondary" onclick="closeRunPipelineModal()">Cancel</button>
                <button class="modal-button primary" onclick="submitRunPipeline()">Run</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let logStreamInterval = null;
        let currentLogId = null;
        let isStreaming = false;

        function refresh() {
            closeMenu();
            vscode.postMessage({ command: 'refresh' });
        }

        function openInBrowser() {
            vscode.postMessage({ command: 'openInBrowser' });
        }

        function runNew() {
            vscode.postMessage({ command: 'runNew' });
        }

        function rerunFailedJobs() {
            vscode.postMessage({ command: 'rerunFailedJobs' });
        }

        function downloadLogs() {
            vscode.postMessage({ command: 'downloadLogs' });
            closeMenu();
        }

        function editPipeline() {
            vscode.postMessage({ command: 'editPipeline' });
            closeMenu();
        }

        function viewYaml() {
            vscode.postMessage({ command: 'viewYaml' });
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
            } else if (message.command === 'showRunPipelineForm') {
                showRunPipelineModal(message.data);
            }
        });

        function showRunPipelineModal(data) {
            const modal = document.getElementById('runPipelineModal');
            const { branches, variables, stages, defaultBranch } = data;

            // Populate branches
            const branchSelect = document.getElementById('modalBranchSelect');
            branchSelect.innerHTML = branches.map(branch =>
                \`<option value="\${branch}" \${branch === defaultBranch ? 'selected' : ''}>\${branch}</option>\`
            ).join('');

            // Populate stages
            const stagesContainer = document.getElementById('modalStagesGroup');
            if (stages && stages.length > 0) {
                let stagesHtml = \`
                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
                        Deselect stages you want to skip for this run
                    </div>
                    <div class="modal-checkbox-item" style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border);">
                        <input type="checkbox" id="modal-stage-all" checked onchange="toggleAllStages(this)">
                        <label for="modal-stage-all" style="font-weight: 600;">Run all stages</label>
                    </div>
                \`;
                stagesHtml += stages.map((stage, index) => \`
                    <div class="modal-checkbox-item">
                        <input type="checkbox" class="stage-checkbox" id="modal-stage-\${index}" value="\${stage.name}" checked onchange="updateRunAllCheckbox()">
                        <label for="modal-stage-\${index}">
                            <div>\${stage.name}</div>
                            \${stage.dependsOn && stage.dependsOn.length > 0 ? \`
                                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px;">
                                    Depends on: \${stage.dependsOn.join(', ')}
                                </div>
                            \` : \`
                                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px;">
                                    No dependencies
                                </div>
                            \`}
                        </label>
                    </div>
                \`).join('');
                stagesContainer.innerHTML = stagesHtml;
                document.getElementById('modalStagesSection').style.display = 'block';
                document.getElementById('modalNoStagesText').style.display = 'none';
            } else {
                stagesContainer.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px;">
                        <div style="color: var(--vscode-charts-blue); font-size: 18px;">ℹ</div>
                        <div style="font-size: 13px;">Configuration is only available for multi-stage pipelines.</div>
                    </div>
                \`;
                document.getElementById('modalStagesSection').style.display = 'block';
                document.getElementById('modalNoStagesText').style.display = 'none';
            }

            // Populate variables
            const variablesContainer = document.getElementById('modalVariablesGroup');
            const varEntries = Object.entries(variables || {});
            if (varEntries.length > 0) {
                variablesContainer.innerHTML = varEntries.map(([key, value]) => \`
                    <div class="modal-variable-item">
                        <div class="modal-variable-name">\${key}</div>
                        <input type="text" class="modal-input" id="modal-var-\${key}" value="\${value.value || ''}" placeholder="Enter value">
                    </div>
                \`).join('');
                document.getElementById('modalVariablesSection').style.display = 'block';
                document.getElementById('modalNoVariablesText').style.display = 'none';
            } else {
                document.getElementById('modalVariablesSection').style.display = 'none';
                document.getElementById('modalNoVariablesText').style.display = 'block';
            }

            // Store all stages for later (convert to just names if needed)
            const stageNames = stages && stages.length > 0 ? stages.map(s => s.name || s) : [];
            modal.dataset.allStages = JSON.stringify(stageNames);

            // Show modal
            modal.classList.add('show');
        }

        function closeRunPipelineModal() {
            document.getElementById('runPipelineModal').classList.remove('show');
        }

        function toggleAllStages(checkbox) {
            const stageCheckboxes = document.querySelectorAll('.stage-checkbox');
            stageCheckboxes.forEach(cb => {
                cb.checked = checkbox.checked;
            });
        }

        function updateRunAllCheckbox() {
            const allCheckbox = document.getElementById('modal-stage-all');
            const stageCheckboxes = document.querySelectorAll('.stage-checkbox');
            const allChecked = Array.from(stageCheckboxes).every(cb => cb.checked);
            if (allCheckbox) {
                allCheckbox.checked = allChecked;
            }
        }

        function submitRunPipeline() {
            const branch = document.getElementById('modalBranchSelect').value;
            const commit = document.getElementById('modalCommitInput').value.trim();
            const enableDiagnostics = document.getElementById('modalEnableDiagnostics').checked;

            // Collect selected stages (exclude the "Run all stages" checkbox)
            const stagesToRun = [];
            document.querySelectorAll('.stage-checkbox:checked').forEach(checkbox => {
                stagesToRun.push(checkbox.value);
            });

            // Collect variables
            const variables = {};
            document.querySelectorAll('[id^="modal-var-"]').forEach(input => {
                const key = input.id.replace('modal-var-', '');
                if (input.value) {
                    variables[key] = input.value;
                }
            });

            const modal = document.getElementById('runPipelineModal');
            const allStagesData = JSON.parse(modal.dataset.allStages || '[]');
            const allStages = allStagesData.map ? allStagesData.map(s => s.name || s) : allStagesData;

            vscode.postMessage({
                command: 'runPipeline',
                data: {
                    branch,
                    commit: commit || undefined,
                    stagesToRun,
                    allStages,
                    variables: Object.keys(variables).length > 0 ? variables : undefined,
                    enableDiagnostics
                }
            });

            closeRunPipelineModal();
        }

        function toggleModalSection(header) {
            header.closest('.modal-expandable-section').classList.toggle('expanded');
        }

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
