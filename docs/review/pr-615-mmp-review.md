# PR #615 · MMP 交付评审

## Purpose / Big Picture

核对 #604 交付与安装验收的边界。首轮结论：一项 P1，阻止本层合并。

## Context and Orientation

2026-11-11 SGT 首轮锁定 `22db967418d891237c7466ea91cee3efa32fbd94`（`feature/release-detail-settings`）对 `37c84f92b1164a9c6e719eb73cd437cb1b198912`（#611）。原生栈 #616：#610 → #611 → #615 → #612。#604 双向关闭引用存在；首轮前无 GitHub review 线程。

## Design / Spec

| 风险 | 分层结论 |
|---|---|
| P0 | 安全正文与读写事务确认保留；未发现提前 Saved 或授权边界被绕过。 |
| P1 | 连接在线仍可能有陈旧条目；新首屏状态缺条目级时效限定，来源身份及最后已知提示在长正文后。违反 #604 可见且诚实的来源／陈旧状态。 |
| P2 | 超长未映射原生状态侵占窄屏弹窗，正文推迟数屏；现有短值夹具不能证明任意长原始元数据换行。 |
| P3 | 无独立 P3；原生遮罩、标签、日期及源组合限制已披露。 |

## Global Constraints

Host 保持事实权威，规划与工程分离；修复不新增 Provider 写入、主题、路由或业务 store。不以源码、fixture 或 CI 代替安装产品验收。

## Plan of Work

修复批次由原实现会话处理一次性 review 的全部意见，补对抗回归和证据。评审会话按新 head / 实际 base 复评；依赖层不先行合并。回滚按原生栈逆序撤各层。

## Validation and Acceptance

在 `.worktrees/release-detail-settings` 对上述固定 head 复核。组合 WorkItemApp 的 connected + stale + 长正文：1440×900 与 390×900 下，时效限定分别落在 y4843 和 y9329；窄屏 320×320、200% 下超长状态使正文从 y1184 才开始。35 项目标浏览器、63 项契约、31 项安全 Markdown 检查及 typecheck 通过；4 项变异中 3 项按归因被检出、禁止长元数据换行的变异存活。23 项证据哈希核对通过；技术 259、文档 271 行。 `gh pr checks 615 -R SingularityKChen/harness-projects` 的当前 Fast Gate、Verify 与 Browser 成功。

## Progress

- [x] 2026-11-11 SGT：独立分层评审、验收反例与现有事项检索。
- [x] 2026-11-11 SGT：由评审账号一次提交 [REQUEST_CHANGES](https://github.com/SingularityKChen/harness-projects/pull/615#pullrequestreview-5851932716)。
- [ ] 复核修复提交及该提交的实际 base、当前门禁和全线程。

## Surprises & Discoveries

#528/#484 为历史状态事项，#606/#607 为日期和 Timeline，#599 为实装；未找到同一详情缺陷的开放 issue。保留唯一对话框与交易 owner，近状态展示精简时效／来源即可。

## Decision Log

2026-11-11 SGT：P1 对应本层明确验收；交原实现会话修，当前提交不合并。P2/P3 与 P1 同轮交接。

## Idempotence and Recovery

从固定 head/base 重跑对应反例；head 或 base 变更即重新定位及复评。保留现有层与其证据，避免与作者同时改动生产文件。

## Interfaces and Dependencies

GitHub 双账号、#616 原生栈及 #599 实装验收。

## Outcomes & Retrospective

首轮验收不成立；绿色检查没有覆盖上述产品场景。规划 Status 与 R1 不由这次评审改变。

## Bottom Change Note

2026-11-11 SGT：记录首轮风险矩阵、关键反例与当前 review。


## 作者修复证据（2026-11-11；不替代首轮评审）

本节只追加作者证据，以上首轮风险、结论、原 SHA 与实测全文保留。首轮 `22db9674` 为历史观察；本次采用服务端 restack 后 head `823ff8faeaf396f6ba95a3b1f004d1db246bd76c`、实际父层 `7aa347b7051b3df38c8a72ac1580fc77b42de539` 开始修复。修复后的独立结论由协调者按新实际 base/head 复评。

| 原线程 | 根因、先 RED 与局部修复 |
|---|---|
| `PRRT_kwDOUekeas61-QtB`（P1） | 组合 WorkItemApp 的 connected、stale 长正文场景先失败：header 无来源／最后已知，live notice 为空。条目 source 与 `stale || refreshing` 现在直接限定 promoted 状态，完整 authority/identity/time 继续留在 dl；1440 与 390 的首屏断言通过。 |
| `PRRT_kwDOUekeas61-QtK`（P2） | 320×320、200% 的真实 1520 字未映射 native 状态先失败：状态头高 4706.5px、正文 y5113.2。通过安全行 key 判 Unknown，头部仅“未知（未映射）”两行约 77.2px；完整原值在新增语义 metadata，1000 字 iteration 与 950 字 external identity 可滚动到达且无水平溢出。旧禁止换行负控被新长值反例检出。 |

安全 key 来自列表已授权安全行，既有 detail-view 契约先 3 项 RED，随后正控、Unknown、撕裂读与遮蔽边全部通过；未按中文显示串猜状态，没有 Provider 依赖或第二事实源。唯一 dialog、布局 observer、读位／草稿／pending 原事务和关闭回焦保留。

本叶分支根执行的命令与恢复路径集中在原 ExecPlan 的 Batch 4。局部详情与投影 35/35、生产 Host 执行／Delivery／设置／Markdown／source-notice 消费者 60/60、boundaries 9/9、typecheck 通过，零 skip。before/after 各自保存真实源文件／fixture／浏览器 bundle／PNG hash；320×320 初始动作区没有变化，另有具名状态与 metadata 滚动位置图，不将滚动后图称为首屏。协调者后续重放、公开 contact sheet、fresh bundle、独立复评及当前远端门仍待完成；本节不宣告 installed／UAT／#599／R1 或 merge 接受。


### 补充 P3 与最终作者订正

复评指出中间修复的“未知（未映射）”会对完全缺失 native 标签的输入多断言未映射。上节“未知（未映射）”／77.2px 与 35 项为中间候选观察，**Superseded by 本节最终中性摘要与 36 项局部验证（2026-11-11）**，保留该历史。

缺失 native 的 SSR 与有 native 的真实组合 browser 各先 RED（22 项中 20 通过、2 失败），随后头部统一“未知”；完整 `未知` 或 `Native Stage（未映射）` 仍在 dl 逐字断言。最终 320×320、200% 状态一行约 38.6px，正文 y552.4；局部 36/36、消费者 60/60、typecheck、boundaries 9/9。没有新增 DTO flag、后缀解析或状态权威；后续独立复评与集成门仍由协调者执行。
