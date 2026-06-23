# Setup Notes

日期：2026-06-23

## Local Environment

已确认本机可用：

- Node.js: `v22.19.0`
- pnpm: `11.2.1`
- Bun: `1.3.14`
- Go: `go1.26.4 windows/amd64`

## Dependency Install

已执行：

```sh
pnpm install
```

结果：成功。

## Verification

### TypeScript

已执行：

```sh
pnpm tsc
```

结果：未形成有效检查。根脚本实际调用裸 `tsc`，当前根目录没有 `tsconfig.json`，因此 TypeScript 只打印帮助并返回失败。

后续应使用更具体的检查命令，例如：

```sh
pnpm lint
pnpm lint:type
turbo run build --filter=...
```

或按具体 app/package 执行对应 typecheck。

### Go Checker

已执行：

```sh
go test ./...
```

工作目录：

```text
apps/checker
```

结果：大部分通过，但 `pkg/job` 有一个测试失败：

```text
--- FAIL: TestTCPJob_Success
expected RequestStatus 'active', got 'error'
expected Error 0, got 1
```

其他已通过包包括：

- `checker`
- `handlers`
- `pkg/assertions`
- `pkg/otel`
- `pkg/scheduler`
- `pkg/tinybird`

判断：这是 OpenStatus upstream 当前测试对 TCP 连通性环境的假设问题，不是 LLMHub Radar 当前改动引入。后续改 checker 时要单独处理或隔离该测试。

### Lint

已执行：

```sh
pnpm lint
```

结果：通过，退出码 0。

注意：输出包含若干 upstream warnings，主要是未使用变量、React hook dependencies、`new Array(singleArgument)`、空文件，以及 Node 对 `oxlint.config.ts` 的 `MODULE_TYPELESS_PACKAGE_JSON` warning。当前不作为本项目初始化阻塞项。

## Git Remote

`llmhub-radar` 保留 OpenStatus fork 历史。

当前远端：

```text
upstream https://github.com/openstatusHQ/openstatus.git (fetch)
upstream DISABLED (push)
```

这样可以防止误推到 upstream。
