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
    PipelineRunOptions
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
            }
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

            // Don't show notifications for 404s - they're often expected (no timeline, no logs, etc.)
            if (status === 404) {
                console.log('Resource not found (404):', error.config?.url);
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
     * Get all organizations for the authenticated user
     * Uses the profile and resource areas to discover accessible organizations
     */
    async getOrganizations(): Promise<Organization[]> {
        try {
            // Get user profile which contains the public alias
            const profileResponse = await this.axiosInstance.get(
                'https://app.vssps.visualstudio.com/_apis/profile/profiles/me',
                {
                    params: {
                        'api-version': '7.1-preview.2',
                        'details': true
                    }
                }
            );

            const publicAlias = profileResponse.data.publicAlias;
            const emailAddress = profileResponse.data.emailAddress;
            const coreAttributes = profileResponse.data.coreAttributes;

            // Try to get organizations through the resource areas endpoint
            // This endpoint lists all Azure DevOps instances the user has access to
            const resourceResponse = await this.axiosInstance.get(
                `https://app.vssps.visualstudio.com/_apis/resourceareas`,
                { params: { 'api-version': '7.1-preview.1' } }
            );

            // Alternative: Try the accounts endpoint with the user's email
            let organizations: Organization[] = [];

            if (emailAddress) {
                try {
                    const accountsResponse = await this.axiosInstance.get(
                        `https://app.vssps.visualstudio.com/_apis/accounts`,
                        {
                            params: {
                                'memberid': emailAddress,
                                'api-version': '7.1-preview.1'
                            }
                        }
                    );

                    if (accountsResponse.data.value && accountsResponse.data.value.length > 0) {
                        return accountsResponse.data.value;
                    }
                } catch (err) {
                    console.log('Failed to get accounts by email:', err);
                }
            }

            // If we have the publicAlias, try that
            if (publicAlias) {
                try {
                    const accountsResponse = await this.axiosInstance.get(
                        `https://app.vssps.visualstudio.com/_apis/accounts`,
                        {
                            params: {
                                'ownerId': publicAlias,
                                'api-version': '7.1-preview.1'
                            }
                        }
                    );

                    if (accountsResponse.data.value && accountsResponse.data.value.length > 0) {
                        return accountsResponse.data.value;
                    }
                } catch (err) {
                    console.log('Failed to get accounts by publicAlias:', err);
                }
            }

            // Last resort: Try using Microsoft Graph to get organizations
            // The access token might work with Graph API
            try {
                const graphResponse = await this.axiosInstance.get(
                    'https://management.azure.com/providers/Microsoft.VisualStudio/accounts',
                    {
                        params: {
                            'api-version': '2014-04-01-preview'
                        }
                    }
                );

                if (graphResponse.data.value) {
                    return graphResponse.data.value.map((account: any) => ({
                        accountId: account.id,
                        accountName: account.name,
                        accountUri: `https://dev.azure.com/${account.name}`
                    }));
                }
            } catch (err) {
                console.log('Failed to get accounts via Azure Management API:', err);
            }

            throw new Error(
                'Unable to automatically discover organizations. This might be due to API restrictions. ' +
                'Please use manual organization setup instead.'
            );

        } catch (error) {
            console.error('Error getting organizations:', error);
            throw error;
        }
    }

    /**
     * Get all projects in an organization
     */
    async getProjects(organizationUrl: string): Promise<Project[]> {
        const response = await this.axiosInstance.get(
            `${organizationUrl}/_apis/projects`,
            { params: { 'api-version': '7.1-preview.4' } }
        );
        return response.data.value;
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
        return response.data;
    }

    /**
     * Create a new pipeline
     */
    async createPipeline(name: string, yamlPath: string, repositoryId: string): Promise<Pipeline> {
        const response = await this.axiosInstance.post(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines`,
            {
                name,
                configuration: {
                    type: 'yaml',
                    path: yamlPath,
                    repository: {
                        id: repositoryId,
                        type: 'azureReposGit'
                    }
                }
            },
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data;
    }

    /**
     * Delete a pipeline
     */
    async deletePipeline(pipelineId: number): Promise<void> {
        await this.axiosInstance.delete(
            `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}`,
            { params: { 'api-version': '7.1-preview.1' } }
        );
    }

    // ==================== Pipeline Runs ====================

    /**
     * Get all runs for a pipeline
     */
    async getPipelineRuns(pipelineId?: number, top: number = 50): Promise<PipelineRun[]> {
        const url = pipelineId
            ? `${this.organizationUrl}/${this.projectName}/_apis/pipelines/${pipelineId}/runs`
            : `${this.organizationUrl}/${this.projectName}/_apis/build/builds`;

        const response = await this.axiosInstance.get(url, {
            params: {
                'api-version': '7.1-preview.1',
                '$top': top
            }
        });
        
        console.log('getPipelineRuns response:', JSON.stringify(response.data, null, 2));
        return response.data.value || [];
    }

    /**
     * Get a specific run
     */
    async getRun(runId: number): Promise<PipelineRun> {
        // Try to get the build from the list API first (returns more complete data)
        try {
            const listUrl = `${this.organizationUrl}/${this.projectName}/_apis/build/builds?buildIds=${runId}&api-version=7.1`;
            console.log('Calling list API:', listUrl);

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
                console.log('getRun from list API - Checking specific fields:');
                console.log('  repository:', build.repository);
                console.log('  definition:', build.definition);
                console.log('  sourceBranch:', build.sourceBranch);
                console.log('  sourceVersion:', build.sourceVersion);
                console.log('  requestedBy:', build.requestedBy);
                console.log('  requestedFor:', build.requestedFor);
                console.log('  Full build object keys:', Object.keys(build));

                // Map state to status for consistency
                if (build.state && !build.status) {
                    build.status = build.state;
                }
                return build;
            }
        } catch (error) {
            console.warn('Failed to get run from list API, falling back to direct API:', error);
        }

        // Fallback to direct API
        const response = await this.axiosInstance.get(
            `${this.organizationUrl}/${this.projectName}/_apis/build/builds/${runId}`,
            { params: { 'api-version': '7.1' } }
        );

        const build = response.data;
        console.log('getRun fallback - Checking specific fields:');
        console.log('  repository:', build.repository);
        console.log('  definition:', build.definition);
        console.log('  sourceBranch:', build.sourceBranch);
        console.log('  sourceVersion:', build.sourceVersion);
        console.log('  sourceGetVersion:', build.sourceGetVersion);
        console.log('  requestedBy:', build.requestedBy);
        console.log('  requestedFor:', build.requestedFor);
        console.log('  Full build object keys:', Object.keys(build));

        // Map state to status if needed
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

        if (options?.variables) {
            body.templateParameters = options.variables;
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
            console.error('Failed to get test runs:', error);
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
            console.log(`getArtifacts for run ${runId}:`, JSON.stringify(response.data, null, 2));
            return response.data.value || [];
        } catch (error: any) {
            // 404 means no artifacts exist for this build, which is normal
            if (error.response?.status === 404) {
                console.log(`getArtifacts for run ${runId}: 404 - No artifacts found`);
                return [];
            }
            console.error(`getArtifacts for run ${runId} error:`, error);
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
            { params: { 'api-version': '7.1-preview.1' } }
        );
        return response.data.variables || {};
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
                    'api-version': '7.1-preview.1',
                    filter: 'heads/'
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
                    versionDescriptor: {
                        version: branch,
                        versionType: 'branch'
                    }
                },
                responseType: 'text'
            }
        );
        return response.data;
    }
}
