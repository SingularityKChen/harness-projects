import { followWorkspace, type WorkspaceFollower } from '@harness-projects/client'
import type { ClientInjectedContext } from './host-surface.ts'

const NAME = 'harness-projects watch'

/** 在注入子 Context 上打开 workspace watch：宿主 $stream 监督重连，followWorkspace 维护 store（#276）。 */
export function openWorkspaceWatch(child: Pick<ClientInjectedContext, 'remote'>): WorkspaceFollower {
  const follower = followWorkspace((carrierFailed) => child.remote.$stream({
    name: NAME,
    open: (signal) => child.remote.harnessProjects.watch(signal),
    // 插件 bundle 拿不到 RemoteStreamCarrierError（CLIENT_EXTERNAL 为空），宿主结束一代一律终止（TD-058）。
    ended: (accepted) => new Error(accepted ? `${NAME} 在 gap 之外结束` : `${NAME} 在开场 baseline 之前结束`),
    carrierFailed: () => { carrierFailed(); console.info('[harness-projects] watch carrier lost') },
  }), { onReport: (report, generation) => console.info('[harness-projects] watch', report.kind, `r=${report.revision}`, `gen=${generation}`) })
  void follower.done.catch((error: unknown) => console.error('[harness-projects] watch failed', error))
  return follower
}
