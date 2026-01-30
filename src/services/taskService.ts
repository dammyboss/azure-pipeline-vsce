import { AzureDevOpsClient } from '../api/azureDevOpsClient';
import { TaskDefinition, TaskCategory } from '../models/types';

/**
 * Task Service
 * Manages task definitions with caching and categorization
 */
export class TaskService {
    private taskCache: {
        tasks: TaskDefinition[];
        timestamp: number;
    } | null = null;

    private readonly CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

    constructor(private client: AzureDevOpsClient) {}

    /**
     * Get all available tasks (with caching)
     */
    async getAllTasks(forceRefresh: boolean = false): Promise<TaskDefinition[]> {
        const now = Date.now();

        // Return cached tasks if valid
        if (
            !forceRefresh &&
            this.taskCache &&
            now - this.taskCache.timestamp < this.CACHE_DURATION_MS
        ) {
            return this.taskCache.tasks;
        }

        // Fetch fresh tasks
        const tasks = await this.client.getTaskDefinitions();

        // Add icon URLs to tasks
        const config = this.client.getConfig();
        tasks.forEach(task => {
            // Generate icon URL based on task ID and version
            // Azure DevOps stores task icons at: {org}/_apis/distributedtask/tasks/{taskId}/{version}/icon
            if (config.organizationUrl && task.id && task.version) {
                task.iconUrl = `${config.organizationUrl}/_apis/distributedtask/tasks/${task.id}/${task.version.Major}.${task.version.Minor}.${task.version.Patch}/icon`;
            }
        });

        // Update cache
        this.taskCache = {
            tasks,
            timestamp: now
        };

        return tasks;
    }

    /**
     * Search tasks by name or description
     */
    async searchTasks(query: string): Promise<TaskDefinition[]> {
        const tasks = await this.getAllTasks();
        const lowerQuery = query.toLowerCase();

        return tasks.filter(task =>
            task.friendlyName.toLowerCase().includes(lowerQuery) ||
            task.name.toLowerCase().includes(lowerQuery) ||
            task.description.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Get tasks by category
     */
    async getTasksByCategory(category: TaskCategory): Promise<TaskDefinition[]> {
        const tasks = await this.getAllTasks();
        return tasks.filter(task => task.category === category);
    }

    /**
     * Get all unique categories
     */
    async getCategories(): Promise<TaskCategory[]> {
        const tasks = await this.getAllTasks();
        const categories = new Set<TaskCategory>();

        tasks.forEach(task => {
            if (task.category) {
                categories.add(task.category);
            }
        });

        return Array.from(categories).sort();
    }

    /**
     * Get popular/common tasks
     */
    async getPopularTasks(): Promise<TaskDefinition[]> {
        const commonTaskNames = [
            'CmdLine',
            'PowerShell',
            'Bash',
            'AzureCLI',
            'AzurePowerShell',
            'DotNetCoreCLI',
            'PublishBuildArtifacts',
            'PublishPipelineArtifact',
            'DownloadPipelineArtifact',
            'UseDotNet',
            'NodeTool',
            'NuGetCommand',
            'VSBuild',
            'MSBuild',
            'VSTest'
        ];

        const tasks = await this.getAllTasks();
        return tasks.filter(task => commonTaskNames.includes(task.name));
    }

    /**
     * Get task by ID
     */
    async getTaskById(taskId: string): Promise<TaskDefinition | null> {
        const tasks = await this.getAllTasks();
        return tasks.find(task => task.id === taskId) || null;
    }

    /**
     * Get task by name
     */
    async getTaskByName(name: string): Promise<TaskDefinition | null> {
        const tasks = await this.getAllTasks();
        return tasks.find(task => task.name === name) || null;
    }

    /**
     * Generate YAML snippet for a task
     */
    generateYamlSnippet(
        task: TaskDefinition,
        inputs: Record<string, any> = {}
    ): string {
        const lines: string[] = [];

        // Task line with version
        const version = `${task.version.Major}`;
        lines.push(`- task: ${task.name}@${version}`);

        // Display name (optional but recommended)
        const displayName = inputs.displayName || task.friendlyName;
        lines.push(`  displayName: '${displayName}'`);

        // Inputs
        const inputKeys = Object.keys(inputs).filter(key => key !== 'displayName');
        if (inputKeys.length > 0) {
            lines.push('  inputs:');
            inputKeys.forEach(key => {
                const value = inputs[key];
                // Handle different value types
                if (typeof value === 'boolean') {
                    lines.push(`    ${key}: ${value}`);
                } else if (typeof value === 'number') {
                    lines.push(`    ${key}: ${value}`);
                } else {
                    // String - quote it if it contains special characters
                    const strValue = String(value);
                    const needsQuotes = strValue.includes(':') || strValue.includes('#') || strValue.includes('$(');
                    lines.push(`    ${key}: ${needsQuotes ? `'${strValue}'` : strValue}`);
                }
            });
        }

        return lines.join('\n');
    }

    /**
     * Clear the task cache
     */
    clearCache(): void {
        this.taskCache = null;
    }
}
