# docs/development

本地开发环境与工具配置。这里写的是"在这台机器上工作需要的设置"，不是产品设计。

## 1. 工具链

| 工具 | 版本来源 | 检查 |
|---|---|---|
| Node.js | `.nvmrc` | `node -v` |
| pnpm | `package.json` 的 `packageManager` | `pnpm -v` |
| GitHub CLI | 系统安装，需 `repo` + `project` scope | `gh auth status` |

```bash
pnpm install     # 建立工作区
pnpm verify      # typecheck + 契约测试
```

## 2. Engram 记忆作用域

Engram 把记忆按"项目"隔离，项目名由 **MCP 进程的 cwd** 决定。本仓库用两处声明把它固定到 `harness-projects`：

| 机制 | 位置 | 作用范围 | 实测结果 |
|---|---|---|---|
| 仓库级声明 | `.engram/config.json`（`project_name`） | 任何以本仓库为 cwd 启动的 Engram MCP 会话 | ✅ `project="harness-projects"`，`project_source="config"` |
| 会话级 preset | `~/.dsh/.agent-presets/harness-projects/`（`--project harness-projects` + cwd 指向本仓库） | 用该 preset 启动的 DSH 会话 | ✅ `project_source="process_override"`，且该 preset 可挂载（`standingKeyFor` 通过） |

**验证命令**（不需要改动任何状态）：

```bash
cd <repo>
node -e '
const { spawn } = require("node:child_process")
const p = spawn("/opt/homebrew/bin/engram", ["mcp", "--tools=agent"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "inherit"] })
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }) + "\n")
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mem_current_project", arguments: {} } }) + "\n")
setTimeout(() => { p.kill(); process.exit(0) }, 5000)
' 2>/dev/null | tail -1
# 期望：{"project":"harness-projects", ..., "project_source":"config"}
```

### 已知边界（v1.20.0 实测）

- **CLI 的一次性命令不读 `.engram/config.json`**：`engram save` 在本目录不带 `--project` 时会把记忆写到**空项目**。用 CLI 写入时始终显式传 `--project harness-projects`：

  ```bash
  engram save "<标题>" "<内容>" --project harness-projects
  ```

- 验证这一点的方法（也是判断该文件是否被采纳的通用办法）：把 `.engram/config.json` 换成非法 JSON，再跑一次 `engram save`。若命令照常成功，说明该路径没有读它。
- `.engram/` 同时也是 `engram sync` 导出分块的位置；两者共用同一目录，不要手工改动其他文件。
- 换仓库时不要改 host-plane 的 Engram 行（它服务另一个仓库），按本仓库的做法新建一个 preset：复制 `standard`，追加同名 `serverName: engram` 的 MCP 行，写死 `--project` 与 `cwd`，然后用 `agentPresets.standingKeyFor(id)` 挂载校验。
