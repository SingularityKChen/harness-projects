/**
 * 宿主半边：由宿主 Loader 按 patch 行加载，只需要一个 `apply`。
 *
 * 就绪行是验收的正面证据（D10）；controller transport 由 #228 接入后改写本文件。
 */

export function apply(): void {
  console.info('[harness-projects] host ready')
}
