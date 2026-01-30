import * as vscode from 'vscode';

/**
 * Parsed task information from YAML
 */
interface ParsedTask {
    taskName: string;
    taskVersion: string;
    displayName?: string;
    inputs: Record<string, any>;
    range: vscode.Range;
}

/**
 * CodeLens Provider for Azure Pipelines YAML
 * Adds "Settings" button above each task
 */
export class PipelineCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    /**
     * Provide CodeLens for YAML documents
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        console.log(`[CodeLens] Checking document: ${document.fileName}, languageId: ${document.languageId}`);

        // Only process YAML files (check both language ID and file extension)
        const isYaml = document.languageId === 'yaml' ||
                       document.languageId === 'azure-pipelines' ||
                       document.fileName.endsWith('.yml') ||
                       document.fileName.endsWith('.yaml');

        if (!isYaml) {
            console.log(`[CodeLens] Skipping non-YAML file: ${document.fileName}`);
            return codeLenses;
        }

        // Parse the document to find tasks
        const tasks = this.parseTasksFromYaml(document);
        console.log(`[CodeLens] Found ${tasks.length} tasks in document`);

        // Create a CodeLens for each task
        for (const task of tasks) {
            // Create range for the line where the task is defined
            const range = new vscode.Range(task.range.start.line, 0, task.range.start.line, 0);

            const codeLens = new vscode.CodeLens(range, {
                title: '⚙️ Settings',
                tooltip: `Configure ${task.taskName}@${task.taskVersion}`,
                command: 'azurePipelines.configureTask',
                arguments: [task]
            });

            codeLenses.push(codeLens);
            console.log(`[CodeLens] Added CodeLens for ${task.taskName}@${task.taskVersion} at line ${task.range.start.line}`);
        }

        return codeLenses;
    }

    /**
     * Parse tasks from YAML document
     */
    private parseTasksFromYaml(document: vscode.TextDocument): ParsedTask[] {
        const tasks: ParsedTask[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[CodeLens] Parsing document with ${lines.length} lines`);

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            // Match task line: - task: TaskName@version
            const taskMatch = trimmed.match(/^-\s*task:\s*([^@\s]+)@(\d+)/);
            if (taskMatch) {
                console.log(`[CodeLens] Found task at line ${i}: ${trimmed}`);
                const taskName = taskMatch[1];
                const taskVersion = taskMatch[2];
                const startLine = i;

                // Parse task properties
                let displayName: string | undefined;
                const inputs: Record<string, any> = {};
                let inInputsSection = false;
                let baseIndent = line.search(/\S/); // Find indentation level

                // Look ahead to parse task properties
                i++;
                while (i < lines.length) {
                    const nextLine = lines[i];
                    const nextTrimmed = nextLine.trim();
                    const nextIndent = nextLine.search(/\S/);

                    // Stop if we hit a line with same or less indentation (new task or step)
                    if (nextTrimmed && nextIndent <= baseIndent) {
                        break;
                    }

                    // Parse displayName
                    const displayNameMatch = nextTrimmed.match(/^displayName:\s*['"]?([^'"]+)['"]?$/);
                    if (displayNameMatch) {
                        displayName = displayNameMatch[1];
                    }

                    // Check if we're entering the inputs section
                    if (nextTrimmed === 'inputs:') {
                        inInputsSection = true;
                        i++;
                        continue;
                    }

                    // Parse inputs
                    if (inInputsSection && nextTrimmed) {
                        const inputMatch = nextTrimmed.match(/^([^:]+):\s*(.*)$/);
                        if (inputMatch) {
                            const key = inputMatch[1].trim();
                            let value = inputMatch[2].trim();

                            // Remove quotes
                            if ((value.startsWith("'") && value.endsWith("'")) ||
                                (value.startsWith('"') && value.endsWith('"'))) {
                                value = value.slice(1, -1);
                            }

                            // Parse boolean values
                            if (value === 'true') {
                                inputs[key] = true;
                            } else if (value === 'false') {
                                inputs[key] = false;
                            } else {
                                inputs[key] = value;
                            }
                        }
                    }

                    i++;
                }

                const endLine = i - 1;
                const range = new vscode.Range(startLine, 0, endLine, lines[endLine].length);

                tasks.push({
                    taskName,
                    taskVersion,
                    displayName,
                    inputs,
                    range
                });

                continue; // Don't increment i again
            }

            i++;
        }

        return tasks;
    }

    /**
     * Refresh CodeLens
     */
    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}
