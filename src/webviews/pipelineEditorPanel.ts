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

    private async fetchStages(): Promise<Array<{ name: string; displayName?: string }>> {
        try {
            const yaml = await this._client.getPipelineYaml(this._pipeline.id);
            const stages: Array<{ name: string; displayName?: string }> = [];
            const lines = yaml.split('\n');

            let currentStage: { name: string; displayName?: string } | null = null;

            for (const line of lines) {
                const stageMatch = line.match(/^\s*-\s*stage:\s*(.+)$/i);
                if (stageMatch) {
                    if (currentStage) {
                        stages.push(currentStage);
                    }
                    const stageName = stageMatch[1].trim().replace(/['"]/g, '').replace(/#.*$/, '').trim();
                    currentStage = { name: stageName };
                }

                if (currentStage && line.match(/^\s+displayName:\s*(.+)$/)) {
                    const displayMatch = line.match(/^\s+displayName:\s*(.+)$/);
                    if (displayMatch) {
                        currentStage.displayName = displayMatch[1].trim().replace(/['"]/g, '');
                    }
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
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
        }

        .action-btn.run:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .action-btn.validate-save {
            background: #388a34;
            color: white;
        }

        .action-btn.validate-save:hover {
            background: #2e7a2a;
        }

        .action-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        /* Modern Refresh Button */
        .refresh-btn {
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

        .refresh-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
            transform: scale(1.05);
        }

        .refresh-btn:active {
            transform: scale(0.95);
        }

        .refresh-btn.spinning svg {
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

        /* Run Pipeline Modal */
        .run-pipeline-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 3000;
        }

        .run-pipeline-modal.show {
            display: block;
        }

        .run-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
        }

        .run-modal-panel {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 550px;
            max-width: 90vw;
            background: var(--vscode-sideBar-background, #252526);
            border-left: 1px solid var(--vscode-panel-border, #454545);
            display: flex;
            flex-direction: column;
            animation: slideInRight 0.3s ease-out;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
        }

        .run-modal-header {
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
        }

        .run-modal-title-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .run-modal-title {
            font-size: 18px;
            font-weight: 600;
        }

        .run-modal-subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        .run-modal-close {
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

        .run-modal-close:hover {
            background: var(--vscode-toolbar-hoverBackground, #5a5d5e50);
        }

        .run-modal-body {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }

        .run-modal-section {
            margin-bottom: 20px;
        }

        .run-modal-section-label {
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .run-modal-select,
        .run-modal-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
        }

        .run-modal-select:focus,
        .run-modal-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .run-modal-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-panel-border, #454545);
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
            <button id="refreshBtn" class="refresh-btn" title="Refresh from repository">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" d="M2.5 8a5.5 5.5 0 119.3 4l-.9-.9A4.5 4.5 0 108.5 3.5v2L6 3l2.5-2.5v2a5.5 5.5 0 010 11A5.5 5.5 0 012.5 8z"/>
                </svg>
            </button>
            <button id="actionBtn" class="action-btn run" title="Run pipeline">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.5 2v12l10-6-10-6z"/>
                </svg>
                <span id="actionBtnText">Run</span>
            </button>
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
    <div id="runPipelineModal" class="run-pipeline-modal">
        <div class="run-modal-overlay" id="runModalOverlay"></div>
        <div class="run-modal-panel">
            <div class="run-modal-header">
                <div class="run-modal-title-section">
                    <div class="run-modal-title">Run pipeline</div>
                    <div class="run-modal-subtitle">Configure and start a new pipeline run</div>
                </div>
                <button class="run-modal-close" id="runModalCloseBtn">
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/>
                    </svg>
                </button>
            </div>
            <div class="run-modal-body">
                <div class="run-modal-section">
                    <div class="run-modal-section-label">Branch</div>
                    <select class="run-modal-select" id="runBranchSelect">
                        <option value="${defaultBranch}">${defaultBranch}</option>
                    </select>
                </div>
            </div>
            <div class="run-modal-footer">
                <button id="runModalCancelBtn" class="modal-btn cancel">Cancel</button>
                <button id="runModalRunBtn" class="modal-btn save">Run</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('editor');
        const actionBtn = document.getElementById('actionBtn');
        const actionBtnText = document.getElementById('actionBtnText');
        const refreshBtn = document.getElementById('refreshBtn');
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
                // Show "Validate and save" button
                actionBtn.className = 'action-btn validate-save';
                actionBtn.title = 'Validate and save to Azure DevOps repository';
                actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg><span id="actionBtnText">Validate and save</span>';
            } else {
                // Show "Run" button
                actionBtn.className = 'action-btn run';
                actionBtn.title = 'Run pipeline';
                actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2v12l10-6-10-6z"/></svg><span id="actionBtnText">Run</span>';
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
        function openModal() {
            modalValidationValid = false;
            modalSaveBtn.disabled = true;
            currentBranchLabel.textContent = selectedBranch;
            modalCommitMessage.value = 'Update ${this._pipeline.name} pipeline';
            modalDescription.value = '';
            document.querySelector('input[name="commitOption"][value="direct"]').checked = true;
            newBranchContainer.classList.add('hidden');
            newBranchName.value = '';

            // Show validating state
            modalValidationStatus.className = 'validation-status validating';
            modalValidationStatus.innerHTML = '<span class="spinner dark"></span><span>Validating pipeline...</span>';

            // Show modal with animation
            modalOverlay.classList.add('visible');
            setTimeout(() => modalPanel.classList.add('visible'), 10);

            // Start validation
            vscode.postMessage({
                command: 'validateForModal',
                content: editor.value,
                branch: selectedBranch
            });
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

            // Show modal
            runPipelineModal.classList.add('show');
        }

        function closeRunPipelineModal() {
            runPipelineModal.classList.remove('show');
        }

        runModalCloseBtn.addEventListener('click', closeRunPipelineModal);
        runModalCancelBtn.addEventListener('click', closeRunPipelineModal);
        runModalOverlay.addEventListener('click', closeRunPipelineModal);

        runModalRunBtn.addEventListener('click', () => {
            const branch = runBranchSelect.value;

            runModalRunBtn.disabled = true;
            runModalRunBtn.innerHTML = '<span class="spinner"></span> Running...';

            vscode.postMessage({
                command: 'submitRunPipeline',
                data: {
                    branch: branch,
                    variables: {},
                    stagesToSkip: [],
                    runtimeParameters: {}
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
        });

        // Handle refresh button
        refreshBtn.addEventListener('click', () => {
            if (isModified) {
                if (!confirm('You have unsaved changes. Refresh anyway?')) {
                    return;
                }
            }
            refreshBtn.classList.add('spinning');
            vscode.postMessage({ command: 'refresh' });
            setTimeout(() => refreshBtn.classList.remove('spinning'), 1000);
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
