/**
 * Core type definitions for Azure DevOps Pipelines extension
 */

export interface AzureDevOpsConfig {
    organizationUrl: string;
    organizationName: string;
    projectName: string;
    accessToken: string;
}

export interface Pipeline {
    id: number;
    name: string;
    folder?: string;
    revision: number;
    url: string;
    repository?: {
        id: string;
        name?: string;
        type: string;
        clean?: string | null;
        checkoutSubmodules?: boolean;
    };
}

export interface PipelineRun {
    id: number;
    name: string;
    buildNumber: string;
    status: RunStatus;
    result?: RunResult;
    queueTime?: string | Date;
    createdDate?: string | Date;
    startTime?: string | Date;
    finishTime?: string | Date;
    finishedDate?: string | Date;
    sourceBranch?: string;
    sourceVersion?: string;
    requestedBy?: {
        displayName: string;
        uniqueName: string;
        imageUrl: string;
    };
    requestedFor?: {
        displayName: string;
        uniqueName: string;
        imageUrl: string;
    };
    pipeline?: {
        id: number;
        name: string;
    };
    definition?: {
        id: number;
        name: string;
    };
    repository?: {
        id: string;
        name?: string;
        type: string;
        clean?: string | null;
        checkoutSubmodules?: boolean;
    };
    url: string;
}

export enum RunStatus {
    All = 'all',
    Cancelling = 'cancelling',
    Completed = 'completed',
    InProgress = 'inProgress',
    None = 'none',
    NotStarted = 'notStarted',
    Postponed = 'postponed'
}

export enum RunResult {
    Succeeded = 'succeeded',
    PartiallySucceeded = 'partiallySucceeded',
    Failed = 'failed',
    Canceled = 'canceled',
    None = 'none'
}

export interface Environment {
    id: number;
    name: string;
    description?: string;
    createdOn: Date;
    modifiedOn: Date;
    resources: EnvironmentResource[];
}

export interface EnvironmentResource {
    id: number;
    name: string;
    type: string;
}

export interface PipelineApproval {
    id: string;
    status: ApprovalStatus;
    approver: {
        displayName: string;
        uniqueName: string;
    };
    createdOn: Date;
    comment?: string;
}

export enum ApprovalStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected'
}

export interface BuildLog {
    id: number;
    type: string;
    url: string;
    lineCount?: number;
}

export interface Artifact {
    id: number;
    name: string;
    source: string;
    resource: {
        downloadUrl: string;
        type: string;
        data: string;
    };
}

export interface Organization {
    accountId: string;
    accountUri: string;
    accountName: string;
}

export interface Project {
    id: string;
    name: string;
    description?: string;
    url: string;
    state: string;
    revision: number;
    visibility: string;
}

export interface Branch {
    name: string;
    objectId: string;
}

export interface Variable {
    name: string;
    value: string;
    isSecret: boolean;
    allowOverride?: boolean;
}

export interface VariableGroup {
    id: number;
    name: string;
    description?: string;
    type: string;
    variables: Record<string, Variable>;
}

export interface ServiceEndpoint {
    id: string;
    name: string;
    type: string;
    url: string;
    description?: string;
    authorization?: {
        scheme: string;
        parameters?: Record<string, string>;
    };
    isReady: boolean;
    isShared?: boolean;
    owner?: string;
    data?: Record<string, any>;
    serviceEndpointProjectReferences?: Array<{
        projectReference: {
            id: string;
            name: string;
        };
        name: string;
        description?: string;
    }>;
    createdBy?: any;
    administratorsGroup?: any;
    readersGroup?: any;
}

export interface AgentPool {
    id: number;
    name: string;
    size: number;
    isHosted: boolean;
    poolType: string;
}

export interface Agent {
    id: number;
    name: string;
    version: string;
    status: AgentStatus;
    enabled: boolean;
    assignedRequest?: {
        requestId: number;
        jobId: string;
    };
}

export enum AgentStatus {
    Offline = 'offline',
    Online = 'online'
}

export interface Timeline {
    id: string;
    changeId: number;
    records: TimelineRecord[];
}

export interface TimelineRecord {
    id: string;
    parentId?: string;
    type: string;
    name: string;
    startTime?: Date;
    finishTime?: Date;
    currentOperation?: string;
    percentComplete?: number;
    state: string;
    result?: string;
    log?: {
        id: number;
        url: string;
    };
    issues?: Issue[];
}

export interface Issue {
    type: 'error' | 'warning';
    category: string;
    message: string;
}

export interface PipelineRunOptions {
    branch?: string;
    variables?: Record<string, string>;
    stagesToSkip?: string[];
}
