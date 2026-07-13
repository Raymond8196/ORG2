# SSH Remote CLI — MVP 实现计划(Codex / Claude Code / Gemini)

> 状态:规划中,待分配。关联 issue:[yorgai/ORG2#157](https://github.com/yorgai/ORG2/issues/157)。
> 第一步目标:**让外部 CLI agent 能跑在远端 host 上**,先支持 **Claude Code、Codex、Gemini** 三个。
> 本文档自包含,接手人无需阅读设计讨论记录。
> 修订 2026-07-07:对照代码核实后修订——补 spawn 前本地文件物化的远程化(skill_sync / Codex hosted,§2.6)、终止机制去 PTY 化(§2.2.1)、Phase 0 spike 改为按部署验证(§3)、明确本里程碑只覆盖 issue 验收标准③(§1)。

---

## 0. 背景与约束(给接手人)

ORG-II 是 Rust + Tauri 的 agent IDE。外部 CLI agent(claude/codex/gemini…)今天是**本地 spawn 的子进程**:ORG-II 拉起进程、注入凭证 env、消费它的 stdout 流、解析成事件、存进可回放的 trace。今天 100% 本地执行,无法连远端机器。

**本里程碑**:不改 agent 大脑的位置逻辑,只在 **spawn 层**加一个"在哪跑"的开关,让上述三个 CLI 能 spawn 到远端 host。

**为什么是这三个**:它们同属"易象限"——

| 维度   | 这三个                                                    | 备注                                                                                                                                               |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输出流 | line-based `stream-json` / `--json`                       | 远端只需把 stdout 流回来,parser 不变                                                                                                               |
| 认证   | base-URL override(`ANTHROPIC_BASE_URL` 等)或 BYOK API key | **不**走 MITM localhost proxy。**例外:Codex hosted 的 base-URL 在 `~/.codex/config.toml` 文件里、且需 `codex login` 预登录——不全在 env,见 §2.6-b** |
| stdin  | `Stdio::null()`(非 ACP)                                   | 无双向 JSON-RPC 需求                                                                                                                               |

跨出这个象限的 CLI(Cursor/Copilot/Kiro 走 MITM localhost proxy;Copilot/Kiro/OpenCode 走 ACP 双向 stdin)**不在本里程碑**。

### 硬约束(不要重新讨论)

1. **不新建凭证存储**(issue #157 要求)。认证复用系统已有机制:`~/.ssh/config`、ssh-agent、key file。远端 CLI 的 API 凭证仍走 ORG-II 现有的 env 注入(API key / base-URL + token)。
2. **`exec_target` 抽象必须 CLI 无关、且可复用**,但注意复用的边界:MITM/ACP 象限扩展复用整条 `RemoteSpawn` 路径;**内置 agent 远程化只复用 `ExecTarget` 数据类型和 ssh 连接管理**——它走 agent-core 内 per-tool-call 的 ExecutionBackend 路由,**不是**把 agent-core spawn 到远端(那条 agentd 路线已在设计讨论中否决)。别写成 claude 专属开关,也别把 `RemoteSpawn` 当成内置 agent 的接口。
3. **trace / event_pipeline 不动**。远程只是换了 stdout 流的来源,ingestion/merger/store/parser 完全不变。ORG-II 的可回放价值押在这层统一。
4. **本地模式零回归**。`exec_target` 默认 `Local`,现有所有 CLI 会话行为不变。

---

## 1. 范围

### In(本里程碑交付)

- 三个 CLI(Claude Code / Codex / Gemini)在**单个远端 host** 上执行。
- 认证模式:**仅 BYOK**(用户自己的 key)。**Hosted 模式整体推迟**(原因见 §1 Out、§6 风险表第一行),本里程碑 Remote 只允许 BYOK。
- line-based stdout 流式回传、Ctrl-C 终止(显式远程 kill,§2.2.1)、exit code 透传、本地可回放。
- 远端二进制健康检查、远端工作目录校验。
- **skill_sync 的远程物化 + 会话后远端清理**(§2.6-a,否则 Remote 会话静默丢失全部 skills)。
- **最小前端入口**:SessionCreator 增加 Remote 执行目标输入(host/port 手填;`~/.ssh/config` 主机列表解析留到后续)。§5 验收矩阵要求从前端走通,没有入口矩阵无法执行。

> **与 issue #157 的关系**:本里程碑只覆盖验收标准 **③**(远端执行 + stdout/stderr 流回)。**①/④**(ssh:// 打开远端文件、远端 save)是编辑器层远程 fs,在后续里程碑(§7);**⑤** 的文档随本里程碑交付使用说明。

### Out(明确不做,后续里程碑)

- ❌ **Hosted 认证模式**(所有 CLI)——hosted 的 `proxy_url` 是否远端可达按部署而定(dev / 自托管必然 loopback 不可达),且共享主机上 `ssh -R` 反向隧道有 token 暴露安全问题。本里程碑只做 BYOK,Hosted 推迟到后续里程碑。
- ❌ MITM-proxy 类 CLI(Cursor / Copilot / Kiro)——localhost proxy 远端不可达,需 SSH 反向隧道,单独立项。
- ❌ ACP 双向 stdin 类 CLI(Copilot / Kiro / OpenCode)。
- ❌ 远端 git worktree 创建(`cli_agent_create` 的 `isolate` 在远端禁用,要求远端 repo 预先存在)。
- ❌ 多 SSH 目标 fan-out(一个 session 一个远端 host)。
- ❌ 内置(Rust)agent 的远程化。
- ❌ Windows 上的 `ssh` 路径(本里程碑目标平台:macOS / Linux 本地 → Linux 远端)。

---

## 2. 架构(已定,不再重新讨论)

### 2.1 新增 `exec_target` 字段(正交于 `cli_agent_type`)

`cli_agent_type` 决定**跑谁**,`exec_target` 决定**在哪跑**。加在三层(默认 `Local`,serde 向后兼容):

```rust
enum ExecTarget {
    Local,
    Remote(SshTarget), // { host: "user@host", port: Option<u16> }
    // 认证不进结构体:复用系统 ssh 配置(issue #157 约束)
}
```

落点:

- `CliLaunchParams` — `src-tauri/crates/agent-core/src/foundation/session_bridge.rs:40-69`
- `CreateCodeSessionParams` — `src-tauri/src/agent_sessions/cli/persistence/types.rs`
- session 持久化行 — `src-tauri/src/agent_sessions/cli/persistence/`(**需要 DB migration**,新列默认 `Local`,旧行兼容)
- `agent_core_bridge.rs` 的字段映射 — `src-tauri/src/agent_sessions/cli/agent_core_bridge.rs:27-53`

### 2.2 spawn 缝分流(唯一的核心改动)

今天唯一的 spawn 点:`src-tauri/src/agent_sessions/cli/session_runner/session.rs:965-1023`

```rust
// 今天
let mut spawn_cmd = Command::new(program);
spawn_cmd.args(args).envs(env_vars).current_dir(working_dir)
    .stdout(Stdio::piped()).stderr(Stdio::piped());
```

改成按 `exec_target` 分流:

```rust
match exec_target {
    Local  => Command::new(program).args(args).envs(env).current_dir(dir)...,   // 原路径
    Remote(ssh) => build_ssh_spawn(ssh, program, args, env, dir)?,               // 新路径
}
```

`build_ssh_spawn` 产出形如:

```
ssh -o BatchMode=yes -p <port> <host> -- bash -lc '<pid 回传>; cd <dir> && exec env VAR=val ... <program> <args>'
```

(stdin/stdout/stderr 仍 `piped()`,parser 端不变)

关键取舍(每条都有原因,别回退):

- **禁止 `-t`/PTY**。PTY 会把远端 stdout/stderr 合并进同一条流、并做 `\n`→`\r\n` 翻译,直接破坏硬约束 3"parser 不变"——现有 spawn 是 stdout/stderr 分管道的(`session.rs:983-993`)。信号/终止问题用显式远程 kill 解决(§2.2.1),不用 PTY 解决。
- **`bash -lc`(login shell)**。非 login shell 的 PATH 不含 nvm / npm-global / homebrew,`claude`/`codex`/`gemini` 大概率解析不到。本地解析器已有 login-shell 兜底(`cli_binary_resolver.rs:379-436`),远端必须镜像,二进制健康检查同理。
- **`-o BatchMode=yes`**。spawn 无头,ssh 一旦交互式提示口令 / hostkey 确认就挂死会话;BatchMode 让它快速失败,错误走 §5.3 的友好提示。v1 只支持免交互认证(key / ssh-agent),与 issue #157 约束一致。
- **ControlMaster 连接复用**。一次会话启动要跑多趟 ssh(binary check、目录校验、skill_sync 物化、spawn、终止时的 kill),`-o ControlMaster=auto -o ControlPath=<app 运行时目录>/ssh-%C -o ControlPersist=60s` 让它们共享一条已认证连接。macOS/Linux 本地端原生支持(Windows 不支持,已在范围外)。

#### 2.2.1 终止与信号(显式远程 kill,不靠 PTY)

杀掉本地 `ssh` 进程**不保证**远端命令退出:无 PTY 时远端收不到 SIGHUP,通常要等下一次写 stdout 失败才死,期间就是僵尸。做法:

1. 远端命令包 wrapper,先把自身 pid 经 **stderr** 带 marker 回传(如 `echo "ORGII_RPID=$$" >&2`),随后 `exec` 成目标 CLI——`exec` 保证该 pid 就是 CLI 进程本身。**不许走 stdout**:stdout 是 parser 的 JSON 行流。
2. 前端 Ctrl-C → 另起一条 `ssh <host> kill -TERM <pid>`(ControlMaster 下零认证成本),超时未死再 `kill -KILL`。语义对齐本地路径 `lifecycle.rs:26-50` 的进程组终止。
3. 兜底:kill 的 ssh 也失败(远端不可达)时,杀本地 `ssh` 进程并把会话标记为"远端状态未知",不要假装干净退出。
4. Phase 3 验收以远端 `ps` 为准:无残留、无僵尸。

> **实现选型**:长期主线就是**系统 `ssh`**——它免费继承 `~/.ssh/config` 的 ProxyJump / Include / Match / ControlMaster,正是 issue #157 验收标准②("用系统已有 SSH 机制")的要求;`russh` 若要对齐得自己重新实现 config 解析。把 spawn 包成 `RemoteSpawn` trait 的理由是**分层与 mock 测试**(§4.2),不是给 russh 占位。两个常见误解要避开:①argv 转义问题换任何客户端库都在(SSH exec channel 把命令**字符串**交给远端 shell 解析),只能靠唯一且充分测试的 quoting 函数根治;②ACP 双向 stdin 也不需要 russh,系统 `ssh` 的 stdio 本来就是全双工。**不要**把 `ssh` 调用散落到多处。

### 2.3 env 转发规则(关键,易踩坑)

OpenSSH 默认**不**转发 env(`SendEnv` 需服务端 `AcceptEnv` 配合,不可靠)。可靠做法:在远端命令前缀 `env VAR1=val1 VAR2=val2 `,包在 `ssh <host> -- bash -lc '...'` 里(login shell 的理由见 §2.2;**不用 `-t`**,理由同上)。**必须有单测覆盖 argv 转义。**

三类 env 区别对待:

| env 类型                             | 处理      | 例子                                                                                                                     |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| **provider 认证**(转发)              | ✅ 转发   | `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`+token、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、Gemini provider key                |
| **用户网络代理**(转发)               | ✅ 转发   | 用户的 `http_proxy`/`https_proxy`(若指向企业代理)                                                                        |
| **ORG-II 本地路径/本地 proxy**(剥离) | ❌ 不转发 | `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`GEMINI_CLI_HOME`(本地路径,远端不存在)、ORG-II 的 MITM `HTTPS_PROXY=127.0.0.1:<port>` |

> 规则口诀:**转发认证 env,剥离本地路径 env**。这三个 CLI 是 base-URL/BYOK 类,认证全在 env 里——剥离 `*_CONFIG_DIR` 不影响认证(CLI 用默认远端配置位置即可)。

### 2.4 不变的环节(明确列出,免得误改)

- stdout 解析:`session.rs:1051-1484`、parsers(`claude_code` / `codex` / `gemini`)
- argv 构造:`session_runner/command.rs:64-264`(argv 本身主机无关,复用)
- 事件管线:`event_pipeline/*`
- trace 存储 / 回放

### 2.5 扩展性与兼容性设计原则(硬约束,贯穿全程)

> 这节的每一条都是**设计纪律**,不是建议。本里程碑交付的代码必须为 Phase 4–6(MITM/ACP CLI、容器、内置 agent 远程化)留口,且不破坏任何既有功能。

**A. 向后兼容(不破坏现有)**

1. **DB migration 只加列**。新增 `exec_target` 列,`NULL` 或默认 `'local'`;**禁止**破坏性 schema 变更。既有 session 行无感加载。
2. **serde 默认 + 未知 variant 降级,不报错**。所有入口(`CliLaunchParams` / IPC / DB)该字段可选,缺失 = `Local`。**反序列化遇到未来新增的 variant(如 `Container`)时,降级为 `Local` 并打 warning,不 panic**——这样新版本写的行,旧版本能读。
   - 注意 Rust serde 的 `#[serde(other)]` 只支持 unit variant;带数据的 `Remote(SshTarget)` 需要自定义反序列化或"kind 判别 + 不透明 payload"结构。**在 Phase 0 定型**,不要临场决定。
3. **IPC/API 只增不减**。前端 invoke 参数新增 `exec_target` 为可选字段;既有前端/CLI 不传 = `Local`,行为不变。**禁止**删除/重命名既有字段。
4. **`Local` 分支 = 原逻辑逐字保留**。`match exec_target { Local => <原代码不动> }`,不借机重构本地路径(重构另开 PR)。

**B. 向前扩展(为后续里程碑留口)**

5. **`ExecTarget` 是开放枚举,不是布尔**。今天 `Local | Remote(SshTarget)`;**预留** `Container(DockerContext)` / `Wsl(...)` / `RemoteAgent(...)`(内置 agent 远程化)。代码用 `match` 分派,**必须有 default/unknown 分支**。
6. **spawn 后端 trait 化**(`RemoteSpawn`)。系统 `ssh` 是第一个实现,`russh` 是第二个;trait 是**唯一**的扩展缝——新后端只实现 trait,不改调用方。**禁止把 `ssh` 字符串/argv 散落到多处。**
7. **CLI 能力是数据,不是代码 fork**。每个 CLI 声明能力位(line-based vs ACP、base-URL vs MITM、是否需 PTY);spawn/streaming/auth 路径**按能力位选择**,而不是 `if cli == claude`。加新 CLI = 加一条能力声明,主干不动。本里程碑先固化 `line-based` + `base-url` 两个能力位。
8. **env 转发是策略函数**:`fn env_for_remote(cli_caps, full_env) -> filtered_env`,不内联。后续 backend(MITM 反向隧道)只改这个函数。
9. **两轴分离(关键)**。`exec_target`(大脑在哪)和 `workspace_target`(文件在哪)在**类型层**就分开,哪怕今天 CLI 模式下二者绑定。这样未来"远程大脑 + 本地文件""容器大脑"都能表达,不被一个布尔锁死。今天可共享一个值,但**类型留两个槽**。
10. **`SshTarget` 结构可生长**。今天 `{host, port}`;预留 `auth_method` / `proxy_jump`(跳板机)/ `known_hosts_policy` / `keepalive`。**不要**把 host 压成 `user@host:port` 单字符串再到处 split——用结构体,新字段可选,序列化不破坏。
11. **parser 输入是流抽象,不焊死在进程句柄上**。解析器消费"一条行流"(本地子进程 stdout、远端 ssh stdout、或将来 detached 模式的缓冲文件回放),不直接持有 `Child`。这是设计讨论里为"无人值守 / detached"(后续里程碑)预付的**唯一**架构成本——趁本次动 spawn 缝顺手做,以后再改贵一个数量级。

**C. 这些原则的落地锚点**

| 原则            | 落点                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 开放枚举 + 降级 | `ExecTarget` serde 自定义反序列化(Phase 0)                                                                              |
| spawn trait     | `session_runner/` 新增 `remote_spawn.rs`,`session.rs:965` 调 trait 不调 `ssh` 直拼                                      |
| CLI 能力位      | 复用 `ModelType` 旁的能力声明(参考 `needs_mitm_proxy()` 模式)                                                           |
| 两轴类型        | `CliLaunchParams` 同时有 `exec_target` 和 `workspace_target`(后者本期可与前者同值)                                      |
| parser 流抽象   | spawn 缝重构时把 stdout 消费端收敛为行流参数(`AsyncBufRead` 或等价抽象,`session.rs:1051` 起的解析侧),不直接持有 `Child` |

### 2.6 spawn 前的本地文件物化——Remote 下必须处理(易漏,实测必撞)

今天 spawn 之前有两类"写本地文件"的准备动作,Remote 下它们写错了地方。§2.3 的 env 规则**不覆盖**这部分。

**a) skill_sync(三个 CLI 全部受影响)**

`session.rs:300` 在 spawn 前把 orgii skills 写进**工作区**的 agent 原生规则文件(`src-tauri/src/agent_sessions/cli/skill_sync.rs`):Claude Code → `.claude/rules/orgii-skills.md`,Codex → `AGENTS.md`,Gemini → `GEMINI.md`;会话结束后按返回的路径清单清理。工作区在远端时,本地写会**静默失败**(代码只 `tracing::warn`)→ Remote 会话静默丢失全部 skills,与 Local 行为分叉且无提示。

**本里程碑的决定:经 ssh 物化到远端。** 就 1–2 个小文件:`ssh <host> 'mkdir -p <dir> && cat > <file>'`,内容从 stdin 灌(不进 argv,免转义)。会话结束后同样经 ssh 清理,且清理必须可靠——`AGENTS.md` / `GEMINI.md` 残留在用户远端仓库里,可能被 agent 下一轮顺手 commit。若实测发现物化不稳,允许降级为"远端跳过 + 前端明示 skills 不生效",**禁止静默跳过**。

**b) Codex hosted 的文件式认证(§0 前提表的例外)——已随 Hosted 模式整体推迟(§1 Out),本节留档给后续里程碑**

Codex hosted 的认证**不全在 env**,今天有两处本地物化,Hosted 远程化落地时要搬到远端:

- `session.rs:753-785`:往本地 `~/.codex/config.toml` 追加 `[model_providers.proxy]`(内嵌 `base_url = "{proxy_url}/v1"`),argv 用 `-c model_provider=proxy` 选中 → Remote 时改写**远端**的 `~/.codex/config.toml`,保留同样的幂等检查(已含 `[model_providers.proxy]` 则跳过)。
- `session.rs:798-850`:本地跑 `codex login --with-api-key`(token 从 stdin 灌入,写 `~/.codex/auth.json`)→ Remote 时改为 `ssh <host> codex login --with-api-key`,token 仍走 stdin(**不进 argv**,避免留在远端 shell history / `ps` 输出里)。

Claude Code / Gemini 的 hosted 认证确实全在 env(`agent_env_builder.rs:441-457`),不受影响。但 Claude Code 剥离 `CLAUDE_CONFIG_DIR` 后(本地它指向 per-session profile 目录,`session.rs:558+`),远端会用共享的 `~/.claude`——首跑 onboarding 状态缺失、跨会话配置互串是已知代价,进 §6 风险表,Phase 1 实测确认。

---

## 3. 开发计划(分阶段,带锚点)

### Phase 0 — Spike + 脚手架(阻塞后续,先做)

> 目的:验证最大未知,搭好抽象。**预计 0.5–1 天。**

- [ ] **Hosted 已推迟,无需 spike**。代码事实备查(不用再翻):hosted 的 `proxy_url` 来自 marketplace `/proxy/allocate` 响应(`crates/integrations/src/proxy/mod.rs:80-150`),按部署而定——云端可能返回公网 URL(远端可达),dev / 自托管必然 loopback(不可达)。本里程碑不做 Hosted,这条留作后续里程碑立项时的第一验证项。
- [ ] **运行时守卫**:session 创建时 `exec_target=Remote` + `key_source=Hosted` → 友好拒绝("Hosted 模式暂不支持远端执行,请用 BYOK"),不让会话跑起来再莫名认证失败。**本里程碑 Remote 只允许 BYOK**。Hosted 远程化落地后移除此守卫。
- [ ] BYOK 模式无 proxy,CLI 直连 provider,**必然可达**(用一次手动测试确认即可)。
- [ ] 加 `ExecTarget` / `SshTarget` 类型 + serde: - 默认 `Local`;**未知 variant 降级 `Local` + warning,不报错**(自定义反序列化,§2.5-A2)。- `ExecTarget` 设计成开放枚举,`match` 带 default 分支(§2.5-B5)。- `SshTarget` 用结构体(`host`/`port` 可选字段),不压成单字符串(§2.5-B10)。
- [ ] 三层结构体加字段 + bridge 映射 + **加列式** DB migration(默认 `Local`,§2.5-A1)。`CliLaunchParams` 同时加 `workspace_target` 槽(本期可与 `exec_target` 同值,§2.5-B9)。
- [ ] spawn 缝引入 `RemoteSpawn` trait + `match exec_target`,`Local` 分支逐字保留原逻辑(§2.5-A4、B6)。
- [ ] CLI 能力位:为 `line-based` / `base-url` 两个能力位定义声明(参照现有 `needs_mitm_proxy()` 模式,§2.5-B7)。
- [ ] **全量本地回归通过**:`cargo test --lib agent_sessions::` + 三个 CLI 的现有解析快照。
- [ ] **前向兼容单测**:构造一个含"未来 variant"(如 `Container{...}`)的序列化 payload,断言反序列化降级为 `Local` 且不 panic(§2.5-A2)。

### Phase 1 — Claude Code 远端打通(证明抽象)

> 目的:用一个 CLI 把 Remote 分支跑通,验证抽象正确。**预计 3–4 天**(含 skill_sync 物化、显式 kill、ControlMaster;原 2–3 天的估算不含这三项)。

- [ ] `build_ssh_spawn`:组装 §2.2 形态的命令(**无 `-t`**、`bash -lc`、`BatchMode=yes`、pid 经 stderr 带 marker 回传)。
- [ ] ControlMaster 连接管理:`ControlMaster=auto` + app 运行时目录下的 `ControlPath` + `ControlPersist`;binary check / 目录校验 / skill_sync / spawn / kill 共享一条已认证连接。
- [ ] 远端二进制解析:`ssh <host> bash -lc 'command -v claude'`(**必须 login shell**,镜像本地 `cli_binary_resolver.rs:379-436` 的兜底;在该模块加远端分支)。
- [ ] 远端工作目录校验:`ssh <host> test -d <dir>`(替代 `session.rs:445-460` 的本地 `is_dir`)。
- [ ] env 选择性转发(§2.3 规则)。
- [ ] **skill_sync 远程物化 + 会话后远端清理**(§2.6-a)。
- [ ] 显式远程 kill 打通(§2.2.1):前端 Ctrl-C → 远端进程消失,以远端 `ps` 验证。
- [ ] Claude Code 共享 `~/.claude` 的首跑行为实测(onboarding 状态,§2.6 末段)。
- [ ] 手动验收:Claude Code 在真实远端 host 上跑通(见 §5 验收矩阵 Claude 行)。

### Phase 2 — Codex + Gemini 增量跟进

> 目的:验证抽象的可复用性。Codex/Gemini 的 BYOK 应近乎免费——只改测试 + 手动验收。**预计 1 天。**

- [ ] Gemini:argv 已有(`gemini --output-format stream-json ...`),复用 `build_ssh_spawn`,应只改测试 + 手动验收。
- [ ] Codex BYOK:argv 已有(`codex exec --json ...`),复用 `build_ssh_spawn`。
- [ ] Codex Hosted / Gemini Hosted:**已随 Hosted 模式整体推迟**(§1 Out),§2.6-b 留作后续里程碑参考。
- [ ] 若 BYOK 增量被迫改 spawn 逻辑 → 抽象有问题,回头补。

### Phase 3 — 健壮性

> 目的:从"能跑"到"能用"。**预计 1–2 天。**
>
> **状态(实现层):全部完成。**下列各项均已落地并经单测覆盖(§4.1);端到端验收以 §5.4 逐步清单为准。

- [x] 终止链路加固(§2.2.1):kill 的 ssh 本身失败(远端不可达)时的兜底——标记"远端状态未知",不假装干净退出;长会话 / 断连后 kill 仍可靠;远端 `ps` 无残留。
- [x] exit code 透传(`ssh` 的退出码 = 远端命令退出码,验证链路;注意 ssh 自身错误是 255)。
- [x] 连接保活:`ServerAliveInterval` / `ServerAliveCountMax` + `ControlPersist`。断线重连**不需要新机制**:远端重 spawn 带 `--resume <cli_session_id>`——存取已就位(`persistence/session_crud.rs:224-288`),补 Remote 分支即可。
- [x] 错误信息友好化:`ssh` 连接失败(含 BatchMode 认证拒绝)、远端无 CLI、远端无目录 → 翻译成用户可读的前端提示。
- [x] 远端 CLI 缺失时的健康检查 UI(`cli_remote_preflight` 命令 + SessionCreator「Test」按钮,连通性 + 二进制 + 目录检查;手动验证见 §5.4 T1–T3 / T15–T16)。
- [x] 最小前端入口收尾:SessionCreator 的 Remote 目标输入(§1 In 承诺项)联调走通。

---

## 4. 测试计划

### 4.1 单元测试(纯函数,快,CI 必跑)

- [ ] `ExecTarget` serde:默认 `Local`;`Remote(SshTarget)` 往返序列化;旧行(无该列)反序列化为 `Local`。
- [ ] **SSH argv 构造器**:给定 `(host, port, program, args, env, dir)` → 产出正确的 §2.2 形态命令(无 `-t`、`bash -lc`、BatchMode);**重点测 quoting 函数**,注入向量至少覆盖:空格、单双引号、`$()`、反引号、换行、`;`、`&&`(task 字符串和 env 值都要测)。
- [ ] **env 过滤器**:给定完整 env map → 保留 provider 认证 + 用户代理,剥离 `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`GEMINI_CLI_HOME`/MITM proxy。
- [ ] **pid 回传解析**:stderr 流里 `ORGII_RPID=<pid>` marker 的提取;marker 行不进用户可见的 stderr 记录。
- [ ] **Remote+Hosted 守卫**(§3-Phase 0):`exec_target=Remote` + `key_source=Hosted` → 创建被拒且报错可读(Hosted 推迟到后续里程碑)。
- [ ] `exec_target` 三层透传:`CliLaunchParams` → `CreateCodeSessionParams` → session 行 → 读回一致。

### 4.2 集成测试(CI 可跑,不依赖真远端)

- [ ] **Mock spawn**:把 spawn 包成 trait 后,mock `RemoteSpawn`,验证 Remote 分支产出**正确的 argv/env**,不真正 SSH。
- [ ] **Parser 回归**:把三个 CLI 的已录制 stdout fixture(`.snap`,见 `agent_sessions/cli/parsers/tests/snapshots/`)喂给现有 parser,`exec_target=Remote`,断言解析结果与 `Local` 完全一致(证明 transport 无关)。

### 4.3 端到端(手动 / 专用环境,不在 CI)

- [ ] `ssh localhost`:CI Linux 上生成临时 keypair、`ssh localhost` 跑一遍 Remote 分支(可选,较重)。
- [ ] 真实远端 host:见 §5 验收矩阵。

---

## 5. 验收计划(每 CLI × 每认证模式)

准备一台 Linux 远端 host,预装 `claude` / `codex` / `gemini` 三个 CLI。

### 5.1 功能验收矩阵(✅ 全绿才算过)

| CLI         | 认证 | 启动 | 流式输出 | Ctrl-C 终止 | exit code 透传 | 本地回放 |
| ----------- | ---- | ---- | -------- | ----------- | -------------- | -------- |
| Claude Code | BYOK | ☐    | ☐        | ☐           | ☐              | ☐        |
| Codex       | BYOK | ☐    | ☐        | ☐           | ☐              | ☐        |
| Gemini      | BYOK | ☐    | ☐        | ☐           | ☐              | ☐        |

> Hosted 模式本里程碑不做(§1 Out),矩阵不含其行。

每格含义:

- **启动**:远端会话能拉起,远端 `ps` 能看到对应 CLI 进程。
- **流式输出**:stdout 事件在前端实时出现(parser 正常工作)。
- **Ctrl-C 终止**:前端中断 → 远端进程消失(不留僵尸)。
- **exit code 透传**:远端命令的退出码正确反映到 session 状态。
- **本地回放**:会话结束后,trace 能完整回放(证明事件管线未受影响)。

矩阵之外的横切验收:

- [ ] **skills 生效**:远端会话里 agent 能看到 orgii skills(§2.6-a 物化成功);会话结束后远端工作区无 `orgii-` 前缀残留文件。
- [ ] **无僵尸**:每格的"Ctrl-C 终止"以远端 `ps` 为准,不以本地 `ssh` 进程退出为准。

### 5.2 兼容性验收(零回归红线 + 前向兼容)

- [ ] 三个 CLI 在 `exec_target=Local` 下,所有现有 e2e/快照测试通过。
- [ ] **既有 session 行(无 `exec_target` 列)能正常加载**(migration 向后兼容)。
- [ ] **新版本写的 `Remote` session 行,用旧版本代码加载不崩**(降级 `Local` 或忽略未知字段,§2.5-A2)。用前向兼容单测覆盖。
- [ ] **既有前端/CLI invoke 不传 `exec_target` 时,行为完全等同改动前**(IPC 只增不减,§2.5-A3)。
- [ ] `ExecTarget` 新增一个"未来 variant"后,`match` 编译期即报缺 default 分支(靠 `#[non_exhaustive]` 或 default 分支强制,§2.5-B5)。

### 5.3 失败路径验收(用户体验)

- [ ] 远端不可达 → 友好报错(非裸 panic / 非 SSH 堆栈)。
- [ ] 远端无对应 CLI 二进制 → 提示安装。
- [ ] 远端工作目录不存在 → 提示路径错误。
- [ ] 认证失败(BYOK key 无效)→ 透传 CLI 的认证错误。

### 5.4 逐步验证清单(T0–T19,本地 / 远端 / 目的)

> 把 §5.1–§5.3 拆成可逐条执行的操作清单。标记:🖥️ = 本地(ORG-II 所在机) · 🌐 = 远端(CLI 实际运行的机) · 🖥️→🌐 = 本地敲 ssh、远端执行。每格过了打 ✅;不过把现象(报错 / 远端 `ps` / 日志)记下来。**顺序:T0 → A → B → C → D → E → F。**

**第 0 步:重启 + 基线**

| ID  | 在哪 | 操作                                     | 目的         | 预期                                                              |
| --- | ---- | ---------------------------------------- | ------------ | ----------------------------------------------------------------- |
| T0  | 🖥️   | 重启 `pnpm tauri:dev`(改了代码 HMR 不够) | 加载最新代码 | 应用起来,SessionCreator 能看到「Remote SSH」输入框 + 「Test」按钮 |

**A. 环境(前置)**

| ID  | 在哪  | 操作                                                       | 目的                                | 预期                   |
| --- | ----- | ---------------------------------------------------------- | ----------------------------------- | ---------------------- |
| T1  | 🖥️→🌐 | `ssh -o BatchMode=yes <user>@<host> echo ok`               | 验免交互认证(= ORG-II 实际用的模式) | 打印 `ok`,**不问密码** |
| T2  | 🖥️→🌐 | `ssh <user>@<host> 'bash -lc "command -v claude"'`         | 验远端 login-shell 能找到 claude    | 打印 claude 绝对路径   |
| T3  | 🖥️→🌐 | `ssh <user>@<host> 'test -d /abs/path/to/repo && echo ok'` | 验远端工作目录存在                  | 打印 `ok`              |

> T1–T2 现在也可直接点 SessionCreator 的 **「Test」** 按钮代替——它跑的就是 T1(连通性)+ T2(二进制存在)的组合检查。

**B. 冒烟(claude_code + BYOK + Remote)**

| ID  | 在哪 | 操作                                                                                                             | 目的                                        | 预期                                     |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| T4  | 🖥️   | 选 claude_code / BYOK / workspace=远端路径 / Remote 填 `<user>@<host>` / 发 `read a.txt and tell me its content` | 核心功能:经 ssh 在远端跑 claude,stdout 流回 | 创建成功 + 实时出 token + agent 回复正确 |

**C. §5.1 功能矩阵(claude_code)**

| ID  | 在哪     | 操作                                                                    | 目的                                  | 预期                   |
| --- | -------- | ----------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| T5  | 🖥️→🌐    | T4 发任务后 `ssh <user>@<host> 'ps -ef \| grep claude \| grep -v grep'` | 确认 claude **真在远端**跑            | 看到远端 claude 进程   |
| T6  | 🖥️       | 观察 T4 前端                                                            | 验流式回传                            | token 实时出现         |
| T7  | 🖥️+🖥️→🌐 | 前端 Ctrl-C;停后立刻 + 10s 各 `ps -ef \| grep claude \| grep -v grep`   | 验显式远端 kill(§2.2.1)               | 远端**无** claude 残留 |
| T8  | 🖥️       | T4 正常完成                                                             | 验退出码透传(ssh 退出码 = 远端退出码) | 会话 = completed       |
| T9  | 🖥️       | 新任务让 agent 跑必失败命令                                             | 验失败路径退出码                      | 会话 = failed          |
| T10 | 🖥️       | T4 结束后 sidebar 重开会话                                              | 验回放                                | trace 完整回放         |

**D. skills 物化(§2.6-a)**

| ID  | 在哪  | 操作                                                                         | 目的                    | 预期           |
| --- | ----- | ---------------------------------------------------------------------------- | ----------------------- | -------------- |
| T11 | 🖥️→🌐 | 会话**运行中** `ssh <user>@<host> 'ls <repo>/.claude/rules/orgii-skills.md'` | 验 skill 文件物化到远端 | 文件存在       |
| T12 | 🖥️→🌐 | 会话**结束后**再 `ls` 同文件                                                 | 验清理 + marker 守卫    | 不存在(已清理) |

**E. 失败守卫(§5.3,全在 🖥️ 创建时拦)**

| ID  | 在哪 | 操作                                     | 预期                                                           |
| --- | ---- | ---------------------------------------- | -------------------------------------------------------------- |
| T13 | 🖥️   | hosted key + Remote host → 创建          | 「Hosted (market) mode does not yet support remote execution」 |
| T14 | 🖥️   | cursor_cli + Remote host → 创建          | 「Remote execution is not yet supported for `cursor_cli`」     |
| T15 | 🖥️   | Remote host 故意填错 → 创建 / 或点 Test  | 「ssh connection to … failed」                                 |
| T16 | 🖥️   | 换没装 claude 的 host → 创建 / 或点 Test | 「`claude` was not found on the remote host」                  |
| T17 | 🖥️   | workspace 选远端不存在的路径 → 创建      | 「Remote working directory does not exist」                    |

**F. 多 CLI 复用(验证抽象,§2)**

| ID  | 在哪  | 操作                        | 目的                        | 预期 |
| --- | ----- | --------------------------- | --------------------------- | ---- |
| T18 | 🖥️→🌐 | 换 **codex**,其余同 T4      | 验抽象可复用(应只改 CLI 名) | 跑通 |
| T19 | 🖥️→🌐 | 换 **gemini_cli**,其余同 T4 | 同上                        | 跑通 |

> **排障诀窍**:ssh 预检报错(T1–T3 / Test 按钮红)→ 环境问题;创建即拒(T13/T14/T17)→ 守卫生效;`ps`/`ls` 看不到预期(T5/T7/T11/T12)→ 链路 bug,把现象(远端 `ps`、日志、前端报错)贴回来。

---

## 6. 风险与未决问题

| 风险                                                   | 影响                                                         | 缓解                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosted 远程化的前置安全**(后续里程碑,本里程碑不触发) | Hosted 模式整体推迟(§1 Out)                                  | 本里程碑用 Remote+Hosted 守卫挡住。将来 Hosted 落地大概率需 `ssh -R` 反向隧道——而**共享多用户远端主机上 loopback 转发端口对同机其他用户可见,proxy token 会暴露**;隧道方案落地前必须先解决(unix socket + 权限 / 隧道内鉴权)。提前记录,免得到时才踩 |
| **argv shell 转义**(task 字符串含特殊字符)             | 命令注入 / 执行失败                                          | 唯一 quoting 函数 + 强制单测(注入向量见 §4.1)。**换 `russh` 也绕不开**——SSH exec 把命令字符串交远端 shell 解析,转义是协议层固有的                                                                                                                 |
| **剥离 `*_CONFIG_DIR` 的副作用**                       | CLI 远端行为与本地不一致                                     | 本里程碑只做 BYOK:Claude/Gemini 认证在 env,影响可控;Claude 共享远端 `~/.claude` 的首跑 onboarding / 跨会话互串在 Phase 1 实测(§2.6 末段)                                                                                                          |
| **远端 kill 不可靠**                                   | 僵尸进程 / 资源泄漏                                          | 显式远程 kill(§2.2.1:pid 回传 + 第二条 ssh)+ 远端 `ps` 实测;**禁止用 `-t`/PTY 解决**(破坏 parser,见 §2.2)                                                                                                                                         |
| **skill_sync 远端残留**                                | `AGENTS.md`/`GEMINI.md` 留在用户远端仓库,可能被 agent commit | 会话后经 ssh 清理 + §5.1 横切验收;清理失败要上报,不静默                                                                                                                                                                                           |
| **长会话断线**                                         | 会话中断                                                     | Phase 3 保活(`ServerAliveInterval`)+ `--resume <cli_session_id>` 重连(机制已有)                                                                                                                                                                   |

### 未决(需在 Phase 0 / Phase 1 早期回答)

1. ~~hosted `proxy_url` 在生产部署下是不是公网?~~ **本里程碑不做 Hosted,此问题推迟**;代码侧已确认按部署而定(见 §3-Phase 0 备查)。等 Hosted 远程化立项时再验。
2. ~~远端 CLI 是否需要预先 `login`?~~ **已答**:Codex 需要——今天就是 ORG-II 代跑 `codex login --with-api-key`(`session.rs:798-850`),Remote 下把这步搬到远端(§2.6-b);Claude / Gemini env 注入即可,剩余疑点只有 Claude 首跑 onboarding 状态(Phase 1 实测)。
3. `exec_target` 是否要进 trace/事件,还是只进 session 行?(倾向:只进 session 行,trace 保持 transport 无关)

---

## 7. 后续里程碑(不在本计划内,仅记录)

- **Hosted 认证模式的远程化**(三个易象限 CLI)——立项时第一验证项是生产部署的 `proxy_url` 是否公网(代码事实备查:§3-Phase 0);Codex 的文件式认证搬迁见 §2.6-b 留档;若走 `ssh -R` 隧道,先解决 §6 第一行的共享主机安全。
- **编辑器层远程 fs**(issue #157 验收标准 ①④:`ssh://` 打开远端文件、远端 save)——issue 的标题性行为,本里程碑只交付了 ③。与 CLI 执行层共用 `workspace_target` 和 ssh 连接管理,可与 CLI 象限扩展并行。
- **MITM-proxy 类 CLI**(Cursor/Copilot/Kiro)——`ssh -R` 反向隧道把本地 proxy 暴露给远端;**前置条件**是先解决共享主机上的隧道安全(§6 风险表第一行)。
- **ACP 双向 stdin 类 CLI**(Copilot/Kiro/OpenCode)——系统 `ssh` 的 stdio 本身全双工,预计**无需**更换传输层(§2.2.1 选型注)。
- **多目标 fan-out、远端 worktree 创建、detached 无人值守**(后者依赖 §2.5-B11 的流抽象已就位)。
- **远期**:内置 Rust agent 的远程化——复用 `ExecTarget` 类型与 ssh 连接管理,走 agent-core 内 per-tool-call 的 ExecutionBackend 路由(**不是** `RemoteSpawn`,见 §0 硬约束 2)。
