/**
 * 分支名校验：在任何 Git 调用之前拒绝本地 Git 无法安全使用的名字（`AGENTS.md` §7）。
 * 规则表逐条携带自己的原因——规则清单在表里，不在这里重述；拒绝码是 `invalid_input`：这些名字 git
 * 自己也会拒绝（`\s` 已收窄成 ASCII 空格，与 git 的 refname 规则逐名对照后漏判 0、误判 0），但必须
 * 在调用 Git **之前**拒绝，否则纯输入错误会落进写命令兜底。
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/[\u0000-\u001f\u007f]/, '不得包含控制字符'],
  [/ /, '不得包含空格'],
  [/[~^:?*\[\\]/, '不得包含 ~ ^ : ? * [ \\ 之一'],
  [/\.\./, '不得包含 ..'],
  [/\.$|(^|\/)\./, '整名不得以 . 结尾，斜杠分量也不得以 . 开头'],
  [/\.lock$|\.lock\//, '不得以 .lock 结尾，斜杠分量同样'],
  [/\/\/|\/$|^\//, '的斜杠分量不得为空'],
  [/@\{/, '不得包含 @{'],
  [/^HEAD$/, '不得是 HEAD 等保留名'],
]

/** 返回拒绝原因；合法名字返回 undefined。 */
export function branchNameProblem(raw: string): string | undefined {
  const name = typeof raw === 'string' ? raw : ''
  if (name.trim() === '') return '分支名不能为空'
  if (name.startsWith('-')) return '分支名不得以 - 开头'
  const rule = RULES.find(([pattern]) => pattern.test(name))?.[1]
  return rule === undefined ? undefined : `分支名${rule}`
}
