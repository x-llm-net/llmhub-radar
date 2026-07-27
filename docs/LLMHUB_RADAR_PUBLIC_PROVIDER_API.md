# LLMHub Radar Public Provider API

本文档用于交接 LLMHub Radar 对外服务商状态查询接口。该接口面向中转站聚合站、导航站、榜单页等场景，用于按服务商 `slug` 批量获取公开服务商的 7 天可用率、等级、当前状态和延迟摘要。

## Endpoint

```http
POST https://llm-hub.store/api/radar/providers/query
Content-Type: application/json
Accept: application/json
```

该接口只返回满足以下条件的服务商：

- 状态页已发布。
- 状态页访问类型为公开。
- 服务商已加入公共池。
- 请求中的 `slug` 与状态页公开 `slug` 匹配。

## Request Body

```json
{
  "slugs": ["x-llm", "skyhope", "autorouter"]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `slugs` | `string[]` | 是 | 服务商公开 slug 列表。 |

请求限制：

| 限制项 | 当前值 |
| --- | --- |
| 单次最多 slug 数 | `20` |
| 单个 slug 长度 | `3` 到 `80` |
| slug 格式 | 小写字母、数字和 `-` |
| 最大请求体 | `8KB` |

服务端会对 slug 做去重和小写归一化。

## Response

成功响应：

```json
{
  "apiVersion": "v1",
  "schemaVersion": "2026-06-29",
  "generatedAt": "2026-06-29T13:30:00.000Z",
  "window": {
    "label": "7d",
    "from": "2026-06-22T13:30:00.000Z",
    "to": "2026-06-29T13:30:00.000Z"
  },
  "windows": {
    "primary": {
      "label": "7d",
      "from": "2026-06-22T13:30:00.000Z",
      "to": "2026-06-29T13:30:00.000Z"
    },
    "shortTerm": {
      "label": "24h",
      "from": "2026-06-28T13:30:00.000Z",
      "to": "2026-06-29T13:30:00.000Z"
    }
  },
  "units": {
    "availability": "basis_points",
    "latency": "milliseconds",
    "score": "availability_percent"
  },
  "limit": 20,
  "items": [
    {
      "slug": "x-llm",
      "name": "X-LLM",
      "description": "性价比与稳定性兼顾，hvoy.ai 实测 100 分。",
      "icon": null,
      "statusPageUrl": "https://llm-hub.store/x-llm",
      "status": "operational",
      "observedHealthScore": 96.85,
      "grade": "A",
      "confidenceLevel": "high",
      "qualityFlags": [],
      "targetCount": 6,
      "sampleCount7d": 1176,
      "availability7dBasisPoints": 9685,
      "sampleCount24h": 678,
      "availability24hBasisPoints": 9646,
      "p50FirstTokenMs": 2431,
      "p95FirstTokenMs": 6416,
      "p95FirstTokenSummaryMs": 5502,
      "lastCheckAt": "2026-06-29T13:38:36.000Z",
      "updatedAt": "2026-06-29T13:38:36.000Z",
      "scoreVersion": "radar-public-availability-7d-v1",
      "scoreInputs": {
        "minSampleCount7d": 10,
        "scoreFormula": "observedHealthScore = availability7dBasisPoints / 100",
        "latencyPenalty": 0
      }
    }
  ],
  "missing": [],
  "disclaimer": "Observed health score equals the 7-day observed probe availability percentage. It is not an official SLA, model quality score, price ranking, or purchase recommendation."
}
```

## Top-Level Fields

| 字段 | 说明 |
| --- | --- |
| `apiVersion` | API 主版本。当前为 `v1`。 |
| `schemaVersion` | 响应结构版本。当前为 `2026-06-29`。 |
| `generatedAt` | 本次结果所属的 10 分钟缓存时间桶。 |
| `window` | 主统计窗口，当前固定为 7 天。 |
| `windows.primary` | 主统计窗口，等同于 `window`。 |
| `windows.shortTerm` | 辅助短期窗口，当前为 24 小时。 |
| `units.availability` | 可用率单位，`basis_points` 表示万分比。 |
| `units.latency` | 延迟单位，当前为毫秒。 |
| `units.score` | 分数单位，当前为可用率百分比。 |
| `limit` | 单次请求最多 slug 数。 |
| `items` | 已找到且符合公开池条件的服务商列表。 |
| `missing` | 请求了但未返回的 slug。可能不存在、未公开、未发布或未加入公共池。 |
| `disclaimer` | 对分数含义的免责声明。 |

## Item Fields

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `slug` | `string` | 服务商公开 slug。 |
| `name` | `string` | 服务商名称。 |
| `description` | `string` | 服务商描述。 |
| `icon` | `string \| null` | 图标地址或空值。 |
| `statusPageUrl` | `string` | 公开状态页地址。 |
| `status` | `operational \| degraded \| down \| unknown` | 当前聚合状态。 |
| `observedHealthScore` | `number \| null` | 7 天可用率百分比。示例：`96.85` 表示 96.85%。 |
| `grade` | `S \| A \| B \| C \| D \| F \| unknown` | 基于 7 天可用率的等级。 |
| `confidenceLevel` | `high \| medium \| low \| insufficient` | 样本可信度。 |
| `qualityFlags` | `string[]` | 辅助质量标记。 |
| `targetCount` | `number` | 该服务商参与统计的 API 密钥或探测目标数量。 |
| `sampleCount7d` | `number` | 7 天内参与统计的探测样本数。 |
| `availability7dBasisPoints` | `number \| null` | 7 天可用率，单位为万分比。`9685` 表示 96.85%。 |
| `sampleCount24h` | `number` | 最近 24 小时样本数，辅助判断短期波动。 |
| `availability24hBasisPoints` | `number \| null` | 最近 24 小时可用率，单位为万分比。 |
| `p50FirstTokenMs` | `number \| null` | 7 天首 token P50，单位毫秒。 |
| `p95FirstTokenMs` | `number \| null` | 7 天首 token P95，单位毫秒。 |
| `p95FirstTokenSummaryMs` | `number \| null` | 基于目标状态摘要的首 token P95 加权值，主要用于辅助展示。 |
| `lastCheckAt` | `string \| null` | 最近一次探测时间。 |
| `updatedAt` | `string \| null` | 聚合状态更新时间。 |
| `scoreVersion` | `string` | 当前分数算法版本。 |
| `scoreInputs` | `object` | 分数计算说明。 |

## Score And Grade Rules

当前分数不再额外扣除延迟分，直接等于 7 天探测可用率：

```text
observedHealthScore = availability7dBasisPoints / 100
```

如果 7 天样本数小于 `10`，则：

```text
observedHealthScore = null
grade = "unknown"
confidenceLevel = "insufficient"
```

等级规则：

| 条件 | 等级 |
| --- | --- |
| `observedHealthScore >= 98` | `S` |
| `observedHealthScore >= 95` | `A` |
| `observedHealthScore >= 90` | `B` |
| `observedHealthScore >= 80` | `C` |
| `observedHealthScore >= 60` | `D` |
| `< 60` | `F` |
| 样本不足 | `unknown` |

可信度规则：

| 7 天样本数 | `confidenceLevel` |
| --- | --- |
| `>= 120` | `high` |
| `>= 30` | `medium` |
| `>= 10` | `low` |
| `< 10` | `insufficient` |

## Status Rules

`status` 是当前目标状态的聚合结果，不等同于 7 天可用率：

| 条件 | `status` |
| --- | --- |
| 没有活跃目标，或全部为 `unknown` | `unknown` |
| 所有活跃目标都是 `down` 或 `configuration_error` | `down` |
| 存在任一非 `operational` 的活跃目标 | `degraded` |
| 其他情况 | `operational` |

因此可能出现：

- 7 天分数较高，但当前 `status = degraded`：说明近期或当前存在局部异常。
- 当前 `status = operational`，但 7 天分数不高：说明当前恢复了，但过去 7 天内有失败样本。

## Quality Flags

| 标记 | 含义 |
| --- | --- |
| `insufficient_samples` | 可计分样本不足 4 次。 |
| `low_sample_count` | 7 天样本数达到 10 但不足 30。 |
| `current_issue` | 当前聚合状态不是 `operational`。 |
| `high_first_token_latency` | 7 天 P95 首 token 超过 8000ms。 |
| `never_checked` | 没有探测记录。 |
| `stale_data` | 最近探测时间距离生成时间超过 30 分钟。 |

## Cache And ETag

服务端有内存缓存，缓存 key 由以下内容组成：

```text
10 分钟 generatedAt 时间桶 + 去重后的 slug 列表
```

响应头：

```http
Cache-Control: public, max-age=600, stale-while-revalidate=300
ETag: "..."
Access-Control-Allow-Origin: *
```

建议接入方：

- 按 10 分钟或更低频率刷新。
- 保存上次响应的 `ETag`。
- 下次请求带上 `If-None-Match`。
- 如果返回 `304 Not Modified`，继续使用本地缓存的数据。

示例：

```bash
curl -X POST 'https://llm-hub.store/api/radar/providers/query' \
  -H 'Content-Type: application/json' \
  -H 'If-None-Match: "previous-etag"' \
  --data '{"slugs":["x-llm","skyhope","autorouter"]}'
```

## Error Responses

请求体非法：

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Invalid request body",
  "details": {
    "formErrors": [],
    "fieldErrors": {}
  },
  "limit": 20
}
```

请求体过大：

```http
HTTP/1.1 413 Payload Too Large
```

```json
{
  "error": "Request body too large"
}
```

服务端异常：

```http
HTTP/1.1 500 Internal Server Error
```

```json
{
  "error": "Internal Server Error"
}
```

## Integration Notes

推荐接入方式：

- 聚合站首页、服务商榜单：使用该 API，自行渲染列表和排序。
- 单个服务商官网嵌入：优先使用公开状态页 iframe，不建议用 API 重新实现完整状态页。

排序建议：

1. 优先按 `observedHealthScore` 从高到低排序。
2. 样本不足的 `unknown` 放到列表末尾。
3. 可用 `sampleCount7d` 和 `confidenceLevel` 辅助展示可信度。
4. 可用 `availability24hBasisPoints` 作为短期波动提示，但不要替代主分数。

注意事项：

- `observedHealthScore` 是观测分数，不是官方 SLA。
- `grade` 是快速筛选用的粗粒度等级，不建议作为唯一决策依据。
- `status` 表示当前状态，`observedHealthScore` 表示 7 天表现，两者维度不同。
- 接口当前没有鉴权，但应避免高频轮询；推荐 10 分钟刷新一次。

## Current Production Sample

以下是 2026-06-29 线上请求 `x-llm`、`skyhope`、`autorouter` 的摘要：

| slug | score | grade | status | sampleCount7d | availability7dBasisPoints | sampleCount24h | availability24hBasisPoints |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| `x-llm` | `96.85` | `A` | `operational` | `1176` | `9685` | `678` | `9646` |
| `skyhope` | `91.03` | `B` | `operational` | `1517` | `9103` | `660` | `8909` |
| `autorouter` | `89.39` | `C` | `operational` | `1545` | `8939` | `791` | `8104` |
