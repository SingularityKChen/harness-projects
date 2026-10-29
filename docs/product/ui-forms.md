# 工作区连接表单

创建工作区、规划连接、字段映射、执行配置和仓库绑定保留当前导航。原生form/label/input/select配合少量私有呈现，不引入通用表单框架或另一份确认状态。

字段有稳定唯一标签、简短帮助与错误关联；同名字段/选项保留来源ID，已删除选项显示原身份。主动作最低44px，颜色和字体继承Host；窄宽字段纵向排列，长路径不撑页。

原生required校验聚焦第一个无效输入。异步错误只响应当前表单的用户提交；仓库绑定的中间configured不提前结束焦点归属，确认读回失败仍聚焦安全摘要。后台刷新不无条件抢焦点。

pending、configured、local_only、unknown、failed、active各自使用现有安全source结果；Provider确认/重验前不称已保存。unknown要求确认，失败保留草稿，重试沿用既有意图键和scope规则。

离开表单只取消当前本地尝试，不解绑已确认配置。凭据由Host管理，不新增密钥输入或回显句柄。列表组合保持外层frame覆盖动作，直接嵌套app清零重复padding。

Host确认与完整发布UAT分别记录，详见[实施计划](../exec-plan/completed/2026-10-29-mmp-ui-forms.md)。
