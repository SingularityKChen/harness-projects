# 发布面检查

本仓库是 public。发布面包括 commit、branch、tag、PR ref、PR 描述和 Actions 日志；已推送内容不能靠后续删除完全回收。

## 机械检查

提交前检查暂存区；开 PR 前检查相对 base 的完整差异：

    node scripts/rule-checks.mjs disclosure <base-ref>
    node scripts/rule-checks.mjs size <base-ref>

disclosure 检查 base 新增行、每个提交新增行、commit message 和 PR_BODY。workflow 通过 env 传递事件文本，不在 shell 中展开。命中只显示文件、类别和打码摘要；命中先加后删时必须重写历史并由人类决定是否清理旧 run。

## 人工五类目

逐项检查凭据、本机路径和身份、账号与个人信息、内部系统、保密字样。真实值改成 <workspace>、<host>、<runner-name> 或 $DSH_HOME/... 等占位符；不要在 workflow 输出 hostname、pwd 或临时绝对路径。

机械检查不覆盖任意口令、业务秘密、标题和分支名。人工检查与机械检查是两道独立门，不能用绿的 advisory job 代替人工判断。
