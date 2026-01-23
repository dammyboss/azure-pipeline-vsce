# Enhancement Plan - Features from azure-pipeline-runner

This document outlines potential enhancements for the Azure Pipelines VSCode extension based on features found in the [azure-pipeline-runner](https://github.com/pedroccaetano/azure-pipeline-runner) project.

## 🎯 High Priority Enhancements

### 1. **Separate Stages View with Hierarchical Display**
**Current State:** Stages are shown inline in the run details panel
**Proposed Enhancement:** Add a dedicated "Stages" tree view

**Benefits:**
- Better visualization of stage hierarchy (Stages > Jobs > Tasks)
- Easier navigation through complex pipeline structures
- Collapsible/expandable tree structure for nested stages

**Implementation Details:**
- Add `StageTreeDataProvider` similar to their implementation
- Display stages with duration inline (e.g., "Build Stage • 2m 34s")
- Support hierarchical tree: Stage → Job → Task
- Show stage status icons (success, failed, in progress)

**Reference:** `/azure-pipeline-runner-main/src/providers/stage/stage-tree-data-provider.ts`

---

### 2. **View Stage Logs in VS Code Editor**
**Current State:** No direct log viewing in VS Code
**Proposed Enhancement:** Open stage/job logs directly in VS Code editor

**Benefits:**
- No need to switch to browser to view logs
- Leverage VS Code's search, find, and text manipulation features
- Better developer experience staying in the IDE

**Implementation Details:**
- Add "View Logs" command/icon for stages and jobs
- Fetch log content from Azure DevOps API
- Open in new VS Code text document with syntax highlighting
- Format logs (remove timestamps if needed for readability)

**Reference:** `/azure-pipeline-runner-main/src/commands/register-commands.ts` (lines 78-110)

---

### 3. **Load More Builds (Pagination)**
**Current State:** Shows all runs at once (limited by initial fetch)
**Proposed Enhancement:** Implement "Load More" functionality for builds

**Benefits:**
- Faster initial load time
- Progressive loading reduces memory usage
- Better UX for pipelines with many runs

**Implementation Details:**
- Initial load: 5-10 most recent runs
- Add "Load More" button in tree view title
- Load builds in batches of 5-10
- Cache all fetched builds locally
- Progress indicator during load

**Reference:** `/azure-pipeline-runner-main/src/providers/build/build-tree-data-provider.ts` (lines 90-122)

---

### 4. **Show Commit Messages in Run List**
**Current State:** Only shows build number and basic info
**Proposed Enhancement:** Display commit messages alongside run information

**Benefits:**
- Quickly identify what changed in each build
- No need to click through to see commit details
- Better context for build failures

**Implementation Details:**
- Fetch commit message using `sourceVersion` from run
- Display format: `#123 • Fix authentication bug`
- Handle multi-line commits (show first line only)
- Cache commit messages to avoid repeated API calls

**Reference:** `/azure-pipeline-runner-main/src/providers/build/build-tree-data-provider.ts` (lines 124-138)

---

### 5. **Multi-Project Support**
**Current State:** Single project per workspace
**Proposed Enhancement:** Support multiple Azure DevOps projects in one tree

**Benefits:**
- Manage pipelines across multiple projects
- Useful for organizations with many projects
- Single view for all your pipelines

**Implementation Details:**
- Top-level tree nodes: Projects
- Second level: Pipelines (organized by folder)
- Fetch projects list on startup
- Store project context with each pipeline
- Update API calls to include project parameter

**Reference:** `/azure-pipeline-runner-main/src/providers/pipeline/pipeline-tree-data-provider.ts` (lines 28-42)

---

### 6. **Better Folder Handling for Pipelines**
**Current State:** Basic folder support
**Proposed Enhancement:** Improved hierarchical folder navigation

**Benefits:**
- Better organization for large number of pipelines
- Matches Azure DevOps web UI structure
- Easier to find pipelines

**Implementation Details:**
- Parse folder path: `\folder1\folder2\pipeline`
- Create collapsible folder nodes
- Recursive folder tree structure
- Show pipelines at each folder level

**Reference:** `/azure-pipeline-runner-main/src/providers/pipeline/pipeline-tree-data-provider.ts` (lines 98-139)

---

## 🎨 Medium Priority Enhancements

### 7. **Better Duration Formatting**
**Current State:** Basic duration display
**Proposed Enhancement:** More readable duration format

**Benefits:**
- Handles edge cases better
- Shows `<1s` for very short operations
- Consistent formatting

**Implementation:**
```typescript
// Shows: "2h 34m 12s" or "45m 2s" or "<1s"
export const formatDuration = (duration: Date) => {
  const hours = Math.floor(duration.getTime() / 3600000);
  const minutes = Math.floor((duration.getTime() % 3600000) / 60000);
  const seconds = ((duration.getTime() % 60000) / 1000).toFixed(0);

  let formatted = "";
  if (hours > 0) formatted += `${hours}h `;
  if (minutes > 0 || hours > 0) formatted += `${minutes}m `;
  formatted += parseInt(seconds) < 1 ? "<1s" : `${seconds}s`;

  return formatted.trim();
};
```

**Reference:** `/azure-pipeline-runner-main/src/utils/format-duration.ts`

---

### 8. **Progress Indicators for Long Operations**
**Current State:** No visual feedback during API calls
**Proposed Enhancement:** Show progress indicators for loading operations

**Benefits:**
- Better UX during slow API calls
- Users know something is happening
- Reduced perceived wait time

**Implementation Details:**
- Use `vscode.window.withProgress` for long operations
- Show progress in status bar or window
- Include operation description (e.g., "Loading builds for Pipeline X")
- Cancellable progress for very long operations

**Reference:** `/azure-pipeline-runner-main/src/providers/build/build-tree-data-provider.ts` (lines 158-170)

---

### 9. **Open Specific Stage/Job in Browser**
**Current State:** Can open pipeline or run in browser
**Proposed Enhancement:** Direct link to specific stage/job in Azure DevOps

**Benefits:**
- Jump directly to problematic stage
- Faster debugging workflow
- Better deep linking support

**Implementation Details:**
- Construct URL with stage/job IDs
- Handle different states (completed, skipped, in-progress)
- URL format: `https://dev.azure.com/{org}/{project}/_build/results?buildId={id}&view=logs&s={stageId}`

**Reference:** `/azure-pipeline-runner-main/src/commands/register-commands.ts` (lines 50-76)

---

### 10. **Welcome Screen for First-Time Users**
**Current State:** Extension views are empty if not configured
**Proposed Enhancement:** Add welcome content with setup instructions

**Benefits:**
- Easier onboarding for new users
- Clear instructions on configuration
- Reduced support questions

**Implementation Details:**
- Add `viewsWelcome` contribution in package.json
- Show when extension is not configured
- Include PAT requirements and permissions
- Quick link to settings

**Reference:** `/azure-pipeline-runner-main/package.json` (lines 173-178)

---

## 📊 Feature Comparison Matrix

| Feature | Current Project | azure-pipeline-runner | Priority |
|---------|----------------|----------------------|----------|
| Pipeline Tree View | ✅ Yes | ✅ Yes | - |
| Runs Tree View | ✅ Yes | ✅ Yes (Builds View) | - |
| Stages View | ❌ No (inline only) | ✅ Separate View | **High** |
| Run Pipeline | ✅ Yes (with form) | ❌ No | - |
| View Logs in VS Code | ❌ No | ✅ Yes | **High** |
| Load More Builds | ❌ No | ✅ Yes | **High** |
| Commit Messages | ❌ No | ✅ Yes | **High** |
| Multi-Project Support | ❌ No | ✅ Yes | **High** |
| Pipeline Runs Panel | ✅ Yes (webview) | ❌ No | - |
| Run Details Panel | ✅ Yes (webview) | ❌ No | - |
| Rerun Failed Jobs | ✅ Yes | ❌ No | - |
| Pipeline Management | ✅ Yes (rename/delete) | ❌ No | - |
| Folder Support | ✅ Basic | ✅ Advanced | Medium |
| Auto-refresh | ✅ Yes (30s) | ❌ No | - |
| Progress Indicators | ❌ No | ✅ Yes | Medium |
| Welcome Screen | ❌ No | ✅ Yes | Medium |

---

## 🔧 Implementation Roadmap

### Phase 1: Core Enhancements (2-3 weeks)
1. **Separate Stages View** - Most requested, high value
2. **View Stage Logs in VS Code** - Complements stages view
3. **Show Commit Messages** - Quick win, high value

### Phase 2: Scalability (1-2 weeks)
4. **Load More Builds** - Performance improvement
5. **Progress Indicators** - Better UX

### Phase 3: Advanced Features (2-3 weeks)
6. **Multi-Project Support** - Larger feature, requires architecture changes
7. **Enhanced Folder Handling** - Complements multi-project
8. **Better Duration Formatting** - Polish

### Phase 4: Polish (1 week)
9. **Welcome Screen** - Onboarding
10. **Deep Linking to Stages** - Nice to have

---

## 💡 Additional Ideas Not in azure-pipeline-runner

Based on the review, here are features your project already has that they don't:

### ✅ Your Unique Features
1. **Pipeline Runs Panel (Webview)** - Rich, filterable view of runs
2. **Run Details Panel (Webview)** - Detailed run information with stages
3. **Run Pipeline with Form** - Interactive pipeline execution
4. **Rerun Failed Jobs** - Smart retry of only failed stages
5. **Pipeline Management** - Rename, delete, edit pipelines
6. **Advanced Filtering** - Filter runs by state, branch, user, repository
7. **Auto-refresh** - Automatic status updates

**Recommendation:** Keep and enhance these features - they provide significant value!

---

## 🎯 Recommended Next Steps

1. **Review this plan** and prioritize features based on your needs
2. **Start with Phase 1** - High value, relatively straightforward
3. **Incremental development** - Implement one feature at a time
4. **Get user feedback** - After each phase, gather feedback
5. **Maintain your unique features** - Continue enhancing your existing differentiators

---

## 📝 Notes

- Both projects use similar technology stack (TypeScript, VS Code API, Axios)
- Their code is well-structured and documented
- Consider borrowing implementation patterns, not just features
- Maintain backward compatibility during enhancements
- Keep your webview-based panels - they offer richer UI than tree views

---

**Generated:** 2026-01-23
**Based on:** azure-pipeline-runner v0.0.5
**Current Project:** ado-pipeline-vsce
