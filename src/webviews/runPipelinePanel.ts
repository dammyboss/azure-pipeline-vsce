import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { PipelineRun, Pipeline } from '../models/types';

export class RunPipelinePanel {
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private pipeline: Pipeline,
        private sourceBranch?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.initialize();

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'runPipeline':
                        await this.handleRunPipeline(message.data);
                        break;
                    case 'cancel':
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static async show(client: AzureDevOpsClient, pipeline: Pipeline, sourceBranch?: string) {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        const panel = vscode.window.createWebviewPanel(
            'runPipeline',
            `Run Pipeline: ${pipeline.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        new RunPipelinePanel(panel, client, pipeline, sourceBranch);
    }

    private async initialize() {
        try {
            // Fetch required data
            const [branches, variables, pipelineConfig] = await Promise.all([
                this.fetchBranches(),
                this.fetchVariables(),
                this.client.getPipelineConfiguration(this.pipeline.id).catch(() => null)
            ]);

            // Get pipeline YAML to extract stages
            const stages = await this.fetchStages();

            this.panel.webview.html = this.getHtmlContent(branches, variables, stages, pipelineConfig);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load pipeline data: ${error}`);
            this.panel.dispose();
        }
    }

    private async fetchBranches(): Promise<string[]> {
        try {
            if (!this.pipeline.repository?.id) {
                return ['main', 'master', 'develop'];
            }
            const branches = await this.client.getBranches(this.pipeline.repository.id);
            return branches.map(b => b.name.replace('refs/heads/', ''));
        } catch (error) {
            console.error('Failed to fetch branches:', error);
            return ['main', 'master', 'develop'];
        }
    }

    private async fetchVariables(): Promise<Record<string, any>> {
        try {
            return await this.client.getPipelineVariables(this.pipeline.id);
        } catch (error) {
            console.error('Failed to fetch variables:', error);
            return {};
        }
    }

    private async fetchStages(): Promise<string[]> {
        try {
            // Get pipeline YAML and parse stages
            const yaml = await this.client.getPipelineYaml(this.pipeline.id);

            // Basic YAML parsing to extract stage names
            const stageMatches = yaml.matchAll(/^[-\s]*stage:\s*(.+)$/gm);
            const stages = Array.from(stageMatches, m => m[1].trim().replace(/['"]/g, ''));

            return stages.length > 0 ? stages : [];
        } catch (error) {
            console.error('Failed to fetch stages:', error);
            return [];
        }
    }

    private async handleRunPipeline(data: any) {
        try {
            const options: any = {
                branch: data.branch
            };

            // Add variables if provided
            if (data.variables && Object.keys(data.variables).length > 0) {
                options.variables = data.variables;
            }

            // Add stages to skip if not all are selected
            if (data.stagesToRun && data.stagesToRun.length > 0) {
                const allStages = data.allStages || [];
                const stagesToSkip = allStages.filter((s: string) => !data.stagesToRun.includes(s));
                if (stagesToSkip.length > 0) {
                    options.stagesToSkip = stagesToSkip;
                }
            }

            const newRun = await this.client.runPipeline(this.pipeline.id, options);
            vscode.window.showInformationMessage(`Pipeline run started: ${newRun.buildNumber || newRun.name}`);

            // Close the panel
            this.panel.dispose();

            // Ask if user wants to view the new run
            const viewRun = await vscode.window.showInformationMessage(
                'Pipeline run started successfully',
                'View Run'
            );

            if (viewRun === 'View Run') {
                vscode.commands.executeCommand('azurePipelines.viewRunDetails', newRun);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run pipeline: ${error}`);
        }
    }

    private getHtmlContent(branches: string[], variables: Record<string, any>, stages: string[], pipelineConfig: { repositoryName: string; yamlPath: string } | null): string {
        const defaultBranch = this.sourceBranch?.replace('refs/heads/', '') || branches[0] || 'main';
        const hasVariables = Object.keys(variables).length > 0;
        const hasStages = stages.length > 0;
        const repoName = pipelineConfig?.repositoryName || '';
        const yamlPath = pipelineConfig?.yamlPath?.replace(/^\//, '') || '';

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
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        .header-path {
            font-size: 12px;
            white-space: nowrap;
            flex-shrink: 0;
            margin-left: 16px;
        }
        .path-repo {
            color: var(--vscode-foreground);
            font-weight: 500;
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 2px;
        }
        .path-file {
            color: var(--vscode-textLink-foreground, #3794ff);
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 6px;
            color: var(--vscode-foreground);
        }
        .label-description {
            font-size: 12px;
            font-weight: 400;
            color: var(--vscode-descriptionForeground);
            margin-left: 4px;
        }
        input[type="text"],
        select,
        textarea {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        input[type="text"]:focus,
        select:focus,
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        textarea {
            min-height: 60px;
            resize: vertical;
        }
        .expandable-section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 16px;
        }
        .expandable-header {
            padding: 12px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .expandable-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .expandable-title {
            font-weight: 600;
            font-size: 14px;
        }
        .expandable-arrow {
            font-size: 12px;
            transition: transform 0.2s;
        }
        .expandable-section.expanded .expandable-arrow {
            transform: rotate(90deg);
        }
        .expandable-content {
            display: none;
            padding: 16px;
        }
        .expandable-section.expanded .expandable-content {
            display: block;
        }
        .info-text {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .checkbox-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 400;
        }
        .variable-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .variable-item {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 12px;
            align-items: center;
        }
        .variable-name {
            font-size: 13px;
            font-weight: 500;
        }
        .actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
            margin-top: 30px;
        }
        button {
            padding: 10px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }
        .primary-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .primary-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .secondary-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .secondary-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 24px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="title">Run pipeline</div>
            <div class="subtitle">Select parameters below and manually run the pipeline</div>
        </div>
        ${repoName && yamlPath ? `<div class="header-path"><span class="path-repo">${repoName}</span><span class="path-separator">/</span><span class="path-file">${yamlPath}</span></div>` : ''}
    </div>

    <div class="section">
        <div class="section-title">Pipeline version</div>

        <div class="form-group">
            <label>
                Select pipeline version by branch/tag
                <span class="label-description">Select the pipeline to run by branch, commit, or tag</span>
            </label>
            <select id="branchSelect">
                ${branches.map(branch =>
                    `<option value="${branch}" ${branch === defaultBranch ? 'selected' : ''}>${branch}</option>`
                ).join('')}
            </select>
        </div>

        <div class="form-group">
            <label>Commit</label>
            <input type="text" id="commitInput" placeholder="Leave empty to use latest commit">
        </div>
    </div>

    <div class="divider"></div>

    <div class="section">
        <div class="section-title">Pipeline artifacts</div>
        <div class="info-text">No pipeline artifacts found.</div>
    </div>

    <div class="divider"></div>

    <div class="section">
        <div class="section-title">Advanced options</div>

        ${hasStages ? `
        <div class="expandable-section">
            <div class="expandable-header" onclick="toggleSection(this)">
                <div class="expandable-title">Stages to run</div>
                <div class="expandable-arrow">▶</div>
            </div>
            <div class="expandable-content">
                <div class="checkbox-group" id="stagesGroup">
                    ${stages.map((stage, index) => `
                        <div class="checkbox-item">
                            <input type="checkbox" id="stage-${index}" value="${stage}" checked>
                            <label for="stage-${index}">${stage}</label>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        ` : '<div class="info-text">Run as configured</div>'}

        <div class="expandable-section">
            <div class="expandable-header" onclick="toggleSection(this)">
                <div class="expandable-title">Resources</div>
                <div class="expandable-arrow">▶</div>
            </div>
            <div class="expandable-content">
                <div class="info-text">1 repository, 0 build runs, 0 container images, 0 package runs</div>
            </div>
        </div>

        ${hasVariables ? `
        <div class="expandable-section">
            <div class="expandable-header" onclick="toggleSection(this)">
                <div class="expandable-title">Variables</div>
                <div class="expandable-arrow">▶</div>
            </div>
            <div class="expandable-content">
                <div class="variable-list">
                    ${Object.entries(variables).map(([key, value]: [string, any]) => `
                        <div class="variable-item">
                            <div class="variable-name">${key}</div>
                            <input type="text" id="var-${key}" value="${value.value || ''}" placeholder="Enter value">
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        ` : '<div class="info-text" style="margin-top: 12px;">This pipeline has no defined variables</div>'}
    </div>

    <div class="form-group" style="margin-top: 24px;">
        <div class="checkbox-item">
            <input type="checkbox" id="enableDiagnostics">
            <label for="enableDiagnostics">Enable system diagnostics</label>
        </div>
    </div>

    <div class="actions">
        <button class="secondary-button" onclick="cancel()">Cancel</button>
        <button class="primary-button" onclick="runPipeline()">Run</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function toggleSection(header) {
            header.closest('.expandable-section').classList.toggle('expanded');
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function runPipeline() {
            const branch = document.getElementById('branchSelect').value;
            const commit = document.getElementById('commitInput').value.trim();
            const enableDiagnostics = document.getElementById('enableDiagnostics').checked;

            // Collect selected stages
            const stagesToRun = [];
            const allStages = ${JSON.stringify(stages)};
            document.querySelectorAll('#stagesGroup input[type="checkbox"]:checked').forEach(checkbox => {
                stagesToRun.push(checkbox.value);
            });

            // Collect variables
            const variables = {};
            ${Object.keys(variables).map(key => `
                const var_${key.replace(/[^a-zA-Z0-9]/g, '_')} = document.getElementById('var-${key}');
                if (var_${key.replace(/[^a-zA-Z0-9]/g, '_')}) {
                    variables['${key}'] = var_${key.replace(/[^a-zA-Z0-9]/g, '_')}.value;
                }
            `).join('')}

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
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
