import * as vscode from 'vscode';
import { ServiceEndpoint } from '../models/types';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';

export class ServiceConnectionPanel {
    private static currentPanel: ServiceConnectionPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private userProfile: { displayName: string; emailAddress: string; id: string } | null = null;

    private constructor(
        panel: vscode.WebviewPanel,
        private connection: ServiceEndpoint,
        private client: AzureDevOpsClient,
        private onUpdate: () => void
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );
        this.loadUserProfile();
    }

    public static show(connection: ServiceEndpoint, client: AzureDevOpsClient, onUpdate: () => void) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (ServiceConnectionPanel.currentPanel) {
            ServiceConnectionPanel.currentPanel.connection = connection;
            ServiceConnectionPanel.currentPanel.update();
            ServiceConnectionPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'serviceConnectionDetails',
            `Service Connection: ${connection.name}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ServiceConnectionPanel.currentPanel = new ServiceConnectionPanel(panel, connection, client, onUpdate);
    }

    private async loadUserProfile() {
        try {
            this.userProfile = await this.client.getCurrentUserProfile();
        } catch (error) {
            console.error('Failed to load user profile:', error);
        }
        this.update();
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'save':
                await this.saveConnection(message.data);
                break;
            case 'close':
                this.panel.dispose();
                break;
            case 'manageRoles':
                vscode.window.showInformationMessage('Manage service connection roles - Feature coming soon');
                break;
            case 'manageApp':
                vscode.window.showInformationMessage('Manage App registration - Feature coming soon');
                break;
            case 'loadUsageHistory':
                await this.loadUsageHistory();
                break;
            case 'openBuildRun':
                await this.openBuildRun(message.buildId);
                break;
            case 'refreshTree':
                this.onUpdate();
                break;
        }
    }

    private async openBuildRun(buildId: number) {
        try {
            const run = await this.client.getRun(buildId);
            vscode.commands.executeCommand('azurePipelines.viewRunDetails', run);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open run: ${error}`);
        }
    }

    private async loadUsageHistory() {
        try {
            const records = await this.client.getServiceEndpointExecutionRecords(this.connection.id, 50);
            this.panel.webview.postMessage({ 
                command: 'usageHistoryLoaded', 
                data: records 
            });
        } catch (error) {
            this.panel.webview.postMessage({ 
                command: 'usageHistoryError', 
                message: String(error) 
            });
        }
    }

    private async editConnection() {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            value: this.connection.name
        });

        if (!newName || newName === this.connection.name) {
            return;
        }

        try {
            const updated = {
                id: this.connection.id,
                name: newName,
                type: this.connection.type,
                url: this.connection.url,
                description: this.connection.description,
                authorization: this.connection.authorization,
                isShared: this.connection.isShared,
                isReady: this.connection.isReady,
                owner: this.connection.owner || 'Library',
                serviceEndpointProjectReferences: this.connection.serviceEndpointProjectReferences || []
            };

            await this.client.updateServiceEndpoint(this.connection.id, updated);
            this.connection = updated as ServiceEndpoint;
            this.update();
            this.onUpdate();
            
            vscode.window.showInformationMessage('Service connection updated successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update: ${error}`);
        }
    }

    private async saveConnection(data: any) {
        try {
            const updated = {
                id: this.connection.id,
                name: data.name,
                type: this.connection.type,
                url: data.url,
                description: data.description,
                authorization: this.connection.authorization,
                isShared: data.isShared,
                isReady: this.connection.isReady,
                owner: this.connection.owner || 'Library',
                data: this.connection.data || {},
                serviceEndpointProjectReferences: this.connection.serviceEndpointProjectReferences || []
            };

            await this.client.updateServiceEndpoint(this.connection.id, updated);
            this.connection = updated as ServiceEndpoint;
            this.update();
            
            this.panel.webview.postMessage({ command: 'saved' });
            vscode.window.showInformationMessage('Service connection updated successfully');
        } catch (error) {
            this.panel.webview.postMessage({ command: 'error', message: String(error) });
            vscode.window.showErrorMessage(`Failed to update: ${error}`);
        }
    }

    private update() {
        this.panel.title = `Service Connection: ${this.connection.name}`;
        this.panel.webview.html = this.getHtmlContent();
    }

    private getHtmlContent(): string {
        const conn = this.connection;
        const projects = conn.serviceEndpointProjectReferences?.map(ref => ref.projectReference?.name).join(', ') || 'None';
        
        // Get creator info from user profile
        const creatorName = this.userProfile?.displayName || 'Loading...';
        const creatorEmail = this.userProfile?.emailAddress || 'Loading...';
        const creatorInitials = creatorName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'DB';

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #1e1e1e;
            color: #cccccc;
            padding: 0;
            overflow-x: hidden;
        }
        .header {
            padding: 20px 24px 0;
            background-color: #1e1e1e;
            position: relative;
        }
        .title {
            font-size: 24px;
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 4px;
        }
        .subtitle {
            font-size: 13px;
            color: #8c8c8c;
            margin-bottom: 20px;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid #3c3c3c;
            padding: 0 24px;
            background-color: #1e1e1e;
        }
        .tab {
            padding: 12px 16px;
            cursor: pointer;
            color: #cccccc;
            font-size: 14px;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: all 0.2s;
        }
        .tab:hover {
            color: #ffffff;
        }
        .tab.active {
            color: #ffffff;
            border-bottom-color: #0078d4;
        }
        .content {
            padding: 24px;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .overview-grid {
            display: grid;
            grid-template-columns: 1fr 280px;
            gap: 0;
            margin-bottom: 20px;
        }
        .card {
            background-color: #252526;
            border: 1px solid #3c3c3c;
            border-radius: 0;
            padding: 20px;
        }
        .card:first-child {
            border-radius: 2px 0 0 2px;
            border-right: 0;
        }
        .card:last-child {
            border-radius: 0 2px 2px 0;
            border-left: 0;
        }
        .card-title {
            font-size: 16px;
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 16px;
        }
        .field {
            margin-bottom: 16px;
        }
        .field-label {
            font-size: 12px;
            color: #8c8c8c;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .field-value {
            font-size: 14px;
            color: #cccccc;
        }
        .field-subtext {
            font-size: 13px;
            color: #8c8c8c;
            margin-top: 4px;
        }
        .action-links {
            margin-top: 12px;
        }
        .action-link {
            color: #3794ff;
            font-size: 13px;
            cursor: pointer;
            margin-right: 16px;
            text-decoration: none;
        }
        .action-link:hover {
            text-decoration: underline;
        }
        .creator-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
            justify-content: center;
        }
        .creator-label {
            font-size: 12px;
            color: #ffffff;
            text-transform: none;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        .creator-content {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background-color: #107c10;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 600;
            color: #ffffff;
            flex-shrink: 0;
        }
        .creator-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .creator-name {
            font-size: 14px;
            color: #ffffff;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .creator-email {
            font-size: 13px;
            color: #8c8c8c;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .full-width-card {
            grid-column: 1 / -1;
        }
        .copy-field {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #1e1e1e;
            padding: 8px 12px;
            border-radius: 2px;
            margin-top: 4px;
        }
        .copy-text {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
            color: #cccccc;
            word-break: break-all;
            flex: 1;
        }
        .copy-icon {
            cursor: pointer;
            color: #8c8c8c;
            margin-left: 12px;
            font-size: 14px;
            flex-shrink: 0;
        }
        .copy-icon:hover {
            color: #3794ff;
        }
        .copy-icon svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #8c8c8c;
            font-size: 14px;
        }
        .edit-button {
            position: absolute;
            top: 20px;
            right: 24px;
            padding: 8px 16px;
            background-color: #0078d4;
            color: #ffffff;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }
        .edit-button:hover {
            background-color: #106ebe;
        }
        .hidden {
            display: none;
        }
        .form-group {
            margin-bottom: 16px;
        }
        .form-label {
            display: block;
            font-size: 13px;
            color: #cccccc;
            margin-bottom: 6px;
            font-weight: 600;
        }
        .form-input {
            width: 100%;
            padding: 8px 12px;
            background-color: #3c3c3c;
            color: #cccccc;
            border: 1px solid #3c3c3c;
            border-radius: 2px;
            font-size: 14px;
            font-family: inherit;
        }
        .form-input:focus {
            outline: none;
            border-color: #0078d4;
        }
        .form-textarea {
            width: 100%;
            padding: 8px 12px;
            background-color: #3c3c3c;
            color: #cccccc;
            border: 1px solid #3c3c3c;
            border-radius: 2px;
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
            min-height: 80px;
        }
        .form-textarea:focus {
            outline: none;
            border-color: #0078d4;
        }
        .form-checkbox {
            margin-right: 8px;
        }
        .form-actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }
        .btn-primary {
            background-color: #0078d4;
            color: #ffffff;
        }
        .btn-primary:hover {
            background-color: #106ebe;
        }
        .btn-secondary {
            background-color: #3c3c3c;
            color: #cccccc;
        }
        .btn-secondary:hover {
            background-color: #4c4c4c;
        }
        @media (max-width: 900px) {
            .overview-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">${conn.name}</div>
        <div class="subtitle">Service Connection ID: ${conn.id}</div>
        <button id="edit-button" class="edit-button" onclick="openEditMode()">Edit</button>
    </div>

    <div class="tabs">
        <div class="tab active" onclick="switchTab('overview')">Overview</div>
        <div class="tab" onclick="switchTab('usage')">Usage history</div>
    </div>

    <div class="content">
        <!-- Overview Tab -->
        <div id="overview" class="tab-content active">
            <div id="view-mode">
                <div class="overview-grid">
                    <div class="card">
                        <div class="card-title">Details</div>
                        <div class="field">
                            <div class="field-label">Service connection type</div>
                            <div class="field-value">${conn.type}</div>
                            <div class="field-subtext">using ${conn.authorization?.scheme || 'standard authentication'}</div>
                        </div>
                        <div class="field">
                            <div class="field-label">URL</div>
                            <div class="field-value">${conn.url}</div>
                        </div>
                        ${conn.description ? `
                        <div class="field">
                            <div class="field-label">Description</div>
                            <div class="field-value">${conn.description}</div>
                        </div>
                        ` : ''}
                        <div class="action-links">
                            <a class="action-link" href="#" onclick="manageRoles(); return false;">Manage service connection roles</a>
                            <a class="action-link" href="#" onclick="manageApp(); return false;">Manage App registration</a>
                        </div>
                    </div>

                    <div class="card creator-section">
                        <div class="creator-label">Creator</div>
                        <div class="creator-content">
                            <div class="avatar">${creatorInitials}</div>
                            <div class="creator-info">
                                <div class="creator-name">${creatorName}</div>
                                <div class="creator-email">${creatorEmail}</div>
                            </div>
                        </div>
                    </div>
                </div>

                ${conn.authorization?.scheme === 'ServicePrincipal' || conn.type === 'azurerm' ? `
                <div class="card full-width-card">
                    <div class="card-title">Workload Identity federation details</div>
                    <div class="field">
                        <div class="field-label">Issuer</div>
                        <div class="copy-field">
                            <div class="copy-text">${conn.data?.environment ? `https://login.microsoftonline.com/${conn.data.tenantid || conn.authorization?.parameters?.tenantid}/v2.0` : conn.url}</div>
                            <div class="copy-icon" onclick="copyToClipboard(event, '${conn.data?.environment ? `https://login.microsoftonline.com/${conn.data.tenantid || conn.authorization?.parameters?.tenantid}/v2.0` : conn.url}')"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 4v1H3V3h8v2h-1V4H4zm8 4V7h1v8H5v-2h1v1h6V8z"/><path d="M11 1H2v10h9V1zM3 10V2h7v8H3z"/></svg></div>
                        </div>
                    </div>
                    <div class="field">
                        <div class="field-label">Subject identifier</div>
                        <div class="copy-field">
                            <div class="copy-text">sc://${conn.data?.organizationName || 'organization'}/${conn.data?.projectId || conn.serviceEndpointProjectReferences?.[0]?.projectReference?.id || 'project'}/${conn.id}</div>
                            <div class="copy-icon" onclick="copyToClipboard(event, 'sc://${conn.data?.organizationName || 'organization'}/${conn.data?.projectId || conn.serviceEndpointProjectReferences?.[0]?.projectReference?.id || 'project'}/${conn.id}')"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 4v1H3V3h8v2h-1V4H4zm8 4V7h1v8H5v-2h1v1h6V8z"/><path d="M11 1H2v10h9V1zM3 10V2h7v8H3z"/></svg></div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div id="edit-mode" class="hidden">
                <div class="card">
                    <div class="card-title">Edit Service Connection</div>
                    <div class="form-group">
                        <label class="form-label" for="edit-name">Name *</label>
                        <input type="text" id="edit-name" class="form-input" value="${conn.name}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="edit-url">URL *</label>
                        <input type="text" id="edit-url" class="form-input" value="${conn.url}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="edit-description">Description</label>
                        <textarea id="edit-description" class="form-textarea">${conn.description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <input type="checkbox" id="edit-shared" class="form-checkbox" ${conn.isShared ? 'checked' : ''}>
                        <label for="edit-shared" style="display:inline; font-weight:normal;">Grant access permission to all pipelines</label>
                    </div>
                    <div class="form-actions">
                        <button class="btn btn-primary" onclick="saveEdit()">Save</button>
                        <button class="btn btn-secondary" onclick="cancelEdit()">Cancel</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Usage History Tab -->
        <div id="usage" class="tab-content">
            <div id="usage-loading" class="empty-state">Loading usage history...</div>
            <div id="usage-empty" class="empty-state" style="display:none;">No pipeline has used this service connection yet.</div>
            <div id="usage-table" style="display:none;"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let usageHistoryLoaded = false;

        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            event.target.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(tabName).classList.add('active');

            const editButton = document.getElementById('edit-button');
            if (tabName === 'overview') {
                editButton.classList.remove('hidden');
            } else {
                editButton.classList.add('hidden');
            }

            if (tabName === 'usage' && !usageHistoryLoaded) {
                vscode.postMessage({ command: 'loadUsageHistory' });
                usageHistoryLoaded = true;
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'saved':
                    cancelEdit();
                    vscode.postMessage({ command: 'refreshTree' });
                    break;
                case 'error':
                    alert('Error: ' + message.message);
                    break;
                case 'usageHistoryLoaded':
                    displayUsageHistory(message.data);
                    break;
                case 'usageHistoryError':
                    document.getElementById('usage-loading').style.display = 'none';
                    document.getElementById('usage-empty').textContent = 'Error loading usage history: ' + message.message;
                    document.getElementById('usage-empty').style.display = 'block';
                    break;
            }
        });

        function displayUsageHistory(records) {
            document.getElementById('usage-loading').style.display = 'none';
            
            if (!records || records.length === 0) {
                document.getElementById('usage-empty').style.display = 'block';
                return;
            }

            const table = document.getElementById('usage-table');
            table.style.display = 'block';
            
            const tableHTML = '<table style="width:100%; border-collapse: collapse; color: #cccccc;">' +
                '<thead><tr style="border-bottom: 1px solid #3c3c3c;">' +
                '<th style="text-align:left; padding:12px; font-size:12px; color:#8c8c8c; text-transform:uppercase;">Pipeline</th>' +
                '<th style="text-align:left; padding:12px; font-size:12px; color:#8c8c8c; text-transform:uppercase;">Build</th>' +
                '<th style="text-align:left; padding:12px; font-size:12px; color:#8c8c8c; text-transform:uppercase;">Result</th>' +
                '<th style="text-align:left; padding:12px; font-size:12px; color:#8c8c8c; text-transform:uppercase;">Date</th>' +
                '</tr></thead><tbody>' +
                records.map(record => {
                    const data = record.data || {};
                    const pipelineName = data.definition?.name || data.planType || 'Unknown';
                    const buildName = data.owner?.name || data.ownerDetails || 'N/A';
                    const buildId = data.owner?.id;
                    const result = data.result || 'N/A';
                    const dateStr = data.finishTime ? new Date(data.finishTime).toLocaleString() : 'N/A';
                    
                    const buildLink = buildId ? 
                        '<a href="#" onclick="openBuildRun(' + buildId + '); return false;" style="color:#3794ff; text-decoration:none;">' + buildName + '</a>' :
                        buildName;
                    
                    return '<tr style="border-bottom: 1px solid #3c3c3c;">' +
                        '<td style="padding:12px; font-size:14px;">' + pipelineName + '</td>' +
                        '<td style="padding:12px; font-size:14px;">' + buildLink + '</td>' +
                        '<td style="padding:12px; font-size:14px;">' + result + '</td>' +
                        '<td style="padding:12px; font-size:14px;">' + dateStr + '</td>' +
                        '</tr>';
                }).join('') +
                '</tbody></table>';
            
            table.innerHTML = tableHTML;
        }

        function copyToClipboard(event, text) {
            navigator.clipboard.writeText(text).then(() => {
                const icon = event.currentTarget;
                icon.innerHTML = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 3L6 11l-4-4 1-1 3 3 7-7z"/></svg>';
                setTimeout(() => {
                    icon.innerHTML = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 4v1H3V3h8v2h-1V4H4zm8 4V7h1v8H5v-2h1v1h6V8z"/><path d="M11 1H2v10h9V1zM3 10V2h7v8H3z"/></svg>';
                }, 1000);
            });
        }

        function openEditMode() {
            document.getElementById('view-mode').classList.add('hidden');
            document.getElementById('edit-mode').classList.remove('hidden');
            document.getElementById('edit-button').classList.add('hidden');
        }

        function cancelEdit() {
            document.getElementById('edit-mode').classList.add('hidden');
            document.getElementById('view-mode').classList.remove('hidden');
            document.getElementById('edit-button').classList.remove('hidden');
        }

        function saveEdit() {
            const name = document.getElementById('edit-name').value;
            const url = document.getElementById('edit-url').value;
            const description = document.getElementById('edit-description').value;
            const isShared = document.getElementById('edit-shared').checked;

            if (!name || !url) {
                alert('Name and URL are required');
                return;
            }

            vscode.postMessage({
                command: 'save',
                data: { name, url, description, isShared }
            });
        }

        function manageRoles() {
            vscode.postMessage({ command: 'manageRoles' });
        }

        function manageApp() {
            vscode.postMessage({ command: 'manageApp' });
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        ServiceConnectionPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
