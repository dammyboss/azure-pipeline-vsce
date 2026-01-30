import * as vscode from 'vscode';
import { TaskService } from '../services/taskService';
import { TaskDefinition, TaskCategory } from '../models/types';

/**
 * Task Assistant Panel
 * Provides a UI for browsing and inserting pipeline tasks
 */
export class TaskAssistantPanel {
    private static currentPanel: TaskAssistantPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _taskService: TaskService;
    private _disposables: vscode.Disposable[] = [];
    private _onTaskSelected: ((yaml: string) => void) | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        taskService: TaskService
    ) {
        this._panel = panel;
        this._taskService = taskService;

        // Set up webview options
        this._panel.webview.options = {
            enableScripts: true
        };

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'loadTasks':
                        await this.loadTasks();
                        break;
                    case 'loadMoreTasks':
                        await this.loadMoreTasks(message.offset, message.limit);
                        break;
                    case 'searchTasks':
                        await this.searchTasks(message.query);
                        break;
                    case 'filterByCategory':
                        await this.filterByCategory(message.category);
                        break;
                    case 'getTaskDetails':
                        await this.getTaskDetails(message.taskId);
                        break;
                    case 'generateYaml':
                        await this.generateYaml(message.taskId, message.inputs);
                        break;
                    case 'insertTask':
                        await this.insertTask(message.yaml);
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
        this.updateWebview();
    }

    /**
     * Show the task assistant panel
     */
    static show(taskService: TaskService, initialTaskData?: any): TaskAssistantPanel {
        const column = vscode.ViewColumn.Two;

        // Reuse existing panel if available
        if (TaskAssistantPanel.currentPanel) {
            TaskAssistantPanel.currentPanel._panel.reveal(column);

            // If initial task data is provided, configure the task
            if (initialTaskData) {
                TaskAssistantPanel.currentPanel.configureTaskFromYaml(initialTaskData);
            }

            return TaskAssistantPanel.currentPanel;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'taskAssistant',
            'Task Assistant',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        TaskAssistantPanel.currentPanel = new TaskAssistantPanel(panel, taskService);

        // If initial task data is provided, configure the task
        if (initialTaskData) {
            TaskAssistantPanel.currentPanel.configureTaskFromYaml(initialTaskData);
        }

        return TaskAssistantPanel.currentPanel;
    }

    /**
     * Set callback for when a task is selected
     */
    onTaskSelected(callback: (yaml: string) => void): void {
        this._onTaskSelected = callback;
    }

    /**
     * Configure a task from YAML data (from CodeLens)
     */
    private async configureTaskFromYaml(taskData: any): Promise<void> {
        try {
            // Find the task by name
            const task = await this._taskService.getTaskByName(taskData.taskName);

            if (!task) {
                vscode.window.showErrorMessage(`Task not found: ${taskData.taskName}`);
                return;
            }

            // Send message to webview to open task details with pre-filled inputs
            this._panel.webview.postMessage({
                command: 'configureTask',
                task: task,
                inputs: taskData.inputs,
                displayName: taskData.displayName
            });
        } catch (error) {
            console.error('Configure task from YAML error:', error);
        }
    }

    /**
     * Load initial tasks (first batch)
     */
    private async loadTasks(): Promise<void> {
        try {
            // Fetch all task definitions (fast - no icons yet)
            const allTasks = await this._taskService.getAllTasks();

            // Get initial batch
            const initialBatch = allTasks.slice(0, 50);
            const hasMore = allTasks.length > 50;

            // Get categories and popular tasks
            const categories = await this._taskService.getCategories();
            const popularTasks = await this._taskService.getPopularTasks();

            // Load icons for popular tasks (small set)
            await this._taskService.loadIconsForTasks(popularTasks);

            // Send initial batch WITHOUT icons first (fast)
            this._panel.webview.postMessage({
                command: 'tasksLoaded',
                tasks: this.simplifyTasks(initialBatch),
                totalCount: allTasks.length,
                hasMore,
                categories,
                popularTasks: this.simplifyTasks(popularTasks)
            });

            // Load icons for initial batch in background
            await this._taskService.loadIconsForTasks(initialBatch);

            // Update webview with icons
            this._panel.webview.postMessage({
                command: 'updateTaskIcons',
                tasks: this.simplifyTasks(initialBatch)
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load tasks: ${errorMessage}`);
            this._panel.webview.postMessage({
                command: 'loadError',
                message: errorMessage
            });
        }
    }

    /**
     * Load more tasks (for pagination)
     */
    private async loadMoreTasks(offset: number, limit: number): Promise<void> {
        try {
            // Get cached tasks
            const allTasks = await this._taskService.getAllTasks();

            // Get the requested batch
            const batch = allTasks.slice(offset, offset + limit);
            const hasMore = offset + limit < allTasks.length;

            // Send tasks without icons first
            this._panel.webview.postMessage({
                command: 'moreTasks',
                tasks: this.simplifyTasks(batch),
                hasMore
            });

            // Load icons in background
            await this._taskService.loadIconsForTasks(batch);

            // Update with icons
            this._panel.webview.postMessage({
                command: 'updateTaskIcons',
                tasks: this.simplifyTasks(batch)
            });
        } catch (error) {
            console.error('Load more tasks error:', error);
            this._panel.webview.postMessage({
                command: 'loadMoreError',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Search tasks by query
     */
    private async searchTasks(query: string): Promise<void> {
        try {
            const tasks = await this._taskService.searchTasks(query);
            this._panel.webview.postMessage({
                command: 'searchResults',
                tasks: this.simplifyTasks(tasks)
            });
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    /**
     * Filter tasks by category
     */
    private async filterByCategory(category: TaskCategory | 'all'): Promise<void> {
        try {
            let tasks: TaskDefinition[];
            if (category === 'all') {
                tasks = await this._taskService.getAllTasks();
            } else {
                tasks = await this._taskService.getTasksByCategory(category);
            }

            this._panel.webview.postMessage({
                command: 'categoryResults',
                tasks: this.simplifyTasks(tasks),
                category
            });
        } catch (error) {
            console.error('Filter error:', error);
        }
    }

    /**
     * Get detailed task information
     */
    private async getTaskDetails(taskId: string): Promise<void> {
        try {
            const task = await this._taskService.getTaskById(taskId);
            if (task) {
                this._panel.webview.postMessage({
                    command: 'taskDetails',
                    task: task
                });
            }
        } catch (error) {
            console.error('Get task details error:', error);
        }
    }

    /**
     * Generate YAML snippet for a task
     */
    private async generateYaml(taskId: string, inputs: Record<string, any>): Promise<void> {
        try {
            const task = await this._taskService.getTaskById(taskId);
            if (task) {
                const yaml = this._taskService.generateYamlSnippet(task, inputs);
                this._panel.webview.postMessage({
                    command: 'yamlGenerated',
                    yaml
                });
            }
        } catch (error) {
            console.error('Generate YAML error:', error);
        }
    }

    /**
     * Insert task into editor
     */
    private async insertTask(yaml: string): Promise<void> {
        if (this._onTaskSelected) {
            this._onTaskSelected(yaml);
            return;
        }

        // Try to insert into active YAML editor
        const editor = vscode.window.activeTextEditor;
        if (editor && (editor.document.languageId === 'yaml' || editor.document.fileName.endsWith('.yml'))) {
            const position = editor.selection.active;
            await editor.edit(editBuilder => {
                editBuilder.insert(position, yaml + '\n');
            });
            vscode.window.showInformationMessage('Task added to pipeline');
        } else {
            // Fallback: copy to clipboard
            await vscode.env.clipboard.writeText(yaml);
            vscode.window.showInformationMessage('Task YAML copied to clipboard (no active YAML editor found)');
        }
    }

    /**
     * Simplify task objects for webview (reduce data size)
     */
    private simplifyTasks(tasks: TaskDefinition[], includeIcons: boolean = true): any[] {
        return tasks.map(task => ({
            id: task.id,
            name: task.name,
            friendlyName: task.friendlyName,
            description: task.description,
            category: task.category,
            author: task.author,
            version: task.version,
            deprecated: task.deprecated,
            preview: task.preview,
            // Only include icon URL if it's a data URL (to avoid failed loads in webview)
            iconUrl: includeIcons && task.iconUrl?.startsWith('data:') ? task.iconUrl : undefined
        }));
    }

    /**
     * Update webview HTML content
     */
    private updateWebview(): void {
        this._panel.webview.html = this.getWebviewContent();
    }

    /**
     * Get webview HTML content
     */
    private getWebviewContent(): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        img-src ${this._panel.webview.cspSource} https://*.visualstudio.com https://*.azure.com https://dev.azure.com data:;
        style-src ${this._panel.webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
    ">
    <title>Task Assistant</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
        }

        .header {
            margin-bottom: 16px;
        }

        h2 {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }

        .search-box {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }

        input[type="text"] {
            flex: 1;
            padding: 6px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 13px;
        }

        input[type="text"]:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        select {
            padding: 6px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 2px;
            font-size: 13px;
        }

        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .tab {
            padding: 8px 16px;
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 13px;
            border-bottom: 2px solid transparent;
        }

        .tab:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tab.active {
            border-bottom-color: var(--vscode-focusBorder);
            color: var(--vscode-focusBorder);
        }

        .task-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .task-item {
            display: flex;
            gap: 12px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .task-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .task-icon {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
            border-radius: 4px;
            background: var(--vscode-editor-background);
            object-fit: contain;
        }

        .task-icon-placeholder {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
            border-radius: 4px;
            background: var(--vscode-button-background);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-button-foreground);
            font-size: 16px;
            font-weight: 600;
        }

        .task-content {
            flex: 1;
            min-width: 0;
        }

        .task-name {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .task-badge {
            padding: 2px 6px;
            font-size: 10px;
            border-radius: 3px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .task-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }

        .task-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .task-details {
            position: fixed;
            top: 0;
            right: -400px;
            width: 400px;
            height: 100%;
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            padding: 16px;
            overflow-y: auto;
            transition: right 0.3s;
            z-index: 1000;
        }

        .task-details.open {
            right: 0;
        }

        .close-btn {
            float: right;
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 20px;
            padding: 0;
            width: 24px;
            height: 24px;
        }

        .close-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .form-group {
            margin-bottom: 16px;
        }

        label {
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 500;
        }

        .required {
            color: var(--vscode-errorForeground);
        }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .help-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Task Assistant</h2>
        <div class="search-box">
            <input type="text" id="searchInput" placeholder="Search tasks..." />
            <select id="categoryFilter">
                <option value="all">All Categories</option>
            </select>
        </div>
    </div>

    <div class="tabs">
        <button class="tab active" data-tab="all">All Tasks</button>
        <button class="tab" data-tab="popular">Popular</button>
    </div>

    <div class="task-list" id="taskList">
        <div class="loading">Loading tasks...</div>
    </div>

    <div class="task-details" id="taskDetails">
        <!-- Task details and configuration form will be rendered here -->
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        let allTasks = [];
        let displayedTasks = [];
        let popularTasks = [];
        let currentTab = 'all';
        let selectedTask = null;
        let isLoading = false;
        let hasMore = false;
        let totalCount = 0;
        let observer = null;

        // Load tasks on startup
        vscode.postMessage({ command: 'loadTasks' });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'tasksLoaded':
                    allTasks = message.tasks;
                    displayedTasks = message.tasks;
                    popularTasks = message.popularTasks;
                    totalCount = message.totalCount;
                    hasMore = message.hasMore;
                    populateCategoryFilter(message.categories);
                    renderTasks(currentTab === 'all' ? displayedTasks : popularTasks);
                    if (hasMore && currentTab === 'all') {
                        setupIntersectionObserver();
                    }
                    break;
                case 'moreTasks':
                    isLoading = false;
                    if (message.tasks.length > 0) {
                        displayedTasks = displayedTasks.concat(message.tasks);
                        appendTasks(message.tasks);
                        hasMore = message.hasMore;
                        if (!hasMore) {
                            removeLoadingSentinel();
                        }
                    }
                    break;
                case 'updateTaskIcons':
                    // Update icons for tasks that have already been rendered
                    updateTaskIcons(message.tasks);
                    break;
                case 'searchResults':
                    hasMore = false;
                    if (observer) {
                        observer.disconnect();
                    }
                    renderTasks(message.tasks);
                    break;
                case 'categoryResults':
                    hasMore = false;
                    if (observer) {
                        observer.disconnect();
                    }
                    renderTasks(message.tasks);
                    break;
                case 'taskDetails':
                    showTaskDetails(message.task);
                    break;
                case 'yamlGenerated':
                    insertYaml(message.yaml);
                    break;
                case 'loadError':
                    document.getElementById('taskList').innerHTML =
                        '<div class="empty-state">Failed to load tasks: ' + message.message + '</div>';
                    break;
                case 'loadMoreError':
                    isLoading = false;
                    console.error('Failed to load more tasks:', message.message);
                    break;
                case 'configureTask':
                    // Open task details with pre-filled inputs
                    showTaskDetails(message.task, message.inputs, message.displayName);
                    break;
            }
        });

        // Search input
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length > 0) {
                vscode.postMessage({ command: 'searchTasks', query });
            } else {
                // Reset to displayed tasks (with lazy loading)
                if (currentTab === 'all') {
                    renderTasks(displayedTasks);
                    if (hasMore) {
                        setupIntersectionObserver();
                    }
                } else {
                    renderTasks(popularTasks);
                }
            }
        });

        // Category filter
        document.getElementById('categoryFilter').addEventListener('change', (e) => {
            const category = e.target.value;
            vscode.postMessage({ command: 'filterByCategory', category });
        });

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentTab = tab.dataset.tab;
                if (currentTab === 'all') {
                    renderTasks(displayedTasks);
                    if (hasMore) {
                        setupIntersectionObserver();
                    }
                } else {
                    renderTasks(popularTasks);
                    if (observer) {
                        observer.disconnect();
                    }
                }
            });
        });

        function populateCategoryFilter(categories) {
            const filter = document.getElementById('categoryFilter');
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                option.textContent = cat;
                filter.appendChild(option);
            });
        }

        function renderTasks(tasks) {
            const container = document.getElementById('taskList');

            if (!tasks || tasks.length === 0) {
                container.innerHTML = '<div class="empty-state">No tasks found</div>';
                return;
            }

            container.innerHTML = tasks.map(task => createTaskItemHTML(task)).join('');

            // Add sentinel for lazy loading
            if (hasMore && currentTab === 'all') {
                const sentinel = document.createElement('div');
                sentinel.id = 'taskListSentinel';
                sentinel.className = 'loading';
                sentinel.textContent = 'Loading more tasks...';
                container.appendChild(sentinel);
            }

            // Add click handlers
            attachTaskClickHandlers(container);
        }

        function appendTasks(tasks) {
            const container = document.getElementById('taskList');
            const sentinel = document.getElementById('taskListSentinel');

            tasks.forEach(task => {
                const taskElement = document.createElement('div');
                taskElement.innerHTML = createTaskItemHTML(task);
                const taskItem = taskElement.firstElementChild;

                if (sentinel) {
                    container.insertBefore(taskItem, sentinel);
                } else {
                    container.appendChild(taskItem);
                }
            });

            // Add click handlers to new tasks
            attachTaskClickHandlers(container);
        }

        function createTaskItemHTML(task) {
            return \`
                <div class="task-item" data-task-id="\${task.id}">
                    \${task.iconUrl ?
                        \`<img src="\${task.iconUrl}" class="task-icon" alt="\${task.friendlyName} icon" data-fallback-text="\${task.friendlyName.charAt(0).toUpperCase()}" /><div class="task-icon-placeholder" style="display:none;">\${task.friendlyName.charAt(0).toUpperCase()}</div>\` :
                        \`<div class="task-icon-placeholder">\${task.friendlyName.charAt(0).toUpperCase()}</div>\`
                    }
                    <div class="task-content">
                        <div class="task-name">
                            \${task.friendlyName}
                            \${task.deprecated ? '<span class="task-badge">Deprecated</span>' : ''}
                            \${task.preview ? '<span class="task-badge">Preview</span>' : ''}
                        </div>
                        <div class="task-description">\${task.description}</div>
                        <div class="task-meta">
                            \${task.category} • \${task.author} • v\${task.version.Major}.\${task.version.Minor}.\${task.version.Patch}
                        </div>
                    </div>
                </div>
            \`;
        }

        function attachTaskClickHandlers(container) {
            container.querySelectorAll('.task-item').forEach(item => {
                if (!item.hasAttribute('data-handler-attached')) {
                    item.setAttribute('data-handler-attached', 'true');
                    item.addEventListener('click', () => {
                        const taskId = item.dataset.taskId;
                        vscode.postMessage({ command: 'getTaskDetails', taskId });
                    });
                }

                // Attach error handler for task icons
                const iconImg = item.querySelector('.task-icon');
                if (iconImg && !iconImg.hasAttribute('data-error-handler-attached')) {
                    iconImg.setAttribute('data-error-handler-attached', 'true');
                    iconImg.addEventListener('error', function() {
                        this.style.display = 'none';
                        const placeholder = this.nextElementSibling;
                        if (placeholder && placeholder.classList.contains('task-icon-placeholder')) {
                            placeholder.style.display = 'flex';
                        }
                    });
                }
            });
        }

        function setupIntersectionObserver() {
            if (observer) {
                observer.disconnect();
            }

            const sentinel = document.getElementById('taskListSentinel');
            if (!sentinel) return;

            observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !isLoading && hasMore) {
                        isLoading = true;
                        const offset = displayedTasks.length;
                        vscode.postMessage({
                            command: 'loadMoreTasks',
                            offset: offset,
                            limit: 50
                        });
                    }
                });
            }, {
                root: null,
                rootMargin: '100px',
                threshold: 0.1
            });

            observer.observe(sentinel);
        }

        function removeLoadingSentinel() {
            const sentinel = document.getElementById('taskListSentinel');
            if (sentinel) {
                sentinel.remove();
            }
            if (observer) {
                observer.disconnect();
            }
        }

        function updateTaskIcons(tasks) {
            tasks.forEach(task => {
                if (!task.iconUrl) return;

                // Find the task item in the DOM
                const taskItem = document.querySelector(\`[data-task-id="\${task.id}"]\`);
                if (!taskItem) return;

                // Find the icon element
                const iconImg = taskItem.querySelector('.task-icon');
                const iconPlaceholder = taskItem.querySelector('.task-icon-placeholder');

                if (task.iconUrl.startsWith('data:')) {
                    // Has a data URL icon
                    if (iconImg) {
                        iconImg.src = task.iconUrl;
                        iconImg.style.display = '';
                        if (iconPlaceholder) {
                            iconPlaceholder.style.display = 'none';
                        }
                    } else if (iconPlaceholder) {
                        // Create new img element
                        const newImg = document.createElement('img');
                        newImg.src = task.iconUrl;
                        newImg.className = 'task-icon';
                        newImg.alt = task.friendlyName + ' icon';

                        // Add error handler
                        newImg.addEventListener('error', function() {
                            this.style.display = 'none';
                            if (iconPlaceholder) {
                                iconPlaceholder.style.display = 'flex';
                            }
                        });

                        taskItem.insertBefore(newImg, iconPlaceholder);
                        iconPlaceholder.style.display = 'none';
                    }
                }
            });
        }

        function showTaskDetails(task, prefilledInputs = {}, prefilledDisplayName = '') {
            selectedTask = task;
            const container = document.getElementById('taskDetails');
            container.classList.add('open');

            let html = \`
                <button class="close-btn" id="closeTaskDetailsBtn">&times;</button>
                <h2>\${task.friendlyName}</h2>
                <p style="margin: 12px 0; font-size: 13px; color: var(--vscode-descriptionForeground);">
                    \${task.description}
                </p>
                <div style="margin: 16px 0; padding: 12px; background: var(--vscode-editor-background); border-radius: 4px;">
                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                        <div>Task: \${task.name}@\${task.version.Major}</div>
                        <div>Category: \${task.category}</div>
                        <div>Author: \${task.author}</div>
                    </div>
                </div>
                <h3 style="margin-top: 20px; margin-bottom: 12px; font-size: 14px;">Configure Task</h3>
                <form id="taskForm">
            \`;

            // Add displayName input
            html += \`
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text"
                           name="displayName"
                           value="\${prefilledDisplayName || task.friendlyName}"
                           style="width: 100%;" />
                </div>
            \`;

            // Add form inputs based on task inputs
            if (task.inputs && task.inputs.length > 0) {
                task.inputs.forEach(input => {
                    // Get pre-filled value or default value
                    const inputValue = prefilledInputs[input.name] !== undefined ? prefilledInputs[input.name] : input.defaultValue;

                    html += \`
                        <div class="form-group">
                            <label>
                                \${input.label}
                                \${input.required ? '<span class="required">*</span>' : ''}
                            </label>
                    \`;

                    if (input.type === 'boolean') {
                        const isChecked = inputValue === true || inputValue === 'true';
                        html += \`
                            <input type="checkbox"
                                   name="\${input.name}"
                                   \${isChecked ? 'checked' : ''} />
                        \`;
                    } else if (input.type === 'pickList' && input.options) {
                        html += \`<select name="\${input.name}">\`;
                        Object.entries(input.options).forEach(([key, value]) => {
                            const isSelected = inputValue === key;
                            html += \`<option value="\${key}" \${isSelected ? 'selected' : ''}>\${value}</option>\`;
                        });
                        html += \`</select>\`;
                    } else if (input.type === 'multiLine') {
                        html += \`
                            <textarea name="\${input.name}"
                                      rows="4"
                                      style="width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px;">\${inputValue || ''}</textarea>
                        \`;
                    } else {
                        html += \`
                            <input type="text"
                                   name="\${input.name}"
                                   value="\${inputValue || ''}"
                                   \${input.required ? 'required' : ''}
                                   style="width: 100%;" />
                        \`;
                    }

                    if (input.helpMarkDown) {
                        html += \`<div class="help-text">\${input.helpMarkDown}</div>\`;
                    }

                    html += \`</div>\`;
                });
            }

            html += \`
                    <button type="submit" style="width: 100%; margin-top: 16px;">Add to Pipeline</button>
                </form>
            \`;

            container.innerHTML = html;

            // Add close button handler
            const closeBtn = document.getElementById('closeTaskDetailsBtn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    document.getElementById('taskDetails').classList.remove('open');
                });
            }

            // Add form submit handler
            document.getElementById('taskForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const inputs = {};
                for (const [key, value] of formData.entries()) {
                    inputs[key] = value;
                }
                vscode.postMessage({
                    command: 'generateYaml',
                    taskId: task.id,
                    inputs
                });
            });
        }

        function insertYaml(yaml) {
            vscode.postMessage({ command: 'insertTask', yaml });
            closeTaskDetails();
        }
    </script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Dispose of the panel
     */
    dispose(): void {
        TaskAssistantPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
