use std::collections::HashMap;

use integrations::cli_binary_resolver::{metadata_for_id, CliBinaryId};
use key_vault::key_store::ModelType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CliPermissionMode {
    FullPermission,
    Manual,
}

impl Default for CliPermissionMode {
    fn default() -> Self {
        Self::FullPermission
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliLaunchProfileDefaults {
    pub agent_type: ModelType,
    pub command_args: &'static [&'static str],
    pub manual_args: &'static [&'static str],
    pub full_permission_args: &'static [&'static str],
    pub manual_env: &'static [(&'static str, &'static str)],
    pub full_permission_env: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliLaunchProfileOverride {
    pub permission_mode: Option<CliPermissionMode>,
    pub command_override: Option<String>,
    pub args_override: Option<Vec<String>>,
    pub env_override: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliLaunchProfileView {
    pub agent_name: String,
    pub permission_mode: CliPermissionMode,
    pub default_command: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub manual_args: Vec<String>,
    pub full_permission_args: Vec<String>,
    pub manual_env: HashMap<String, String>,
    pub full_permission_env: HashMap<String, String>,
    pub command_overridden: bool,
    pub args_overridden: bool,
    pub env_overridden: bool,
    pub effective_command: Vec<String>,
    pub required_args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCliLaunchProfile {
    pub permission_mode: CliPermissionMode,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliLaunchProfileUpdate {
    pub agent_name: String,
    pub permission_mode: CliPermissionMode,
    pub command_override: Option<String>,
    pub args_override: Option<Vec<String>>,
    pub env_override: Option<HashMap<String, String>>,
}
pub fn cli_binary_id_for_agent(agent: &ModelType) -> Option<CliBinaryId> {
    match agent {
        ModelType::CursorCli => Some(CliBinaryId::CursorCli),
        ModelType::ClaudeCode => Some(CliBinaryId::ClaudeCode),
        ModelType::Codex => Some(CliBinaryId::Codex),
        ModelType::GeminiCli => Some(CliBinaryId::GeminiCli),
        ModelType::Kiro => Some(CliBinaryId::Kiro),
        ModelType::Copilot => Some(CliBinaryId::Copilot),
        ModelType::OpenCode => Some(CliBinaryId::OpenCode),
        ModelType::KimiCli => Some(CliBinaryId::KimiCli),
        ModelType::Aider => Some(CliBinaryId::Aider),
        ModelType::Goose => Some(CliBinaryId::Goose),
        ModelType::Amp => Some(CliBinaryId::Amp),
        ModelType::Cline => Some(CliBinaryId::Cline),
        ModelType::Kilo => Some(CliBinaryId::Kilo),
        ModelType::Grok => Some(CliBinaryId::Grok),
        ModelType::Devin => Some(CliBinaryId::Devin),
        ModelType::Rovo => Some(CliBinaryId::Rovo),
        ModelType::Hermes => Some(CliBinaryId::Hermes),
        ModelType::OpenClaw => Some(CliBinaryId::OpenClaw),
        ModelType::Aug => Some(CliBinaryId::Aug),
        ModelType::Codebuff => Some(CliBinaryId::Codebuff),
        ModelType::QwenCode => Some(CliBinaryId::QwenCode),
        ModelType::MimoCode => Some(CliBinaryId::MimoCode),
        ModelType::Antigravity => Some(CliBinaryId::Antigravity),
        ModelType::Continue => Some(CliBinaryId::Continue),
        ModelType::Droid => Some(CliBinaryId::Droid),
        ModelType::MistralVibe => Some(CliBinaryId::MistralVibe),
        ModelType::Autohand => Some(CliBinaryId::Autohand),
        ModelType::Omp => Some(CliBinaryId::Omp),
        ModelType::Pi => Some(CliBinaryId::Pi),
        _ => None,
    }
}

pub fn bare_command_for_agent(agent: &ModelType) -> Option<&'static str> {
    cli_binary_id_for_agent(agent).map(|id| metadata_for_id(id).command)
}

pub const CLI_LAUNCH_PROFILE_DEFAULTS: &[CliLaunchProfileDefaults] = &[
    CliLaunchProfileDefaults {
        agent_type: ModelType::CursorCli,
        command_args: &["agent"],
        manual_args: &[],
        full_permission_args: &["--force", "--approve-mcps"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::ClaudeCode,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--dangerously-skip-permissions"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Codex,
        command_args: &["exec"],
        manual_args: &["--sandbox", "workspace-write"],
        full_permission_args: &["--dangerously-bypass-approvals-and-sandbox"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::GeminiCli,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--yolo"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Copilot,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--allow-all-tools", "--no-ask-user"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Kiro,
        command_args: &["acp"],
        manual_args: &[],
        full_permission_args: &["--trust-all-tools"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::OpenCode,
        command_args: &["acp"],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::KimiCli,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Aider,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--yes-always"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Goose,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[("GOOSE_MODE", "auto")],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Amp,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--dangerously-allow-all"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Cline,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--auto-approve", "true"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Kilo,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Grok,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--permission-mode", "bypassPermissions"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Devin,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--permission-mode", "bypass"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Rovo,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--yolo"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Hermes,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--yolo"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::OpenClaw,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Aug,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Codebuff,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::QwenCode,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--approval-mode", "yolo"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::MimoCode,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Antigravity,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--dangerously-skip-permissions"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Continue,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--allow", "*"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Droid,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::MistralVibe,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--agent", "auto-approve"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Autohand,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &["--unrestricted"],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Omp,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
    CliLaunchProfileDefaults {
        agent_type: ModelType::Pi,
        command_args: &[],
        manual_args: &[],
        full_permission_args: &[],
        manual_env: &[],
        full_permission_env: &[],
    },
];

pub fn defaults_for_agent(agent_type: &ModelType) -> Option<&'static CliLaunchProfileDefaults> {
    CLI_LAUNCH_PROFILE_DEFAULTS
        .iter()
        .find(|defaults| &defaults.agent_type == agent_type)
}

pub fn default_args_for_mode(
    defaults: &CliLaunchProfileDefaults,
    mode: CliPermissionMode,
) -> Vec<String> {
    match mode {
        CliPermissionMode::FullPermission => defaults.full_permission_args,
        CliPermissionMode::Manual => defaults.manual_args,
    }
    .iter()
    .map(|arg| (*arg).to_string())
    .collect()
}

pub fn default_env_for_mode(
    defaults: &CliLaunchProfileDefaults,
    mode: CliPermissionMode,
) -> HashMap<String, String> {
    match mode {
        CliPermissionMode::FullPermission => defaults.full_permission_env,
        CliPermissionMode::Manual => defaults.manual_env,
    }
    .iter()
    .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
    .collect()
}

pub fn static_env_to_map(
    values: &'static [(&'static str, &'static str)],
) -> HashMap<String, String> {
    values
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

pub fn static_args_to_vec(values: &'static [&'static str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}
