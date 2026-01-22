import * as vscode from 'vscode';
import { AzureDevOpsClient } from '../api/azureDevOpsClient';

export class LiveLogPanel {
    private static panels: Map<number, LiveLogPanel> = new Map();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private refreshInterval?: NodeJS.Timeout;
    private logContent: string = '';
    private lastLogId: number = 0;

    private constructor(
        panel: vscode.WebviewPanel,
        private client: AzureDevOpsClient,
        private runId: number,
        private logId: number
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        
        this.startStreaming();

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'refresh':
                        await this.fetchLogs();
                        break;
                    case 'stop':
                        this.stopStreaming();
                        break;
                    case 'start':
                        this.startStreaming();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static async show(client: AzureDevOpsClient, runId: number, logId: number, logName: string) {
        const key = runId * 1000 + logId;
        
        if (LiveLogPanel.panels.has(key)) {
            LiveLogPanel.panels.get(key)!.panel.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'liveLog',
            `Log: ${logName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const liveLogPanel = new LiveLogPanel(panel, client, runId, logId);
        LiveLogPanel.panels.set(key, liveLogPanel);
    }

    private async startStreaming() {
        await this.fetchLogs();
        
        this.refreshInterval = setInterval(async () => {
            await this.fetchLogs();
        }, 2000);
    }

    private stopStreaming() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
    }

    private async fetchLogs() {
        try {
            const content = await this.client.getLogContent(this.runId, this.logId);
            
            if (content !== this.logContent) {
                this.logContent = content;
                this.updateView();
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        }
    }

    private updateView() {
        const lines = this.logContent.split('\n');
        const isStreaming = !!this.refreshInterval;

        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 10px;
        }
        .toolbar {
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 10px;
            align-items: center;
            z-index: 100;
        }
        button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .status {
            margin-left: auto;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .streaming { color: #28a745; }
        .log-container {
            padding: 10px;
            overflow-x: auto;
        }
        .log-line {
            padding: 2px 0;
            white-space: pre;
            font-size: 13px;
            line-height: 1.5;
        }
        .log-line:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .line-number {
            display: inline-block;
            width: 50px;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none;
            text-align: right;
            margin-right: 15px;
        }
        .error { color: #dc3545; }
        .warning { color: #ffa500; }
        .success { color: #28a745; }
        .info { color: #007acc; }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="refresh()">🔄 Refresh</button>
        ${isStreaming 
            ? '<button onclick="stop()">⏸️ Stop Streaming</button>' 
            : '<button onclick="start()">▶️ Start Streaming</button>'}
        <button onclick="scrollToBottom()">⬇️ Scroll to Bottom</button>
        <span class="status ${isStreaming ? 'streaming' : ''}">
            ${isStreaming ? '● Live' : '○ Paused'} | ${lines.length} lines
        </span>
    </div>
    <div class="log-container" id="logContainer">
        ${lines.map((line, i) => this.formatLogLine(line, i + 1)).join('')}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function stop() {
            vscode.postMessage({ command: 'stop' });
        }
        
        function start() {
            vscode.postMessage({ command: 'start' });
        }
        
        function scrollToBottom() {
            window.scrollTo(0, document.body.scrollHeight);
        }
        
        // Auto-scroll if near bottom
        let wasAtBottom = true;
        window.addEventListener('scroll', () => {
            const threshold = 100;
            wasAtBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - threshold);
        });
        
        // Auto-scroll on update if was at bottom
        if (wasAtBottom && ${isStreaming}) {
            scrollToBottom();
        }
    </script>
</body>
</html>`;
    }

    private formatLogLine(line: string, lineNumber: number): string {
        let className = '';
        const lower = line.toLowerCase();
        
        if (lower.includes('error') || lower.includes('failed')) {
            className = 'error';
        } else if (lower.includes('warning') || lower.includes('warn')) {
            className = 'warning';
        } else if (lower.includes('success') || lower.includes('succeeded')) {
            className = 'success';
        } else if (lower.includes('info') || lower.includes('starting')) {
            className = 'info';
        }

        const escaped = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        return `<div class="log-line ${className}"><span class="line-number">${lineNumber}</span>${escaped}</div>`;
    }

    public dispose() {
        const key = this.runId * 1000 + this.logId;
        LiveLogPanel.panels.delete(key);
        
        this.stopStreaming();
        this.panel.dispose();
        
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
