/**
 * @harness-projects/ui —— 共享 React 页面与组件
 *
 * Responsibility: 共享 React 页面与组件；不得直接调用任何外部平台 API。
 * Allowed imports: @harness-projects/domain、@harness-projects/client、@harness-projects/ui-model
 */

export const packageId = '@harness-projects/ui' as const
export { HARNESS_PANEL_TITLE, PlaceholderIcon } from './placeholder.ts'
export { WorkItemListPage } from './work-item-list.ts'
export type { ItemNavigation } from './work-item-list.ts'
export { WorkItemDetailDrawer } from './work-item-detail.ts'
export { WorkItemProjectPage } from './work-item-project.ts'
export { WorkItemApp, bindWorkItemApp } from './work-item-app.ts'
export type { WorkspaceSource } from './work-item-app.ts'
export { EmptyState, FreshnessBadge, LoadingState, SourceBadge, StaleBanner, UnavailableState } from './list-states.ts'
export { browserHistoryPort, createItemNavigation, itemPath, parseItemRoute } from './item-route.ts'
export type { HistoryPort, ItemRoute } from './item-route.ts'
export { ExecutionContextSection } from './execution-context-section.ts'
export { WorkspaceSetupGate, bindWorkspaceSetupApp } from './workspace-setup.ts'

export * from './repository-binding.ts'
export { StartWorkSection } from './start-work-section.ts'
