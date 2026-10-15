/**
 * @harness-projects/app-harness-plugin —— Harness 外壳适配
 *
 * Responsibility: Harness 外壳适配：宿主半边（host.ts）与客户端半边（client.ts）由安装件构建分别打成 lib/index.js 与 lib/client.js；本入口只导出包标识，不 re-export 两个半边，避免 Node 侧按包名 import 时把 react 拉进来；不承载业务规则。
 * Allowed imports: @harness-projects/domain、@harness-projects/client、@harness-projects/ui-model、@harness-projects/ui；Host 入口 host.ts、host-composition.ts 与 host-providers.ts 另可 import core、controller、storage-sqlite（ADR-0013）、capabilities 与目录收录的 provider 包（ADR-0014；provider-fake 不放行；client 入口不可达）
 */

export const packageId = '@harness-projects/app-harness-plugin' as const
