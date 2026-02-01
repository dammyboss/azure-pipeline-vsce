import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { AzureDevOpsAuthProvider } from '../authentication/authProvider';
import {
    Pipeline,
    PipelineRun,
    Organization,
    Project,
    Branch,
    BuildLog,
    Artifact,
    Timeline,
    Environment,
    Variable,
    VariableGroup,
    ServiceEndpoint,
    AgentPool,
    Agent,
    PipelineRunOptions,
    RuntimeParameter,
    TaskDefinition,
    InstalledExtension
} from '../models/types';

/**
 * Azure DevOps API Client
 * Handles all interactions with Azure DevOps REST API
 */
export class AzureDevOpsClient {
    private axiosInstance: AxiosInstance;
    private organizationUrl: string = '';
    private projectName: string = '';

    constructor(private authProvider: AzureDevOpsAuthProvider) {
        this.axiosInstance = axios.create({
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000 // 30 second timeout to prevent indefinite hangs
        });

        // Add request interceptor to inject auth token
        this.axiosInstance.interceptors.request.use(
            async (config) => {
                const token = await this.authProvider.getAccessToken();
                config.headers.Authorization = `Bearer ${token}`;
                return config;
            },
            (error) => Promise.reject(error)
        );

        // Add response interceptor for error handling
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                this.handleError(error);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Initialize client with organization and project
     */
    async initialize(organizationUrl: string, projectName: string): Promise<void> {
        this.organizationUrl = organizationUrl;
        this.projectName = projectName;
    }

    /**
     * Get configured organization and project
     */
    getConfig(): { organizationUrl: string; projectName: string } {
        return {
            organizationUrl: this.organizationUrl,
            projectName: this.projectName
        };
    }

    /**
     * Handle API errors
     */
    private handleError(error: AxiosError): void {
        if (error.response) {
            const status = error.response.status;
            const message = (error.response.data as any)?.message || error.message;
            const url = error.config?.url || '';

            // Don't show notifications for 404s - they're often expected (no timeline, no logs, etc.)
            if (status === 404) {
                return;
            }

            // Don't show auth errors for organization discovery endpoints - those are expected to fail
            // during auto-discovery attempts
            if (status === 401 && (
                url.includes('app.vssps.visualstudio.com') ||
                url.includes('management.azure.com')
            )) {
                return;
            }

            switch (status) {
                case 401:
                    vscode.window.showErrorMessage('Authentication failed. Please sign in again.');
                    break;
                case 403:
                    vscode.window.showErrorMessage('Access denied. Check your permissions.');
                    break;
                default:
                    vscode.window.showErrorMessage(`Azure DevOps API error: ${message}`);
            }
        } else if (error.request) {
            vscode.window.showErrorMessage('Network error. Please check your connection.');
        } else {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    }

    // ==================== Organizations & Projects ====================

    /**
     * Get connection data (user info and accessible resources)
     * This is useful for verifying authentication and getting user details
     */
    async getConnectionData(): Promise<any> {
        const response = await this.axiosInstance.get(
            'https://app.vssps.visualstudio.com/_apis/connectionData',
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data;
    }

    /**
     * Get current authenticated user profile
     */
    async getCurrentUserProfile(): Promise<{ displayName: string; emailAddress: string; id: string }> {
        const response = await this.axiosInstance.get(
            'https://app.vssps.visualstudio.com/_apis/profile/profiles/me',
            { params: { 'api-version': '7.1' } }
        );
        return {
            displayName: response.data.displayName || response.data.coreAttributes?.DisplayName?.value || 'Unknown',
            emailAddress: response.data.emailAddress || response.data.coreAttributes?.EmailAddress?.value || response.data.coreAttributes?.PublicAlias?.value || 'unknown@example.com',
            id: response.data.id
        };
    }

    /**
     * Get all organizations for the authenticated user
     * Uses the profile and resource areas to discover accessible organizations
     */
    async getOrganizations(): Promise<Organization[]> {
        try {
            const profileResponse = await this.axiosInstance.get(
                'https://app.vssps.visualstudio.com/_apis/profile/profiles/me',
                {
                    params: {
                        'api-version': '7.1'
                    }
                }
            );

            const memberId = profileResponse.data.id;

            const accountsResponse = await this.axiosInstance.get(
                'https://app.vssps.visualstudio.com/_apis/accounts',
                {
                    params: {
                        'memberId': memberId,
                        'api-version': '7.1'
                    }
                }
            );

            if (accountsResponse.data && accountsResponse.data.count > 0) {
                const organizations = accountsResponse.data.value.map((account: any) => {
                    let accountUri = account.accountUri || '';

                    if (accountUri) {
                        accountUri = accountUri.replace('vssps.dev.azure.com', 'dev.azure.com');
                        accountUri = accountUri.replace('.vssps.visualstudio.com', '.visualstudio.com');
                        accountUri = accountUri.replace(/\/+$/, '');
                    }

                    if (!accountUri || !accountUri.startsWith('http')) {
                        accountUri = `https://dev.azure.com/${account.accountName}`;
                    }

                    return {
                        accountId: account.accountId,
                        accountName: account.accountName,
                        accountUri: accountUri
                    };
                });

                return organizations;
            }

            throw new Error('No Azure DevOps organizations found for your account.');

        } catch (error: any) {
            throw new Error(`Unable to discover organizations: ${error.message}`);
        }
    }

    /**
     * Get all projects in an organization
     */
    async getProjects(organizationUrl: string): Promise<Project[]> {
        if (!organizationUrl || typeof organizationUrl !== 'string') {
            throw new Error(`Invalid organization URL: ${organizationUrl}`);
        }

        let cleanUrl = organizationUrl.trim().replace(/\/+$/, '');

        if (!cleanUrl.includes('dev.azure.com') && !cleanUrl.includes('visualstudio.com')) {
            cleanUrl = `https://dev.azure.com/${cleanUrl}`;
        }

        const projectsUrl = `${cleanUrl}/_apis/projects`;

        try {
            const response = await this.axiosInstance.get(
                projectsUrl,
                { params: { 'api-version': '7.1' } }
            );

            return response.data.value || [];
        } catch (error: any) {
            if (error.response?.status === 401) {
                throw new Error(`Authentication failed. Your access token may have expired.`);
            } else if (error.response?.status === 404) {
                throw new Error(`Organization not found. Please verify the organization name.`);
            } else {
                throw new Error(`Failed to access organization: ${error.message}`);
            }
        }
    }

    // ==================== Pipelines ====================

    /**
     * Get all pipelines in a project
     */
    async getPipelines(): Promise<Pipeline[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    /**
     * Get a specific pipeline by ID
     */
    async getPipeline(pipelineId: number): Promise<Pipeline> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}`,
            { params: { 'api-version': '7.1-preview.1' } }
        );

        // Map configuration.repository to top-level repository for consistency
        const data = response.data;
        if (data.configuration?.repository && !data.repository) {
            data.repository = data.configuration.repository;
        }

        return data;
    }

    /**
     * Create a new pipeline
     */
    async createPipeline(
        name: string,
        yamlPath: string,
        repositoryId: string,
        repositoryName: string,
        folder?: string | null
    ): Promise<Pipeline> {
        const requestBody: any = {
            name,
            configuration: {
                type: 'yaml',
                path: yamlPath,
                repository: {
                    id: repositoryId,
                    name: repositoryName,
                    type: 'azureReposGit'
                }
            }
        };

        // Add folder if specified (null represents root)
        if (folder !== undefined) {
            requestBody.folder = folder || null;
        }

        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines`,
            requestBody,
            { params: { 'api-version': '7.1' } }
        );
        return response.data;
    }

    /**
     * Update/rename/move a pipeline (using Build Definitions API)
     * Requires getting the full definition first, then updating it
     */
    async updatePipeline(pipelineId: number, name?: string, folder?: string): Promise<Pipeline> {
        // First, get the current definition to get its revision number
        const currentDefinition = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            { params: { 'api-version': '7.1' } }
        );

        const definition = currentDefinition.data;

        // Update the name and/or folder if provided
        if (name !== undefined) {
            definition.name = name;
        }
        if (folder !== undefined) {
            definition.path = folder;
        }

        // PUT the updated definition back (revision must match)
        const response = await this.axiosInstance.put(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            definition,
            { params: { 'api-version': '7.1' } }
        );

        return response.data;
    }

    /**
     * Delete a pipeline
     */
    async deletePipeline(pipelineId: number): Promise<void> {
        await this.axiosInstance.delete(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            { params: { 'api-version': '7.1' } }
        );
    }

    // ==================== Pipeline Runs ====================

    /**
     * Get all runs for a pipeline
     */
    async getPipelineRuns(pipelineId?: number, top: number = 50): Promise<PipelineRun[]> {
        const params: any = {
            'api-version': '7.1',
            '$top': top
        };

        if (pipelineId) {
            params.definitions = pipelineId;
        }

        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds`,
            { params }
        );

        return response.data.value || [];
    }

    /**
     * Get a specific run
     */
    async getRun(runId: number): Promise<PipelineRun> {
        try {
            const listResponse = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/build/builds`,
                {
                    params: {
                        'api-version': '7.1',
                        'buildIds': runId,
                        'queryOrder': 'finishTimeDescending'
                    }
                }
            );

            if (listResponse.data.value && listResponse.data.value.length > 0) {
                const build = listResponse.data.value[0];
                if (build.state && !build.status) {
                    build.status = build.state;
                }
                return build;
            }
        } catch (error) {
            // Fallback to direct API
        }

        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}`,
            { params: { 'api-version': '7.1' } }
        );

        const build = response.data;
        if (build.state && !build.status) {
            build.status = build.state;
        }
        return build;
    }

    /**
     * Run a pipeline
     */
    async runPipeline(pipelineId: number, options?: PipelineRunOptions): Promise<PipelineRun> {
        const body: any = {
            resources: {
                repositories: {
                    self: {}
                }
            }
        };

        if (options?.branch) {
            body.resources.repositories.self.refName = `refs/heads/${options.branch}`;
        }

        if (options?.templateParameters) {
            body.templateParameters = options.templateParameters;
        }

        if (options?.variables) {
            const vars: Record<string, { value: string; isSecret: boolean }> = {};
            for (const [key, value] of Object.entries(options.variables)) {
                vars[key] = { value, isSecret: false };
            }
            body.variables = vars;
        }

        if (options?.stagesToSkip) {
            body.stagesToSkip = options.stagesToSkip;
        }

        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}/runs`,
            body,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data;
    }

    /**
     * Cancel a running pipeline
     */
    async cancelRun(runId: number): Promise<void> {
        await this.axiosInstance.patch(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}`,
            { status: 'Cancelling' },
            { params: { 'api-version': '7.1-preview.1' } }
        );
    }

    /**
     * Retry a failed run
     */
    async retryRun(runId: number): Promise<PipelineRun> {
        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/retry`,
            {},
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data;
    }

    // ==================== Git/Repository ====================

    /**
     * Get commit message for a specific commit
     */
    async getCommitMessage(repositoryId: string, commitId: string): Promise<string> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/commits/${commitId}`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data.comment || '';
        } catch (error: any) {
            return '';
        }
    }

    // ==================== Logs ====================

    /**
     * Get logs for a run
     */
    async getRunLogs(runId: number): Promise<BuildLog[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/logs`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data.value || [];
        } catch (error: any) {
            // If 404, return empty logs
            if (error.response?.status === 404) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Get specific log content
     */
    async getLogContent(runId: number, logId: number): Promise<string> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/logs/${logId}`,
            {
                params: { 'api-version': '7.1-preview.1' },
                responseType: 'text'
            }
        );
        return response.data;
    }

    /**
     * Get log content from a direct URL
     */
    async getLogContentFromUrl(logUrl: string): Promise<{ count: number; value: string[] }> {
        const response = await this.axiosInstance.get<{ count: number; value: string[] }>(logUrl);
        return response.data;
    }

    /**
     * Get timeline for a run (detailed task/stage information)
     */
    async getRunTimeline(runId: number): Promise<Timeline> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/timeline`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data;
        } catch (error: any) {
            // If 404, return empty timeline
            if (error.response?.status === 404) {
                return { id: '', changeId: 0, records: [] };
            }
            throw error;
        }
    }

    /**
     * Get test runs for a build
     */
    async getTestRuns(runId: number): Promise<any[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/test/runs`,
                {
                    params: {
                        'api-version': '7.1',
                        'buildIds': runId
                    }
                }
            );
            return response.data.value || [];
        } catch (error: any) {
            return [];
        }
    }

    /**
     * Get pipeline YAML definition
     */
    async getPipelineYaml(pipelineId: number): Promise<string> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}`,
                { params: { 'api-version': '7.1' } }
            );

            if (response.data.configuration?.path) {
                const repoId = response.data.configuration.repository?.id;
                const path = response.data.configuration.path;
                const rawRef = response.data.configuration.repository?.ref;
                const branchName = rawRef ? rawRef.replace('refs/heads/', '') : undefined;

                // Ensure path starts with /
                const normalizedPath = path.startsWith('/') ? path : `/${path}`;

                // Try 1: fetch with the configured branch (if ref was provided)
                if (branchName) {
                    try {
                        return await this.fetchFileFromRepo(repoId, normalizedPath, branchName);
                    } catch (fileError: any) {
                        console.warn(`[Azure Pipelines] Failed to fetch YAML at "${normalizedPath}" on branch "${branchName}": ${fileError.response?.status || ''} ${fileError.message || fileError}`);
                    }
                }

                // Try 2: fetch using the repo's default branch (no branch specified)
                try {
                    return await this.fetchFileFromRepoDefaultBranch(repoId, normalizedPath);
                } catch (fileError: any) {
                    console.warn(`[Azure Pipelines] Failed to fetch YAML at "${normalizedPath}" on default branch: ${fileError.response?.status || ''} ${fileError.message || fileError}`);
                }

                // Try 3: Use Build Definitions API in case the Pipelines API returned a partial path
                try {
                    const defResponse = await this.axiosInstance.get(
                        `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
                        { params: { 'api-version': '7.1' } }
                    );

                    const fullPath = defResponse.data?.process?.yamlFilename;
                    if (fullPath) {
                        const normalizedFullPath = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;

                        if (normalizedFullPath !== normalizedPath) {
                            try {
                                return await this.fetchFileFromRepoDefaultBranch(repoId, normalizedFullPath);
                            } catch (retryError: any) {
                                console.warn(`[Azure Pipelines] Failed to fetch YAML at "${normalizedFullPath}": ${retryError.response?.status || ''} ${retryError.message || retryError}`);
                            }
                        }
                    }
                } catch (defError: any) {
                    console.warn(`[Azure Pipelines] Failed to fetch build definition for pipeline ${pipelineId}: ${defError.message || defError}`);
                }
            }

            return `# Pipeline: ${response.data.name}\n# ID: ${response.data.id}\n# Path: ${response.data.configuration?.path || 'N/A'}\n\n# Full pipeline definition not available`;
        } catch (error) {
            throw new Error(`Failed to get pipeline YAML: ${error}`);
        }
    }

    /**
     * Fetch a file from a Git repository by path and branch.
     * Uses org-level URL (without project scope) so that cross-project
     * repository references resolve correctly by repo GUID.
     */
    private async fetchFileFromRepo(repoId: string, path: string, branch: string): Promise<string> {
        const fileResponse = await this.axiosInstance.get(
            `${this.organizationUrl}/_apis/git/repositories/${repoId}/items`,
            {
                params: {
                    'path': path,
                    'versionDescriptor.version': branch,
                    'versionDescriptor.versionType': 'branch',
                    'api-version': '7.1',
                    'includeContent': true
                }
            }
        );
        // API returns JSON with content property when includeContent=true
        return fileResponse.data.content || fileResponse.data;
    }

    /**
     * Fetch a file from a Git repository using the repo's default branch.
     * Omits versionDescriptor so the API uses whatever the repo's default branch is.
     */
    private async fetchFileFromRepoDefaultBranch(repoId: string, path: string): Promise<string> {
        const fileResponse = await this.axiosInstance.get(
            `${this.organizationUrl}/_apis/git/repositories/${repoId}/items`,
            {
                params: {
                    'path': path,
                    'api-version': '7.1',
                    'includeContent': true
                }
            }
        );
        // API returns JSON with content property when includeContent=true
        return fileResponse.data.content || fileResponse.data;
    }

    /**
     * Runtime parameter type definition
     */
    public parseRuntimeParameters(yaml: string): RuntimeParameter[] {
        const parameters: RuntimeParameter[] = [];
        const lines = yaml.split('\n');

        let inParametersSection = false;
        let currentParameter: Partial<RuntimeParameter> | null = null;
        let inValuesSection = false;
        let currentValues: string[] = [];
        let baseIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Detect start of parameters section
            if (trimmed === 'parameters:' || trimmed.startsWith('parameters:')) {
                inParametersSection = true;
                baseIndent = line.search(/\S/);
                continue;
            }

            // Check if we've exited parameters section (new top-level key)
            if (inParametersSection) {
                const currentIndent = line.search(/\S/);
                if (currentIndent <= baseIndent && !trimmed.startsWith('-')) {
                    // We've reached a new section at same or lower indent level
                    if (currentParameter && currentParameter.name) {
                        if (currentValues.length > 0) {
                            currentParameter.values = currentValues;
                        }
                        parameters.push(currentParameter as RuntimeParameter);
                    }
                    inParametersSection = false;
                    currentParameter = null;
                    continue;
                }
            }

            if (!inParametersSection) {
                continue;
            }

            // Parse parameter entry (starts with -)
            if (trimmed.startsWith('- name:')) {
                // Save previous parameter if exists
                if (currentParameter && currentParameter.name) {
                    if (currentValues.length > 0) {
                        currentParameter.values = currentValues;
                    }
                    parameters.push(currentParameter as RuntimeParameter);
                }

                // Start new parameter
                const nameMatch = trimmed.match(/^-\s*name:\s*['"]?([^'"]+)['"]?$/);
                currentParameter = {
                    name: nameMatch ? nameMatch[1].trim() : '',
                    type: 'string', // default type
                    default: undefined,
                    displayName: undefined,
                    values: undefined
                };
                currentValues = [];
                inValuesSection = false;
                continue;
            }

            // Parse parameter properties
            if (currentParameter) {
                if (trimmed.startsWith('type:')) {
                    const typeMatch = trimmed.match(/^type:\s*['"]?([^'"]+)['"]?$/);
                    if (typeMatch) {
                        const validTypes = ['string', 'boolean', 'number', 'object', 'step', 'stepList', 'job', 'jobList', 'deployment', 'deploymentList', 'stage', 'stageList', 'stringList'];
                        const parsedType = typeMatch[1].trim();
                        currentParameter.type = validTypes.includes(parsedType) ? parsedType as RuntimeParameter['type'] : 'string';
                    }
                } else if (trimmed.startsWith('displayName:')) {
                    const displayMatch = trimmed.match(/^displayName:\s*['"]?([^'"]+)['"]?$/);
                    if (displayMatch) {
                        currentParameter.displayName = displayMatch[1].trim();
                    }
                } else if (trimmed.startsWith('default:')) {
                    const defaultMatch = trimmed.match(/^default:\s*(.*)$/);
                    if (defaultMatch) {
                        let defaultVal = defaultMatch[1].trim();
                        // Remove quotes if present
                        if ((defaultVal.startsWith("'") && defaultVal.endsWith("'")) ||
                            (defaultVal.startsWith('"') && defaultVal.endsWith('"'))) {
                            defaultVal = defaultVal.slice(1, -1);
                        }
                        // Handle boolean and number types
                        if (currentParameter.type === 'boolean') {
                            currentParameter.default = defaultVal.toLowerCase() === 'true';
                        } else if (currentParameter.type === 'number') {
                            currentParameter.default = parseFloat(defaultVal) || 0;
                        } else {
                            currentParameter.default = defaultVal;
                        }
                    }
                } else if (trimmed === 'values:') {
                    inValuesSection = true;
                    currentValues = [];
                } else if (inValuesSection && trimmed.startsWith('-')) {
                    // Parse value item
                    const valueMatch = trimmed.match(/^-\s*['"]?([^'"]+)['"]?$/);
                    if (valueMatch) {
                        currentValues.push(valueMatch[1].trim());
                    }
                } else if (inValuesSection && !trimmed.startsWith('-') && trimmed.includes(':')) {
                    // We've moved past values section
                    inValuesSection = false;
                }
            }
        }

        // Don't forget the last parameter
        if (currentParameter && currentParameter.name) {
            if (currentValues.length > 0) {
                currentParameter.values = currentValues;
            }
            parameters.push(currentParameter as RuntimeParameter);
        }

        return parameters;
    }

    /**
     * Get runtime parameters for a pipeline by fetching and parsing the YAML
     */
    async getPipelineRuntimeParameters(pipelineId: number): Promise<RuntimeParameter[]> {
        try {
            const yaml = await this.getPipelineYaml(pipelineId);
            return this.parseRuntimeParameters(yaml);
        } catch (error) {
            console.error('Failed to get pipeline runtime parameters:', error);
            return [];
        }
    }

    // ==================== Artifacts ====================

    /**
     * Get artifacts for a run
     */
    async getArtifacts(runId: number): Promise<Artifact[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/artifacts`,
                { params: { 'api-version': '7.1-preview.1' } }
            );
            return response.data.value || [];
        } catch (error: any) {
            if (error.response?.status === 404) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Download artifact
     */
    async downloadArtifact(runId: number, artifactName: string): Promise<string> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}/artifacts`,
            {
                params: {
                    'api-version': '7.1-preview.1',
                    artifactName
                }
            }
        );
        return response.data.resource.downloadUrl;
    }

    // ==================== Environments ====================

    /**
     * Get all environments
     */
    async getEnvironments(): Promise<Environment[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/distributedtask/environments`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    /**
     * Get environment by ID
     */
    async getEnvironment(environmentId: number): Promise<Environment> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/distributedtask/environments/${environmentId}`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data;
    }

    // ==================== Variables ====================

    /**
     * Get pipeline variables
     */
    async getPipelineVariables(pipelineId: number): Promise<Record<string, Variable>> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            { params: { 'api-version': '7.1-preview.7' } }
        );
        return response.data.variables || {};
    }

    /**
     * Create or update a pipeline variable
     */
    async createOrUpdatePipelineVariable(
        pipelineId: number,
        variableName: string,
        value: string,
        isSecret: boolean = false,
        allowOverride: boolean = false
    ): Promise<void> {
        // Get current pipeline definition
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            { params: { 'api-version': '7.1-preview.7' } }
        );

        const definition = response.data;

        // Initialize variables object if it doesn't exist
        if (!definition.variables) {
            definition.variables = {};
        }

        // Add or update the variable
        definition.variables[variableName] = {
            value: isSecret ? '' : value,  // Don't send secret values in definition
            isSecret: isSecret,
            allowOverride: allowOverride
        };

        // Update the pipeline definition
        await this.axiosInstance.put(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            definition,
            { params: { 'api-version': '7.1-preview.7' } }
        );
    }

    /**
     * Delete a pipeline variable
     */
    async deletePipelineVariable(pipelineId: number, variableName: string): Promise<void> {
        // Get current pipeline definition
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
            { params: { 'api-version': '7.1-preview.7' } }
        );

        const definition = response.data;

        // Remove the variable if it exists
        if (definition.variables && definition.variables[variableName]) {
            delete definition.variables[variableName];

            // Update the pipeline definition
            await this.axiosInstance.put(
                `${this.organizationUrl}/${this.projectName}/_apis/build/definitions/${pipelineId}`,
                definition,
                { params: { 'api-version': '7.1-preview.7' } }
            );
        }
    }

    /**
     * Get variable groups
     */
    async getVariableGroups(): Promise<VariableGroup[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/distributedtask/variablegroups`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    // ==================== Service Endpoints ====================

    /**
     * Get all service endpoints
     */
    async getServiceEndpoints(): Promise<ServiceEndpoint[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/serviceendpoint/endpoints`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    /**
     * Create service endpoint
     */
    async createServiceEndpoint(endpointData: any): Promise<ServiceEndpoint> {
        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/_apis/serviceendpoint/endpoints`,
            endpointData,
            { params: { 'api-version': '7.1' } }
        );
        return response.data;
    }

    /**
     * Update service endpoint
     */
    async updateServiceEndpoint(endpointId: string, endpointData: any): Promise<ServiceEndpoint> {
        // Remove null/empty authorization parameters to avoid 404 errors
        const cleanData = { ...endpointData };
        if (cleanData.authorization?.parameters) {
            Object.keys(cleanData.authorization.parameters).forEach(key => {
                if (cleanData.authorization.parameters[key] === null || cleanData.authorization.parameters[key] === '') {
                    delete cleanData.authorization.parameters[key];
                }
            });
        }
        
        // Get project IDs from serviceEndpointProjectReferences
        const projectIds = cleanData.serviceEndpointProjectReferences
            ?.map((ref: any) => ref.projectReference?.id)
            .filter((id: any) => id)
            .join(',') || '';
        
        const response = await this.axiosInstance.put(
            `${this.organizationUrl}/_apis/serviceendpoint/endpoints/${endpointId}`,
            cleanData,
            { 
                params: { 
                    'api-version': '7.1-preview.4',
                    ...(projectIds && { 'projectIds': projectIds })
                } 
            }
        );
        return response.data;
    }

    /**
     * Get service endpoint execution records (usage history)
     */
    async getServiceEndpointExecutionRecords(endpointId: string, top: number = 50): Promise<any[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/${this.projectName}/_apis/serviceendpoint/executionhistory`,
                { 
                    params: { 
                        'endpointId': endpointId,
                        'top': top,
                        'api-version': '7.1-preview.1' 
                    } 
                }
            );
            return response.data.value || [];
        } catch (error: any) {
            if (error.response?.status === 404) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Delete service endpoint
     */
    async deleteServiceEndpoint(endpointId: string, projectId: string): Promise<void> {
        await this.axiosInstance.delete(
            `${this.organizationUrl}/_apis/serviceendpoint/endpoints/${endpointId}`,
            { 
                params: { 
                    'projectIds': projectId,
                    'api-version': '7.1' 
                } 
            }
        );
    }

    // ==================== Agent Pools ====================

    /**
     * Get all agent pools
     */
    async getAgentPools(): Promise<AgentPool[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/_apis/distributedtask/pools`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    /**
     * Get agents in a pool
     */
    async getAgents(poolId: number): Promise<Agent[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/_apis/distributedtask/pools/${poolId}/agents`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    // ==================== Repositories ====================

    /**
     * Get repositories in the project
     */
    async getRepositories(): Promise<any[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.value;
    }

    /**
     * Get branches for a repository
     */
    async getBranches(repositoryId: string): Promise<Branch[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/refs`,
            {
                params: {
                    'api-version': '7.1',
                    'filter': 'heads/'
                }
            }
        );
        return response.data.value.map((ref: any) => ({
            name: ref.name.replace('refs/heads/', ''),
            objectId: ref.objectId
        }));
    }

    /**
     * Get file content from repository
     */
    async getFileContent(repositoryId: string, path: string, branch: string = 'main'): Promise<string> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/items`,
            {
                params: {
                    'api-version': '7.1-preview.1',
                    path,
                    'versionDescriptor.version': branch,
                    'versionDescriptor.versionType': 'branch',
                    'includeContent': true,
                    '$format': 'text'
                },
                responseType: 'text',
                headers: {
                    'Accept': 'text/plain'
                }
            }
        );
        return response.data;
    }

    /**
     * List items (files and folders) in a repository
     */
    async getRepositoryItems(
        repositoryId: string,
        scopePath: string = '/',
        branch: string = 'main',
        recursionLevel: 'none' | 'oneLevel' | 'full' = 'full'
    ): Promise<any[]> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/items`,
            {
                params: {
                    'api-version': '7.1',
                    'scopePath': scopePath,
                    'recursionLevel': recursionLevel,
                    'versionDescriptor.version': branch,
                    'versionDescriptor.versionType': 'branch'
                }
            }
        );
        return response.data.value || [];
    }

    /**
     * Get the latest commit SHA for a specific branch
     */
    async getBranchCommitSha(repositoryId: string, branchName: string): Promise<string> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/refs`,
            {
                params: {
                    'api-version': '7.1',
                    'filter': `heads/${branchName}`
                }
            }
        );

        if (response.data.value && response.data.value.length > 0) {
            return response.data.value[0].objectId;
        }

        throw new Error(`Branch '${branchName}' not found in repository`);
    }

    /**
     * Push file changes to the repository
     * This creates a commit and pushes it directly to the specified branch
     */
    async pushFileToRepository(
        repositoryId: string,
        branchName: string,
        filePath: string,
        content: string,
        commitMessage: string,
        changeType: 'add' | 'edit' | 'delete' = 'edit'
    ): Promise<any> {
        // Get the current commit SHA for the branch
        const oldObjectId = await this.getBranchCommitSha(repositoryId, branchName);

        // Prepare the push request body
        const pushBody = {
            refUpdates: [
                {
                    name: `refs/heads/${branchName}`,
                    oldObjectId: oldObjectId
                }
            ],
            commits: [
                {
                    comment: commitMessage,
                    changes: [
                        {
                            changeType: changeType,
                            item: {
                                path: filePath
                            },
                            ...(changeType !== 'delete' && {
                                newContent: {
                                    content: content,
                                    contentType: 'rawtext'
                                }
                            })
                        }
                    ]
                }
            ]
        };

        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/pushes`,
            pushBody,
            { params: { 'api-version': '7.1' } }
        );

        return response.data;
    }

    /**
     * Get pipeline configuration details including repository and YAML path
     */
    async getPipelineConfiguration(pipelineId: number): Promise<{
        repositoryId: string;
        repositoryName: string;
        yamlPath: string;
        defaultBranch: string;
    }> {
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}`,
            { params: { 'api-version': '7.1' } }
        );

        const config = response.data.configuration;
        if (!config || !config.repository) {
            throw new Error('Pipeline configuration not found');
        }

        // Get default branch and repository name from repository API
        let defaultBranch = 'main';
        let repositoryName = config.repository.name || '';

        // If repository name is not in config, or we need the default branch, fetch from repos API
        if (!repositoryName || !config.repository.ref) {
            try {
                const repos = await this.getRepositories();
                const repo = repos.find(r => r.id === config.repository.id);
                if (repo) {
                    if (!repositoryName) {
                        repositoryName = repo.name;
                    }
                    if (repo.defaultBranch) {
                        defaultBranch = repo.defaultBranch.replace('refs/heads/', '');
                    }
                }
            } catch (error) {
                // Use defaults
            }
        }

        // Use ref from config if available
        if (config.repository.ref) {
            defaultBranch = config.repository.ref.replace('refs/heads/', '');
        }

        return {
            repositoryId: config.repository.id,
            repositoryName: repositoryName || 'Repository',
            yamlPath: config.path,
            defaultBranch: defaultBranch
        };
    }

    /**
     * Validate pipeline YAML without running the pipeline
     * Uses the preview API to parse and validate the YAML
     */
    async validatePipelineYaml(
        pipelineId: number,
        yamlContent: string,
        branch?: string
    ): Promise<{ valid: boolean; finalYaml?: string; error?: string }> {
        try {
            const requestBody: any = {
                previewRun: true,
                yamlOverride: yamlContent
            };

            // Add branch reference if provided
            if (branch) {
                requestBody.resources = {
                    repositories: {
                        self: {
                            refName: `refs/heads/${branch}`
                        }
                    }
                };
            }

            const response = await this.axiosInstance.post(
                `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}/preview`,
                requestBody,
                { params: { 'api-version': '7.1' } }
            );

            return {
                valid: true,
                finalYaml: response.data.finalYaml
            };
        } catch (error: any) {
            // Extract error message from response
            let errorMessage = 'Validation failed';
            if (error.response?.data?.message) {
                errorMessage = error.response.data.message;
            } else if (error.response?.data?.typeKey) {
                errorMessage = `${error.response.data.typeKey}: ${error.response.data.message || 'Unknown error'}`;
            } else if (error.message) {
                errorMessage = error.message;
            }

            return {
                valid: false,
                error: errorMessage
            };
        }
    }

    /**
     * Create a new branch from an existing branch
     */
    async createBranch(repositoryId: string, newBranchName: string, sourceBranchName: string): Promise<void> {
        // Get the commit SHA from the source branch
        const sourceCommitSha = await this.getBranchCommitSha(repositoryId, sourceBranchName);

        // Create the new branch by pushing a ref update
        const refUpdates = [
            {
                name: `refs/heads/${newBranchName}`,
                oldObjectId: '0000000000000000000000000000000000000000',
                newObjectId: sourceCommitSha
            }
        ];

        await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/git/repositories/${repositoryId}/refs`,
            refUpdates,
            { params: { 'api-version': '7.1' } }
        );
    }

    // ==================== Tasks & Extensions ====================

    /**
     * Get all available task definitions
     * This uses an undocumented but functional API endpoint
     */
    async getTaskDefinitions(): Promise<TaskDefinition[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/_apis/distributedtask/tasks`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data.value || [];
        } catch (error: any) {
            // If the undocumented API fails, return empty array
            console.warn('Failed to fetch task definitions:', error.message);
            return [];
        }
    }

    /**
     * Get a specific task definition by ID
     */
    async getTaskDefinition(taskId: string): Promise<TaskDefinition | null> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/_apis/distributedtask/tasks/${taskId}`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data;
        } catch (error: any) {
            console.warn(`Failed to fetch task definition ${taskId}:`, error.message);
            return null;
        }
    }

    /**
     * Get all installed extensions in the organization
     */
    async getInstalledExtensions(): Promise<InstalledExtension[]> {
        try {
            const response = await this.axiosInstance.get(
                `${this.organizationUrl}/_apis/extensionmanagement/installedextensions`,
                {
                    params: {
                        'api-version': '7.2',
                        'includeDisabledExtensions': true,
                        'includeErrors': false
                    }
                }
            );
            return response.data.value || [];
        } catch (error: any) {
            console.warn('Failed to fetch installed extensions:', error.message);
            return [];
        }
    }

    /**
     * Fetch task icon and convert to base64 data URL
     * This is needed because icon URLs require authentication
     */
    async getTaskIconAsDataUrl(iconUrl: string): Promise<string | null> {
        try {
            const response = await this.axiosInstance.get(iconUrl, {
                responseType: 'arraybuffer'
            });

            // Convert to base64
            const base64 = Buffer.from(response.data, 'binary').toString('base64');
            const contentType = response.headers['content-type'] || 'image/png';
            return `data:${contentType};base64,${base64}`;
        } catch (error: any) {
            console.warn(`Failed to fetch icon from ${iconUrl}:`, error.message);
            return null;
        }
    }
}
