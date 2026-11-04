# 停机备份、产物回滚与原路径恢复

本流程适用于[安装指南](../product/demo-install.md)固定的官方 `0.2.0-rc.2` Web profile。它不提供自动备份、数据库降级、跨 profile 迁移或外部执行撤销。一次实际演练见[演练记录](backup-rollback-rehearsal.md)；R1 条件12仍由人类在 #73 判断。

## 1. 准备同一 profile 的恢复材料

先按安装指南建立专用 sandbox，核对 `DSH_HOME`、Documents overlay、生效配置和官方 launcher 提供的 `profileContext.dir`。数据库只能取该目录下的 `harness-projects/workspace.sqlite`，不能只按环境变量猜位置。整个回滚与恢复保留相同的 profile、数据库路径、本地仓库和 worktree realpath。

保留当前 tgz、拟回滚 tgz、各自的 SHA-256、精确 source/tree、Host 版本和数据库基线。版本名相同不代表安装件字节相同。迁移 SQL 相同只是配对检查的一部分；还须核对 schema generation、配置语义、Host ABI，并实际验证旧包能读取该库。旧包存在已知执行缺陷时，只允许本流程中的明确只读验证，不叫作“已知良好可继续执行”。不匹配就停止，不改 `user_version`，不删库绕过拒绝。

从原凭据服务继续提供同一 issuer 与规划凭据。数据库备份不备份 secret 值；只有句柄不能重新签发或验证人工执行凭据。环境变量适配必须让每次启动继承同一原值，不打印、不写进 manifest；本流程不建立另一套 secret 存储。

下面变量均指向已核验的原 sandbox。沿用安装指南的 `HP_DEMO_SCRATCH`；产物路径从本次交付记录选择，不能把新旧同一包改名充数：

```sh
HP_REHEARSAL_ROOT="$HP_DEMO_SCRATCH"
HP_REHEARSAL_PROFILE=web
HP_REHEARSAL_DB="$DSH_HOME/profiles/$HP_REHEARSAL_PROFILE/harness-projects/workspace.sqlite"
HP_REHEARSAL_BACKUP="$HP_REHEARSAL_ROOT/backups/initial.sqlite"
```

另保存 `HP_REHEARSAL_CURRENT`、`HP_REHEARSAL_ROLLBACK`、`HP_REHEARSAL_PATCH` 的绝对路径及已审核摘要。操作前将路径规范化，拒绝 `..`、符号链接、逃逸 sandbox 和已有 backup 目标。本流程保留原件，默认不清理。

备份前从产品列表与执行区记录非空样本：工作项身份、context/run ID、状态、原 worktree、分支/head、用户文件摘要。记录 Planner 与工程事实的区别；备份、回滚和恢复都不改 Planning `Status`。用户仓库和工作树不在数据库快照里，须另外保护；数据库时间倒退不能撤销外部 PR、已接纳会话或人工工作。

## 2. 停止写入并生成一致快照

等待命令结束，停止该 profile 的 Web Host、CLI 辅助写入者和其他数据库持有者。保存启动 PID、正常退出结果；核对该进程组已退出，再用 `lsof` 核对主库及存在的 sidecars 无打开者。只关闭浏览器不算停机；PID 不明、权限不足或存在打开者时停止，不创建备份或覆盖目标。

在原 sandbox 操作者的 shell 中执行以下命令。它使用 SQLite Backup API，源为只读 URI，目标以排他方式创建；不是复制活动主文件。失败产生的目标也保留，重新尝试须选新的目标。

```sh
python3 - "$HP_REHEARSAL_ROOT" "$HP_REHEARSAL_DB" "$HP_REHEARSAL_BACKUP" <<'PY'
import hashlib, json, os, sqlite3, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
def inside(value, exists=True):
    p = Path(value)
    assert p.is_absolute() and '..' not in p.parts
    assert p.resolve(strict=exists).is_relative_to(root)
    for part in (p, *p.parents):
        if part == root:
            break
        assert not part.is_symlink()
    return p
source = inside(sys.argv[2])
target = inside(sys.argv[3], False)
assert source.is_file() and not target.exists()
target.parent.mkdir(parents=True, exist_ok=True)
files = [source, *[Path(str(source) + s) for s in ('-wal', '-shm', '-journal')]]
files = [p for p in files if p.exists()]
probe = subprocess.run(['lsof', '-t', '--', *map(str, files)],
                       capture_output=True, text=True)
assert probe.returncode in (0, 1) and not probe.stdout.strip()
def inspect(p):
    c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)
    try:
        assert c.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        assert c.execute('PRAGMA foreign_key_check').fetchall() == []
        schema = c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema "
                           "WHERE name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        names = [r[0] for r in c.execute("SELECT name FROM sqlite_schema "
                                        "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        rows = {n: sorted(c.execute('SELECT * FROM "' + n.replace('"', '""') + '"').fetchall(), key=repr)
                for n in names}
        digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True,
                           ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        return {'generation': c.execute('PRAGMA user_version').fetchone()[0],
                'schemaSha256': digest(schema), 'rowsSha256': digest(rows),
                'tableCounts': {n: len(v) for n, v in rows.items()}}
    finally:
        c.close()
before = inspect(source)
assert before['tableCounts'].get('workspace_projection', 0) > 0
s = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
try:
    os.close(os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    d = sqlite3.connect(target)
    try:
        s.backup(d)
    finally:
        d.close()
finally:
    s.close()
assert inspect(source) == before == inspect(target)
proof = {**before, 'backupSha256': hashlib.sha256(target.read_bytes()).hexdigest()}
receipt = Path(str(target) + '.json')
with receipt.open('x') as f:
    json.dump(proof, f, ensure_ascii=False, indent=2)
print('backup verified; keep the database, receipt and original files privately')
PY
```

`integrity_check`、外键检查、基线与全表逻辑摘要必须同时通过。清单仅存摘要和计数，仍按私有运维材料保管；不要将整个数据库、用户内容或机器路径公开。单独归档原数据库与原 sidecars、配置清单和 Git 现场，但不把旧 sidecars 拼接进恢复快照。

## 3. 安装匹配的旧产物并只读核对

确认仍已停机；使用同一个 `DSH_HOME`、profile 和 overlay：

```sh
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile "$HP_REHEARSAL_PROFILE" remove @harness-projects/app-harness-plugin
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile "$HP_REHEARSAL_PROFILE" add "$HP_REHEARSAL_ROLLBACK"
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile "$HP_REHEARSAL_PROFILE" --patch "$HP_REHEARSAL_PATCH" --dump-config
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_REHEARSAL_PATCH" --no-open --port 0
```

逐一核对旧 tgz 中的 12 个安装文件与实际安装目录的摘要，不能只看 manifest 版本或“host ready”。再次确认 Documents 与 profile 数据根未变。会话地址包含访问材料，只在本机使用，不写入公开记录。

从实际安装的产品读回非空列表、指定工作项和执行上下文；核对 context/run 身份与状态、原 worktree 与分支。查询仍可触发来源同步，观察到的数据新鲜度须照实记录。不要点击 Start Work、resume、cancel 或创建 PR 来“验证恢复”；这些会产生新的外部事实，不属于本次只读回滚。

## 4. 停机，在原 dataPath 恢复

再次按 §2 确认 Host 进程组和数据库打开者都已退出。先检查备份和 receipt：缺失、损坏、摘要不符、generation/schema 不匹配均拒绝。检查完成之后，才把现有主库及 sidecars 移入本次根内一个不存在的隔离目录。保留它们原来的摘要；恢复不混用任何旧 journal/WAL。

下面执行原路径恢复。它首先校验独立备份，使用 Backup API 新建主库，不覆盖已有目标；验证或复制失败时保持 Host 停止，保留 backup 和隔离原件，不自动回填或删文件。

```sh
python3 - "$HP_REHEARSAL_ROOT" "$HP_REHEARSAL_DB" "$HP_REHEARSAL_BACKUP" <<'PY'
import hashlib, json, os, sqlite3, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
def inside(value):
    p = Path(value)
    assert p.is_absolute() and '..' not in p.parts
    assert p.resolve(strict=True).is_relative_to(root)
    for part in (p, *p.parents):
        if part == root:
            break
        assert not part.is_symlink()
    return p
db, backup = map(inside, sys.argv[2:4])
assert db != backup
proof = json.loads(Path(str(backup) + '.json').read_text())
assert hashlib.sha256(backup.read_bytes()).hexdigest() == proof['backupSha256']
s = sqlite3.connect(backup.as_uri() + '?mode=ro', uri=True)
try:
    assert s.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    assert s.execute('PRAGMA foreign_key_check').fetchall() == []
    assert s.execute('PRAGMA user_version').fetchone()[0] == proof['generation']
    schema = s.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema "
                       "WHERE name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    actual = hashlib.sha256(json.dumps(schema, ensure_ascii=False,
                separators=(',', ':')).encode()).hexdigest()
    assert actual == proof['schemaSha256']
    files = [p for p in (db, *[Path(str(db) + x) for x in ('-wal', '-shm', '-journal')]) if p.exists()]
    probe = subprocess.run(['lsof', '-t', '--', *map(str, files)],
                           capture_output=True, text=True)
    assert probe.returncode in (0, 1) and not probe.stdout.strip()
    quarantine = root / 'original-before-restore'
    quarantine.mkdir()
    for p in files:
        inside(str(p)).rename(quarantine / p.name)
    os.close(os.open(db, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    d = sqlite3.connect(db)
    try:
        s.backup(d)
        assert d.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        assert d.execute('PRAGMA foreign_key_check').fetchall() == []
        names = [r[0] for r in d.execute("SELECT name FROM sqlite_schema "
                                        "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        rows = {n: sorted(d.execute('SELECT * FROM "' + n.replace('"', '""') + '"').fetchall(), key=repr)
                for n in names}
        restored = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False,
                    separators=(',', ':')).encode()).hexdigest()
        assert restored == proof['rowsSha256']
    finally:
        d.close()
finally:
    s.close()
print('restored at the original path; retain quarantine and perform product readback')
PY
```

使用与该备份匹配的旧包，在原 profile 重启并重复产品读回；对照 §1 的工作项集合、context/run、状态、worktree/分支/head和用户文件摘要。文件可保留未提交修改。仅查到 SQLite 行不够；换目录查到行也不算原执行上下文可恢复。备份不恢复凭据、Git 文件或外部平台对象，运行记录仍是已发生事实，不自动再次执行。

需要返回当前包时，再停机并按 §3 的 remove/add 换成 `HP_REHEARSAL_CURRENT`，重复安装文件、产品 reader 与 Git 现场核验。任何阶段失败都保留原件、备份、产物和错误记录；先重新确认匹配关系，禁止以删库或改基线修复。

## 5. 记录与判定

记录实际日期/时区、Host/Node、两份 source/artifact/schema、停机证据、四步顺序、非空读回、Git/用户文件、负控和失败。将 synthetic seed、真实来源读取、实际安装、局部合同测试分开；没有做的项目写明未做。公开记录只含可分享摘要，不含 token、issuer、签名执行句柄、session URL 或本机身份。

在副本中先验证损坏、错 generation、缺失文件、已有目标、越界路径和数据库仍被打开均拒绝，且原件摘要不变。已有合同测试可辅助核对基线与重启：

```sh
pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-demo-artifact.test.js
```

测试通过不代替实际演练；工程子 issue #532、PR Ready 与本记录均不代替父 #369/#73 的人类 R1-12 裁决。
