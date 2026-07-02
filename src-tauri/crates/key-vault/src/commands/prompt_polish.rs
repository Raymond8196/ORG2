use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::key_store::{ModelKey, ModelType, KEY_SERVICE};

const PROMPT_POLISH_SYSTEM_PROMPT: &str = r#"你是一个发给代码智能体前的 prompt 润色器。
你的唯一任务：把【用户原始输入】改写成一条更清晰、更具体、更适合继续发送给另一个强代码模型的“用户请求”。
目标风格：把模糊、口语化、过短的需求扩写成可执行的任务说明，尽量包含执行步骤、检查维度、验收标准和期望交付物。

硬性规则：
1. 你不是在和用户聊天，绝对不要回答【用户原始输入】。
2. 输出必须仍然是一条用户将要发送出去的请求/指令，而不是助手回复。
3. 不要输出思考过程，不要输出 <think>、analysis、reasoning、解释、标题、Markdown 包装。
4. 不要翻译成另一种语言。用户用中文就输出中文，用户用英文就输出英文。
5. 保持原意，不添加不存在的事实，不替用户做技术决策。
6. 保留文件名、路径、命令、代码片段、URL、模型名、占位符，例如 [[ORGII_PILL_0]] 必须原样保留。
7. 只返回改写后的用户请求文本。

短输入处理：
- 如果输入很短、很口语化或只有一个话题，不要直接回答它。
- 你要把它扩写成正式、具体、可执行的任务清单，而不是只补一句礼貌开头。
- 对工程类需求，优先拆成性能、代码质量、稳定性、安全性、测试验证、交付物等维度。
- 对项目评估类需求，优先拆成目标进度、资源配置、风险问题、质量达标、下一步方案等维度。
- 对报错排查类需求，优先补充错误信息、触发流程、涉及模块、出现频率、环境版本、根因分析、修复验证等维度。
- 如果原始输入本身是在问模型一个问题，例如“你是谁”“你能干嘛”，要把它改写成用户对模型的明确请求，不要改写成“请围绕这个问题进行询问”。
- 不要输出“例如……”“可以询问……”“或者……”这类教用户如何提问的元描述；输出只能是一条最终请求。

示例：
输入：给我优化一下后端
输出：对现有后端系统进行全面优化，具体执行以下任务：
1. 性能优化：分析接口响应时间，优化数据库查询语句，添加必要的索引，实现接口缓存策略，将核心接口平均响应时间降低30%以上
2. 代码质量优化：重构冗余、重复的代码模块，统一代码规范，添加详细的接口文档和注释，提升代码可维护性
3. 稳定性优化：完善错误处理机制，添加日志埋点和监控告警，修复已知的线上bug，将系统可用性提升至99.9%以上
4. 安全性优化：排查并修复潜在的安全漏洞，强化接口权限校验，优化敏感数据加密存储方案
5. 测试验证：完成优化后编写对应的单元测试和集成测试，进行压力测试验证优化效果，确保所有核心业务流程正常运行，输出优化前后的性能对比报告

输入：我们这个项目怎么样
输出：请针对当前正在推进的项目，从以下维度开展全面的现状调研与评估分析并形成正式评估报告：
1. 项目核心目标与当前完成进度的匹配度：梳理已明确的阶段性里程碑，统计各里程碑的实际完成占比，识别已滞后节点的具体滞后时长与影响范围
2. 资源配置效率分析：评估人力、财力、技术工具等核心资源的投入产出比，排查资源分配失衡、闲置或不足的具体环节
3. 风险与问题盘点：梳理当前项目推进中存在的技术风险、沟通壁垒、需求变更等各类问题，按影响程度分级标注并说明已采取的应对措施
4. 质量达标情况：对照项目初期设定的功能完整性、性能指标、合规性要求等质量标准，核查未达标的具体项并分析成因
最终提交的评估报告需包含量化的进度数据、问题分级清单、资源优化建议以及下一阶段的推进调整方案，确保全面清晰地呈现项目的真实运行状态。

输入：为什么老是出错
输出：请你详细说明当前开发场景中具体出现的错误信息、错误触发的操作流程、涉及的代码文件或功能模块，以及错误出现的频率和相关的环境信息（包括开发环境、运行环境、使用的技术栈版本等），以便全面排查导致程序频繁出错的根本原因，制定针对性的修复方案，完成问题的彻底解决并验证修复效果。

输入：帮我改一下
输出：请根据当前上下文定位需要修改的代码或文档内容，先分析现有实现存在的问题，再给出具体修改方案并直接完成改动；修改完成后请说明变更点、验证方式以及可能需要继续确认的边界情况。

错误示例：
输入：给我优化一下后端
错误输出：请帮我优化后端。
错误原因：输出过短，没有把模糊需求扩写成具体任务。

输入：我们这个项目怎么样
错误输出：这个项目整体还不错，但还需要继续推进。
错误原因：这是回答用户，不是将用户输入改写成可发送给大模型的任务请求。

输入：为什么老是出错
错误输出：可能是代码逻辑或环境配置有问题。
错误原因：这是猜测原因，不是用于排查问题的结构化请求。"#;

const MAX_POLISH_INPUT_CHARS: usize = 20_000;
const POLISH_REQUEST_TIMEOUT_SECONDS: u64 = 60;
const POLISH_MAX_TOKENS: u32 = 2048;
const STEP_EXPLAIN_MAX_TOKENS: u32 = 384;
const STEP_EXPLAIN_FIELD_MAX_CHARS: usize = 900;
const SHORT_ANSWER_MAX_CHARS: usize = 24;

const SESSION_STEP_EXPLAIN_SYSTEM_PROMPT: &str = r#"你是 session replay 的步骤解释器。
你的唯一任务：根据一个结构化 session event，用中文解释当前这一步发生了什么。

硬性规则：
1. 只解释当前这一步，不要预测下一步，不要给修复方案。
2. 不要回答用户问题，不要输出 <think>、analysis、reasoning、标题、Markdown。
3. 输出 1 到 2 句中文，控制在 120 字以内。
4. 说明“做了什么”和“这一步对当前任务有什么意义”。
5. 如果信息有限，就诚实说明只能判断为某类操作，不要编造文件内容或执行结果。
6. 只返回解释文本。"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPolishRequest {
    pub text: String,
    pub account_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPolishResponse {
    pub polished_text: String,
    pub model: String,
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStepExplainRequest {
    pub event_id: String,
    pub function_name: Option<String>,
    pub action_type: Option<String>,
    pub display_text: Option<String>,
    pub display_status: Option<String>,
    pub display_variant: Option<String>,
    pub source: Option<String>,
    pub file_path: Option<String>,
    pub command: Option<String>,
    pub args: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub account_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStepExplainResponse {
    pub explanation: String,
    pub model: String,
    pub account_id: String,
}

#[derive(Debug)]
struct PromptPolishSelection {
    key: ModelKey,
    model: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<ChatCompletionMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ChatCompletionMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: Option<ChatCompletionResponseMessage>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponseMessage {
    content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorResponse {
    error: Option<OpenAiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    message: Option<String>,
    #[serde(rename = "type")]
    error_type: Option<String>,
}

fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn push_unique(candidates: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() || candidates.iter().any(|candidate| candidate == trimmed) {
        return;
    }
    candidates.push(trimmed.to_string());
}

fn model_candidates(key: &ModelKey) -> Vec<String> {
    let mut candidates = Vec::new();

    for model in &key.enabled_models {
        push_unique(&mut candidates, model);
    }
    for model in &key.available_models {
        push_unique(&mut candidates, model);
    }
    for alias in &key.model_aliases {
        push_unique(&mut candidates, &alias.alias);
    }
    for variant in &key.model_variants {
        push_unique(&mut candidates, &variant.model);
    }
    for default_variant in &key.default_variants {
        push_unique(&mut candidates, &default_variant.model);
    }

    candidates
}

fn select_prompt_polish_model(
    key: &ModelKey,
    requested_model: Option<&str>,
) -> Result<String, String> {
    if let Some(model) = clean_optional(requested_model) {
        return Ok(model);
    }

    model_candidates(key)
        .into_iter()
        .find(|model| model.to_lowercase().contains("minicpm"))
        .ok_or_else(|| {
            format!(
                "No MiniCPM model configured for local model account {}",
                key.name.as_deref().unwrap_or(&key.id)
            )
        })
}

fn select_prompt_polish_account(
    account_id: Option<&str>,
    requested_model: Option<&str>,
) -> Result<PromptPolishSelection, String> {
    if let Some(account_id) = clean_optional(account_id) {
        let key = KEY_SERVICE
            .get_key_by_id(&account_id)
            .ok_or_else(|| format!("Local model account not found: {account_id}"))?;
        if key.model_type != ModelType::VllmApi {
            return Err(format!(
                "Account {} is {}, expected vllm_api",
                account_id,
                key.model_type.as_str()
            ));
        }
        if !key.enabled {
            return Err(format!("Local model account {account_id} is disabled"));
        }
        let model = select_prompt_polish_model(&key, requested_model)?;
        return Ok(PromptPolishSelection { key, model });
    }

    let keys = KEY_SERVICE
        .get_all_keys_for_agent(&ModelType::VllmApi)
        .into_iter()
        .filter(|key| key.enabled)
        .collect::<Vec<_>>();

    if keys.is_empty() {
        return Err("No local vLLM/MiniCPM account configured".to_string());
    }

    for key in keys {
        if let Ok(model) = select_prompt_polish_model(&key, requested_model) {
            return Ok(PromptPolishSelection { key, model });
        }
    }

    Err("No MiniCPM model configured in local vLLM accounts".to_string())
}

fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("MiniCPM account has no base URL".to_string());
    }

    if trimmed.ends_with("/chat/completions") {
        return Ok(trimmed.to_string());
    }
    if trimmed.ends_with("/v1") {
        return Ok(format!("{trimmed}/chat/completions"));
    }
    Ok(format!("{trimmed}/v1/chat/completions"))
}

fn content_value_to_string(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text),
        serde_json::Value::Array(parts) => {
            let text = parts
                .into_iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>()
                .join("");
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn strip_tagged_block_case_insensitive(mut text: String, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");

    loop {
        let lower = text.to_lowercase();
        let Some(start) = lower.find(&open) else {
            break;
        };
        let after_open = start + open.len();
        if let Some(relative_end) = lower[after_open..].find(&close) {
            let end = after_open + relative_end + close.len();
            text.replace_range(start..end, "");
        } else {
            text.replace_range(start.., "");
            break;
        }
    }

    text
}

fn strip_reasoning_artifacts(text: &str) -> String {
    let mut cleaned = text.to_string();
    for tag in ["think", "thinking", "reasoning", "analysis"] {
        cleaned = strip_tagged_block_case_insensitive(cleaned, tag);
    }

    cleaned
        .lines()
        .filter(|line| {
            let trimmed = line.trim().to_lowercase();
            !trimmed.starts_with("analysis:")
                && !trimmed.starts_with("reasoning:")
                && !trimmed.starts_with("thought:")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn is_short_text(text: &str) -> bool {
    text.trim().chars().count() <= SHORT_ANSWER_MAX_CHARS
}

fn normalized_short_input(text: &str) -> String {
    text.trim()
        .trim_matches(|ch: char| {
            ch.is_ascii_punctuation()
                || ch.is_whitespace()
                || matches!(
                    ch,
                    '。' | '，' | '、' | '？' | '！' | '：' | '；' | '“' | '”'
                )
        })
        .to_lowercase()
}

fn is_greeting_like(text: &str) -> bool {
    let normalized = normalized_short_input(text);
    [
        "你好",
        "您好",
        "hello",
        "hi",
        "hey",
        "在吗",
        "谢谢",
        "thanks",
        "thank you",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

fn is_identity_question(text: &str) -> bool {
    let normalized = normalized_short_input(text);
    [
        "你是谁",
        "您是谁",
        "你是什么",
        "你是什么模型",
        "你是哪个模型",
        "who are you",
        "what are you",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

fn is_capability_question(text: &str) -> bool {
    let normalized = normalized_short_input(text);
    [
        "你能干嘛",
        "你能做什么",
        "你可以做什么",
        "能干嘛",
        "能做啥",
        "会什么",
        "what can you do",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

fn normalized_task_input(text: &str) -> String {
    normalized_short_input(text)
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect()
}

fn is_backend_optimization_request(text: &str) -> bool {
    let normalized = normalized_task_input(text);
    normalized.contains("后端") && (normalized.contains("优化") || normalized.contains("改进"))
}

fn is_project_assessment_request(text: &str) -> bool {
    let normalized = normalized_task_input(text);
    normalized.contains("项目")
        && (normalized.contains("怎么样")
            || normalized.contains("如何")
            || normalized.contains("评估")
            || normalized.contains("现状"))
}

fn is_repeated_error_request(text: &str) -> bool {
    let normalized = normalized_task_input(text);
    (normalized.contains("出错") || normalized.contains("报错") || normalized.contains("错误"))
        && (normalized.contains("为什么")
            || normalized.contains("老是")
            || normalized.contains("总是")
            || normalized.contains("一直")
            || normalized.contains("频繁"))
}

fn known_task_expansion_fallback(original_text: &str) -> Option<String> {
    if is_backend_optimization_request(original_text) {
        return Some(
            r#"对现有后端系统进行全面优化，具体执行以下任务：
1. 性能优化：分析接口响应时间，优化数据库查询语句，添加必要的索引，实现接口缓存策略，将核心接口平均响应时间降低30%以上
2. 代码质量优化：重构冗余、重复的代码模块，统一代码规范，添加详细的接口文档和注释，提升代码可维护性
3. 稳定性优化：完善错误处理机制，添加日志埋点和监控告警，修复已知的线上bug，将系统可用性提升至99.9%以上
4. 安全性优化：排查并修复潜在的安全漏洞，强化接口权限校验，优化敏感数据加密存储方案
5. 测试验证：完成优化后编写对应的单元测试和集成测试，进行压力测试验证优化效果，确保所有核心业务流程正常运行，输出优化前后的性能对比报告"#
                .to_string(),
        );
    }

    if is_project_assessment_request(original_text) {
        return Some(
            r#"请针对当前正在推进的项目，从以下维度开展全面的现状调研与评估分析并形成正式评估报告：
1. 项目核心目标与当前完成进度的匹配度：梳理已明确的阶段性里程碑，统计各里程碑的实际完成占比，识别已滞后节点的具体滞后时长与影响范围
2. 资源配置效率分析：评估人力、财力、技术工具等核心资源的投入产出比，排查资源分配失衡、闲置或不足的具体环节
3. 风险与问题盘点：梳理当前项目推进中存在的技术风险、沟通壁垒、需求变更等各类问题，按影响程度分级标注并说明已采取的应对措施
4. 质量达标情况：对照项目初期设定的功能完整性、性能指标、合规性要求等质量标准，核查未达标的具体项并分析成因
最终提交的评估报告需包含量化的进度数据、问题分级清单、资源优化建议以及下一阶段的推进调整方案，确保全面清晰地呈现项目的真实运行状态。"#
                .to_string(),
        );
    }

    if is_repeated_error_request(original_text) {
        return Some(
            "请你详细说明当前开发场景中具体出现的错误信息、错误触发的操作流程、涉及的代码文件或功能模块，以及错误出现的频率和相关的环境信息（包括开发环境、运行环境、使用的技术栈版本等），以便全面排查导致程序频繁出错的根本原因，制定针对性的修复方案，完成问题的彻底解决并验证修复效果。"
                .to_string(),
        );
    }

    None
}

fn contains_request_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "请",
        "帮",
        "希望",
        "需要",
        "围绕",
        "基于",
        "说明",
        "分析",
        "实现",
        "修改",
        "优化",
        "生成",
        "write",
        "help",
        "please",
        "explain",
        "analyze",
        "implement",
        "fix",
        "optimize",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
}

fn looks_like_direct_answer(original_text: &str, polished_text: &str) -> bool {
    if !is_short_text(original_text) {
        return false;
    }

    let cleaned = polished_text
        .trim()
        .trim_matches(|ch: char| ch.is_ascii_punctuation() || ch.is_whitespace());
    if cleaned.is_empty() || contains_request_signal(cleaned) {
        return false;
    }

    let lower_original = original_text.trim().to_lowercase();
    let lower_cleaned = cleaned.to_lowercase();

    if is_identity_question(&lower_original)
        && (lower_cleaned.starts_with("我是")
            || lower_cleaned.starts_with("我是一个")
            || lower_cleaned.starts_with("i am")
            || lower_cleaned.starts_with("i'm")
            || lower_cleaned.contains("作为一个"))
    {
        return true;
    }

    if is_capability_question(&lower_original)
        && (lower_cleaned.starts_with("我可以")
            || lower_cleaned.starts_with("我能")
            || lower_cleaned.contains("可以帮你")
            || lower_cleaned.starts_with("i can"))
    {
        return true;
    }

    if !is_short_text(polished_text) || contains_request_signal(cleaned) {
        return false;
    }

    is_greeting_like(&lower_original)
        || matches!(
            lower_cleaned.as_str(),
            "hello" | "hi" | "hey" | "你好" | "您好" | "不客气" | "you're welcome"
        )
}

fn looks_like_prompt_meta_output(original_text: &str, polished_text: &str) -> bool {
    if !is_short_text(original_text) {
        return false;
    }

    let text = polished_text.trim();
    let lower = text.to_lowercase();
    [
        "例如",
        "比如",
        "可以询问",
        "进行询问",
        "您提供的信息",
        "提供的信息或身份",
        "用户原始输入",
        "原始输入",
        "教用户",
        "改写成",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
        || text.contains("”或“")
        || text.contains("或“")
        || text.contains("或者“")
}

fn looks_like_underexpanded_known_task(original_text: &str, polished_text: &str) -> bool {
    known_task_expansion_fallback(original_text).is_some()
        && polished_text.trim().chars().count() < 120
}

fn fallback_polish_for_short_answer(original_text: &str) -> String {
    if let Some(fallback) = known_task_expansion_fallback(original_text) {
        return fallback;
    }

    if is_greeting_like(original_text) {
        return "请用中文回应我的问候，并简要说明接下来可以如何帮助我。".to_string();
    }

    if is_identity_question(original_text) {
        return "请用中文介绍你的身份、能力范围，以及你可以如何帮助我。".to_string();
    }

    if is_capability_question(original_text) {
        return "请说明你可以完成哪些类型的任务，并给出几个我可以继续提问的方向。".to_string();
    }

    format!(
        "请基于“{}”将我的意图改写成一条更清晰、可直接发送给大模型的请求。",
        original_text.trim()
    )
}

fn sanitize_polished_text(original_text: &str, polished_text: &str) -> Result<String, String> {
    let cleaned = strip_reasoning_artifacts(polished_text);
    if cleaned.trim().is_empty() {
        return Err("MiniCPM returned only reasoning text".to_string());
    }

    if looks_like_direct_answer(original_text, &cleaned)
        || looks_like_prompt_meta_output(original_text, &cleaned)
        || looks_like_underexpanded_known_task(original_text, &cleaned)
    {
        return Ok(fallback_polish_for_short_answer(original_text));
    }

    Ok(cleaned)
}

fn build_polish_user_prompt(text: &str) -> String {
    format!(
        r#"请把下面这段【用户原始输入】扩写并润色成一条将发送给另一个大模型的用户请求。
要求：
1. 输出要比原始输入更具体、更可执行，必要时拆成编号任务。
2. 不要回答原始输入，不要解释，不要输出思考过程。
3. 不要只做同义改写；如果原始输入过短，要补充合理的执行维度、验收标准和交付物。

【用户原始输入】
{text}

【输出】
只输出扩写润色后的用户请求："#
    )
}

fn option_text_excerpt(value: Option<&str>, max_chars: usize) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| text_excerpt(value, max_chars))
        .unwrap_or_else(|| "无".to_string())
}

fn text_excerpt(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let excerpt = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{excerpt}...")
    } else {
        excerpt
    }
}

fn json_excerpt(value: Option<&serde_json::Value>, max_chars: usize) -> String {
    let Some(value) = value else {
        return "无".to_string();
    };

    if value.is_null() {
        return "无".to_string();
    }

    if let Some(text) = value.as_str() {
        return text_excerpt(text, max_chars);
    }

    serde_json::to_string(value)
        .map(|text| text_excerpt(&text, max_chars))
        .unwrap_or_else(|_| "无法序列化".to_string())
}

fn build_step_explain_user_prompt(request: &SessionStepExplainRequest) -> String {
    format!(
        r#"请解释下面这个 session replay 当前步骤。

事件 ID：{event_id}
事件来源：{source}
展示类型：{display_variant}
状态：{display_status}
工具/函数：{function_name}
动作类型：{action_type}
文件路径：{file_path}
命令：{command}
展示文本：{display_text}
参数摘要：{args}
结果摘要：{result}

请只输出 1 到 2 句中文解释，说明这一步做了什么，以及它为什么对当前任务有意义："#,
        event_id = option_text_excerpt(Some(&request.event_id), 160),
        source = option_text_excerpt(request.source.as_deref(), 80),
        display_variant = option_text_excerpt(request.display_variant.as_deref(), 80),
        display_status = option_text_excerpt(request.display_status.as_deref(), 80),
        function_name = option_text_excerpt(request.function_name.as_deref(), 120),
        action_type = option_text_excerpt(request.action_type.as_deref(), 120),
        file_path = option_text_excerpt(request.file_path.as_deref(), 240),
        command = option_text_excerpt(request.command.as_deref(), 360),
        display_text = option_text_excerpt(
            request.display_text.as_deref(),
            STEP_EXPLAIN_FIELD_MAX_CHARS
        ),
        args = json_excerpt(request.args.as_ref(), STEP_EXPLAIN_FIELD_MAX_CHARS),
        result = json_excerpt(request.result.as_ref(), STEP_EXPLAIN_FIELD_MAX_CHARS),
    )
}

fn sanitize_step_explanation(explanation: &str) -> Result<String, String> {
    let cleaned = strip_reasoning_artifacts(explanation);
    let cleaned = cleaned
        .trim()
        .trim_start_matches("解释：")
        .trim_start_matches("说明：")
        .trim_start_matches("当前步骤：")
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err("MiniCPM returned only reasoning text".to_string());
    }

    Ok(text_excerpt(&cleaned, 220))
}

fn extract_polished_text(
    response: ChatCompletionResponse,
    original_text: &str,
) -> Result<String, String> {
    let content = response
        .choices
        .into_iter()
        .find_map(|choice| {
            choice
                .message
                .and_then(|message| message.content)
                .and_then(content_value_to_string)
                .or(choice.text)
        })
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "MiniCPM returned an empty polish result".to_string())?;

    sanitize_polished_text(original_text, &content)
}

fn extract_step_explanation(response: ChatCompletionResponse) -> Result<String, String> {
    let content = response
        .choices
        .into_iter()
        .find_map(|choice| {
            choice
                .message
                .and_then(|message| message.content)
                .and_then(content_value_to_string)
                .or(choice.text)
        })
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "MiniCPM returned an empty step explanation".to_string())?;

    sanitize_step_explanation(&content)
}

fn provider_error_message(status: reqwest::StatusCode, body: &str) -> String {
    if let Ok(error_response) = serde_json::from_str::<OpenAiErrorResponse>(body) {
        if let Some(error) = error_response.error {
            if let Some(message) = error.message {
                if let Some(error_type) = error.error_type {
                    return format!(
                        "MiniCPM request failed: HTTP {status} {error_type}: {message}"
                    );
                }
                return format!("MiniCPM request failed: HTTP {status}: {message}");
            }
        }
    }

    let excerpt = body.trim();
    if excerpt.is_empty() {
        format!("MiniCPM request failed: HTTP {status}")
    } else {
        format!(
            "MiniCPM request failed: HTTP {status}: {}",
            excerpt.chars().take(500).collect::<String>()
        )
    }
}

async fn request_prompt_polish(key: &ModelKey, model: &str, text: &str) -> Result<String, String> {
    let base_url = key
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "MiniCPM account has no base URL".to_string())?;
    let endpoint = chat_completions_url(base_url)?;

    let user_prompt = build_polish_user_prompt(text);
    let body = ChatCompletionRequest {
        model,
        messages: vec![
            ChatCompletionMessage {
                role: "system",
                content: PROMPT_POLISH_SYSTEM_PROMPT,
            },
            ChatCompletionMessage {
                role: "user",
                content: &user_prompt,
            },
        ],
        temperature: 0.2,
        max_tokens: POLISH_MAX_TOKENS,
        stream: false,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(POLISH_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|err| format!("Failed to create MiniCPM HTTP client: {err}"))?;

    let mut request = client.post(endpoint).json(&body);
    if let Some(api_key) = key
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("MiniCPM request failed: {err}"))?;
    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read MiniCPM response: {err}"))?;

    if !status.is_success() {
        return Err(provider_error_message(status, &response_body));
    }

    let parsed = serde_json::from_str::<ChatCompletionResponse>(&response_body)
        .map_err(|err| format!("Failed to parse MiniCPM response: {err}"))?;
    extract_polished_text(parsed, text)
}

async fn request_session_step_explain(
    key: &ModelKey,
    model: &str,
    explain_request: &SessionStepExplainRequest,
) -> Result<String, String> {
    let base_url = key
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "MiniCPM account has no base URL".to_string())?;
    let endpoint = chat_completions_url(base_url)?;

    let user_prompt = build_step_explain_user_prompt(explain_request);
    let body = ChatCompletionRequest {
        model,
        messages: vec![
            ChatCompletionMessage {
                role: "system",
                content: SESSION_STEP_EXPLAIN_SYSTEM_PROMPT,
            },
            ChatCompletionMessage {
                role: "user",
                content: &user_prompt,
            },
        ],
        temperature: 0.15,
        max_tokens: STEP_EXPLAIN_MAX_TOKENS,
        stream: false,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(POLISH_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|err| format!("Failed to create MiniCPM HTTP client: {err}"))?;

    let mut request = client.post(endpoint).json(&body);
    if let Some(api_key) = key
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("MiniCPM request failed: {err}"))?;
    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read MiniCPM response: {err}"))?;

    if !status.is_success() {
        return Err(provider_error_message(status, &response_body));
    }

    let parsed = serde_json::from_str::<ChatCompletionResponse>(&response_body)
        .map_err(|err| format!("Failed to parse MiniCPM response: {err}"))?;
    extract_step_explanation(parsed)
}

#[tauri::command]
pub async fn prompt_polish(request: PromptPolishRequest) -> Result<PromptPolishResponse, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err("No text to polish".to_string());
    }
    if text.chars().count() > MAX_POLISH_INPUT_CHARS {
        return Err(format!(
            "Text is too long for MiniCPM polish: max {MAX_POLISH_INPUT_CHARS} characters"
        ));
    }

    let account_id = request.account_id.clone();
    let model = request.model.clone();
    let selection = tokio::task::spawn_blocking(move || {
        select_prompt_polish_account(account_id.as_deref(), model.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))??;

    let polished_text = request_prompt_polish(&selection.key, &selection.model, text).await?;
    Ok(PromptPolishResponse {
        polished_text,
        model: selection.model,
        account_id: selection.key.id,
    })
}

#[tauri::command]
pub async fn session_step_explain(
    request: SessionStepExplainRequest,
) -> Result<SessionStepExplainResponse, String> {
    if request.event_id.trim().is_empty() {
        return Err("No session event to explain".to_string());
    }

    let account_id = request.account_id.clone();
    let model = request.model.clone();
    let selection = tokio::task::spawn_blocking(move || {
        select_prompt_polish_account(account_id.as_deref(), model.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))??;

    let explanation =
        request_session_step_explain(&selection.key, &selection.model, &request).await?;
    Ok(SessionStepExplainResponse {
        explanation,
        model: selection.model,
        account_id: selection.key.id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key_store::{ModelAlias, ModelVariant};

    fn vllm_key() -> ModelKey {
        let mut key = ModelKey::new(ModelType::VllmApi);
        key.id = "local-1".to_string();
        key.name = Some("Local Models".to_string());
        key.enabled = true;
        key.base_url = Some("http://127.0.0.1:8000/v1".to_string());
        key
    }

    #[test]
    fn selects_minicpm_from_enabled_models_first() {
        let mut key = vllm_key();
        key.enabled_models = vec![
            "qwen2.5-coder".to_string(),
            "openbmb/minicpm5:latest".to_string(),
        ];
        key.available_models = vec!["openbmb/minicpm4".to_string()];

        let selected = select_prompt_polish_model(&key, None).unwrap();

        assert_eq!(selected, "openbmb/minicpm5:latest");
    }

    #[test]
    fn selects_minicpm_from_aliases_when_model_lists_are_empty() {
        let mut key = vllm_key();
        key.model_aliases = vec![ModelAlias {
            display_name: "MiniCPM".to_string(),
            alias: "openbmb/minicpm5:latest".to_string(),
            icon: None,
        }];

        let selected = select_prompt_polish_model(&key, None).unwrap();

        assert_eq!(selected, "openbmb/minicpm5:latest");
    }

    #[test]
    fn honors_explicit_requested_model() {
        let key = vllm_key();

        let selected = select_prompt_polish_model(&key, Some("custom-local-model")).unwrap();

        assert_eq!(selected, "custom-local-model");
    }

    #[test]
    fn fails_without_minicpm_candidate() {
        let mut key = vllm_key();
        key.model_variants = vec![ModelVariant {
            model: "qwen2.5-coder".to_string(),
            base_model: "qwen2.5-coder".to_string(),
            reasoning: None,
            fast: true,
            context_window: None,
        }];

        let error = select_prompt_polish_model(&key, None).unwrap_err();

        assert!(error.contains("No MiniCPM model configured"));
    }

    #[test]
    fn builds_chat_completions_url() {
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8000").unwrap(),
            "http://127.0.0.1:8000/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8000/v1").unwrap(),
            "http://127.0.0.1:8000/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8000/v1/chat/completions").unwrap(),
            "http://127.0.0.1:8000/v1/chat/completions"
        );
    }

    #[test]
    fn strips_think_blocks_from_polished_text() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "<think>这部分不应该进入输入框</think>\n请帮我优化这个功能描述。"
                            .to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "优化功能").unwrap();

        assert_eq!(polished, "请帮我优化这个功能描述。");
    }

    #[test]
    fn falls_back_when_short_greeting_was_answered() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "<think>用户说你好，我应该回答 Hello</think>\nHello".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "你好").unwrap();

        assert_eq!(
            polished,
            "请用中文回应我的问候，并简要说明接下来可以如何帮助我。"
        );
    }

    #[test]
    fn keeps_valid_short_request_rewrite() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "请用中文回应我的问候，并简要说明接下来可以如何帮助我。".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "你好").unwrap();

        assert_eq!(
            polished,
            "请用中文回应我的问候，并简要说明接下来可以如何帮助我。"
        );
    }

    #[test]
    fn falls_back_when_identity_question_becomes_meta_instruction() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "请围绕您提供的信息或身份进行询问，例如“请分享您的身份信息”或“您是谁？”"
                            .to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "你是谁").unwrap();

        assert_eq!(
            polished,
            "请用中文介绍你的身份、能力范围，以及你可以如何帮助我。"
        );
    }

    #[test]
    fn falls_back_when_identity_question_was_answered() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "我是一个人工智能助手，可以帮助你处理问题。".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "你是谁").unwrap();

        assert_eq!(
            polished,
            "请用中文介绍你的身份、能力范围，以及你可以如何帮助我。"
        );
    }

    #[test]
    fn keeps_valid_identity_question_rewrite() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "请用中文介绍你的身份、能力范围，以及你可以如何帮助我。".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "你是谁").unwrap();

        assert_eq!(
            polished,
            "请用中文介绍你的身份、能力范围，以及你可以如何帮助我。"
        );
    }

    #[test]
    fn expands_underdeveloped_backend_optimization_request() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String("请帮我优化后端。".to_string())),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "给我优化一下后端").unwrap();

        assert!(polished.contains("对现有后端系统进行全面优化"));
        assert!(polished.contains("性能优化"));
        assert!(polished.contains("代码质量优化"));
        assert!(polished.contains("测试验证"));
    }

    #[test]
    fn expands_underdeveloped_project_assessment_request() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "请评估一下当前项目。".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "我们这个项目怎么样").unwrap();

        assert!(polished.contains("全面的现状调研与评估分析"));
        assert!(polished.contains("项目核心目标与当前完成进度"));
        assert!(polished.contains("资源配置效率分析"));
        assert!(polished.contains("下一阶段的推进调整方案"));
    }

    #[test]
    fn expands_underdeveloped_repeated_error_request() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "请帮我排查频繁出错的问题。".to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let polished = extract_polished_text(response, "为什么老是出错").unwrap();

        assert!(polished.contains("具体出现的错误信息"));
        assert!(polished.contains("错误触发的操作流程"));
        assert!(polished.contains("使用的技术栈版本"));
        assert!(polished.contains("验证修复效果"));
    }

    #[test]
    fn strips_think_blocks_from_step_explanation() {
        let response = ChatCompletionResponse {
            choices: vec![ChatCompletionChoice {
                message: Some(ChatCompletionResponseMessage {
                    content: Some(serde_json::Value::String(
                        "<think>这里是模型推理</think>\n当前步骤正在读取后端配置文件，用于确认服务启动参数。"
                            .to_string(),
                    )),
                }),
                text: None,
            }],
        };

        let explanation = extract_step_explanation(response).unwrap();

        assert_eq!(
            explanation,
            "当前步骤正在读取后端配置文件，用于确认服务启动参数。"
        );
    }

    #[test]
    fn truncates_large_step_explain_fields() {
        let request = SessionStepExplainRequest {
            event_id: "event-1".to_string(),
            function_name: Some("read_file".to_string()),
            action_type: Some("tool_call".to_string()),
            display_text: Some("读取文件".to_string()),
            display_status: Some("completed".to_string()),
            display_variant: Some("tool_call".to_string()),
            source: Some("assistant".to_string()),
            file_path: Some("src/main.rs".to_string()),
            command: None,
            args: Some(serde_json::json!({
                "content": "x".repeat(STEP_EXPLAIN_FIELD_MAX_CHARS + 50)
            })),
            result: None,
            account_id: None,
            model: None,
        };

        let prompt = build_step_explain_user_prompt(&request);

        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("xxx"));
        assert!(prompt.contains("..."));
        assert!(prompt.len() < STEP_EXPLAIN_FIELD_MAX_CHARS + 1_500);
    }
}
