import { superviseWorkspace, type SuperviseOptions, type WorkspaceSupervisor } from '@harness-projects/client'
import type { ClientInjectedContext } from './host-surface.ts'

const NAME = 'harness-projects watch'

/** 在注入子 Context 上打开 workspace watch：宿主 $stream 监督载体重连，监督者在三种终止之后有界退避、以新 follower 重新跟随（#276、#229）。 */
export function openWorkspaceWatch(child: Pick<ClientInjectedContext, 'remote'>, options: Pick<SuperviseOptions, 'schedule'> = {}): WorkspaceSupervisor {
  return superviseWorkspace((carrierFailed) => child.remote.$stream({
    name: NAME,
    open: (signal) => child.remote.harnessProjects.watch(signal),
    // 插件 bundle 拿不到 RemoteStreamCarrierError（CLIENT_EXTERNAL 为空），宿主结束一代一律终止，由监督者退避后重开（TD-058）。
    ended: (accepted) => new Error(accepted ? `${NAME} 在 gap 之外结束` : `${NAME} 在开场 baseline 之前结束`),
    carrierFailed: () => { carrierFailed(); console.info('[harness-projects] watch carrier lost') },
  }), {
    ...options,
    onReport: (report, generation) => console.info('[harness-projects] watch', report.kind, `r=${report.revision}`, `gen=${generation}`),
    onRetry: (error, delayMs) => console.error('[harness-projects] watch failed', `retry in ${delayMs}ms`, error ?? '流正常结束'), // 宿主没有报错就结束了流时 error 是 undefined
  })
}
