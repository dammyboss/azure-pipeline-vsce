# Changelog

All notable changes to the Azure DevOps Pipelines extension will be documented in this file.

## [0.5.5] - 2026-02-13

### Added
- **Automatic Tenant Detection**: Intelligent multi-tenant authentication with auto-discovery
  - Automatically detects all Azure AD tenants the user has access to
  - Shows tenant picker with friendly names and domains instead of manual GUID entry
  - Uses Microsoft Graph API and Azure Management API for comprehensive tenant discovery
  - Loading indicator with progress notification during tenant discovery
  - Graceful fallback to manual tenant ID entry if auto-detection fails
  - Eliminates need to copy/paste tenant IDs from Azure Portal

### Improved
- Enhanced authentication flow for multi-tenant scenarios
- Better user experience when switching between tenants

## [0.5.4] - 2026-02-10

### Added
- Subdirectory Pipeline Support - Fixed YAML fetching for pipelines stored in subdirectories
- Improved API Performance - Added 30-second timeout to prevent indefinite hangs during API calls
- Enhanced Git Items API Integration - Updated to use official Microsoft Learn Git Items API specification
- Full YAML Path Display - Pipeline editor now shows complete repo/path

### Fixed
- Fixed Runtime Parameters Issue - Resolved "variables not settable at queue time" errors
- Pipeline Form Loading - Fixed issue where "Run Pipeline" forms were getting stuck during loading

### Improved
- Better Error Handling - More informative error messages and graceful fallbacks
- Performance Optimizations - Reduced loading times and improved overall responsiveness

## [0.4.0] - Previous Version

### Features
- OAuth 2.0 authentication with Microsoft accounts
- Pipeline management and execution
- YAML editor integration
- Run history and logs
- Real-time pipeline status updates

---

**Note:** This extension is actively maintained and regularly updated with new features and improvements.

For detailed feature information, visit the [GitHub repository](https://github.com/dammyboss/azure-pipeline-vsce).
