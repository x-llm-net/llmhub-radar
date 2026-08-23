# 模型定价能力验证设计

## 目标

渠道商声明的模型名、OpenAI-compatible 协议成功和一次普通聊天成功，都不足以证明其供给可以按对应高价模型销售。本设计为模型定价自动审核提供可审计的最低证据，重点阻止把低档模型、中转降级模型或不完整实现按高价模型（例如 CCMax）定价。

审核结论回答的是“该 Channel 的该模型是否有足够证据达到某一价格档的最低能力门槛”，而不是证明它百分之百等同于官方模型，也不建立学术排行榜。

适用对象是 `Channel + Model + EndpointType`。它与现有渠道商审核、供给上架和探测流程配合，但保持职责独立：渠道商审核决定主体是否能供给；上游 origin 归属验证决定自定义上游是否可配置；健康探测决定当前是否可用、延迟和稳定性；本设计决定模型声明可使用的价格档及是否需要人工复核。

## 非目标和原则

- 首版不运行完整公开 benchmark，不以 MMLU 等排行榜分数作为定价证明。
- 不要求自然语言正文逐字等同官方 API；模型版本和采样本身会产生差异。
- 不把一次通过视为永久认证；上游模型或路由策略变化后必须能复核。
- 不把验证分数混入 `hub_routing_health`、质量路由分或实时 Channel 选择权重。
- 高价档采用保守缺省：证据不足进入人工审核，不自动按高档放行。
- 倍率是销售和成本规则，审核时仅作为声明价格档与候选过滤条件，不能反向抬高能力分。

## 可借鉴的开源项目

首版不引入外部评测平台作为运行依赖，测试执行应在现有供给检测和 Channel 请求路径上实现。可参考：

- [EvalScope](https://github.com/modelscope/evalscope)（Apache-2.0）：已有 K2、Kimi、MiniMax Vendor Verifier，重点比较工具调用、参数边界和部署特征。
- [OpenCompass](https://github.com/open-compass/opencompass)（Apache-2.0）、[lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)（MIT）、[Lighteval](https://github.com/huggingface/lighteval)（MIT）：后续需要离线基准或宽能力回归时使用，首版不直接接入生产审核链路。
- [LLM Endpoint Doctor](https://github.com/xinlizhu/llm-endpoint-doctor)（MIT）：参考协议、流式、工具调用和完整工具循环体检。
- [Promptfoo](https://github.com/promptfoo/promptfoo)（MIT）：参考版本化提示词集、多供应商回归和 CI 执行。

商业服务 CCTest 可作为产品参照，但不应将其黑盒结论作为本平台自动审核的唯一依据。

## 审核对象与状态

每条审核记录绑定不可变快照：

```text
channel_id + provider_id + declared_model + actual_model_mapping + endpoint_type
+ declared_price_tier + test_suite_version + baseline_version + rule_version
```

结果状态：

| 状态 | 含义 | 定价动作 |
| --- | --- | --- |
| `approved` | 所有关键门槛通过 | 允许该档上架和参与候选 |
| `pending_review` | 样本不足、版本不明、灰区或测试基础设施异常 | 不自动按高档放行，管理员复核 |
| `downgrade` | 未达到声明档，但满足较低档门槛 | 只能按建议低档销售 |
| `rejected` | 关键能力缺失、明显伪装或消费行为异常 | 不得以该声明档位上架 |
| `expired` | 验证过期或发生模型/协议漂移 | 暂停高档自动资格，等待复核 |

## 四层最小验证

高价档必须满足每层关键门槛，而不是把所有指标压成一个可被其他高分补偿的总分。

### 1. 协议与端点体检

确认声明的 `EndpointType` 能真实完成其承诺的协议能力：Chat、Responses、Anthropic Messages、Gemini `generateContent` 等对应协议；流式输出、正常结束原因、超时和错误参数；工具调用的触发、参数、结果回传和第二轮继续生成；Structured Output/JSON Schema 的有效 JSON、Schema 满足率和拒绝行为；基本上下文与最大输出边界。

仅支持 OpenAI-compatible 普通聊天的 Channel，不能据此获得 Claude Messages、Gemini 原生协议、Responses 或对应高档能力的资格。

### 2. 官方或可信基线比较

为每个模型族和价格档维护受版本控制的基线：官方 API 优先，官方不可用时可采用平台已验证的直营/可信 Channel，并明确来源和版本。比较结构化行为而非全文文本相似度，优先包括工具是否触发、工具参数字段、Schema 合法率、`finish_reason`、参数接受/拒绝、连续多轮行为和上下文召回。必要时加入低档对照基线，判断候选是否明显更接近低档模型。

### 3. 隐藏的模型族指纹题

每个高价模型首次审核使用约 8--15 个短请求。题集由模型族专属关键题和通用题构成，部分隐藏、低成本、可重复、版本化：

| 模型族 | 关键能力示例 |
| --- | --- |
| GPT | Responses、reasoning、tool calling、Structured Outputs、长上下文 |
| Claude | Messages、extended thinking、tool use、内容块顺序、长上下文 |
| Gemini | 原生 `generateContent`、function calling、安全拦截、多模态、长上下文 |
| 国模 | 各家 thinking 参数、工具调用格式、中文和代码任务、JSON Schema、厂商特有协议 |

所有模型族共享框架，但不能共享同一套题目和阈值。申请高价档时必须通过该模型族的关键能力门槛，不能只凭普通聊天成功放行。

### 4. 性能与消费合理性

性能不是能力分的替代品，但应阻断明显不可信的高价供给：成功率、超时率、TTFT P50/P95、生成 TPS、异常截断率；`usage` token 数与输入/输出长度的合理区间；小并发下的能力或稳定性降级；倍率是否违反平台规则。

审核请求使用独立成本预算、独立审计标记，不产生用户扣费、渠道商收益或正常账务记录。

## 企业探针实践：首版必须落实的规则

本模块本质上是“定价验证探针”，不是单纯的健康探针。健康探针回答“现在能否稳定调用”；定价探针回答“是否有证据达到声明档位”。以下规则直接借鉴企业验收和 Vendor Verifier 的实践：

### 题库保密、轮换和变体

- 题目、阈值、判定器和完整基线不得向渠道商公开。
- 保留少量稳定核心题，同时从隐藏题池轮换抽样；工具名、字段顺序、实体名称和部分参数允许受控变体。
- 每次审核保存 `test_suite_version`、题目 ID 和变体种子，而不是保存完整敏感请求。
- 题库变更、规则变更或模型映射变更后，旧结论不能直接继承到新版本。

### 关键题重复采样和置信度

8--15 个“题目”不等于 8--15 次请求。首版建议：

- 协议连通性题运行 1 次即可；工具调用、结构化输出、拒答/安全边界和参数行为等关键题至少运行 3 次，必要时使用不同变体。
- 记录每题通过次数、失败类别和可重复性；关键题不得用一次偶然成功覆盖多次失败。
- 关键题未达到产品定义的最低通过率，直接阻止高价 `approved`；普通题结果处于阈值灰区、有效样本不足或失败原因疑似平台自身异常时进入 `pending_review`。
- 首版不强行输出复杂统计学排名；只需保存 `pass_count / run_count`、关键题是否通过、样本是否充足和置信度等级（`high / medium / low`）。后续有真实样本后再引入 Wilson 区间或 Beta 后验。

### 必须包含负向探针

不能只测“能不能做”，还要测“不该做时是否正确拒绝”：非法 JSON Schema、缺失或错误工具参数、超出上下文/输出边界、未授权工具调用、明显越权请求和模型族特有的安全拦截。只模拟正常成功路径的中转服务可能通过正向题，却会在负向行为上暴露。

### 成本、速率和影响隔离

- 探针使用短输入、小输出、低并发和每 Channel 独立预算，并设置单次、单日上限。
- 连续失败采用退避，避免审核任务把不稳定上游打穿。
- 探针请求在日志中标记为审核流量，不计用户用量、用户扣费、渠道商收益或公开稳定性样本。
- 只有管理员可以触发全量复测；渠道商只能看到脱敏状态和失败类别，不能看到完整题目。

### 版本漂移和持续复核

审核结果绑定 `baseline_version`、`test_suite_version` 和 `rule_version`，并设有效期。以下事件应自动将高价资格置为 `pending_review` 或 `expired`：模型映射、EndpointType、上游版本/路由声明变化；连续消费或性能异常；工具/结构化行为显著漂移；基线升级。持续复核采用低频抽样，不把每次用户请求变成隐性评测。

## 可解释的判定规则

保留分项指标，而不是单一“真实性分数”：

```text
protocol_pass
critical_capability_pass
tool_call_trigger_f1
tool_schema_accuracy
structured_output_valid_rate
parameter_rejection_accuracy
finish_reason_match_rate
multi_turn_continuation_rate
context_recall_rate
token_usage_anomaly
success_rate
ttft_p50 / ttft_p95
```

高价档的最小逻辑为：

```text
协议门槛
AND 该模型族关键能力门槛
AND 工具/结构化输出门槛（若该档承诺该能力）
AND 消费合理性门槛
AND 最低稳定性门槛
```

关键题失败不能由速度或其他题目的高分抵消。普通题少量波动、基线版本不确定或样本不足应进入 `pending_review`。明确接近低档对照或缺少声明的关键能力时，输出 `downgrade` 并给出可销售的最高建议档位。

## 与现有 LLM-Hub 的集成边界

现有 `HubProvider`、`Channel`、`hub_supply_groups`、模型上架审核和 `hub_supply_probe` 仍是实体和执行基础。本模块新增模型能力/价格档资格的只读结论与审核历史，不复制 Channel 配置、协议请求实现或健康模型。

- 探针复用现有 Channel adaptor 和定价预检，确保审核凭证、模型映射和消费者实际请求一致。
- 可用性继续由当前健康探测和 `hub_routing_health` 决定；验证结果只可作为上架资格、价格档资格和候选过滤条件。
- `approved` 不是路由加分项；质量、Affinity、故障回退仍由既有路由设计处理。
- `pending_review`、`rejected` 或 `expired` 的高价声明不得进入对应高价候选池。`downgrade` 可进入其低档池。
- 审核失败不回写既有成功请求的账务。

## 审计与数据保留

每次运行保存：声明模型和供应商模型名、Channel/Provider、API 协议和 endpoint、基线来源及版本、题集与规则版本、每题结构化结果/失败原因、测试时间/区域/并发/超时、脱敏 token usage、TTFT/TPS、最终状态和人工裁决。

不得保存 API Key、Cookie、完整敏感请求或完整响应正文；保存脱敏摘要、哈希和结构化 diff。审核操作、重新运行和人工覆写均留下操作者与原因。

## 实施阶段

### F0：价格档和基线定义

定义首批高价模型、价格档、必须能力、可降级档、官方/可信基线和有效期。

### F1：协议体检

在现有 `hub_supply_probe` 调度中增加独立审核任务类型，复用 adaptor 执行最小协议、流式、工具和结构化输出检查；结果只写审核记录，不改变健康分。

### F2：隐藏指纹题与自动结论

加入每个高价档 8--15 个版本化短题、关键题重复采样、负向探针和 `approved/pending_review/downgrade/rejected` 状态。

### F3：可信基线差异比较

维护官方或可信基线的结构化行为范围，加入低档对照和版本漂移检测。只有基线来源可追溯、版本明确时才允许高价档自动 `approved`。

### F4：持续复核和人工工作台

按上游版本变更、异常账务、模型映射修改、稳定性异常或固定周期触发低频复测，展示题目级失败原因、成本和降档建议。

应推迟：完整公开 benchmark、大规模在线探索、复杂 LLM-as-a-judge、公开题库、自动永久认证，以及把能力分直接写入实时路由权重。

## 编码前必须确认

1. 哪些具体模型和价格档属于首批必须审核的高价声明，CCMax 的最低能力合同是什么？
2. 自动 `downgrade` 后，是否允许渠道商以系统建议低价档继续销售，还是必须管理员确认？
3. 官方 API 不可用或版本不明确时，哪些平台自营/可信 Channel 可作为基线，基线有效期多久？
