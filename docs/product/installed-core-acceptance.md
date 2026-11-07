# 已安装 Core 人类验收记录

本记录覆盖2026-11-04至2026-11-07的人工走查，供 #236、#449、#427、#143 收口复用。它记录实际接受的范围，不能将原生PR关联、工程测试或不同Host的旧记录替换成当前Desktop的执行结果。控制计划为[已安装交付链路验收](../exec-plan/completed/2026-11-04-installed-delivery-acceptance.md)。时区为Asia/Singapore。

## 候选与操作身份

| 项目 | 记录 |
|---|---|
| Desktop Host | `0.2.1-rc.5`，人类现有安装与真实项目工作区 |
| 产品源码 | `f0883948f78a9bf0a28290e21c7b1c3842b54cf5` |
| 插件版本 | `0.1.0-demo.1` |
| tarball SHA-256 | `29787f35ab8efbfd9233e5018757687a932bee8cbf0e39c46d82402fcea96cdf` |
| 安装一致性 | 2026-11-06只读核对，12个已安装文件与上述tarball逐字节相同 |
| 项目 | `SingularityKChen/harness-projects`、用户级Project #10；不公开本机目录、凭据或会话地址 |
| 人类角色 | 接收者执行产品检查；协调者记录结果及读取工程证据 |
| 初始批次执行 | 专用 #545只完成准备；当时未创建执行产物。Superseded by 文末2026-11-06实际安装/一次提交记录 |

独立安装另有一条2026-11-06的人类记录：使用同一tarball、固定 `0.2.0-rc.2` Web、干净profile，仅按[安装指南](demo-install.md)完成摘要核对、安装、Documents/native workspace隔离及Projects空工作区入口。人类对四项回复“确认无问题。继续”，见[#236安装接受](https://github.com/SingularityKChen/harness-projects/issues/236#issuecomment-6680184758)。协调者未代替人类执行安装，也没有新采集人类终端日志；这是人类报告的独立安装接受，不是Desktop干净安装或完整Demo的证据。

## 已接受的人工观察

下表的“通过”只覆盖实际提出并得到明确回复的检查。详细原始接受索引见[#449人类记录](https://github.com/SingularityKChen/harness-projects/issues/449#issuecomment-6625125958)。该评论保留历史待定语句；各子项以其后有日期的明确接受记录为准。

| 日期 | 观察与结果 | 适用范围 |
|---|---|---|
| 11-04 | 首屏视觉、布局及已登记改进可接受；#446已关闭 | 当前具体首屏，不等于 #449整体通过 |
| 11-04 | 工作项内容及展示的原生PR关联正常；刷新后任务勾选值正确 | #124当前读取、#508；不证明 #72执行谱系 |
| 11-04 | 详情展开/还原保持同项及阅读位置，Esc关闭回到原条目 | #430/#506 |
| 11-04 | 设置入口、任务切换和返回正常，工作区内容保留 | #447/#485；未保存或改变设置 |
| 11-04 | 宿主与来源分开，确认时间及映射可读，披露展开布局正常 | #528 |
| 11-04 | 光暗主题、缩窄面板清晰，无报告的重叠、截断或整页横向溢出 | 实际人工缩窄；不推定精确1440/1200/1024尺寸量测 |
| 11-04 | Tab/Shift+Tab焦点可见，Enter开详情，模态内控件可达，Esc回焦 | 已检查控件；不是屏幕阅读器审计 |
| 11-04 | Desktop无缩放入口；人类明确接受已有Web缩放证据 | 保留旧Web候选身份，不记为本轮Desktop 200%实测 |
| 11-04 | 标题搜索、筛选、排序/恢复、无匹配/清除正常 | 编号搜索缺口仍为 #537 |
| 11-04 | 列宽调整/重置、隐藏/恢复、长表双轴滚动对齐正常 | #514/#515/#516；不推定所有键盘步长或重启偏好 |
| 11-04 | 普通Markdown、可用代码/表格、A→B→A与刷新、正文及原生PR外链正常 | 排除 #538/#539/#542；原始反馈截图私下保留，未经脱敏不公开 |
| 11-06 | Start Work字段/前置提示、无仓库禁用、分支草稿折叠重开、诚实未开始及PR前置提示通过 | [#143提交前接受](https://github.com/SingularityKChen/harness-projects/issues/143#issuecomment-6680050774)；未提交执行，不推定具体执行模式 |
| 11-06 | 独立干净Web安装四项通过 | #236安装子项；与现有Desktop观察分开 |

#124的创建/连接/三种类型按人类明确决定复用历史记录：2026-10-26 Web，源码 `35693c4985d09a1f2dba5a3ef607ee28d3c97f51`；2026-10-21 Desktop，源码 `3cea57f6`，5个Issue、3个Draft、1个PR且无重复。详见[#124记录](https://github.com/SingularityKChen/harness-projects/issues/124)。当前候选没有新增Draft观察。

## Demo逐步结果

| 步骤 | 实际证据及判断 |
|---|---|
| 1–3 创建、连接、首次读取 | 按上述明确复用决定接受历史记录；当前列表/详情补充只读观察 |
| 4 列表 | 读取/查询/列控制和11-07最终离线/恢复批次均由人类接受 |
| 5 详情 | 当前人工展示/展开/回焦及原生PR关联接受；执行谱系缺口保留 |
| 6 开始工作 | 初始表单检查接受；新候选由人类实际提交一次，返回unknown，原操作保持可追溯 |
| 7 分支与工作树 | 新候选实际产生一套ready context、获准分支与真实worktree；固定fixture字节正确 |
| 8 会话或人工备用 | 原生日志已确认唯一主turn completed、精确任务和停止边界；插件run仍unknown且缺provider ref，#554跟进；本轮Desktop未新注入强制失败，该子项已按人类明确裁决接受复用[Web回滚演练](../development/backup-rollback-rehearsal.md)，保留原Host/日期 |
| 9 创建PR | 人类创建 #555，OPEN/Draft、目标main、ff293c9a已回读；原请求durably saved，Issue原生关闭关联/负责人选择缺口为 #556/#557 |
| 10 Actions/checks | #555 exact-head 16项GitHub checks success；协调者观察实际Desktop同源CI，11-07人类批量确认已通过 |
| 11 同源谱系 | 协调者已在实际安装观察context→branch/head→#555→CI；与空的原生Issue关闭关联分开，11-07人类同源确认已通过 |
| 12 规划字段对比 | GitHub #545执行前后Status均Todo，未设置Iteration/TargetDate；PR创建后再次读回一致。人类最终裁决另记 |

## 原始验收条件与剩余证据

| Issue | 已有证据 | 完成判定及保留边界 |
|---|---|---|
| #236 | 唯一安装指南、逐步用户路径、本轮开放问题清单、独立人类安装 | 原“每项必须属于M4.1或以后”条件保留；11-07后续明确授权将已知开放owner归入M4.1/M5并回读，指南与清单由 #552交付，当前仍OPEN待评审/合并 |
| #449 | 精确安装/包体、同源PR/CI、原操作/重启/离线、主题/窄面板/键盘、Markdown及明确Web尺寸/截图复用裁决 | 11-07人类最终接受并completed关闭/Done；拒绝/撤权/迟到响应采用 #450/#451/#457生产组合浏览器证据，不声称本轮撤销真实账号权限 |
| #427 | #446/#430/#447/#448等实现子项已关闭，上表提供共用UI观察 | 11-07原始Core条件及 #449整体裁决接受，后于 #449关闭并Done；Post-Core工作台不混入本项 |
| #143 | 步骤1–12、原生一次模型/PR/CI、规划前后值、当前重启/唯一性/离线及明确Web人工备用复用均已记录 | 11-07缺陷Demo分类和完整学习检查点获人类接受，completed关闭/Done；不替代R1 |

这些缺口不要求把已接受检查逐单再做一次；一次真实交付链路可共同支撑 #72/#143/#545/#449。原 `f0883948` 安装中 `harness run <branch>` 没有精确有界任务，且没有Draft输入，分别由 #546/#547及 #548跟进；该原候选快照 Superseded by 下文 `64b58137` 实际安装、精确任务原生完成及 #555 Draft创建记录。相关PR的源码或CI不能自行转移安装态接受。是否换候选须另记新身份与受影响的重验范围。

## 同构建包体证据

2026-11-06直接从上述SHA-256的原始tarball提取两份bundle，重新计算长度、gzip level9和内容摘要，均与2026-11-04 14:44 SGT的原构建报告一致。报告工具和产品同为 `f0883948` 干净源码；Node `26.13.0`、pnpm `10.28.2`、esbuild `0.28.2`，Host target为 `node22`。

| 对象 | raw bytes | gzip level9 bytes | SHA-256 |
|---|---:|---:|---|
| `lib/index.js` | 578771 | 137563 | `f265b5813d08b025b1c62bc5bffeb4574ce974ca6b9e8163b6ea50b072337ff5` |
| `lib/client.js` | 684043 | 143827 | `290564d974f8fcdc5a8652978bb1f0a6d135e4c4a898f2d6f656c5a37c0fb031` |
| 整体tarball | 299414 | 已压缩归档，不重复作为bundle gzip口径 | `29787f35ab8efbfd9233e5018757687a932bee8cbf0e39c46d82402fcea96cdf` |

构建报告的client external imports仅为 `react` 与 `react/jsx-runtime`，Host/client均无bundled React；宿主基线包及依赖评价沿用 #428 和已交付各切片记录。本次仅改文档，没有新增产品依赖；这些数字不代表新候选的构建测量，也不替代安装态UI裁决。

接收者可在只含原tarball的目录复核上表字节口径：

```sh
python3 - <<'PY'
import gzip, hashlib, pathlib, tarfile
p = pathlib.Path('harness-projects-app-harness-plugin-0.1.0-demo.1.tgz')
data = p.read_bytes()
print('tarball', len(data), hashlib.sha256(data).hexdigest())
with tarfile.open(p) as archive:
    for name in ('lib/index.js', 'lib/client.js'):
        data = archive.extractfile('package/' + name).read()
        print(name, len(data), len(gzip.compress(data, compresslevel=9, mtime=0)),
              hashlib.sha256(data).hexdigest())
PY
```

## 2026-11-06 历史结论与接续

截至2026-11-06，本轮明确关闭的是 #446；#236/#449/#427/#143仍开放，当前记录不作R1或发布结论。人类已决定 #236保留原条件、暂不收口；文档改进可以独立交付。其余按实际缺口继续，离线留最后。任务编号、Markdown、关系及原生PR快照等新发现见[Demo已知限制](demo.md#已知限制)，不是被本记录默认为修复或发布豁免。

原最后离线提案（现已执行，见文末2026-11-07接受记录）在已连接Desktop执行：联网刷新并打开已知Issue，断网刷新后列表及同项详情保留最后已知值并如实显示陈旧/失败，不出现虚假Saved或CI通过；恢复网络后明确刷新并核对内容/来源恢复、无重复/串项。空Web安装profile不用于此检查；该原待执行语句 Superseded by 文末11-07五项全部通过结果。

## 下一批候选：准备与实际安装分开记录

为继续 #449/#143实际执行，2026-11-06另行准备了本地组合 `64b58137c9fe9607e766e90f82201b31c4cbd9ec`。它从main `609463d8` 合并 #549@`3d80acfd`、#550@`6a28a7a9`、#551@`f5b41ff4`，覆盖明确任务输入、Draft PR与Markdown修复。合并只需收敛文档索引及两处测试断言，产品代码没有手工冲突修复；`apps`/`packages`树与既有组合 `a64f5848` 相同。

新tarball SHA-256为 `d2c9c1b0a7508b7e25ff2c79484e8c81503915c28855fec5812773197e6966c4`，302193 bytes；Host raw/gzip为585631/138946 bytes，Client为688587/145120 bytes，gzip level9。与原候选相比，Client gzip增加1293 bytes，无新增input或external import；七份migration及peer依赖范围均不变。这不构成数据库兼容或发布接受裁决。

该干净源码已通过类型检查、208项范围测试、49项安装件/边界检查、17项组合浏览器检查，均无失败或跳过；这些范围命令见控制计划。在该准备快照时，候选没有安装到人类profile，没有调用模型或创建测试PR。Superseded by 下节实际安装与单次提交记录。上文所有人工接受仍属于旧候选，不能提前转移到新包；人类安装后应先核对12个实际文件，再复验任务/Draft/Markdown及继续真实链路，完整关闭仍需剩余原条件与人类裁决。

## 2026-11-06 实际安装与一次提交

18:33 SGT只读核对12个安装文件全部匹配 `64b58137` 的 `d2c9c1b0…` tarball；Desktop Host已更新为 `0.2.2-rc.1`。既有rc.5人工接受不自动扩大到该Host。当前原生UI可读取真实Project、#545、任务输入和Draft选择；这些是协调者实际观察，不是完整人类UI裁决。

通过正式UI启用两执行绑定后，设置页持续显示处理中；SQLite只读证实已存在预期pair。返回工作区并重进设置可读回已启用，#553独立跟进。该步骤未启动执行，也未直接写库。

人类随后实际提交一次固定任务。18:50 SGT回读：context `ctx-a4d2d10426d31097d98a7683bd299c3d` 为ready，分支为 `test/desktop-uat-20261104`，worktree属于获准仓库。run `run-ae24bda6a6f916e8b3debe6731983eda` 与原Start Work mutation为unknown，provider ref为空。刷新不能确认原运行终态；#554跟进。不能将“生成文件”改写成“模型已成功结束”，也不能以第二次启动代替读回。

固定fixture已存在且与批准正文/末尾换行逐字节相同，SHA-256 `63280ed805e84652e0a459dfb9c91edaef311c47f61e42d20887a2127d892b5b`。当次Git只读观察只有该fixture未跟踪，HEAD仍为 `609463d8`；协调者没有提交、推送或创建测试PR。原会话内容和结束状态仍需核对，Mac锁屏使原生UI核对暂停，等待人类手动解锁。Superseded by 下节2026-11-07原生终态取证；插件unknown状态未被改写。#143/#449/#427仍未获得整体通过裁决，#236继续按人类决定保留原条件。

## 2026-11-07 原生完成与交付准备

只读原session日志证明：唯一主turn于11月6日18:47:10.213–18:47:32.517 SGT执行，`turn/end.reason.kind=completed`；user rpcId精确指向原context。实际prompt SHA-256 `a18cc397c4ee02d084b6a9137050bd2ea384234ead1cda905240cddc07b826a3` 与持久startRun command一致，包含固定正文和停止边界。最终消息来源为deepseek-official/deepseek-v4.1-flash；标题生成请求单独记录。五次有界shell调用只核对现场/指令、创建与验证fixture，未commit/push/创建PR或调用子模型。

这使原模型“是否完成”得到确认，不代表产品恢复完成。11月7日复核安装仍12/12匹配 `64b58137`，Host仍 `0.2.2-rc.1`；单个run及attempt仍unknown、provider ref仍空。#554保留，本地日志关联没有通过修库冒充支持的恢复操作。

协调者按原授权完成测试commit `ff293c9a3233bab3f5f982092a6bfed326211f60`，推送 `test/desktop-uat-20261104` 并读回远端SHA一致。相对原base只新增145 bytes/4行固定fixture；空白、规模与公开面检查通过，无产品代码改动。原生PR表单填写目标main、英文测试标题与证据/回滚正文，交由人类勾选Draft后提交一次。此记录时尚无已确认PR，Superseded by 下节实际 #555创建记录；最终保持不合并。#545精确任务到达和模型单文件边界两项已勾，其余验收保持未完成。

## 2026-11-07 人类创建Draft PR与元数据反馈

人类提交后报告“已保存原请求（草稿 PR）：test(tests): Record installed Desktop delivery fixture；test/desktop-uat-20261104 → main”。[#555](https://github.com/SingularityKChen/harness-projects/pull/555)实际为OPEN/Draft，head为 `ff293c9a3233bab3f5f982092a6bfed326211f60`，唯一差异为固定fixture。SQLite只读回执证实PR mutation saved、draft=true及原context一致；Start Work原attempt仍unknown且未重复。

16项actual GitHub checks在该head完成SUCCESS。协调者在Host `0.2.2-rc.1`实际刷新交付谱系，展开原生标识看见 #555、对应提交与通过的流水线/检查，run继续诚实显示unknown。刷新中旧CI一度标为最后已知/unknown，确认后才显示通过。该时点是协调者实际产品观察；其待确认状态 Superseded by 下节11-07人类五项均正常结果。

人类同时报告缺少关联Issue和用户。双向GitHub原生关闭关联均为0，表单只含base/title/body/Draft，正文使用Refs；“来源已确认无原生关闭关联”符合现有来源结果。11-07进一步原生回读已找到 #555→#545的 `CrossReferencedEvent`，`willCloseTarget=false`；当前面板只读关闭连接，因此没有展示该普通引用。#556按后续人类授权采用默认正文引用、可选合并关闭及两类原生关系展示，#544同步持久化边界；这是方案更新，不是当前候选已具备该入口。PR作者由认证账号存在，Assignees为0；负责人选择单独记为 #557，不把它误当原生关联缺失的原因。没有手工补关系/赋人掩盖缺口。

测试PR按既有唯一性检查范围加入Project #10，原生Project membership回读恰好1条，机械Kind/Area为test/tests；#545规划Status仍为Todo，未写Status/原生依赖/里程碑。该批最初提出同源CI、保存原操作读取、正常退出/重开保留且无新run、PR唯一和Markdown修复；该待验快照 Superseded by 下节人类五项正常及最后离线通过记录。#236仍保留原条件，#449/#427/#143整体裁决单独保留。

## 2026-11-07 最后人工批次及最终裁决提案

人类对五项明确回复“五项均正常”：同context/ff293c9a/#555/CI一致；读回原操作仍为同一Draft；正常退出并重开Desktop保留context/分支/Draft、run仍诚实unknown且无新执行；Project列表中测试PR仅一条；#308等原样例的额外任务圆点与正文HTML注释已消失。只读复核仍为1个context、1个run、1个saved PR创建请求，#545 Status保持Todo。

人工备用采用一条显式复用裁决：人类接受2026-11-04实际Web演练，Host `0.2.0-rc.2`，原包SHA-256 `29787f35…`，强制启动失败后manual_fallback、工作树和多次重启上下文保留。它不记作本轮Desktop `0.2.2-rc.1`的新故障注入。该演练原有设置反馈现象已由 #553继续跟进，原记录没有被改成无问题安装。

新Host界面三项也明确正常：当前光暗可读、窄面板/展开还原/长文本控件无重叠截断、Tab/Shift+Tab/Esc/回焦正常。人类明确接受精确1440/1200/1024、200%及对应截图沿用已有真实Web/组合浏览器记录，保留各自来源身份，不记成本次Desktop尺寸量测。原始用户截图及本轮原生界面截图只私下保留，未将包含账号/侧栏的原图公开。拒绝/撤权/迟到响应沿用 #450/#451/#457生产组合浏览器证据，最终整体裁决需要明确包含这项来源边界；本轮未撤销真实账号权限。

最后断网/恢复五项在原Desktop完成，人类回复“五项均正常”：联网基线清晰，断网刷新后列表保留最后已知值并提示陈旧/失败，同详情正文及交付事实诚实降级，无虚假Saved/新CI通过，恢复联网后内容/来源/PR/CI正常且无重复串项。#124唯一剩余离线条件取得人类证据；#72缺少的同源真实PR/CI展示也已明确接受。

对学习检查点的缺陷分类提案为：#553设置确认反馈、#556来源Issue关联选择、#557 PR负责人选择是非基本跟进；#554是平台集成/运行身份恢复缺陷，原生任务已完成且PR/CI链路成立，但产品run仍unknown。提议人类将它作为本次Demo非基本缺陷接受记录并独立修复；这不是R1豁免或允许发布的风险接受，#459/#73仍须对实际发布路径逐项裁决。原编号/引用/关系/原生PR快照改进继续独立跟踪，不在本轮虚称修复。

当时提请最后人类裁决的具体对象为 #449、#427、#143，以及已达到原条件的 #124、#72；该待批准状态 Superseded by 下一节实际裁决与关闭结果。若人类明确接受并批准，将分别记录条件/证据，关闭这五项并只把对应Project Status置Done；在批准前不执行关闭或Status写入。#236原milestone条件保留、继续OPEN；测试PR #555继续Draft/unmerged。整个结果不等于 #73发布go/no-go，也不提前接受未来构建。

## 2026-11-07 最终人类裁决

人类在点名 #449/#427/#143及 #124/#72关闭/Done、披露 #554仍unknown但原生completed、历史证据复用/未实际撤权及R1独立判断的具体提案下，回复“后续有Issue 追踪的都可以关闭并 done”。据此接受上述精确候选的本轮界面与Demo学习走查，并批准关闭这五项、仅将其Project #10 Status置Done。前节“待最后裁决”状态被本节替代；2026-11-07 11:17 SGT已逐项写入并回读：#124/#72/#143/#449/#427均CLOSED/COMPLETED、Project Status均Done。未扩大到其他Issue或发布。

#553/#554/#556/#557与原改进项继续由独立Issue跟踪。#554按本次Demo非基本跟进处置，R1 #459/#73仍必须对实际发布风险单独裁决；本次整体接受不表示产品已恢复原run身份。#236当时按原milestone条件保持开放，该归属缺口 Superseded by 下节11-07后续授权与回读；#555继续Draft/unmerged。后续候选变化按受影响范围重验，不将本记录自动套用到未来产物。

| 目标 | 最终状态 | 保留边界 |
|---|---|---|
| #124 | CLOSED / COMPLETED；Done | 离线最后完成，历史类型/连接证据保留原身份 |
| #72 | CLOSED / COMPLETED；Done | 实际context/branch/head/#555/CI已接受，原生关闭关系单独跟进 |
| #143 | CLOSED / COMPLETED；Done | Demo学习走查接受，#554保留独立缺陷且不豁免R1 |
| #449 | CLOSED / COMPLETED；Done | 精确候选及明确复用证据接受，未来变化受影响重验 |
| #427 | CLOSED / COMPLETED；Done | Core父项接受，Post-Core #460仍独立 |
| #236 | OPEN；原Status | 原milestone条件保留、归属已按后续授权补齐；文档待 #552评审/合并 |
| PR #555 | OPEN / Draft；unmerged | 不ready、不合并、不清理 |

## 2026-11-07 后续方案与指南交付

人类要求修改相关Issue描述、指定milestone并修订 #552。M4.1承接 #223/#283的剩余收敛与 #544/#546/#553/#554/#556；M5承接 #537/#539/#543/#557，既有 #144/#278/#235的M4.1和 #538/#542的M5保留。#223/#283的MMP-Core与原验收没有因此延期或豁免。本批只写Issue正文/标题/milestone；回读Status/Engineering一致，#553/#554的iteration同期从10变为9，保留该现值而不覆盖。

指南已就地消除“完整走查未执行”的过期说法，将任务输入/Draft/Markdown的旧候选限制与当前实测分开。#546仍开放以逐项核销父单工程证据，不再表示当前精确任务没有进入session。#236保留原四项要求，按独立安装、开放owner的实际milestone和本PR文档检查核销；Issue继续开放等待 #552评审/合并，安装和Demo人验无需重做。本记录不作R1发布结论。

## 2026-11-07 最终Markdown安装补验与R1分项

人类要求最新main包后，协调者从干净远端 `04af317ec3bda5084ab1e44ea5e3559fd4622079` 打包，302917 bytes、SHA-256 `32e0dd1bb5574fb7828278c2817d68aa01f269624b14c85ccb33534e32387b58`，插件版本仍为 `0.1.0-demo.1`。实际安装12文件全部匹配；相对 `64b58137`归档只改变client bundle，产品源码只改变 `safe-markdown.ts`，Host bundle、manifest/peers、七份migration均相同。62项Markdown/安装件检查通过，无失败/跳过。

人类对 #542正文末三项回复“均无问题”：正文真实注释隐藏且相邻文字保留、inline/fenced code中的注释可读、惰性HTML字面量与尾部保留。该结果覆盖 #551最终parser修正，不把旧包检查冒充新包。#538展示样式源码未变，其已接受的实际主题/窄面板/展开和具名Web缩放复用仍保留原身份。已按既有关闭已接受项的指令，分别核销原条件、关闭 #538/#542并设Done，远端回读一致。

人类随后点名继续 #459/#369/#304。#369已有2026-11-04 14:51–15:16 SGT官方Web `0.2.0-rc.2`的备份、旧包回滚、原路径恢复和换回当时当前包演练，原source/两包摘要与限制见[原记录](../development/backup-rollback-rehearsal.md)。人类明确选择“接受并登记、关闭 #369 / Done”，批准在 #73登记R1条件12满足；批准先写入控制计划并发布，再执行关闭/Done。#73的条件12记录和 #369关闭/Done均已回读。没有在当前Desktop再做破坏性演练，也未将这个分项接受写成整体R1通过。

#304的当前7文件591项检查通过，旧owner隔离和最多一次执行成立；真实 #554仍丢失原session身份，产品无法读回已完成run，触及父项“不丢句柄、可恢复”。#304保持开放；该安装快照时 #559尚未合并，后续源码合并见文末推进记录，不计作该安装候选证据。#459的当前8文件324项通过、23入口及12+10映射见[边界审计增量](core-release-audit.md#2026-11-07-当前安装候选核对增量)；九finding、原Core义务、全量风险归级、同head连续两次CI与评审/修复容量缺口保留，因此 #459保持开放。

人类只确认本人可继续UAT，评审/修复容量尚未确认。没有推断具名Reviewer已承诺或11月8日必发；#73及其余条件未关闭、#555仍Draft/unmerged，未新增模型请求或业务库写入。

| 本批目标 | 回读结果 | 判定边界 |
|---|---|---|
| #538/#542 | CLOSED / COMPLETED；Done | 原条件核销，最终parser另有新包人验 |
| #369 | CLOSED / COMPLETED；Done | 原Web演练获人类接受，#73仅条件12满足 |
| #304 | OPEN；原Status | #554原run身份/恢复及ADR具体设计核对仍保留 |
| #459 | OPEN；原Status | 当前RC证据/风险/CI稳定性与剩余容量待收口 |
| #73 | OPEN；原Status | 仅登记人类条件12裁决，没有整体发布批准 |

## 2026-11-07 固定测试核销与源码推进

人类点名推进 #552、#545，并告知 #559已合并。实时回读确认 #559合并提交为 `1ad2411ef7b7e8ef846c98c72a6e352021a9694c`，随后 #560合入main `45330b54c7c786f81e3453254210440437e6fd3b`。#559修复新启动的durable session/request checkpoint及迟到结算，#560修复设置反馈与原位恢复；均不把旧安装中的无ref记录补写为成功，也未完成本轮新包接受。

#545原五项条件已逐项核销。第二项允许“实际session或诚实分类的失败/人工路径”：已安装产品的一个真实context/分支/工作树与 `unknown/result_unknown`原样记录，原session的completed另有匹配证据；这一核销不表示产品已恢复原run，也未将unknown改成manual_fallback。固定文件SHA-256为 `63280ed805e84652e0a459dfb9c91edaef311c47f61e42d20887a2127d892b5b`，实际commit为 `ff293c9a3233bab3f5f982092a6bfed326211f60`；新鲜GitHub回读确认 #555仍为OPEN/Draft、只有该4行fixture且未合并。人类已接受同源PR/CI、重启、唯一成员和最后离线批次，原before/after规划字段快照保留。

按既有“有独立跟进的已接受项可关闭/Done”和本次具体推进请求，#545关闭/Done，只改变该测试单本身；#554继续承接原缺失身份、实际Host失败边界及安装恢复接受。#235也已逐条验收关闭/Done，#553随 #560工程交付关闭；指南开放owner不再列这两项。#561编号搜索、#564来源普通引用观察及 #565来源Issue关系选择已交付到当前源码，均不改变已接受安装候选 `64b58137` / `04af317e` 的证据身份；#556父项及安装接受仍开放，#544快照持久化与 #557负责人选择分别跟进。

本段没有新真实模型请求、数据库修复或新安装。`64b58137` / Desktop `0.2.2-rc.1`的完整走查、`04af317e`的Markdown补验、Web历史复用分别保留身份。#236仍等待 #552文档评审/合并；#554/#304/#459/#73保持独立，#555保持Draft/unmerged。2026-10-29 UI框架计划保持原内容；2026-11-04本有界文档交付计划已归档completed。历史推进回执保存在运行态证据中。
