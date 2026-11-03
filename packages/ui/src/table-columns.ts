/** 表格共享的列契约：仅描述呈现几何，宽度单位 px，不保存业务事实或偏好。 */
export const TABLE_COLUMNS = [
  { id: 'title', label: '工作项', minWidth: 160, defaultWidth: 320, maxWidth: 640, optional: false },
  { id: 'identity', label: '内容身份', minWidth: 96, defaultWidth: 104, maxWidth: 240, optional: true },
  { id: 'planningStatus', label: '规划状态', minWidth: 112, defaultWidth: 144, maxWidth: 320, optional: true },
  { id: 'iteration', label: '迭代', minWidth: 128, defaultWidth: 192, maxWidth: 480, optional: true },
  { id: 'targetDate', label: '目标日期', minWidth: 144, defaultWidth: 160, maxWidth: 320, optional: true },
  { id: 'engineering', label: '工程提示', minWidth: 128, defaultWidth: 160, maxWidth: 400, optional: true },
  { id: 'source', label: '来源', minWidth: 144, defaultWidth: 256, maxWidth: 560, optional: true },
  { id: 'freshness', label: '新鲜度', minWidth: 112, defaultWidth: 128, maxWidth: 320, optional: true },
] as const
export type TableColumnId = typeof TABLE_COLUMNS[number]['id']
