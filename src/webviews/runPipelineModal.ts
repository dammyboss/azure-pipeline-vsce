import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline } from '../models/types';

/**
 * Lightweight modal for running pipelines
 * Shows only the modal overlay without a full panel behind it
 */
export class RunPipelineModal {
    private static currentPanel: RunPipelineModal | undefined;
    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private pipeline: Pipeline,
        private sourceBranch?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'runPipeline':
                        await this.handleRunPipeline(message.data);
                        break;
                    case 'close':
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this.disposables
        );

        this.initialize();
    }

    public static async show(
        client: AzureDevOpsClient,
        pipeline: Pipeline,
        sourceBranch?: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        // If we already have a panel, reuse it
        if (RunPipelineModal.currentPanel) {
            RunPipelineModal.currentPanel.panel.reveal(column);
            RunPipelineModal.currentPanel.pipeline = pipeline;
            RunPipelineModal.currentPanel.sourceBranch = sourceBranch;
            RunPipelineModal.currentPanel.client = client;
            await RunPipelineModal.currentPanel.initialize();
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'runPipelineModal',
            'Run Pipeline',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: false
            }
        );

        RunPipelineModal.currentPanel = new RunPipelineModal(panel, client, pipeline, sourceBranch);
    }

    private async initialize() {
        try {
            // Fetch required data
            const [branches, variables, stages] = await Promise.all([
                this.fetchBranches(),
                this.fetchVariables(),
                this.fetchStages()
            ]);

            // Set HTML content and show modal immediately
            this.panel.webview.html = this.getHtmlContent();

            // Send data to populate the form
            this.panel.webview.postMessage({
                command: 'initialize',
                data: {
                    pipeline: this.pipeline,
                    branches,
                    variables,
                    stages,
                    defaultBranch: this.sourceBranch?.replace('refs/heads/', '') || branches[0] || 'main'
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to initialize run pipeline form: ${error}`);
            this.panel.dispose();
        }
    }

    private async fetchBranches(): Promise<string[]> {
        try {
            vscode.window.showInformationMessage(`Repository ID: ${this.pipeline.repository?.id || 'MISSING'}`);
            if (!this.pipeline.repository?.id) {
                return ['main'];
            }
            const branches = await this.client.getBranches(this.pipeline.repository.id);
            vscode.window.showInformationMessage(`Fetched ${branches.length} branches`);
            return branches.map(b => b.name);
        } catch (error) {
            vscode.window.showErrorMessage(`Branch fetch error: ${error}`);
            return ['main'];
        }
    }

    private async fetchVariables(): Promise<Record<string, any>> {
        try {
            return await this.client.getPipelineVariables(this.pipeline.id);
        } catch (error) {
            return {};
        }
    }

    private async fetchStages(): Promise<Array<{ name: string; dependsOn?: string[] }>> {
        try {
            const yaml = await this.client.getPipelineYaml(this.pipeline.id);

            const stages: Array<{ name: string; dependsOn?: string[] }> = [];
            const lines = yaml.split('\n');

            let currentStage: { name: string; dependsOn?: string[] } | null = null;
            let inDependsOn = false;
            let inStagesSection = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.match(/^stages:\s*$/)) {
                    inStagesSection = true;
                    continue;
                }

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
                    continue;
                }

                if (currentStage && line.match(/^\s*dependsOn:\s*(.+)$/)) {
                    const dependsMatch = line.match(/^\s*dependsOn:\s*(.+)$/);
                    if (dependsMatch) {
                        const depValue = dependsMatch[1].trim();
                        if (depValue.startsWith('[')) {
                            const deps = depValue
                                .replace(/[\[\]]/g, '')
                                .split(',')
                                .map(d => d.trim().replace(/['"]/g, ''))
                                .filter(d => d.length > 0);
                            currentStage.dependsOn = deps;
                        } else if (depValue.toLowerCase() !== 'null' && depValue !== '[]') {
                            currentStage.dependsOn = [depValue.replace(/['"]/g, '')];
                        }
                        inDependsOn = false;
                    }
                    continue;
                }

                if (currentStage && line.match(/^\s*dependsOn:\s*$/)) {
                    inDependsOn = true;
                    currentStage.dependsOn = [];
                    continue;
                }

                if (inDependsOn && line.match(/^\s*-\s*(.+)$/)) {
                    const itemMatch = line.match(/^\s*-\s*(.+)$/);
                    if (itemMatch && currentStage) {
                        const dep = itemMatch[1].trim().replace(/['"]/g, '');
                        if (!currentStage.dependsOn) {
                            currentStage.dependsOn = [];
                        }
                        currentStage.dependsOn.push(dep);
                    }
                    continue;
                }

                if (inDependsOn && line.match(/^\s*\w+:/)) {
                    inDependsOn = false;
                }
            }

            if (currentStage) {
                stages.push(currentStage);
            }

            return stages;
        } catch (error) {
            return [];
        }
    }

    private async handleRunPipeline(data: any) {
        try {
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

            const newRun = await this.client.runPipeline(this.pipeline.id, options);

            // Close the modal
            this.panel.dispose();

            // Show success message with option to view run
            const viewRun = await vscode.window.showInformationMessage(
                `Pipeline run started: ${newRun.buildNumber || newRun.name}`,
                'View Run'
            );

            if (viewRun === 'View Run') {
                vscode.commands.executeCommand('azurePipelines.viewRunDetails', newRun);
            }

            // Refresh runs view
            vscode.commands.executeCommand('azurePipelines.refreshRuns');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run pipeline: ${error}`);
        }
    }

    private getHtmlContent(): string {
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
            overflow: hidden;
            height: 100vh;
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
        }

        .modal-panel {
            width: 600px;
            max-width: 90vw;
            height: 100vh;
            background: var(--vscode-editor-background);
            border-left: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            animation: slideInRight 0.3s ease-out;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
        }

        @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
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

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="modal-panel">
        <div class="modal-header">
            <div>
                <div class="modal-title">Run pipeline</div>
                <div class="modal-subtitle">Select parameters below and manually run the pipeline</div>
            </div>
            <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-content" id="modalContent">
            <div class="loading">Loading pipeline configuration...</div>
        </div>
        <div class="modal-footer" id="modalFooter" style="display: none;">
            <button class="modal-button secondary" onclick="closeModal()">Cancel</button>
            <button class="modal-button primary" onclick="submitRunPipeline()">Run</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let pipelineData = null;

        function closeModal() {
            vscode.postMessage({ command: 'close' });
        }

        function toggleModalSection(header) {
            header.closest('.modal-expandable-section').classList.toggle('expanded');
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

            const allStages = pipelineData?.stages ? pipelineData.stages.map(s => s.name) : [];

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

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'initialize') {
                pipelineData = message.data;
                renderForm(message.data);
            }
        });

        function renderForm(data) {
            const { branches, variables, stages, defaultBranch, pipeline } = data;

            const content = document.getElementById('modalContent');
            content.innerHTML = \`
                <div class="modal-section">
                    <div class="modal-section-title">Pipeline version</div>
                    <div class="modal-form-group">
                        <label class="modal-label">
                            Select pipeline version by branch/tag
                            <span class="modal-label-description">Select the pipeline to run by branch, commit, or tag</span>
                        </label>
                        <select class="modal-input" id="modalBranchSelect">
                            \${branches.map(branch =>
                                \`<option value="\${branch}" \${branch === defaultBranch ? 'selected' : ''}>\${branch}</option>\`
                            ).join('')}
                        </select>
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
                            \${stages && stages.length > 0 ? \`
                                <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
                                    Deselect stages you want to skip for this run
                                </div>
                                <div class="modal-checkbox-group" id="modalStagesGroup">
                                    <div class="modal-checkbox-item" style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border);">
                                        <input type="checkbox" id="modal-stage-all" checked onchange="toggleAllStages(this)">
                                        <label for="modal-stage-all" style="font-weight: 600;">Run all stages</label>
                                    </div>
                                    \${stages.map((stage, index) => \`
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
                                    \`).join('')}
                                </div>
                            \` : \`
                                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px;">
                                    <div style="color: var(--vscode-charts-blue); font-size: 18px;">ℹ</div>
                                    <div style="font-size: 13px;">Configuration is only available for multi-stage pipelines.</div>
                                </div>
                            \`}
                        </div>
                    </div>

                    <div class="modal-expandable-section">
                        <div class="modal-expandable-header" onclick="toggleModalSection(this)">
                            <div class="modal-expandable-title">Resources</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-info-text">1 repository, 0 build runs, 0 container images, 0 package runs</div>
                        </div>
                    </div>

                    \${Object.keys(variables || {}).length > 0 ? \`
                        <div class="modal-expandable-section" id="modalVariablesSection">
                            <div class="modal-expandable-header" onclick="toggleModalSection(this)">
                                <div class="modal-expandable-title">Variables</div>
                                <div class="modal-expandable-arrow">▶</div>
                            </div>
                            <div class="modal-expandable-content">
                                <div class="modal-variable-list" id="modalVariablesGroup">
                                    \${Object.entries(variables).map(([key, value]) => \`
                                        <div class="modal-variable-item">
                                            <div class="modal-variable-name">\${key}</div>
                                            <input type="text" class="modal-input" id="modal-var-\${key}" value="\${value.value || ''}" placeholder="Enter value">
                                        </div>
                                    \`).join('')}
                                </div>
                            </div>
                        </div>
                    \` : \`
                        <div class="modal-info-text" style="margin-top: 12px;">
                            This pipeline has no defined variables
                        </div>
                    \`}
                </div>

                <div class="modal-form-group" style="margin-top: 24px;">
                    <div class="modal-checkbox-item">
                        <input type="checkbox" id="modalEnableDiagnostics">
                        <label for="modalEnableDiagnostics">Enable system diagnostics</label>
                    </div>
                </div>
            \`;

            // Show footer
            document.getElementById('modalFooter').style.display = 'flex';
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        RunPipelineModal.currentPanel = undefined;

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
