import * as vscode from 'vscode';

export interface RunFilter {
    status?: string[];
    branch?: string;
    dateFrom?: Date;
    dateTo?: Date;
    triggeredBy?: string;
}

export class FilterManager {
    private currentFilter: RunFilter = {};
    private _onFilterChanged = new vscode.EventEmitter<RunFilter>();
    readonly onFilterChanged = this._onFilterChanged.event;

    async showFilterDialog(): Promise<boolean> {
        const options = [
            { label: '$(filter) Filter by Status', value: 'status' },
            { label: '$(git-branch) Filter by Branch', value: 'branch' },
            { label: '$(calendar) Filter by Date Range', value: 'date' },
            { label: '$(person) Filter by Triggered By', value: 'user' },
            { label: '$(clear-all) Clear All Filters', value: 'clear' }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select filter type'
        });

        if (!selected) {
            return false;
        }

        switch (selected.value) {
            case 'status':
                await this.filterByStatus();
                break;
            case 'branch':
                await this.filterByBranch();
                break;
            case 'date':
                await this.filterByDate();
                break;
            case 'user':
                await this.filterByUser();
                break;
            case 'clear':
                this.clearFilters();
                break;
        }

        return true;
    }

    private async filterByStatus() {
        const statuses = [
            { label: '✓ Succeeded', value: 'succeeded', picked: this.currentFilter.status?.includes('succeeded') },
            { label: '✗ Failed', value: 'failed', picked: this.currentFilter.status?.includes('failed') },
            { label: '● In Progress', value: 'inProgress', picked: this.currentFilter.status?.includes('inProgress') },
            { label: '⚠ Partially Succeeded', value: 'partiallySucceeded', picked: this.currentFilter.status?.includes('partiallySucceeded') },
            { label: '○ Canceled', value: 'canceled', picked: this.currentFilter.status?.includes('canceled') }
        ];

        const selected = await vscode.window.showQuickPick(statuses, {
            placeHolder: 'Select statuses to filter',
            canPickMany: true
        });

        if (selected && selected.length > 0) {
            this.currentFilter.status = selected.map(s => s.value);
            this._onFilterChanged.fire(this.currentFilter);
        }
    }

    private async filterByBranch() {
        const branch = await vscode.window.showInputBox({
            prompt: 'Enter branch name (e.g., main, develop)',
            value: this.currentFilter.branch,
            placeHolder: 'Branch name'
        });

        if (branch !== undefined) {
            this.currentFilter.branch = branch || undefined;
            this._onFilterChanged.fire(this.currentFilter);
        }
    }

    private async filterByDate() {
        const options = [
            { label: 'Last 24 hours', value: 1 },
            { label: 'Last 7 days', value: 7 },
            { label: 'Last 30 days', value: 30 },
            { label: 'Custom range', value: 0 }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select date range'
        });

        if (!selected) {
            return;
        }

        if (selected.value > 0) {
            const now = new Date();
            const from = new Date(now.getTime() - selected.value * 24 * 60 * 60 * 1000);
            this.currentFilter.dateFrom = from;
            this.currentFilter.dateTo = now;
            this._onFilterChanged.fire(this.currentFilter);
        } else {
            // Custom range - simplified for now
            vscode.window.showInformationMessage('Custom date range coming soon');
        }
    }

    private async filterByUser() {
        const user = await vscode.window.showInputBox({
            prompt: 'Enter user name or email',
            value: this.currentFilter.triggeredBy,
            placeHolder: 'User name'
        });

        if (user !== undefined) {
            this.currentFilter.triggeredBy = user || undefined;
            this._onFilterChanged.fire(this.currentFilter);
        }
    }

    clearFilters() {
        this.currentFilter = {};
        this._onFilterChanged.fire(this.currentFilter);
    }

    getFilter(): RunFilter {
        return { ...this.currentFilter };
    }

    hasActiveFilters(): boolean {
        return Object.keys(this.currentFilter).length > 0;
    }

    getFilterDescription(): string {
        const parts: string[] = [];
        
        if (this.currentFilter.status && this.currentFilter.status.length > 0) {
            parts.push(`Status: ${this.currentFilter.status.join(', ')}`);
        }
        
        if (this.currentFilter.branch) {
            parts.push(`Branch: ${this.currentFilter.branch}`);
        }
        
        if (this.currentFilter.dateFrom) {
            parts.push(`From: ${this.currentFilter.dateFrom.toLocaleDateString()}`);
        }
        
        if (this.currentFilter.triggeredBy) {
            parts.push(`By: ${this.currentFilter.triggeredBy}`);
        }
        
        return parts.join(' | ') || 'No filters';
    }

    matchesFilter(run: any): boolean {
        if (this.currentFilter.status && this.currentFilter.status.length > 0) {
            const runStatus = String(run.result || run.status).toLowerCase();
            if (!this.currentFilter.status.some(s => runStatus === s.toLowerCase())) {
                return false;
            }
        }

        if (this.currentFilter.branch) {
            const runBranch = run.sourceBranch?.replace('refs/heads/', '') || '';
            if (!runBranch.toLowerCase().includes(this.currentFilter.branch.toLowerCase())) {
                return false;
            }
        }

        if (this.currentFilter.dateFrom) {
            const runDate = new Date(run.createdDate);
            if (runDate < this.currentFilter.dateFrom) {
                return false;
            }
        }

        if (this.currentFilter.dateTo) {
            const runDate = new Date(run.createdDate);
            if (runDate > this.currentFilter.dateTo) {
                return false;
            }
        }

        if (this.currentFilter.triggeredBy) {
            const requestedBy = run.requestedBy?.displayName || run.requestedBy?.uniqueName || '';
            if (!requestedBy.toLowerCase().includes(this.currentFilter.triggeredBy.toLowerCase())) {
                return false;
            }
        }

        return true;
    }
}
