import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline } from '../models/types';

/**
 * Pipeline Editor Panel
 * Provides an editor for pipeline YAML with save to Azure DevOps repository
 */
export class PipelineEditorPanel {
    private static currentPanel: PipelineEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _client: AzureDevOpsClient;
    private _pipeline: Pipeline;
    private _disposables: vscode.Disposable[] = [];
    private _pipelineConfig: {
        repositoryId: string;
        repositoryName: string;
        yamlPath: string;
        defaultBranch: string;
    } | null = null;
    private _originalContent: string = '';
    private _branches: string[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        client: AzureDevOpsClient,
        pipeline: Pipeline
    ) {
        this._panel = panel;
        this._client = client;
        this._pipeline = pipeline;

        // Set up webview
        this._panel.webview.options = {
            enableScripts: true
        };

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this.savePipelineYaml(message.content, message.branch, message.commitMessage, message.createNewBranch, message.newBranchName);
                        break;
                    case 'validate':
                        await this.validatePipelineYaml(message.content, message.branch);
                        break;
                    case 'validateForModal':
                        await this.validateForModal(message.content, message.branch);
                        break;
                    case 'validateWithoutSave':
                        // Validate current editor content without saving
                        this._panel.webview.postMessage({ command: 'triggerValidate' });
                        break;
                    case 'close':
                        this._panel.dispose();
                        break;
                    case 'refresh':
                        await this.loadContent();
                        break;
                    case 'getBranches':
                        await this.sendBranches();
                        break;
                    case 'runPipeline':
                        await this.openRunPipelineForm();
                        break;
                    case 'submitRunPipeline':
                        await this.handleRunPipeline(message.data);
                        break;
                    case 'openVariablesModal':
                        this._panel.webview.postMessage({ command: 'openVariablesModal' });
                        break;
                    case 'loadVariables':
                        await this.loadVariables();
                        break;
                    case 'saveVariable':
                        await this.saveVariable(message.data);
                        break;
                    case 'deleteVariable':
                        await this.deleteVariable(message.variableName);
                        break;
                }
            },
            null,
            this._disposables
        );

        // Handle panel disposal
        this._panel.onDidDispose(
            () => this.dispose(),
            null,
            this._disposables
        );

        // Load initial content
        this.loadContent();
    }

    /**
     * Show the pipeline editor panel
     */
    static async show(client: AzureDevOpsClient, pipeline: Pipeline): Promise<void> {
        const column = vscode.ViewColumn.One;

        // Reuse existing panel if available
        if (PipelineEditorPanel.currentPanel) {
            PipelineEditorPanel.currentPanel._panel.reveal(column);
            PipelineEditorPanel.currentPanel._pipeline = pipeline;
            await PipelineEditorPanel.currentPanel.loadContent();
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'pipelineEditor',
            `Edit: ${pipeline.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        PipelineEditorPanel.currentPanel = new PipelineEditorPanel(panel, client, pipeline);
    }

    /**
     * Load pipeline content
     */
    private async loadContent(): Promise<void> {
        try {
            // Get pipeline configuration
            this._pipelineConfig = await this._client.getPipelineConfiguration(this._pipeline.id);

            // Get YAML content
            const yaml = await this._client.getPipelineYaml(this._pipeline.id);
            this._originalContent = yaml;

            // Get branches
            try {
                const branches = await this._client.getBranches(this._pipelineConfig.repositoryId);
                this._branches = branches.map(b => b.name);
            } catch (error) {
                this._branches = [this._pipelineConfig.defaultBranch];
            }

            // Update panel title
            this._panel.title = `Edit: ${this._pipeline.name}`;

            // Send content to webview
            this._panel.webview.html = this.getWebviewContent(yaml);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load pipeline YAML: ${errorMessage}`);
            this._panel.webview.html = this.getErrorContent(errorMessage);
        }
    }

    /**
     * Send branches list to webview
     */
    private async sendBranches(): Promise<void> {
        if (!this._pipelineConfig) {
            return;
        }

        try {
            const branches = await this._client.getBranches(this._pipelineConfig.repositoryId);
            this._branches = branches.map(b => b.name);
            this._panel.webview.postMessage({
                command: 'branchesLoaded',
                branches: this._branches,
                defaultBranch: this._pipelineConfig.defaultBranch
            });
        } catch (error) {
            console.error('Failed to load branches:', error);
        }
    }

    /**
     * Validate pipeline YAML
     */
    private async validatePipelineYaml(content: string, branch: string): Promise<void> {
        try {
            this._panel.webview.postMessage({
                command: 'validationStarted'
            });

            const result = await this._client.validatePipelineYaml(
                this._pipeline.id,
                content,
                branch
            );

            if (result.valid) {
                this._panel.webview.postMessage({
                    command: 'validationSuccess',
                    message: 'YAML validation successful! No errors found.',
                    finalYaml: result.finalYaml
                });
            } else {
                this._panel.webview.postMessage({
                    command: 'validationError',
                    message: result.error || 'Validation failed'
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'validationError',
                message: errorMessage
            });
        }
    }

    /**
     * Validate pipeline for modal (returns validation result to show in modal)
     */
    private async validateForModal(content: string, branch: string): Promise<void> {
        try {
            this._panel.webview.postMessage({
                command: 'modalValidationStarted'
            });

            const result = await this._client.validatePipelineYaml(
                this._pipeline.id,
                content,
                branch
            );

            this._panel.webview.postMessage({
                command: 'modalValidationResult',
                valid: result.valid,
                message: result.valid ? 'Pipeline is valid.' : (result.error || 'Validation failed')
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'modalValidationResult',
                valid: false,
                message: errorMessage
            });
        }
    }

    /**
     * Open the run pipeline form (slideout)
     */
    private async openRunPipelineForm(): Promise<void> {
        try {
            if (!this._pipelineConfig) {
                vscode.window.showErrorMessage('Pipeline configuration not loaded');
                return;
            }

            const [branches, variables, stages, runtimeParameters] = await Promise.all([
                this.fetchBranches(),
                this.fetchVariables(),
                this.fetchStages(),
                this.fetchRuntimeParameters()
            ]);

            this._panel.webview.postMessage({
                command: 'showRunPipelineForm',
                data: {
                    pipeline: this._pipeline,
                    branches,
                    variables,
                    stages,
                    runtimeParameters,
                    defaultBranch: this._pipelineConfig.defaultBranch
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open run pipeline form: ${error}`);
        }
    }

    /**
     * Handle running the pipeline
     */
    private async handleRunPipeline(data: any): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Starting pipeline run...',
                    cancellable: false
                },
                async () => {
                    const run = await this._client.runPipeline(this._pipeline.id, {
                        branch: data.branch,
                        variables: { ...data.variables, ...data.runtimeParameters },
                        stagesToSkip: data.stagesToSkip
                    });

                    this._panel.webview.postMessage({
                        command: 'runPipelineSuccess',
                        run: run
                    });

                    const viewRun = await vscode.window.showInformationMessage(
                        `Pipeline run #${run.buildNumber || run.id} started successfully`,
                        'View Run'
                    );

                    if (viewRun === 'View Run') {
                        vscode.commands.executeCommand('azure-pipelines.viewRun', run);
                    }
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._panel.webview.postMessage({
                command: 'runPipelineError',
                message: errorMessage
            });
            vscode.window.showErrorMessage(`Failed to start pipeline run: ${errorMessage}`);
        }
    }

    private async fetchBranches(): Promise<string[]> {
        try {
            if (!this._pipelineConfig?.repositoryId) {
                return [this._pipelineConfig?.defaultBranch || 'main'];
            }
            const branches = await this._client.getBranches(this._pipelineConfig.repositoryId);
            return branches.map(b => b.name.replace('refs/heads/', ''));
        } catch (error) {
            return [this._pipelineConfig?.defaultBranch || 'main'];
        }
    }

    private async fetchVariables(): Promise<Record<string, any>> {
        try {
            return await this._client.getPipelineVariables(this._pipeline.id);
        } catch (error) {
            return {};
        }
    }

    private async fetchStages(): Promise<Array<{ name: string; dependsOn?: string[] }>> {
        try {
            const yaml = await this._client.getPipelineYaml(this._pipeline.id);

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

    private async fetchRuntimeParameters(): Promise<any[]> {
        try {
            return await this._client.getPipelineRuntimeParameters(this._pipeline.id);
        } catch (error) {
            return [];
        }
    }

    /**
     * Load pipeline variables and send to webview
     */
    private async loadVariables(): Promise<void> {
        try {
            const variablesData = await this._client.getPipelineVariables(this._pipeline.id);

            // Convert variables object to array format for UI
            const variables = Object.entries(variablesData).map(([name, variable]: [string, any]) => ({
                name: name,
                value: variable.value || '',
                isSecret: variable.isSecret || false,
                allowOverride: variable.allowOverride || false
            }));

            this._panel.webview.postMessage({
                command: 'variablesLoaded',
                variables: variables
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load variables: ${errorMessage}`);
            this._panel.webview.postMessage({
                command: 'variablesLoaded',
                variables: []
            });
        }
    }

    /**
     * Save a pipeline variable
     */
    private async saveVariable(data: { name: string; value: string; isSecret: boolean; allowOverride: boolean }): Promise<void> {
        try {
            await this._client.createOrUpdatePipelineVariable(
                this._pipeline.id,
                data.name,
                data.value,
                data.isSecret,
                data.allowOverride
            );

            this._panel.webview.postMessage({
                command: 'variableSaved'
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to save variable: ${errorMessage}`);
            this._panel.webview.postMessage({
                command: 'variableSaveError',
                message: errorMessage
            });
        }
    }

    /**
     * Delete a pipeline variable
     */
    private async deleteVariable(variableName: string): Promise<void> {
        try {
            await this._client.deletePipelineVariable(this._pipeline.id, variableName);

            this._panel.webview.postMessage({
                command: 'variableDeleted'
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to delete variable: ${errorMessage}`);
            this._panel.webview.postMessage({
                command: 'variableDeleteError',
                message: errorMessage
            });
        }
    }

    /**
     * Save pipeline YAML to repository
     */
    private async savePipelineYaml(content: string, branch: string, commitMessage: string, createNewBranch?: boolean, newBranchName?: string): Promise<void> {
        if (!this._pipelineConfig) {
            vscode.window.showErrorMessage('Pipeline configuration not loaded');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Saving pipeline YAML to repository...',
                    cancellable: false
                },
                async () => {
                    let targetBranch = branch;

                    // If creating a new branch, create it first from the source branch
                    if (createNewBranch && newBranchName) {
                        targetBranch = newBranchName;
                        await this._client.createBranch(
                            this._pipelineConfig!.repositoryId,
                            newBranchName,
                            branch
                        );
                    }

                    await this._client.pushFileToRepository(
                        this._pipelineConfig!.repositoryId,
                        targetBranch,
                        this._pipelineConfig!.yamlPath,
                        content,
                        commitMessage || `Update ${this._pipeline.name} pipeline`,
                        'edit'
                    );

                    // Update original content after successful save
                    this._originalContent = content;

                    // Notify webview of successful save
                    this._panel.webview.postMessage({
                        command: 'saveSuccess',
                        message: 'Pipeline YAML saved successfully!',
                        newBranch: createNewBranch ? targetBranch : undefined
                    });

                    vscode.window.showInformationMessage(
                        `Pipeline YAML saved to ${this._pipelineConfig!.repositoryName}/${this._pipelineConfig!.yamlPath}`,
                        'View in Browser'
                    ).then(selection => {
                        if (selection === 'View in Browser') {
                            const config = this._client.getConfig();
                            const repoUrl = `${config.organizationUrl}/${config.projectName}/_git/${this._pipelineConfig!.repositoryName}?path=${encodeURIComponent(this._pipelineConfig!.yamlPath)}&version=GB${targetBranch}`;
                            vscode.env.openExternal(vscode.Uri.parse(repoUrl));
                        }
                    });
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Notify webview of error
            this._panel.webview.postMessage({
                command: 'saveError',
                message: errorMessage
            });

            vscode.window.showErrorMessage(`Failed to save pipeline YAML: ${errorMessage}`);
        }
    }

    /**
     * Get webview content
     */
    private getWebviewContent(yaml: string): string {
        const escapedYaml = yaml
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');

        const branchesJson = JSON.stringify(this._branches);
        const defaultBranch = this._pipelineConfig?.defaultBranch || 'main';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Pipeline</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-foreground, #cccccc);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: var(--vscode-titleBar-activeBackground, #323232);
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            flex-wrap: wrap;
        }

        .toolbar-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        /* Custom Branch Dropdown */
        .branch-dropdown-container {
            position: relative;
            min-width: 200px;
        }

        .branch-dropdown-trigger {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            width: 100%;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .branch-dropdown-trigger:hover {
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .branch-dropdown-trigger.open {
            border-color: var(--vscode-focusBorder, #007acc);
            border-bottom-left-radius: 0;
            border-bottom-right-radius: 0;
        }

        .branch-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .branch-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .dropdown-arrow {
            width: 12px;
            height: 12px;
            transition: transform 0.2s ease;
        }

        .branch-dropdown-trigger.open .dropdown-arrow {
            transform: rotate(180deg);
        }

        .branch-dropdown-menu {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--vscode-dropdown-background, #3c3c3c);
            border: 1px solid var(--vscode-focusBorder, #007acc);
            border-top: none;
            border-radius: 0 0 4px 4px;
            max-height: 0;
            overflow: hidden;
            z-index: 1000;
            transition: max-height 0.25s ease-out, opacity 0.2s ease;
            opacity: 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .branch-dropdown-menu.open {
            max-height: 300px;
            opacity: 1;
            overflow: auto;
        }

        .branch-search-container {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            position: sticky;
            top: 0;
            background: var(--vscode-dropdown-background, #3c3c3c);
        }

        .branch-search {
            width: 100%;
            padding: 6px 10px 6px 32px;
            background: var(--vscode-input-background, #2d2d2d);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 4px;
            font-size: 12px;
            outline: none;
        }

        .branch-search:focus {
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .branch-search-icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            color: var(--vscode-descriptionForeground, #8b8b8b);
            pointer-events: none;
        }

        .branch-list {
            padding: 4px 0;
        }

        .branch-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            transition: background 0.1s ease;
        }

        .branch-item:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }

        .branch-item.selected {
            background: var(--vscode-list-activeSelectionBackground, #094771);
            color: var(--vscode-list-activeSelectionForeground, #ffffff);
        }

        .branch-item-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991);
        }

        .branch-item-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 13px;
        }

        .no-branches {
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground, #8b8b8b);
            font-size: 12px;
        }

        .toolbar-input {
            padding: 6px 10px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 4px;
            font-size: 13px;
            flex: 1;
            min-width: 250px;
        }

        .toolbar-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }

        /* Primary Action Button */
        .action-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .action-btn.run {
            background: #0078d4;
            color: white;
            border-radius: 4px;
        }

        .action-btn.run:hover {
            background: #106ebe;
        }

        .action-btn.validate-save {
            background: #0078d4;
            color: white;
            border-radius: 4px 0 0 4px;
            padding-right: 16px;
        }

        .action-btn.validate-save:hover {
            background: #106ebe;
        }

        .action-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        /* Action Button Group */
        .action-btn-group {
            display: flex;
            position: relative;
        }

        .action-dropdown-btn {
            background: #0078d4;
            color: white;
            border: none;
            border-left: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 0 4px 4px 0;
            padding: 8px 12px;
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
        }

        .action-dropdown-btn:hover {
            background: #106ebe;
        }

        .action-dropdown-menu {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            min-width: 220px;
            background: var(--vscode-menu-background, #252526);
            border: 1px solid var(--vscode-menu-border, #454545);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            overflow: hidden;
        }

        .action-dropdown-menu.show {
            display: block;
        }

        .action-dropdown-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 16px;
            background: transparent;
            border: none;
            color: var(--vscode-menu-foreground, #cccccc);
            font-size: 13px;
            cursor: pointer;
            width: 100%;
            text-align: left;
            transition: background 0.15s ease;
        }

        .action-dropdown-item:hover {
            background: var(--vscode-menu-selectionBackground, #094771);
        }

        /* Variables Button */
        .variables-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            background: #3c3c3c;
            color: #ffffff;
            font-size: 13px;
            font-weight: 400;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .variables-btn:hover {
            background: #505050;
        }

        .variables-btn:active {
            background: #2d2d2d;
        }

        /* More Menu (3-dot menu) */
        .more-menu-container {
            position: relative;
        }

        .more-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            border: none;
            border-radius: 6px;
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #cccccc);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .more-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }

        .more-btn:active {
            transform: scale(0.95);
        }

        .more-menu {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            min-width: 220px;
            background: var(--vscode-menu-background, #252526);
            border: 1px solid var(--vscode-menu-border, #454545);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            overflow: hidden;
        }

        .more-menu.show {
            display: block;
        }

        .more-menu-item {
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            padding: 10px 16px;
            background: transparent;
            border: none;
            color: var(--vscode-menu-foreground, #cccccc);
            font-size: 13px;
            text-align: left;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .more-menu-item:hover {
            background: var(--vscode-menu-selectionBackground, #094771);
            color: var(--vscode-menu-selectionForeground, white);
        }

        .more-menu-item svg {
            flex-shrink: 0;
        }

        .more-menu-item.spinning svg {
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Split Button for Validate and Save */
        .split-button-container {
            display: flex;
            border-radius: 4px;
            overflow: hidden;
        }

        .split-button-main {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
            border: none;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .split-button-main:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .split-button-main:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .split-button-dropdown {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px 10px;
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
            border: none;
            border-left: 1px solid rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .split-button-dropdown:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .split-button-dropdown:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .split-button-menu {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 200px;
            background: var(--vscode-dropdown-background, #3c3c3c);
            border: 1px solid var(--vscode-panel-border, #454545);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            opacity: 0;
            visibility: hidden;
            transform: translateY(-8px);
            transition: all 0.2s ease;
            z-index: 1000;
        }

        .split-button-menu.open {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        .split-button-menu-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            color: var(--vscode-foreground, #cccccc);
            cursor: pointer;
            transition: background 0.1s ease;
            font-size: 13px;
        }

        .split-button-menu-item:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }

        .split-button-menu-item:first-child {
            border-radius: 5px 5px 0 0;
        }

        .split-button-menu-item:last-child {
            border-radius: 0 0 5px 5px;
        }

        .split-button-wrapper {
            position: relative;
        }

        .editor-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .editor-wrapper {
            flex: 1;
            position: relative;
            overflow: hidden;
        }

        .editor {
            width: 100%;
            height: 100%;
            padding: 16px;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            border: none;
            resize: none;
            font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', Consolas, monospace);
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: 1.5;
            tab-size: 2;
            white-space: pre;
            overflow: auto;
        }

        .editor:focus {
            outline: none;
        }

        .status-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 16px;
            background: var(--vscode-statusBar-background, #007acc);
            color: var(--vscode-statusBar-foreground, white);
            font-size: 12px;
        }

        .status-bar.modified {
            background: var(--vscode-statusBarItem-warningBackground, #c27d00);
        }

        .status-bar.validating {
            background: var(--vscode-statusBarItem-prominentBackground, #388a34);
        }

        .status-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .file-path {
            opacity: 0.8;
        }

        .notification {
            position: fixed;
            top: 16px;
            right: 16px;
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
            animation: slideIn 0.3s ease;
            z-index: 1000;
            max-width: 400px;
        }

        .notification.success {
            background: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
            color: white;
        }

        .notification.error {
            background: var(--vscode-notificationsErrorIcon-foreground, #f14c4c);
            color: white;
        }

        .notification.warning {
            background: var(--vscode-notificationsWarningIcon-foreground, #cca700);
            color: white;
        }

        .notification.hidden {
            display: none;
        }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .info-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 16px;
            background: var(--vscode-editorWidget-background, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            font-size: 12px;
        }

        .info-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .info-label {
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        .info-value {
            color: var(--vscode-foreground, #cccccc);
        }

        .repo-name {
            font-weight: 500;
        }

        .info-separator {
            color: var(--vscode-descriptionForeground, #8b8b8b);
            margin: 0 2px;
        }

        .file-name {
            color: var(--vscode-textLink-foreground, #3794ff);
        }

        .azure-repos-icon {
            flex-shrink: 0;
            border-radius: 3px;
        }

        /* Validation result panel */
        .validation-panel {
            padding: 12px 16px;
            background: var(--vscode-editorWidget-background, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            display: none;
        }

        .validation-panel.visible {
            display: block;
        }

        .validation-panel.success {
            background: rgba(55, 148, 255, 0.1);
            border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground, #3794ff);
        }

        .validation-panel.error {
            background: rgba(241, 76, 76, 0.1);
            border-left: 3px solid var(--vscode-notificationsErrorIcon-foreground, #f14c4c);
        }

        .validation-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .validation-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            font-size: 13px;
        }

        .validation-close {
            background: none;
            border: none;
            color: var(--vscode-foreground, #cccccc);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
        }

        .validation-close:hover {
            background: var(--vscode-toolbar-hoverBackground, #5a5d5e50);
        }

        .validation-message {
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* Slideout Modal Overlay */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            z-index: 2000;
        }

        .modal-overlay.visible {
            display: block;
        }

        /* Slideout Modal Panel */
        .modal-panel {
            position: fixed;
            top: 0;
            right: -450px;
            width: 450px;
            height: 100%;
            background: var(--vscode-sideBar-background, #252526);
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            transition: right 0.3s ease;
            z-index: 2001;
        }

        .modal-panel.visible {
            right: 0;
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
        }

        .modal-title-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .modal-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground, #cccccc);
        }

        .modal-subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground, #cccccc);
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-close:hover {
            background: var(--vscode-toolbar-hoverBackground, #5a5d5e50);
        }

        .modal-body {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }

        .modal-section {
            margin-bottom: 24px;
        }

        .modal-section-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground, #cccccc);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .validation-status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 14px;
            background: var(--vscode-input-background, #3c3c3c);
            border-radius: 6px;
            font-size: 13px;
        }

        .validation-status.success {
            background: rgba(56, 138, 52, 0.15);
            color: #73c991;
        }

        .validation-status.error {
            background: rgba(241, 76, 76, 0.15);
            color: #f14c4c;
        }

        .validation-status.validating {
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        .modal-input {
            width: 100%;
            padding: 10px 12px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 6px;
            font-size: 13px;
            font-family: inherit;
        }

        .modal-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .modal-textarea {
            width: 100%;
            padding: 10px 12px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 6px;
            font-size: 13px;
            font-family: inherit;
            resize: vertical;
            min-height: 80px;
        }

        .modal-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .radio-option {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            cursor: pointer;
        }

        .radio-option input[type="radio"] {
            margin-top: 2px;
            accent-color: var(--vscode-focusBorder, #007acc);
        }

        .radio-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .radio-label-text {
            font-size: 13px;
            color: var(--vscode-foreground, #cccccc);
        }

        .new-branch-input {
            margin-top: 10px;
            margin-left: 20px;
        }

        .new-branch-input.hidden {
            display: none;
        }

        .modal-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-panel-border, #454545);
        }

        .modal-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .modal-btn.cancel {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #cccccc);
        }

        .modal-btn.cancel:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }

        .modal-btn.save {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
        }

        .modal-btn.save:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .modal-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        .spinner.dark {
            border-color: rgba(0, 0, 0, 0.2);
            border-top-color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        /* Run Pipeline Modal Styles (scoped to avoid conflict with validate/save modal) */
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

        @keyframes slideInRight {
            from {
                transform: translateX(100%);
            }
            to {
                transform: translateX(0);
            }
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }

        .run-pipeline-modal .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.2s ease-in;
        }
        .run-pipeline-modal .modal-panel {
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
        .run-pipeline-modal .modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .run-pipeline-modal .modal-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .run-pipeline-modal .modal-subtitle {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .run-pipeline-modal .modal-close {
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
        .run-pipeline-modal .modal-close:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .run-pipeline-modal .modal-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px 24px;
        }
        .run-pipeline-modal .modal-footer {
            padding: 16px 24px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            background: var(--vscode-editor-background);
        }
        .run-pipeline-modal .modal-section {
            margin-bottom: 24px;
        }
        .run-pipeline-modal .modal-section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .run-pipeline-modal .modal-form-group {
            margin-bottom: 16px;
        }
        .run-pipeline-modal .modal-label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 6px;
        }
        .run-pipeline-modal .modal-label-description {
            display: block;
            font-size: 12px;
            font-weight: 400;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .run-pipeline-modal .modal-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        .run-pipeline-modal .modal-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .run-pipeline-modal .modal-divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 20px 0;
        }
        .run-pipeline-modal .modal-info-text {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .run-pipeline-modal .modal-expandable-section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 12px;
        }
        .run-pipeline-modal .modal-expandable-header {
            padding: 12px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .run-pipeline-modal .modal-expandable-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .run-pipeline-modal .modal-expandable-title {
            font-weight: 600;
            font-size: 14px;
        }
        .run-pipeline-modal .modal-expandable-arrow {
            font-size: 12px;
            transition: transform 0.2s;
        }
        .run-pipeline-modal .modal-expandable-section.expanded .modal-expandable-arrow {
            transform: rotate(90deg);
        }
        .run-pipeline-modal .modal-expandable-content {
            display: none;
            padding: 16px;
        }
        .run-pipeline-modal .modal-expandable-section.expanded .modal-expandable-content {
            display: block;
        }
        .run-pipeline-modal .modal-checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .run-pipeline-modal .modal-checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .run-pipeline-modal .modal-checkbox-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: var(--vscode-button-background);
        }
        .run-pipeline-modal .modal-checkbox-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 400;
            font-size: 13px;
        }
        .run-pipeline-modal .modal-radio-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 8px;
        }
        .run-pipeline-modal .modal-radio-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .run-pipeline-modal .modal-radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: var(--vscode-button-background);
        }
        .run-pipeline-modal .modal-radio-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 400;
            font-size: 13px;
        }
        .run-pipeline-modal .modal-variable-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .run-pipeline-modal .modal-variable-item {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 12px;
            align-items: center;
        }
        .run-pipeline-modal .modal-variable-name {
            font-size: 13px;
            font-weight: 500;
        }
        .run-pipeline-modal .modal-button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }
        .run-pipeline-modal .modal-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .run-pipeline-modal .modal-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .run-pipeline-modal .modal-button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .run-pipeline-modal .modal-button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .run-pipeline-modal .modal-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Variables Modal Styles */
        /* Variables Modal */
        .variables-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2000;
        }
        .variables-modal.show {
            display: block;
        }
        .variables-modal .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.2s ease-in;
        }
        .variables-modal .variables-panel {
            position: absolute;
            top: 2%;
            right: 1%;
            bottom: 2%;
            width: 550px;
            max-width: 85vw;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            animation: slideInRight 0.3s ease-out;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        .variables-modal .modal-header {
            padding: 24px 32px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .variables-modal .modal-header h2 {
            font-size: 24px;
            font-weight: 400;
            margin: 0;
        }
        .variables-modal .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 28px;
            padding: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            opacity: 0.6;
            transition: opacity 0.2s, background 0.2s;
        }
        .variables-modal .modal-close:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Variables Main View */
        .variables-main-view {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        /* Search Container */
        .variables-search-container {
            padding: 24px 32px 16px;
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .variables-search-input-wrapper {
            position: relative;
            flex: 1;
        }
        .variables-search-input-wrapper .search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0.6;
        }
        .variables-search-input {
            width: 100%;
            padding: 8px 12px 8px 36px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            font-size: 14px;
            border-radius: 4px;
            outline: none;
        }
        .variables-search-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .variables-search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .add-variable-btn {
            background: #3c3c3c;
            border: none;
            color: #ffffff;
            cursor: pointer;
            width: 48px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .add-variable-btn:hover {
            background: #505050;
        }

        /* Variables List View */
        .variables-list-view {
            flex: 1;
            overflow-y: auto;
            padding: 0 32px;
        }
        .variables-list {
            border-top: 1px solid var(--vscode-panel-border);
        }
        .variable-row {
            display: flex;
            align-items: flex-start;
            padding: 16px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background 0.15s ease;
            gap: 12px;
            position: relative;
        }
        .variable-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .variable-row:hover .variable-row-actions {
            display: flex;
        }
        .variable-icon {
            margin-top: 2px;
            opacity: 0.7;
            flex-shrink: 0;
        }
        .variable-content {
            flex: 1;
            min-width: 0;
        }
        .variable-name {
            font-size: 14px;
            font-weight: 600;
            color: #ffffff;
            margin: 0 0 4px 0;
        }
        .variable-value-display {
            font-size: 13px;
            color: #ffffff;
            word-break: break-all;
        }
        .variable-value-display.secret {
            letter-spacing: 2px;
        }
        .variable-row-actions {
            display: none;
            gap: 8px;
            align-items: center;
        }
        .variable-action-icon {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
            opacity: 0.7;
        }
        .variable-action-icon:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Variables Footer */
        .variables-footer {
            padding: 20px 32px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-background);
        }
        .learn-link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            font-size: 13px;
        }
        .learn-link:hover {
            text-decoration: underline;
        }
        .footer-buttons {
            display: flex;
            gap: 12px;
        }
        .footer-buttons .modal-button {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 400;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .footer-buttons .modal-button.secondary {
            background: #3c3c3c;
            color: #ffffff;
        }
        .footer-buttons .modal-button.secondary:hover {
            background: #505050;
        }
        .footer-buttons .modal-button.primary {
            background: #0078d4;
            color: white;
        }
        .footer-buttons .modal-button.primary:hover {
            background: #106ebe;
        }
        .footer-buttons .modal-button:disabled {
            background: #3c3c3c;
            color: #666666;
            cursor: not-allowed;
            opacity: 0.6;
        }

        /* Variable Form */
        .variable-form-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
        }
        .variable-form-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 24px 32px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .variable-form-header h3 {
            font-size: 20px;
            font-weight: 400;
            margin: 0;
        }
        .variable-form {
            padding: 24px 32px;
        }
        .back-button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 8px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
        }
        .back-button:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .variable-form {
            max-width: 600px;
        }
        .variable-form .modal-form-group {
            margin-bottom: 24px;
        }
        .variables-modal .modal-label {
            display: block;
            margin-bottom: 8px;
            font-size: 13px;
            font-weight: 400;
            color: #ffffff;
        }
        .variables-modal .modal-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: #ffffff;
            border: 1px solid #ffffff;
            border-radius: 2px;
            font-size: 13px;
            font-family: inherit;
            box-sizing: border-box;
        }
        .variables-modal .modal-input:focus {
            outline: none;
            border: 2px solid #0078d4;
            padding: 7px 11px;
        }
        .variable-form-info {
            margin-top: 32px;
            padding: 0;
            background: transparent;
            font-size: 13px;
            line-height: 1.6;
            color: #ffffff;
        }
        .variables-modal .modal-checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        }
        .variables-modal .modal-checkbox-item input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            background: transparent;
            border: 1px solid #ffffff;
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            border-radius: 4px;
        }
        .variables-modal .modal-checkbox-item input[type="checkbox"]:checked {
            background: #0078d4;
            border-color: #0078d4;
        }
        .variables-modal .modal-checkbox-item input[type="checkbox"]:checked::after {
            content: '✓';
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .variables-modal .modal-checkbox-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 400;
            font-size: 13px;
            color: #ffffff;
        }
        .info-section {
            margin-bottom: 12px;
        }
        .info-section:last-child {
            margin-bottom: 0;
        }
        .info-section code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }
        .code-examples {
            margin-top: 12px;
        }
        .code-example {
            margin-bottom: 8px;
            padding-left: 16px;
        }
        .code-example:last-child {
            margin-bottom: 0;
        }
        .variable-form-footer {
            margin-top: auto;
            padding: 20px 32px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-background);
        }
        .variable-form-footer .modal-button {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 400;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .variable-form-footer .modal-button.secondary {
            background: #3c3c3c;
            color: #ffffff;
        }
        .variable-form-footer .modal-button.secondary:hover {
            background: #505050;
        }
        .variable-form-footer .modal-button.primary {
            background: #0078d4;
            color: white;
        }
        .variable-form-footer .modal-button.primary:hover {
            background: #106ebe;
        }
        .variable-form-footer .modal-button:disabled {
            background: #3c3c3c;
            color: #666666;
            cursor: not-allowed;
            opacity: 0.6;
        }
        .button-group {
            display: flex;
            gap: 12px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <span class="toolbar-label">Branch:</span>
            <div class="branch-dropdown-container">
                <button class="branch-dropdown-trigger" id="branchDropdownTrigger">
                    <svg class="branch-icon" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                    </svg>
                    <span class="branch-name" id="selectedBranchName">${defaultBranch}</span>
                    <svg class="dropdown-arrow" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
                    </svg>
                </button>
                <div class="branch-dropdown-menu" id="branchDropdownMenu">
                    <div class="branch-search-container">
                        <svg class="branch-search-icon" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z"/>
                        </svg>
                        <input type="text" class="branch-search" id="branchSearch" placeholder="Filter branches...">
                    </div>
                    <div class="branch-list" id="branchList"></div>
                </div>
            </div>
        </div>
        <div class="toolbar-group" style="margin-left: auto;">
            <button id="variablesBtn" class="variables-btn" title="Manage pipeline variables">
                <span>Variables</span>
            </button>
            <div class="action-btn-group">
                <button id="actionBtn" class="action-btn run" title="Run pipeline">
                    <span id="actionBtnText">Run</span>
                </button>
                <button id="actionDropdownBtn" class="action-dropdown-btn" title="More run options">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
                    </svg>
                </button>
                <div class="action-dropdown-menu" id="actionDropdownMenu">
                    <button class="action-dropdown-item" id="validateWithoutSaveMenuItem">
                        <span>Validate without saving</span>
                    </button>
                </div>
            </div>
            <div class="more-menu-container">
                <button id="moreBtn" class="more-btn" title="More actions">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5"/>
                        <circle cx="8" cy="8" r="1.5"/>
                        <circle cx="8" cy="13" r="1.5"/>
                    </svg>
                </button>
                <div class="more-menu" id="moreMenu">
                    <button class="more-menu-item" id="refreshMenuItem">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M2.5 8a5.5 5.5 0 119.3 4l-.9-.9A4.5 4.5 0 108.5 3.5v2L6 3l2.5-2.5v2a5.5 5.5 0 010 11A5.5 5.5 0 012.5 8z"/>
                        </svg>
                        <span>Refresh from repository</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div class="info-bar">
        <div class="info-item">
            <svg class="azure-repos-icon" width="18" height="18" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#prefix__clip0_9_19)">
                    <mask id="prefix__a" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
                        <path d="M512 0H0v512h512V0z" fill="#fff"/>
                    </mask>
                    <g mask="url(#prefix__a)">
                        <path d="M388.849 0H123.115a18.443 18.443 0 00-18.49 18.49v60.543h302.714V18.49A18.443 18.443 0 00388.849 0z" fill="#BC3200"/>
                        <path d="M420.141 36.98H91.857c-14.793 0-26.732 11.939-26.732 26.73v21.027H446.87V63.711c0-14.792-11.938-26.732-26.73-26.732z" fill="#D13600"/>
                        <path d="M458.601 74.917H53.398c-14.792 0-26.731 11.94-26.731 26.731v380.586c0 14.792 12.045 26.837 26.837 26.837h404.992c14.793 0 26.837-12.045 26.837-26.837V101.648c0-14.792-11.94-26.731-26.732-26.731z" fill="#E15815"/>
                        <path d="M162.011 114.104c-28.105 0-50.928 22.822-50.928 50.928 0 28.105 22.823 50.927 50.928 50.927 28.105 0 50.928-22.822 50.928-50.927 0-28.106-22.823-50.928-50.928-50.928zm0 83.894c-18.279 0-33.071-14.793-33.071-33.072 0-18.279 14.792-33.071 33.071-33.071 18.279 0 33.071 14.792 33.071 33.071 0 18.279-14.792 33.072-33.071 33.072z" fill="#FFB290"/>
                        <path d="M181.137 210.479h-37.72v103.23h37.72v-103.23z" fill="#FFB290"/>
                        <path d="M403.885 165.782c0-28.105-22.823-50.928-50.929-50.928-28.105 0-50.927 22.823-50.927 50.928 0 21.66 13.525 40.15 32.648 47.547v34.972l-191.243 63.185h-.317v64.77c-18.701 7.501-31.909 25.886-31.909 47.228 0 28.106 22.823 50.929 50.928 50.929 28.105 0 50.928-22.823 50.928-50.929 0-21.131-12.891-39.305-31.17-47.017v-40.151l190.187-62.867-.422-.741h.422v-59.802c18.596-7.502 31.804-25.781 31.804-47.124zM195.102 423.59c0 18.279-14.792 33.071-33.071 33.071-18.28 0-33.072-14.792-33.072-33.071 0-18.278 14.792-33.071 33.072-33.071 18.279 0 33.071 14.793 33.071 33.071zm157.854-224.842c-18.279 0-33.071-14.793-33.071-33.072 0-18.279 14.792-33.071 33.071-33.071 18.28 0 33.073 14.792 33.073 33.071 0 18.279-14.899 33.072-33.073 33.072z" fill="#FFDBCA"/>
                    </g>
                </g>
                <defs>
                    <clipPath id="prefix__clip0_9_19">
                        <path fill="#fff" d="M0 0h512v512H0z"/>
                    </clipPath>
                </defs>
            </svg>
            <span class="info-value repo-name">${this._pipelineConfig?.repositoryName || 'Loading...'}</span>
            <span class="info-separator">/</span>
            <span class="info-value file-name">${this._pipelineConfig?.yamlPath?.split('/').pop() || 'Loading...'}</span>
        </div>
    </div>

    <div id="validationPanel" class="validation-panel">
        <div class="validation-header">
            <div class="validation-title">
                <span id="validationIcon"></span>
                <span id="validationTitle">Validation Result</span>
            </div>
            <button class="validation-close" id="closeValidation">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/>
                </svg>
            </button>
        </div>
        <div class="validation-message" id="validationMessage"></div>
    </div>

    <div class="editor-container">
        <div class="editor-wrapper">
            <textarea id="editor" class="editor" spellcheck="false">${yaml}</textarea>
        </div>
    </div>

    <div id="statusBar" class="status-bar">
        <div class="status-item">
            <span id="statusText">Ready</span>
        </div>
        <div class="status-item">
            <span class="file-path">${this._pipelineConfig?.yamlPath || ''}</span>
        </div>
    </div>

    <div id="notification" class="notification hidden"></div>

    <!-- Validate and Save Modal -->
    <div id="modalOverlay" class="modal-overlay">
        <div id="modalPanel" class="modal-panel">
            <div class="modal-header">
                <div class="modal-title-section">
                    <div class="modal-title">Validate and save</div>
                    <div class="modal-subtitle">Validate and commit ${this._pipelineConfig?.yamlPath || 'pipeline.yaml'} to the repository.</div>
                </div>
                <button class="modal-close" id="modalCloseBtn">
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="modal-section">
                    <div class="modal-section-label">Validation</div>
                    <div id="modalValidationStatus" class="validation-status validating">
                        <span class="spinner dark"></span>
                        <span>Validating pipeline...</span>
                    </div>
                </div>
                <div class="modal-section">
                    <div class="modal-section-label">Commit message</div>
                    <input type="text" id="modalCommitMessage" class="modal-input"
                           placeholder="Update pipeline configuration"
                           value="Update ${this._pipeline.name} pipeline">
                </div>
                <div class="modal-section">
                    <div class="modal-section-label">Optional extended description</div>
                    <textarea id="modalDescription" class="modal-textarea"
                              placeholder="Add an optional extended description..."></textarea>
                </div>
                <div class="modal-section">
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="commitOption" value="direct" checked>
                            <div class="radio-label">
                                <span class="radio-label-text">Commit directly to the <strong id="currentBranchLabel">${defaultBranch}</strong> branch</span>
                            </div>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="commitOption" value="newBranch">
                            <div class="radio-label">
                                <span class="radio-label-text">Create a new branch for this commit</span>
                            </div>
                        </label>
                    </div>
                    <div id="newBranchContainer" class="new-branch-input hidden">
                        <input type="text" id="newBranchName" class="modal-input"
                               placeholder="Enter new branch name">
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="modalCancelBtn" class="modal-btn cancel">Cancel</button>
                <button id="modalSaveBtn" class="modal-btn save">Save</button>
            </div>
        </div>
    </div>

    <!-- Run Pipeline Modal -->
    <div class="run-pipeline-modal" id="runPipelineModal">
        <div class="modal-overlay" id="runModalOverlay"></div>
        <div class="modal-panel">
            <div class="modal-header">
                <div>
                    <div class="modal-title">Run pipeline</div>
                    <div class="modal-subtitle">Select parameters below and manually run the pipeline</div>
                </div>
                <button class="modal-close" id="runModalCloseBtn">×</button>
            </div>
            <div class="modal-content">
                <div class="modal-section">
                    <div class="modal-section-title">Pipeline version</div>
                    <div class="modal-form-group">
                        <label class="modal-label">
                            Select pipeline version by branch/tag
                            <span class="modal-label-description">Select the pipeline to run by branch, commit, or tag</span>
                        </label>
                        <select class="modal-input" id="runBranchSelect">
                            <option value="${defaultBranch}">${defaultBranch}</option>
                        </select>
                    </div>
                    <div class="modal-form-group">
                        <label class="modal-label">Commit</label>
                        <input type="text" class="modal-input" id="runCommitInput" placeholder="Leave empty to use latest commit">
                    </div>
                </div>

                <!-- Runtime Parameters Section -->
                <div id="runParametersSection" style="display: none;">
                    <div class="modal-divider"></div>
                    <div class="modal-section">
                        <div class="modal-section-title">Parameters</div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                            Configure runtime parameters for this pipeline run
                        </div>
                        <div id="runParametersContainer"></div>
                    </div>
                </div>

                <div class="modal-divider"></div>

                <div class="modal-section">
                    <div class="modal-section-title">Advanced options</div>

                    <!-- Stages Section -->
                    <div id="runStagesExpandable" class="modal-expandable-section" style="display: none;">
                        <div class="modal-expandable-header" onclick="document.getElementById('runStagesExpandable').classList.toggle('expanded')">
                            <div class="modal-expandable-title">Stages to run</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-checkbox-group" id="runStagesContainer"></div>
                        </div>
                    </div>

                    <div id="runNoStagesText" class="modal-info-text" style="display: none;">
                        Run all stages as configured
                    </div>

                    <!-- Resources Section -->
                    <div class="modal-expandable-section">
                        <div class="modal-expandable-header" onclick="this.closest('.modal-expandable-section').classList.toggle('expanded')">
                            <div class="modal-expandable-title">Resources</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-info-text">1 repository, 0 build runs, 0 container images, 0 package runs</div>
                        </div>
                    </div>

                    <!-- Variables Section -->
                    <div id="runVariablesExpandable" class="modal-expandable-section" style="display: none;">
                        <div class="modal-expandable-header" onclick="document.getElementById('runVariablesExpandable').classList.toggle('expanded')">
                            <div class="modal-expandable-title">Variables</div>
                            <div class="modal-expandable-arrow">▶</div>
                        </div>
                        <div class="modal-expandable-content">
                            <div class="modal-variable-list" id="runVariablesContainer"></div>
                        </div>
                    </div>

                    <div id="runNoVariablesText" class="modal-info-text" style="display: none;">
                        This pipeline has no defined variables
                    </div>
                </div>

                <div class="modal-form-group" style="margin-top: 24px;">
                    <div class="modal-checkbox-item">
                        <input type="checkbox" id="runEnableDiagnostics">
                        <label for="runEnableDiagnostics">Enable system diagnostics</label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="runModalCancelBtn" class="modal-button secondary">Cancel</button>
                <button id="runModalRunBtn" class="modal-button primary">Run</button>
            </div>
        </div>
    </div>

    <!-- Variables Modal -->
    <div class="variables-modal" id="variablesModal">
        <div class="modal-overlay" id="variablesModalOverlay"></div>
        <div class="modal-panel variables-panel">
            <div class="modal-header" id="variablesMainHeader">
                <h2 class="modal-title">Variables</h2>
                <button class="modal-close" id="variablesModalCloseBtn">×</button>
            </div>

            <!-- Main Variables View -->
            <div class="variables-main-view" id="variablesMainView">
                <!-- Search Bar with Add Button -->
                <div class="variables-search-container">
                    <div class="variables-search-input-wrapper">
                        <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z"/>
                        </svg>
                        <input type="text" class="variables-search-input" id="variablesSearchInput" placeholder="Search variables">
                    </div>
                    <button class="add-variable-btn" id="addVariableBtn" title="Add variable">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/>
                        </svg>
                    </button>
                </div>

                <!-- Variables List -->
                <div class="variables-list-view" id="variablesListView">
                    <div class="variables-list" id="variablesList"></div>
                </div>

                <!-- Footer -->
                <div class="variables-footer">
                    <a href="https://go.microsoft.com/fwlink/?linkid=2098718" class="learn-link" id="learnAboutVariablesLink" target="_blank">Learn about variables</a>
                    <div class="footer-buttons">
                        <button class="modal-button secondary" id="closeVariablesBtn">Cancel</button>
                        <button class="modal-button primary" id="saveVariablesBtn" disabled>Save</button>
                    </div>
                </div>
            </div>

            <!-- Add/Edit Variable Form -->
            <div class="variable-form-container" id="variableFormContainer" style="display: none;">
                <div class="variable-form-header">
                    <button class="back-button" id="backToListBtn">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.56 7.25h7.69a.75.75 0 010 1.5H4.56l3.22 3.22a.75.75 0 010 1.06z"/>
                        </svg>
                    </button>
                    <h3 class="form-title" id="variableFormTitle">New variable</h3>
                </div>

                <div class="variable-form">
                    <div class="modal-form-group">
                        <label class="modal-label">Name</label>
                        <input type="text" class="modal-input" id="variableNameInput" placeholder="Enter variable name">
                    </div>

                    <div class="modal-form-group">
                        <label class="modal-label">Value</label>
                        <input type="text" class="modal-input" id="variableValueInput" placeholder="Enter variable value">
                    </div>

                    <div class="modal-form-group">
                        <div class="modal-checkbox-item">
                            <input type="checkbox" id="variableSecretCheckbox">
                            <label for="variableSecretCheckbox">Keep this value secret</label>
                        </div>
                    </div>

                    <div class="modal-form-group">
                        <div class="modal-checkbox-item">
                            <input type="checkbox" id="variableOverrideCheckbox">
                            <label for="variableOverrideCheckbox">Let users override this value when running this pipeline</label>
                        </div>
                    </div>

                    <div class="variable-form-info">
                        <div class="info-section">
                            <strong>To reference a variable in YAML,</strong> prefix it with a dollar sign and enclose it in parentheses. For example: <code>$(variable-name)</code>
                        </div>

                        <div class="info-section">
                            <strong>To use a variable in a script,</strong> use environment variable syntax. Replace <code>.</code> and space with <code>_</code>, capitalize the letters, and then use your platform's syntax for referencing an environment variable.
                        </div>

                        <div class="info-section">
                            Examples:
                        </div>

                        <div class="code-examples">
                            <div class="code-example">
                                <strong>Batch script:</strong> <code>%VARIABLE_NAME%</code>
                            </div>
                            <div class="code-example">
                                <strong>PowerShell script:</strong> <code>$\{env:VARIABLE_NAME}</code>
                            </div>
                            <div class="code-example">
                                <strong>Bash script:</strong> <code>$(VARIABLE_NAME)</code>
                            </div>
                        </div>
                    </div>

                    <div class="variable-form-footer">
                        <a href="https://go.microsoft.com/fwlink/?linkid=2098718" class="learn-link" id="learnAboutVariablesLink2" target="_blank">Learn about variables</a>
                        <div class="button-group">
                            <button class="modal-button secondary" id="cancelVariableBtn">Cancel</button>
                            <button class="modal-button primary" id="saveVariableBtn">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('editor');
        const actionBtn = document.getElementById('actionBtn');
        const actionBtnText = document.getElementById('actionBtnText');
        const actionDropdownBtn = document.getElementById('actionDropdownBtn');
        const actionDropdownMenu = document.getElementById('actionDropdownMenu');
        const validateWithoutSaveMenuItem = document.getElementById('validateWithoutSaveMenuItem');
        const variablesBtn = document.getElementById('variablesBtn');
        const moreBtn = document.getElementById('moreBtn');
        const moreMenu = document.getElementById('moreMenu');
        const refreshMenuItem = document.getElementById('refreshMenuItem');
        const branchDropdownTrigger = document.getElementById('branchDropdownTrigger');
        const branchDropdownMenu = document.getElementById('branchDropdownMenu');
        const branchSearch = document.getElementById('branchSearch');
        const branchList = document.getElementById('branchList');
        const selectedBranchName = document.getElementById('selectedBranchName');
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const notification = document.getElementById('notification');
        const validationPanel = document.getElementById('validationPanel');
        const validationMessage = document.getElementById('validationMessage');
        const validationTitle = document.getElementById('validationTitle');
        const validationIcon = document.getElementById('validationIcon');
        const closeValidation = document.getElementById('closeValidation');

        // Modal elements
        const modalOverlay = document.getElementById('modalOverlay');
        const modalPanel = document.getElementById('modalPanel');
        const modalCloseBtn = document.getElementById('modalCloseBtn');
        const modalCancelBtn = document.getElementById('modalCancelBtn');
        const modalSaveBtn = document.getElementById('modalSaveBtn');
        const modalCommitMessage = document.getElementById('modalCommitMessage');
        const modalDescription = document.getElementById('modalDescription');
        const modalValidationStatus = document.getElementById('modalValidationStatus');
        const currentBranchLabel = document.getElementById('currentBranchLabel');
        const newBranchContainer = document.getElementById('newBranchContainer');
        const newBranchName = document.getElementById('newBranchName');
        const commitOptions = document.querySelectorAll('input[name="commitOption"]');

        let originalContent = \`${escapedYaml}\`;
        let isModified = false;
        let selectedBranch = '${defaultBranch}';
        let branches = ${branchesJson};
        let isValidating = false;
        let modalValidationValid = false;

        // Initialize branches
        renderBranches(branches);

        // Track modifications and update button state
        editor.addEventListener('input', () => {
            const modified = editor.value !== originalContent;
            if (modified !== isModified) {
                isModified = modified;
                updateButtonState();
                updateStatus();
            }
        });

        function updateButtonState() {
            if (isModified) {
                // Show "Validate and save" button with dropdown
                actionBtn.className = 'action-btn validate-save';
                actionBtn.title = 'Validate and save to Azure DevOps repository';
                actionBtn.innerHTML = '<span id="actionBtnText">Validate and save</span>';
                actionDropdownBtn.style.display = 'flex';
            } else {
                // Show "Run" button without dropdown
                actionBtn.className = 'action-btn run';
                actionBtn.title = 'Run pipeline';
                actionBtn.innerHTML = '<span id="actionBtnText">Run</span>';
                actionDropdownBtn.style.display = 'none';
                actionBtn.style.borderRadius = '4px'; // Full rounded corners when no dropdown
            }
        }

        function updateStatus() {
            if (isValidating) {
                statusBar.className = 'status-bar validating';
                statusText.textContent = 'Validating...';
            } else if (isModified) {
                statusBar.className = 'status-bar modified';
                statusText.textContent = 'Modified';
            } else {
                statusBar.className = 'status-bar';
                statusText.textContent = 'Ready';
            }
        }

        function showNotification(message, type) {
            notification.className = 'notification ' + type;
            notification.textContent = message;
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 5000);
        }

        function showValidationResult(success, message) {
            validationPanel.classList.add('visible');
            validationPanel.classList.remove('success', 'error');
            validationPanel.classList.add(success ? 'success' : 'error');
            validationTitle.textContent = success ? 'Validation Successful' : 'Validation Failed';
            validationIcon.innerHTML = success
                ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="#3794ff"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>'
                : '<svg width="16" height="16" viewBox="0 0 16 16" fill="#f14c4c"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 5zm0 8a1 1 0 100-2 1 1 0 000 2z"/></svg>';
            validationMessage.textContent = message;
        }

        closeValidation.addEventListener('click', () => {
            validationPanel.classList.remove('visible');
        });

        // Modal functions
        function openModal(skipValidation = false) {
            modalValidationValid = false;
            modalSaveBtn.disabled = !skipValidation;
            currentBranchLabel.textContent = selectedBranch;
            modalCommitMessage.value = 'Update ${this._pipeline.name} pipeline';
            modalDescription.value = '';
            document.querySelector('input[name="commitOption"][value="direct"]').checked = true;
            newBranchContainer.classList.add('hidden');
            newBranchName.value = '';

            if (skipValidation) {
                // Hide validation status when skipping validation
                modalValidationStatus.style.display = 'none';
                modalValidationValid = true;
            } else {
                // Show validating state
                modalValidationStatus.style.display = 'flex';
                modalValidationStatus.className = 'validation-status validating';
                modalValidationStatus.innerHTML = '<span class="spinner dark"></span><span>Validating pipeline...</span>';
            }

            // Show modal with animation
            modalOverlay.classList.add('visible');
            setTimeout(() => modalPanel.classList.add('visible'), 10);

            // Start validation only if not skipping
            if (!skipValidation) {
                vscode.postMessage({
                    command: 'validateForModal',
                    content: editor.value,
                    branch: selectedBranch
                });
            }
        }

        function closeModal() {
            modalPanel.classList.remove('visible');
            setTimeout(() => modalOverlay.classList.remove('visible'), 300);
        }

        function updateModalValidationStatus(valid, message) {
            modalValidationValid = valid;
            modalSaveBtn.disabled = !valid;

            if (valid) {
                modalValidationStatus.className = 'validation-status success';
                modalValidationStatus.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg><span>' + message + '</span>';
            } else {
                modalValidationStatus.className = 'validation-status error';
                modalValidationStatus.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 5zm0 8a1 1 0 100-2 1 1 0 000 2z"/></svg><span>' + message + '</span>';
            }
        }

        // Modal event listeners
        modalCloseBtn.addEventListener('click', closeModal);
        modalCancelBtn.addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });

        // Handle radio button change for new branch option
        commitOptions.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'newBranch') {
                    newBranchContainer.classList.remove('hidden');
                    newBranchName.focus();
                } else {
                    newBranchContainer.classList.add('hidden');
                }
            });
        });

        // Handle save button
        modalSaveBtn.addEventListener('click', () => {
            if (!modalValidationValid) return;

            const commitOption = document.querySelector('input[name="commitOption"]:checked').value;
            const createNewBranch = commitOption === 'newBranch';
            const newBranch = createNewBranch ? newBranchName.value.trim() : null;

            if (createNewBranch && !newBranch) {
                showNotification('Please enter a new branch name', 'error');
                return;
            }

            // Combine commit message and description
            let fullCommitMessage = modalCommitMessage.value.trim() || 'Update pipeline';
            if (modalDescription.value.trim()) {
                fullCommitMessage += '\\n\\n' + modalDescription.value.trim();
            }

            modalSaveBtn.disabled = true;
            modalSaveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            vscode.postMessage({
                command: 'save',
                content: editor.value,
                branch: selectedBranch,
                commitMessage: fullCommitMessage,
                createNewBranch: createNewBranch,
                newBranchName: newBranch
            });
        });

        // Main action button handler
        actionBtn.addEventListener('click', () => {
            if (isModified) {
                // Open validate and save modal
                openModal();
            } else {
                // Open run pipeline form
                vscode.postMessage({ command: 'runPipeline' });
            }
        });

        // Run Pipeline Modal
        const runPipelineModal = document.getElementById('runPipelineModal');
        const runModalOverlay = document.getElementById('runModalOverlay');
        const runModalCloseBtn = document.getElementById('runModalCloseBtn');
        const runModalCancelBtn = document.getElementById('runModalCancelBtn');
        const runModalRunBtn = document.getElementById('runModalRunBtn');
        const runBranchSelect = document.getElementById('runBranchSelect');

        let runPipelineData = null;

        function openRunPipelineModal(data) {
            runPipelineData = data;

            // Populate branches
            runBranchSelect.innerHTML = data.branches.map(branch =>
                \`<option value="\${branch}" \${branch === data.defaultBranch ? 'selected' : ''}>\${branch}</option>\`
            ).join('');

            // Populate runtime parameters
            const parametersSection = document.getElementById('runParametersSection');
            const parametersContainer = document.getElementById('runParametersContainer');
            if (data.runtimeParameters && data.runtimeParameters.length > 0) {
                parametersContainer.innerHTML = data.runtimeParameters.map(param => {
                    const paramId = 'run-param-' + param.name;
                    const displayName = param.displayName || param.name;

                    // Boolean type - render as checkbox
                    if (param.type === 'boolean') {
                        const isChecked = param.default === true || param.default === 'true';
                        return \`
                            <div class="modal-form-group">
                                <div class="modal-checkbox-item" style="padding: 8px 0;">
                                    <input type="checkbox" id="\${paramId}" \${isChecked ? 'checked' : ''}>
                                    <label for="\${paramId}" style="font-weight: 500;">\${displayName}</label>
                                </div>
                            </div>
                        \`;
                    }

                    // String with values - render based on number of options
                    // 3 or fewer values: radio buttons, 4+ values: dropdown
                    if (param.values && param.values.length > 0) {
                        if (param.values.length <= 3) {
                            // Radio buttons for small number of options
                            return \`
                                <div class="modal-form-group">
                                    <label class="modal-label">\${displayName}</label>
                                    <div class="modal-radio-group" data-param-name="\${param.name}">
                                        \${param.values.map((val, i) => \`
                                            <div class="modal-radio-item">
                                                <input type="radio"
                                                       name="run-param-\${param.name}"
                                                       id="\${paramId}-\${i}"
                                                       value="\${val}"
                                                       \${val === param.default ? 'checked' : ''}>
                                                <label for="\${paramId}-\${i}">\${val}</label>
                                            </div>
                                        \`).join('')}
                                    </div>
                                </div>
                            \`;
                        } else {
                            // Dropdown for larger number of options
                            return \`
                                <div class="modal-form-group">
                                    <label class="modal-label">\${displayName}</label>
                                    <select class="modal-input" id="\${paramId}">
                                        \${param.values.map(val => \`
                                            <option value="\${val}" \${val === param.default ? 'selected' : ''}>\${val}</option>
                                        \`).join('')}
                                    </select>
                                </div>
                            \`;
                        }
                    }

                    // Number type - render as number input
                    if (param.type === 'number') {
                        return \`
                            <div class="modal-form-group">
                                <label class="modal-label">\${displayName}</label>
                                <input type="number" class="modal-input" id="\${paramId}"
                                       value="\${param.default !== undefined ? param.default : ''}"
                                       placeholder="Enter number">
                            </div>
                        \`;
                    }

                    // Default - render as text input
                    return \`
                        <div class="modal-form-group">
                            <label class="modal-label">\${displayName}</label>
                            <input type="text" class="modal-input" id="\${paramId}"
                                   value="\${param.default !== undefined ? param.default : ''}"
                                   placeholder="Enter value">
                        </div>
                    \`;
                }).join('');
                parametersSection.style.display = 'block';
            } else {
                parametersSection.style.display = 'none';
            }

            // Populate stages
            const stagesExpandable = document.getElementById('runStagesExpandable');
            const stagesContainer = document.getElementById('runStagesContainer');
            const noStagesText = document.getElementById('runNoStagesText');
            if (data.stages && data.stages.length > 0) {
                let stagesHtml = \`
                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
                        Deselect stages you want to skip for this run
                    </div>
                    <div class="modal-checkbox-item" style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border);">
                        <input type="checkbox" id="run-stage-all" checked onchange="toggleAllRunStages(this)">
                        <label for="run-stage-all" style="font-weight: 600;">Run all stages</label>
                    </div>
                \`;
                stagesHtml += data.stages.map((stage, index) => \`
                    <div class="modal-checkbox-item">
                        <input type="checkbox" class="run-stage-checkbox" id="run-stage-\${index}" value="\${stage.name}" checked onchange="updateRunAllCheckbox()">
                        <label for="run-stage-\${index}">
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
                stagesExpandable.style.display = 'block';
                noStagesText.style.display = 'none';
            } else {
                stagesExpandable.style.display = 'none';
                noStagesText.style.display = 'block';
            }

            // Populate variables
            const variablesExpandable = document.getElementById('runVariablesExpandable');
            const variablesContainer = document.getElementById('runVariablesContainer');
            const noVariablesText = document.getElementById('runNoVariablesText');
            const variableEntries = data.variables ? Object.entries(data.variables) : [];
            if (variableEntries.length > 0) {
                variablesContainer.innerHTML = variableEntries.map(([key, value]) => \`
                    <div class="modal-variable-item">
                        <div class="modal-variable-name">\${key}</div>
                        <input type="text" class="modal-input" id="run-var-\${key}" value="\${value}" data-var-name="\${key}">
                    </div>
                \`).join('');
                variablesExpandable.style.display = 'block';
                noVariablesText.style.display = 'none';
            } else {
                variablesExpandable.style.display = 'none';
                noVariablesText.style.display = 'block';
            }

            // Show modal
            runPipelineModal.classList.add('show');
        }

        function toggleAllRunStages(checkbox) {
            const stageCheckboxes = document.querySelectorAll('.run-stage-checkbox');
            stageCheckboxes.forEach(cb => {
                cb.checked = checkbox.checked;
            });
        }

        function updateRunAllCheckbox() {
            const allCheckbox = document.getElementById('run-stage-all');
            const stageCheckboxes = document.querySelectorAll('.run-stage-checkbox');
            const allChecked = Array.from(stageCheckboxes).every(cb => cb.checked);
            if (allCheckbox) {
                allCheckbox.checked = allChecked;
            }
        }

        function closeRunPipelineModal() {
            runPipelineModal.classList.remove('show');
        }

        runModalCloseBtn.addEventListener('click', closeRunPipelineModal);
        runModalCancelBtn.addEventListener('click', closeRunPipelineModal);
        runModalOverlay.addEventListener('click', closeRunPipelineModal);

        runModalRunBtn.addEventListener('click', () => {
            const branch = runBranchSelect.value;
            const commit = document.getElementById('runCommitInput')?.value.trim();

            // Collect selected stages
            const stagesToRun = [];
            document.querySelectorAll('.run-stage-checkbox:checked').forEach(checkbox => {
                stagesToRun.push(checkbox.value);
            });

            // Collect runtime parameters (template parameters)
            const templateParameters = {};

            // Handle checkboxes, text inputs, number inputs, and select dropdowns
            document.querySelectorAll('[id^="run-param-"]:not([type="radio"])').forEach(input => {
                const key = input.id.replace('run-param-', '');
                if (input.type === 'checkbox') {
                    templateParameters[key] = input.checked.toString();
                } else if (input.tagName === 'SELECT') {
                    templateParameters[key] = input.value;
                } else if (input.value !== '' && input.value !== undefined) {
                    templateParameters[key] = input.value;
                }
            });

            // Handle radio buttons (string parameters with few values)
            document.querySelectorAll('.modal-radio-group').forEach(group => {
                const paramName = group.dataset.paramName;
                const checkedRadio = group.querySelector('input[type="radio"]:checked');
                if (paramName && checkedRadio) {
                    templateParameters[paramName] = checkedRadio.value;
                }
            });

            // Collect variables (legacy pipeline variables)
            const variables = {};
            document.querySelectorAll('[id^="run-var-"]').forEach(input => {
                const key = input.id.replace('run-var-', '');
                if (input.value) {
                    variables[key] = input.value;
                }
            });

            // Merge template parameters with variables for the API call
            const allVariables = { ...variables, ...templateParameters };

            const allStages = runPipelineData?.stages ? runPipelineData.stages.map(s => s.name) : [];
            const stagesToSkip = allStages.filter(s => !stagesToRun.includes(s));

            runModalRunBtn.disabled = true;
            runModalRunBtn.innerHTML = '<span class="spinner"></span> Running...';

            vscode.postMessage({
                command: 'submitRunPipeline',
                data: {
                    branch: branch,
                    commit: commit || undefined,
                    variables: Object.keys(allVariables).length > 0 ? allVariables : undefined,
                    stagesToSkip: stagesToSkip.length > 0 ? stagesToSkip : undefined
                }
            });
        });

        // Branch dropdown functionality
        function renderBranches(branchesToRender) {
            branchList.innerHTML = '';
            if (branchesToRender.length === 0) {
                branchList.innerHTML = '<div class="no-branches">No branches found</div>';
                return;
            }
            branchesToRender.forEach(branch => {
                const item = document.createElement('div');
                item.className = 'branch-item' + (branch === selectedBranch ? ' selected' : '');
                item.innerHTML = \`
                    <svg class="branch-item-icon" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                    </svg>
                    <span class="branch-item-name">\${branch}</span>
                \`;
                item.addEventListener('click', () => {
                    selectedBranch = branch;
                    selectedBranchName.textContent = branch;
                    currentBranchLabel.textContent = branch;
                    closeBranchDropdown();
                    renderBranches(branches);
                });
                branchList.appendChild(item);
            });
        }

        function openBranchDropdown() {
            branchDropdownTrigger.classList.add('open');
            branchDropdownMenu.classList.add('open');
            branchSearch.value = '';
            renderBranches(branches);
            setTimeout(() => branchSearch.focus(), 100);
        }

        function closeBranchDropdown() {
            branchDropdownTrigger.classList.remove('open');
            branchDropdownMenu.classList.remove('open');
        }

        branchDropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (branchDropdownMenu.classList.contains('open')) {
                closeBranchDropdown();
            } else {
                openBranchDropdown();
            }
        });

        branchSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = branches.filter(b => b.toLowerCase().includes(query));
            renderBranches(filtered);
        });

        branchSearch.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!branchDropdownTrigger.contains(e.target) && !branchDropdownMenu.contains(e.target)) {
                closeBranchDropdown();
            }
            if (!moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
                moreMenu.classList.remove('show');
            }
            if (!actionDropdownBtn.contains(e.target) && !actionDropdownMenu.contains(e.target)) {
                actionDropdownMenu.classList.remove('show');
            }
        });

        // Handle Variables button
        variablesBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openVariablesModal' });
        });

        // Handle Action dropdown toggle
        actionDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            actionDropdownMenu.classList.toggle('show');
        });

        // Handle validate without save
        validateWithoutSaveMenuItem.addEventListener('click', () => {
            // Open modal without validation
            openModal(true);
            actionDropdownMenu.classList.remove('show');
        });

        // Handle More menu toggle
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moreMenu.classList.toggle('show');
        });

        // Handle refresh menu item
        refreshMenuItem.addEventListener('click', () => {
            if (isModified) {
                if (!confirm('You have unsaved changes. Refresh anyway?')) {
                    return;
                }
            }
            refreshMenuItem.classList.add('spinning');
            vscode.postMessage({ command: 'refresh' });
            setTimeout(() => refreshMenuItem.classList.remove('spinning'), 1000);
            moreMenu.classList.remove('show');
        });

        // Variables Modal
        const variablesModal = document.getElementById('variablesModal');
        const variablesModalOverlay = document.getElementById('variablesModalOverlay');
        const variablesModalCloseBtn = document.getElementById('variablesModalCloseBtn');
        const variablesMainHeader = document.getElementById('variablesMainHeader');
        const variablesMainView = document.getElementById('variablesMainView');
        const variablesSearchInput = document.getElementById('variablesSearchInput');
        const addVariableBtn = document.getElementById('addVariableBtn');
        const variablesList = document.getElementById('variablesList');
        const closeVariablesBtn = document.getElementById('closeVariablesBtn');
        const saveVariablesBtn = document.getElementById('saveVariablesBtn');
        const variableFormContainer = document.getElementById('variableFormContainer');
        const backToListBtn = document.getElementById('backToListBtn');
        const variableFormTitle = document.getElementById('variableFormTitle');
        const variableNameInput = document.getElementById('variableNameInput');
        const variableValueInput = document.getElementById('variableValueInput');
        const variableSecretCheckbox = document.getElementById('variableSecretCheckbox');
        const variableOverrideCheckbox = document.getElementById('variableOverrideCheckbox');
        const saveVariableBtn = document.getElementById('saveVariableBtn');
        const cancelVariableBtn = document.getElementById('cancelVariableBtn');

        let currentVariables = [];
        let editingVariableName = null;

        function openVariablesModal() {
            variablesModal.classList.add('show');
            showMainView();
            // Request variables from backend
            vscode.postMessage({ command: 'loadVariables' });
        }

        function closeVariablesModal() {
            variablesModal.classList.remove('show');
            showMainView();
            resetVariableForm();
        }

        function showMainView() {
            variablesMainHeader.style.display = 'flex';
            variablesMainView.style.display = 'flex';
            variableFormContainer.style.display = 'none';
        }

        function showVariableForm(variableName = null) {
            variablesMainHeader.style.display = 'none';
            variablesMainView.style.display = 'none';
            variableFormContainer.style.display = 'flex';

            if (variableName) {
                // Edit mode
                editingVariableName = variableName;
                const variable = currentVariables.find(v => v.name === variableName);
                if (variable) {
                    variableNameInput.value = variable.name;
                    variableValueInput.value = variable.isSecret ? '' : variable.value;
                    variableSecretCheckbox.checked = variable.isSecret;
                    variableOverrideCheckbox.checked = variable.allowOverride;
                    variableNameInput.disabled = true; // Can't change variable name when editing
                    variableFormTitle.textContent = 'Edit variable';
                    saveVariableBtn.disabled = false; // Enable save button for editing
                }
            } else {
                // Add mode
                editingVariableName = null;
                resetVariableForm();
                variableNameInput.disabled = false;
                variableFormTitle.textContent = 'New variable';
                saveVariableBtn.disabled = true; // Disable save button initially
            }
        }

        function resetVariableForm() {
            variableNameInput.value = '';
            variableValueInput.value = '';
            variableSecretCheckbox.checked = false;
            variableOverrideCheckbox.checked = false;
            editingVariableName = null;
        }

        function renderVariablesList() {
            variablesList.innerHTML = '';

            if (currentVariables.length === 0) {
                variablesList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--vscode-descriptionForeground);">No variables defined. Click the + button to add one.</div>';
                return;
            }

            currentVariables.forEach(variable => {
                const row = document.createElement('div');
                row.className = 'variable-row';
                row.dataset.variableName = variable.name;

                // Icon (ƒx for normal, lock for secret)
                const icon = variable.isSecret
                    ? \`<svg class="variable-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                         <path fill-rule="evenodd" d="M4 4v2h-.25A1.75 1.75 0 002 7.75v5.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 13.25v-5.5A1.75 1.75 0 0012.25 6H12V4a4 4 0 10-8 0zm6.5 2V4a2.5 2.5 0 00-5 0v2h5zM12 7.5h.25a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-5.5a.25.25 0 01.25-.25H12z"/>
                       </svg>\`
                    : \`<svg class="variable-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                         <path d="M6 7h4v1H6V7zm0 2h4v1H6V9z"/>
                         <path d="M11 2H9c0-.55-.45-1-1-1s-1 .45-1 1H5c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm0 11H5V3h6v10z"/>
                         <text x="5" y="7.5" font-size="6" fill="currentColor" font-style="italic">fx</text>
                       </svg>\`;

                const valueDisplay = variable.isSecret ? '************' : (variable.value || '');
                const valueText = \`= \${valueDisplay}\`;

                row.innerHTML = \`
                    \${icon}
                    <div class="variable-content">
                        <div class="variable-name">\${variable.name}</div>
                        <div class="variable-value-display \${variable.isSecret ? 'secret' : ''}">\${valueText}</div>
                    </div>
                    <div class="variable-row-actions">
                        <button class="variable-action-icon copy-variable-btn" title="Copy variable name">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4 4v1h1V4h6v6h-1v1h1.5a.5.5 0 00.5-.5v-7a.5.5 0 00-.5-.5h-7a.5.5 0 00-.5.5V4z"/>
                                <path d="M9.5 5h-7a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h7a.5.5 0 00.5-.5v-7a.5.5 0 00-.5-.5z"/>
                            </svg>
                        </button>
                        <button class="variable-action-icon delete-variable-btn" title="Delete variable">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path fill-rule="evenodd" d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19c.9 0 1.652-.681 1.741-1.576l.66-6.6a.75.75 0 00-1.492-.149l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z"/>
                            </svg>
                        </button>
                    </div>
                \`;

                // Click to edit (on content area only, not on action buttons)
                const contentArea = row.querySelector('.variable-content');
                contentArea.addEventListener('click', () => {
                    showVariableForm(variable.name);
                });

                // Copy button
                const copyBtn = row.querySelector('.copy-variable-btn');
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(variable.name);
                    showNotification('Variable name copied to clipboard', 'success');
                });

                // Delete button
                const deleteBtn = row.querySelector('.delete-variable-btn');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(\`Are you sure you want to delete the variable "\${variable.name}"?\`)) {
                        vscode.postMessage({
                            command: 'deleteVariable',
                            variableName: variable.name
                        });
                    }
                });

                variablesList.appendChild(row);
            });
        }

        // Event listeners for Variables modal
        variablesModalCloseBtn.addEventListener('click', closeVariablesModal);
        variablesModalOverlay.addEventListener('click', closeVariablesModal);
        closeVariablesBtn.addEventListener('click', closeVariablesModal);

        addVariableBtn.addEventListener('click', () => {
            showVariableForm();
        });

        backToListBtn.addEventListener('click', () => {
            showMainView();
            resetVariableForm();
        });

        cancelVariableBtn.addEventListener('click', () => {
            showMainView();
            resetVariableForm();
        });

        saveVariableBtn.addEventListener('click', () => {
            const name = variableNameInput.value.trim();
            const value = variableValueInput.value;
            const isSecret = variableSecretCheckbox.checked;
            const allowOverride = variableOverrideCheckbox.checked;

            if (!name) {
                alert('Variable name is required');
                return;
            }

            // Validate variable name (must start with letter or underscore, contain only alphanumeric and underscores)
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
                alert('Variable name must start with a letter or underscore and contain only letters, numbers, and underscores');
                return;
            }

            // Check if variable already exists (when adding new)
            if (!editingVariableName && currentVariables.some(v => v.name === name)) {
                alert('A variable with this name already exists');
                return;
            }

            saveVariableBtn.disabled = true;
            saveVariableBtn.textContent = 'Saving...';

            vscode.postMessage({
                command: 'saveVariable',
                data: {
                    name: name,
                    value: value,
                    isSecret: isSecret,
                    allowOverride: allowOverride
                }
            });
        });

        // Handle secret checkbox - clear value when checked
        variableSecretCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                variableValueInput.type = 'password';
                variableValueInput.placeholder = 'Enter secret value';
            } else {
                variableValueInput.type = 'text';
                variableValueInput.placeholder = 'Enter variable value';
            }
        });

        // Enable/disable OK button based on name input
        variableNameInput.addEventListener('input', () => {
            const hasName = variableNameInput.value.trim().length > 0;
            saveVariableBtn.disabled = !hasName;
        });

        // Handle keyboard shortcut for save (Ctrl+S / Cmd+S)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (isModified) {
                    openModal();
                }
            }
            // Close modal with Escape
            if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) {
                closeModal();
            }
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'branchesLoaded':
                    branches = message.branches;
                    if (message.defaultBranch) {
                        selectedBranch = message.defaultBranch;
                        selectedBranchName.textContent = message.defaultBranch;
                    }
                    renderBranches(branches);
                    break;
                case 'triggerValidate':
                    // Trigger validation of current content
                    vscode.postMessage({
                        command: 'validate',
                        content: editor.value,
                        branch: selectedBranch
                    });
                    break;
                case 'validationStarted':
                    isValidating = true;
                    updateStatus();
                    break;
                case 'validationSuccess':
                    isValidating = false;
                    updateStatus();
                    showValidationResult(true, message.message);
                    break;
                case 'validationError':
                    isValidating = false;
                    updateStatus();
                    showValidationResult(false, message.message);
                    break;
                case 'modalValidationStarted':
                    // Handled by openModal
                    break;
                case 'modalValidationResult':
                    updateModalValidationStatus(message.valid, message.message);
                    break;
                case 'saveSuccess':
                    closeModal();
                    originalContent = editor.value;
                    isModified = false;
                    updateButtonState();
                    updateStatus();
                    showNotification(message.message, 'success');
                    // Update branch if a new branch was created
                    if (message.newBranch) {
                        selectedBranch = message.newBranch;
                        selectedBranchName.textContent = message.newBranch;
                        // Refresh branches list
                        vscode.postMessage({ command: 'getBranches' });
                    }
                    break;
                case 'saveError':
                    modalSaveBtn.disabled = false;
                    modalSaveBtn.innerHTML = 'Save';
                    showNotification('Error: ' + message.message, 'error');
                    break;
                case 'showRunPipelineForm':
                    openRunPipelineModal(message.data);
                    break;
                case 'runPipelineSuccess':
                    closeRunPipelineModal();
                    runModalRunBtn.disabled = false;
                    runModalRunBtn.innerHTML = 'Run';
                    showNotification('Pipeline run started successfully!', 'success');
                    break;
                case 'runPipelineError':
                    runModalRunBtn.disabled = false;
                    runModalRunBtn.innerHTML = 'Run';
                    showNotification('Error: ' + message.message, 'error');
                    break;
                case 'openVariablesModal':
                    openVariablesModal();
                    break;
                case 'variablesLoaded':
                    currentVariables = message.variables || [];
                    renderVariablesList();
                    break;
                case 'variableSaved':
                    saveVariableBtn.disabled = false;
                    saveVariableBtn.textContent = 'OK';
                    showNotification('Variable saved successfully!', 'success');
                    // Reload variables
                    vscode.postMessage({ command: 'loadVariables' });
                    showMainView();
                    resetVariableForm();
                    break;
                case 'variableSaveError':
                    saveVariableBtn.disabled = false;
                    saveVariableBtn.textContent = 'Save';
                    showNotification('Error: ' + message.message, 'error');
                    break;
                case 'variableDeleted':
                    showNotification('Variable deleted successfully!', 'success');
                    // Reload variables
                    vscode.postMessage({ command: 'loadVariables' });
                    break;
                case 'variableDeleteError':
                    showNotification('Error: ' + message.message, 'error');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Get error content
     */
    private getErrorContent(error: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-foreground, #cccccc);
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            padding: 20px;
        }
        .error-container {
            text-align: center;
            max-width: 500px;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .error-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-errorForeground, #f14c4c);
        }
        .error-message {
            color: var(--vscode-descriptionForeground, #8b8b8b);
            margin-bottom: 20px;
        }
        .retry-button {
            padding: 10px 20px;
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
        }
        .retry-button:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">&#9888;</div>
        <div class="error-title">Failed to Load Pipeline</div>
        <div class="error-message">${error}</div>
        <button class="retry-button" onclick="location.reload()">Retry</button>
    </div>
</body>
</html>`;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        PipelineEditorPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
