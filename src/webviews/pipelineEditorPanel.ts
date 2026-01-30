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
                        await this.savePipelineYaml(message.content, message.branch, message.commitMessage);
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
            this._panel.webview.postMessage({
                command: 'branchesLoaded',
                branches: branches.map(b => b.name),
                defaultBranch: this._pipelineConfig.defaultBranch
            });
        } catch (error) {
            console.error('Failed to load branches:', error);
        }
    }

    /**
     * Save pipeline YAML to repository
     */
    private async savePipelineYaml(content: string, branch: string, commitMessage: string): Promise<void> {
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
                    await this._client.pushFileToRepository(
                        this._pipelineConfig!.repositoryId,
                        branch,
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
                        message: 'Pipeline YAML saved successfully!'
                    });

                    vscode.window.showInformationMessage(
                        `Pipeline YAML saved to ${this._pipelineConfig!.repositoryName}/${this._pipelineConfig!.yamlPath}`,
                        'View in Browser'
                    ).then(selection => {
                        if (selection === 'View in Browser') {
                            const config = this._client.getConfig();
                            const repoUrl = `${config.organizationUrl}/${config.projectName}/_git/${this._pipelineConfig!.repositoryName}?path=${encodeURIComponent(this._pipelineConfig!.yamlPath)}&version=GB${branch}`;
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

        .toolbar-select {
            padding: 6px 10px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, #454545);
            border-radius: 4px;
            font-size: 13px;
            min-width: 150px;
        }

        .toolbar-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
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

        .toolbar-button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.15s ease;
        }

        .toolbar-button.primary {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, white);
        }

        .toolbar-button.primary:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .toolbar-button.primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toolbar-button.secondary {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #cccccc);
        }

        .toolbar-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
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
            gap: 16px;
            padding: 8px 16px;
            background: var(--vscode-editorWidget-background, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #454545);
            font-size: 12px;
        }

        .info-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .info-label {
            color: var(--vscode-descriptionForeground, #8b8b8b);
        }

        .info-value {
            color: var(--vscode-foreground, #cccccc);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <span class="toolbar-label">Branch:</span>
            <select id="branchSelect" class="toolbar-select">
                <option value="${this._pipelineConfig?.defaultBranch || 'main'}">${this._pipelineConfig?.defaultBranch || 'main'}</option>
            </select>
        </div>
        <div class="toolbar-group" style="flex: 1;">
            <span class="toolbar-label">Commit message:</span>
            <input type="text" id="commitMessage" class="toolbar-input"
                   placeholder="Update pipeline configuration"
                   value="Update ${this._pipeline.name} pipeline">
        </div>
        <div class="toolbar-group">
            <button id="refreshBtn" class="toolbar-button secondary" title="Refresh from repository">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-1.124 2.876l-.021.165.033.163.071.345c.156.423.47.82.997 1.21l.168.108-.091.14a4.71 4.71 0 0 1-2.967 2.153 4.669 4.669 0 0 1-3.882-.615A4.775 4.775 0 0 1 2.9 8.093a4.873 4.873 0 0 1 1.125-4.152 4.716 4.716 0 0 1 3.81-1.554l.18.017-.036.03-.012.012-.057.056.002.007-.039.039-.135.134c-.287.33-.514.694-.67 1.076-.141.345-.2.651-.2.9 0 .33.088.618.258.851.185.253.45.452.753.595.412.193.972.315 1.678.358l.632.031-.317.527c-.23.382-.393.856-.393 1.477 0 .327.086.597.248.797.163.203.39.343.658.428.274.087.576.124.892.124.376 0 .722-.058 1.015-.155.265-.088.483-.203.641-.334.143-.117.247-.248.303-.385.044-.107.07-.223.07-.358 0-.294-.136-.555-.42-.803l-.098-.066.009-.055.006-.023a4.63 4.63 0 0 0-.06-.674 4.508 4.508 0 0 0-.12-.48l-.021-.063.054-.035c.207-.131.39-.285.531-.453.242-.29.374-.643.374-1.045 0-.313-.082-.612-.243-.896l-.129-.224.24-.105c.403-.175.778-.437 1.093-.79l.046-.05zM8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16z"/>
                </svg>
                Refresh
            </button>
            <button id="saveBtn" class="toolbar-button primary" title="Save to Azure DevOps repository">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.353 1.146l1.5 1.5L15 2.793V14.5l-.5.5h-13l-.5-.5v-13l.5-.5h11.707l.146.146zM2 2v12h12V3.207L12.793 2H12v4H4V2H2zm9 0H5v3h6V2z"/>
                </svg>
                Save to Azure DevOps
            </button>
        </div>
    </div>

    <div class="info-bar">
        <div class="info-item">
            <span class="info-label">Repository:</span>
            <span class="info-value">${this._pipelineConfig?.repositoryName || 'Loading...'}</span>
        </div>
        <div class="info-item">
            <span class="info-label">Path:</span>
            <span class="info-value">${this._pipelineConfig?.yamlPath || 'Loading...'}</span>
        </div>
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

    <script>
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('editor');
        const saveBtn = document.getElementById('saveBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const branchSelect = document.getElementById('branchSelect');
        const commitMessage = document.getElementById('commitMessage');
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const notification = document.getElementById('notification');

        let originalContent = \`${escapedYaml}\`;
        let isModified = false;

        // Track modifications
        editor.addEventListener('input', () => {
            const modified = editor.value !== originalContent;
            if (modified !== isModified) {
                isModified = modified;
                updateStatus();
            }
        });

        function updateStatus() {
            if (isModified) {
                statusBar.classList.add('modified');
                statusText.textContent = 'Modified';
            } else {
                statusBar.classList.remove('modified');
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

        // Request branches on load
        vscode.postMessage({ command: 'getBranches' });

        // Handle save button
        saveBtn.addEventListener('click', () => {
            if (!editor.value.trim()) {
                showNotification('Cannot save empty content', 'error');
                return;
            }

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span>Saving...</span>';

            vscode.postMessage({
                command: 'save',
                content: editor.value,
                branch: branchSelect.value,
                commitMessage: commitMessage.value
            });
        });

        // Handle refresh button
        refreshBtn.addEventListener('click', () => {
            if (isModified) {
                if (!confirm('You have unsaved changes. Refresh anyway?')) {
                    return;
                }
            }
            vscode.postMessage({ command: 'refresh' });
        });

        // Handle keyboard shortcut for save (Ctrl+S / Cmd+S)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveBtn.click();
            }
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'branchesLoaded':
                    branchSelect.innerHTML = '';
                    message.branches.forEach(branch => {
                        const option = document.createElement('option');
                        option.value = branch;
                        option.textContent = branch;
                        if (branch === message.defaultBranch) {
                            option.selected = true;
                        }
                        branchSelect.appendChild(option);
                    });
                    break;
                case 'saveSuccess':
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.353 1.146l1.5 1.5L15 2.793V14.5l-.5.5h-13l-.5-.5v-13l.5-.5h11.707l.146.146zM2 2v12h12V3.207L12.793 2H12v4H4V2H2zm9 0H5v3h6V2z"/></svg>Save to Azure DevOps';
                    originalContent = editor.value;
                    isModified = false;
                    updateStatus();
                    showNotification(message.message, 'success');
                    break;
                case 'saveError':
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.353 1.146l1.5 1.5L15 2.793V14.5l-.5.5h-13l-.5-.5v-13l.5-.5h11.707l.146.146zM2 2v12h12V3.207L12.793 2H12v4H4V2H2zm9 0H5v3h6V2z"/></svg>Save to Azure DevOps';
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
