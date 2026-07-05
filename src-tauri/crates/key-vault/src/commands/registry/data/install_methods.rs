//! CLI install, uninstall, and install-method inference helpers.

use super::super::CliInstallMethod;

pub(crate) fn cli_install_methods(name: &str) -> Vec<CliInstallMethod> {
    let m = |id: &str, label: &str, cmd: &str| CliInstallMethod {
        id: id.into(),
        label: label.into(),
        command: cmd.into(),
    };
    match name {
        "claude_code" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://claude.ai/install.sh | bash",
            ),
            m(
                "powershell",
                "PowerShell",
                "irm https://claude.ai/install.ps1 | iex",
            ),
            m("homebrew", "Homebrew", "brew install --cask claude-code"),
            m("npm", "npm", "npm install -g @anthropic-ai/claude-code"),
        ],
        "codex" => vec![
            m("npm", "npm", "npm install -g @openai/codex"),
            m("homebrew", "Homebrew", "brew install --cask codex"),
        ],
        "cursor_cli" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://cursor.com/install | bash",
            ),
            m("npm", "npm", "npm install -g cursor-cli"),
        ],
        "kiro" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://cli.kiro.dev/install | bash",
            ),
            m(
                "appimage",
                "AppImage",
                "curl -L https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.appimage -o kiro-cli.appimage && chmod +x kiro-cli.appimage",
            ),
            m(
                "deb",
                ".deb",
                "wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.deb && sudo dpkg -i kiro-cli.deb && sudo apt-get install -f",
            ),
            m(
                "zip-x64",
                "Linux x86-64",
                "curl --proto '=https' --tlsv1.2 -sSf 'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-x86_64-linux.zip' -o kirocli.zip && unzip kirocli.zip && ./kirocli/install.sh",
            ),
        ],
        "copilot" => vec![
            m("npm", "npm", "npm install -g @github/copilot"),
            m(
                "curl",
                "curl",
                "curl -fsSL https://gh.io/copilot-install | bash",
            ),
            m("homebrew", "Homebrew", "brew install copilot-cli"),
            m("winget", "WinGet", "winget install GitHub.Copilot"),
        ],
        "gemini_cli" => vec![
            m("npm", "npm", "npm install -g @google/gemini-cli"),
            m(
                "npx",
                "npx",
                "npx https://github.com/google-gemini/gemini-cli",
            ),
        ],
        "kimi_cli" => vec![
            m(
                "curl",
                "curl",
                "curl -LsSf https://code.kimi.com/install.sh | bash",
            ),
            m(
                "powershell",
                "PowerShell",
                "irm https://code.kimi.com/install.ps1 | iex",
            ),
            m("uv", "uv", "uv tool install --python 3.13 kimi-cli"),
        ],
        "openclaude" => vec![
            m("npm", "npm", "npm install -g openclaude"),
        ],
        "aider" => vec![
            m("pip", "pip / pipx", "pip install aider-chat"),
            m("brew", "Homebrew", "brew install aider"),
        ],
        "goose" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://github.com/block/goose/releases/latest/download/install.sh | bash",
            ),
            m("pip", "pipx", "pipx install goose-ai"),
        ],
        "amp" => vec![
            m("npm", "npm", "npm install -g @sourcegraph/amp"),
        ],
        "cline" => vec![
            m("npm", "npm", "npm install -g cline"),
        ],
        "kilo" => vec![
            m("npm", "npm", "npm install -g kilocode"),
        ],
        "grok" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://raw.githubusercontent.com/xai-org/grok-cli/main/install.sh | bash",
            ),
            m("npm", "npm", "npm install -g @xai/grok-cli"),
        ],
        "devin" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://github.com/cognition-ai/devin/releases/latest/download/install.sh | bash",
            ),
        ],
        "rovo" => vec![
            m("npm", "npm", "npm install -g @atlassian/rovo"),
        ],
        "hermes" => vec![
            m("pip", "pipx", "pipx install hermes-ai"),
            m("npm", "npm", "npm install -g @hermes-ai/cli"),
        ],
        "openclaw" => vec![
            m("npm", "npm", "npm install -g openclaw"),
        ],
        "crush" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://raw.githubusercontent.com/charmbracelet/crush/main/install/install.sh | bash",
            ),
        ],
        "aug" => vec![
            m("npm", "npm", "npm install -g @augmentcode/auggie"),
        ],
        "codebuff" => vec![
            m("npm", "npm", "npm install -g codebuff"),
        ],
        "command_code" => vec![
            m("npm", "npm", "npm install -g command-code"),
        ],
        "qwen_code" => vec![
            m("npm", "npm", "npm install -g qwen-code"),
        ],
        "mimo_code" => vec![
            m("npm", "npm", "npm install -g mimo-code"),
        ],
        "antigravity" => vec![
            m("pip", "pipx", "pipx install antigravity"),
            m("pip", "pip", "pip install antigravity"),
        ],
        "continue_cli" => vec![
            m("npm", "npm", "npm install -g @continuedev/continue"),
        ],
        "droid" => vec![
            m("npm", "npm", "npm install -g droid-ai"),
        ],
        "mistral_vibe" => vec![
            m("pip", "pipx", "pipx install mistral-vibe"),
            m("pip", "pip", "pip install mistral-vibe"),
        ],
        "ante" => vec![
            m("npm", "npm", "npm install -g ante-ai"),
        ],
        "autohand" => vec![
            m("npm", "npm", "npm install -g autohand"),
        ],
        "omp" => vec![
            m("npm", "npm", "npm install -g omp-ai"),
        ],
        "pi" => vec![
            m("npm", "npm", "npm install -g pi-ai-cli"),
        ],
        // The caller iterates `cli_agent_registry()` entries, so any
        // CLI agent that ships in the registry but has no install_methods
        // entry here would silently render the "Install" UI as a no-op.
        // Warn so a future registry addition surfaces in logs.
        other => {
            tracing::warn!(
                "[key_vault::registry] cli_install_methods has no entry for CLI agent {:?}; \
                 the Install UI will show no options",
                other
            );
            Vec::new()
        }
    }
}

pub(crate) fn cli_uninstall_methods(name: &str) -> Vec<CliInstallMethod> {
    let m = |id: &str, label: &str, cmd: &str| CliInstallMethod {
        id: id.into(),
        label: label.into(),
        command: cmd.into(),
    };
    match name {
        "claude_code" => vec![
            m("native", "Native", "claude uninstall"),
            m("homebrew", "Homebrew", "brew uninstall --cask claude-code"),
            m("npm", "npm", "npm uninstall -g @anthropic-ai/claude-code"),
        ],
        "codex" => vec![
            m("npm", "npm", "npm uninstall -g @openai/codex"),
            m("homebrew", "Homebrew", "brew uninstall --cask codex"),
        ],
        "cursor_cli" => vec![
            m("npm", "npm", "npm uninstall -g cursor-cli"),
            m(
                "curl",
                "curl",
                "rm -rf ~/.local/bin/cursor ~/.local/share/cursor",
            ),
        ],
        "kiro" => vec![
            m("cli", "Native", "kiro-cli uninstall"),
            m("apt", "apt", "sudo apt-get remove kiro-cli"),
        ],
        "copilot" => vec![
            m("npm", "npm", "npm uninstall -g @github/copilot"),
            m("homebrew", "Homebrew", "brew uninstall copilot-cli"),
            m("winget", "WinGet", "winget uninstall GitHub.Copilot"),
        ],
        "gemini_cli" => vec![m("npm", "npm", "npm uninstall -g @google/gemini-cli")],
        "kimi_cli" => vec![m("uv", "uv", "uv tool uninstall kimi-cli")],
        "openclaude" => vec![m("npm", "npm", "npm uninstall -g openclaude")],
        "aider" => vec![
            m("pip", "pip", "pip uninstall aider-chat"),
            m("brew", "Homebrew", "brew uninstall aider"),
        ],
        "goose" => vec![m("pip", "pipx", "pipx uninstall goose-ai")],
        "amp" => vec![m("npm", "npm", "npm uninstall -g @sourcegraph/amp")],
        "cline" => vec![m("npm", "npm", "npm uninstall -g cline")],
        "kilo" => vec![m("npm", "npm", "npm uninstall -g kilocode")],
        "grok" => vec![m("npm", "npm", "npm uninstall -g @xai/grok-cli")],
        "devin" => vec![m("native", "Native", "devin uninstall")],
        "rovo" => vec![m("npm", "npm", "npm uninstall -g @atlassian/rovo")],
        "hermes" => vec![
            m("pip", "pipx", "pipx uninstall hermes-ai"),
            m("npm", "npm", "npm uninstall -g @hermes-ai/cli"),
        ],
        "openclaw" => vec![m("npm", "npm", "npm uninstall -g openclaw")],
        "crush" => vec![m("native", "Native", "rm -f $(which crush)")],
        "aug" => vec![m("npm", "npm", "npm uninstall -g @augmentcode/auggie")],
        "codebuff" => vec![m("npm", "npm", "npm uninstall -g codebuff")],
        "command_code" => vec![m("npm", "npm", "npm uninstall -g command-code")],
        "qwen_code" => vec![m("npm", "npm", "npm uninstall -g qwen-code")],
        "mimo_code" => vec![m("npm", "npm", "npm uninstall -g mimo-code")],
        "antigravity" => vec![
            m("pip", "pipx", "pipx uninstall antigravity"),
            m("pip", "pip", "pip uninstall antigravity"),
        ],
        "continue_cli" => vec![m("npm", "npm", "npm uninstall -g @continuedev/continue")],
        "droid" => vec![m("npm", "npm", "npm uninstall -g droid-ai")],
        "mistral_vibe" => vec![
            m("pip", "pipx", "pipx uninstall mistral-vibe"),
            m("pip", "pip", "pip uninstall mistral-vibe"),
        ],
        "ante" => vec![m("npm", "npm", "npm uninstall -g ante-ai")],
        "autohand" => vec![m("npm", "npm", "npm uninstall -g autohand")],
        "omp" => vec![m("npm", "npm", "npm uninstall -g omp-ai")],
        "pi" => vec![m("npm", "npm", "npm uninstall -g pi-ai-cli")],
        // Same fail-loud principle as `cli_install_methods` above.
        other => {
            tracing::warn!(
                "[key_vault::registry] cli_uninstall_methods has no entry for CLI agent {:?}; \
                 the Uninstall UI will show no options",
                other
            );
            Vec::new()
        }
    }
}

/// Infer install method from the binary path returned by `which`/`where`.
///
/// Resolves symlinks first so that e.g. `~/.local/bin/poetry` →
/// `~/.local/pipx/venvs/poetry/bin/poetry` is detected as pip, while
/// `~/.local/bin/cursor` (a plain shell script from a curl installer) is
/// detected as curl.
pub(crate) fn infer_install_method(binary_path: &str) -> Option<String> {
    let resolved = std::fs::canonicalize(binary_path)
        .ok()
        .and_then(|p| p.to_str().map(String::from));
    let resolved_lower = resolved.as_deref().map(|s| s.to_lowercase());
    let original_lower = binary_path.to_lowercase();

    let either_contains = |pattern: &str| -> bool {
        original_lower.contains(pattern)
            || resolved_lower
                .as_deref()
                .is_some_and(|r| r.contains(pattern))
    };

    #[cfg(not(windows))]
    {
        if either_contains("/homebrew/")
            || either_contains("/cellar/")
            || either_contains("/linuxbrew/")
        {
            return Some("homebrew".into());
        }
        if either_contains("/node_modules/")
            || either_contains("/lib/node_modules/")
            || either_contains("/.nvm/")
            || either_contains("/.fnm/")
            || either_contains("/.volta/")
        {
            return Some("npm".into());
        }
        if either_contains("/.cargo/bin/") {
            return Some("cargo".into());
        }
        if either_contains("/snap/bin/") || either_contains("/snap/") {
            return Some("snap".into());
        }
        if either_contains("/pipx/")
            || either_contains("/pyenv/")
            || either_contains("/.pyenv/")
            || either_contains("/library/python/")
            || either_contains("/lib/python")
        {
            return Some("pip".into());
        }
        if either_contains("/.local/bin/") {
            return Some("curl".into());
        }
        if original_lower.starts_with("/usr/local/bin/") || original_lower.starts_with("/usr/bin/")
        {
            return Some("curl".into());
        }
    }

    #[cfg(windows)]
    {
        if either_contains(r"\node_modules\")
            || either_contains(r"\npm\")
            || either_contains(r"\nvm\")
            || either_contains(r"\fnm\")
            || either_contains(r"\volta\")
        {
            return Some("npm".into());
        }
        if either_contains(r"\scoop\") {
            return Some("scoop".into());
        }
        if either_contains(r"\cargo\bin\") {
            return Some("cargo".into());
        }
        if either_contains(r"\pipx\") || either_contains(r"\python") || either_contains(r"\pyenv\")
        {
            return Some("pip".into());
        }
        if either_contains(r"\program files") || either_contains(r"\appdata\local\programs") {
            return Some("native".into());
        }
    }

    None
}
