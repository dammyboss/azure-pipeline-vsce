import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { Pipeline } from '../models/types';

/**
 * Modal for renaming and moving pipelines
 */
export class RenamePipelineModal {
    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private pipeline: Pipeline,
        private onSuccess: () => void
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'submit':
                        await this.handleSubmit(message.data);
                        break;
                    case 'close':
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this.disposables
        );

        this.panel.webview.html = this.getHtmlContent();
    }

    public static async show(
        client: AzureDevOpsClient,
        pipeline: Pipeline,
        onSuccess: () => void
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'renamePipelineModal',
            'Rename/Move Pipeline',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: false
            }
        );

        new RenamePipelineModal(panel, client, pipeline, onSuccess);
    }

    private async handleSubmit(data: { name: string; folder: string }) {
        try {
            const newName = data.name.trim();
            const newFolder = data.folder.trim();

            // Validate name
            if (!newName || newName.length === 0) {
                vscode.window.showErrorMessage('Pipeline name cannot be empty');
                return;
            }

            // Determine what changed
            const nameChanged = newName !== this.pipeline.name;
            const folderChanged = newFolder !== (this.pipeline.folder || '\\');

            if (!nameChanged && !folderChanged) {
                vscode.window.showInformationMessage('No changes were made');
                this.panel.dispose();
                return;
            }

            // Update pipeline
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Updating pipeline...',
                    cancellable: false
                },
                async () => {
                    await this.client.updatePipeline(
                        this.pipeline.id,
                        nameChanged ? newName : undefined,
                        folderChanged ? newFolder : undefined
                    );

                    vscode.window.showInformationMessage(
                        `Pipeline updated successfully: ${newName}`
                    );

                    // Close modal
                    this.panel.dispose();

                    // Call success callback
                    this.onSuccess();
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update pipeline: ${errorMessage}`);
        }
    }

    private getHtmlContent(): string {
        const currentFolder = this.pipeline.folder || '\\';

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
            background: rgba(0, 0, 0, 0.5);
            overflow: hidden;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-container {
            width: 500px;
            max-width: 90vw;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            animation: fadeInScale 0.2s ease-out;
        }

        @keyframes fadeInScale {
            from {
                opacity: 0;
                transform: scale(0.95);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        .modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px 8px 0 0;
        }

        .modal-title {
            font-size: 18px;
            font-weight: 600;
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
            padding: 24px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 8px;
        }

        .form-input {
            width: 100%;
            padding: 10px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 14px;
            font-family: var(--vscode-font-family);
        }

        .form-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .form-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .modal-footer {
            padding: 16px 24px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            background: var(--vscode-editor-background);
            border-radius: 0 0 8px 8px;
        }

        .btn {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .info-box {
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            margin-bottom: 20px;
        }

        .info-title {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .info-item {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
    </style>
</head>
<body>
    <div class="modal-container">
        <div class="modal-header">
            <div class="modal-title">Rename/Move Pipeline</div>
            <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-content">
            <div class="info-box">
                <div class="info-title">Current Pipeline</div>
                <div class="info-item"><strong>Name:</strong> ${this.escapeHtml(this.pipeline.name)}</div>
                <div class="info-item"><strong>Folder:</strong> ${this.escapeHtml(currentFolder)}</div>
            </div>

            <form id="renameForm" onsubmit="handleSubmit(event)">
                <div class="form-group">
                    <label class="form-label" for="nameInput">Pipeline Name</label>
                    <input
                        type="text"
                        id="nameInput"
                        class="form-input"
                        value="${this.escapeHtml(this.pipeline.name)}"
                        placeholder="Enter pipeline name"
                        required
                    />
                    <div class="form-description">Enter a new name for the pipeline</div>
                </div>

                <div class="form-group">
                    <label class="form-label" for="folderInput">Folder Path</label>
                    <input
                        type="text"
                        id="folderInput"
                        class="form-input"
                        value="${this.escapeHtml(currentFolder)}"
                        placeholder="\\FolderName or \\ for root"
                    />
                    <div class="form-description">
                        Enter folder path (e.g., \\MyFolder or \\Parent\\Child). Use \\ for root.
                    </div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="submitBtn" onclick="handleSubmit()">Update</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function closeModal() {
            vscode.postMessage({ command: 'close' });
        }

        function handleSubmit(event) {
            if (event) {
                event.preventDefault();
            }

            const nameInput = document.getElementById('nameInput');
            const folderInput = document.getElementById('folderInput');

            const name = nameInput.value.trim();
            const folder = folderInput.value.trim();

            // Validate
            if (!name || name.length === 0) {
                alert('Pipeline name cannot be empty');
                nameInput.focus();
                return;
            }

            // Normalize folder path
            let normalizedFolder = folder;
            if (normalizedFolder && !normalizedFolder.startsWith('\\\\')) {
                if (!normalizedFolder.startsWith('\\\\') && !normalizedFolder.startsWith('\\\\')) {
                    normalizedFolder = '\\\\' + normalizedFolder;
                }
            }
            if (!normalizedFolder) {
                normalizedFolder = '\\\\';
            }

            vscode.postMessage({
                command: 'submit',
                data: {
                    name,
                    folder: normalizedFolder
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        // Focus name input on load
        document.getElementById('nameInput')?.focus();
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose() {
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
