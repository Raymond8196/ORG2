//! Execution target for a CLI agent — *where* the agent process runs.
//!
//! Orthogonal to the CLI agent type (which decides *who* runs):
//! `cli_agent_type` is the agent identity, `exec_target` is its host. The
//! SSH-remote milestone (`docs/ssh-remote-cli-mvp-plan.md`) introduces this
//! field end-to-end so a session can opt into running on a remote host.
//!
//! ## Open enum (§2.5-B5)
//!
//! Today only [`ExecTarget::Local`] and [`ExecTarget::Remote`] exist. The
//! type is written as an open set: future milestones add `Container` /
//! `Wsl` / `RemoteAgent` and every `match` site picks them up explicitly
//! (no catch-all `_` — adding a variant is a compile error until every
//! dispatch handles it).
//!
//! ## Forward-compatible deserialization (§2.5-A2)
//!
//! serde's `#[serde(other)]` only works for unit variants, so a data-carrying
//! `Remote(SshTarget)` needs a hand-written [`Deserialize`]. The contract:
//!
//! - `"local"` / `null` / `{"local": …}` → [`ExecTarget::Local`]
//! - `{"remote": {host, port?}}` → [`ExecTarget::Remote`] (a malformed
//!   payload for a *known* variant is a hard error, not a silent degrade)
//! - any **unknown** tag (e.g. a future `{"container": …}` written by a
//!   newer build) → log a warning and degrade to [`ExecTarget::Local`],
//!   so an older build can still load a newer build's session row.
//!
//! That last rule is the cross-version safety net: a new variant never
//! panics an old reader.

use serde::{Deserialize, Serialize};

/// SSH connection target. Authentication is intentionally **not** stored
/// here — remote auth reuses the system's existing SSH mechanisms
/// (`~/.ssh/config`, ssh-agent, key file), per issue #157's "no new
/// credential storage" constraint.
///
/// Kept as a struct rather than a packed `user@host:port` string so future
/// optional fields (`proxy_jump`, `known_hosts_policy`, `keepalive`, …) can
/// be added without breaking serialized rows (§2.5-B10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    /// `user@host` or bare `host`. Passed verbatim to `ssh <host>`, so the
    /// full `~/.ssh/config` host alias / ProxyJump machinery applies.
    pub host: String,
    /// SSH port. `None` = ssh default (22) or whatever `~/.ssh/config`
    /// specifies for this host.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

impl SshTarget {
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: None,
        }
    }
}

/// Where a CLI agent process executes.
///
/// Defaults to [`ExecTarget::Local`] so that every existing session row,
/// IPC payload, and call site that omits the field keeps today's behavior.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecTarget {
    /// Run locally as a child process — today's only behavior.
    Local,
    /// Run on a remote host over SSH. The actual `ssh` spawn is wired in
    /// Phase 1 of the SSH-remote milestone; Phase 0 carries the type
    /// end-to-end and rejects `Remote` at the spawn seam with a clear
    /// "not yet wired" error so no session silently runs locally.
    Remote(SshTarget),
}

impl ExecTarget {
    /// `true` when this target is anything other than [`Local`].
    pub fn is_remote(&self) -> bool {
        matches!(self, Self::Remote(_))
    }

    /// The SSH target if this is [`Remote`](Self::Remote), else `None`.
    pub fn as_remote(&self) -> Option<&SshTarget> {
        match self {
            Self::Remote(ssh) => Some(ssh),
            Self::Local => None,
        }
    }
}

impl Default for ExecTarget {
    fn default() -> Self {
        Self::Local
    }
}

impl std::fmt::Display for ExecTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::Remote(ssh) => write!(f, "remote:{}", ssh.host),
        }
    }
}

// ---------------------------------------------------------------------------
// Forward-compatible Deserialize (see module docs).
// ---------------------------------------------------------------------------

struct ExecTargetVisitor;

impl<'de> serde::de::Visitor<'de> for ExecTargetVisitor {
    type Value = ExecTarget;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "\"local\", \"remote\", or a tagged object such as {{\"remote\":{{\"host\":\"user@host\"}}}}"
        )
    }

    fn visit_unit<E>(self) -> Result<ExecTarget, E>
    where
        E: serde::de::Error,
    {
        Ok(ExecTarget::Local)
    }

    fn visit_none<E>(self) -> Result<ExecTarget, E>
    where
        E: serde::de::Error,
    {
        Ok(ExecTarget::Local)
    }

    fn visit_str<E>(self, v: &str) -> Result<ExecTarget, E>
    where
        E: serde::de::Error,
    {
        match v {
            // Only `Local` is representable as a bare string; data-carrying
            // variants (remote/container/…) must arrive as objects.
            "local" => Ok(ExecTarget::Local),
            other => {
                tracing::warn!(
                    target = "orgii::exec_target",
                    variant = other,
                    "[exec_target] bare string `{other}` is not a valid exec target; \
                     degrading to Local"
                );
                Ok(ExecTarget::Local)
            }
        }
    }

    fn visit_map<A>(self, mut map: A) -> Result<ExecTarget, A::Error>
    where
        A: serde::de::MapAccess<'de>,
    {
        let Some(key) = map.next_key::<String>()? else {
            return Ok(ExecTarget::Local);
        };
        match key.as_str() {
            "local" => {
                // `{"local": …}` — discard any payload.
                let _: serde::de::IgnoredAny = map.next_value()?;
                Ok(ExecTarget::Local)
            }
            "remote" => {
                // Known variant with a required payload — a malformed
                // SshTarget is a real error, not a silent degrade.
                let ssh: SshTarget = map.next_value()?;
                Ok(ExecTarget::Remote(ssh))
            }
            other => {
                // Unknown variant — almost certainly a row written by a
                // newer build (e.g. `container`). Degrade so an old build
                // can still load it. (§2.5-A2)
                let _: serde::de::IgnoredAny = map.next_value()?;
                tracing::warn!(
                    target = "orgii::exec_target",
                    variant = other,
                    "[exec_target] unknown variant `{other}`; degrading to Local. \
                     A newer ORG-II build wrote this row; upgrade to handle `{other}`."
                );
                Ok(ExecTarget::Local)
            }
        }
    }
}

impl<'de> Deserialize<'de> for ExecTarget {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(ExecTargetVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_local() {
        assert_eq!(ExecTarget::default(), ExecTarget::Local);
    }

    #[test]
    fn local_round_trips_as_bare_string() {
        let json = serde_json::to_string(&ExecTarget::Local).unwrap();
        assert_eq!(json, "\"local\"");
        let back: ExecTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ExecTarget::Local);
    }

    #[test]
    fn remote_round_trips() {
        let target = ExecTarget::Remote(SshTarget {
            host: "deploy@10.0.0.5".to_string(),
            port: Some(2222),
        });
        let json = serde_json::to_string(&target).unwrap();
        let back: ExecTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(back, target);
        assert!(back.is_remote());
    }

    #[test]
    fn remote_omits_port_when_none() {
        let target = ExecTarget::Remote(SshTarget::new("build-host"));
        let json = serde_json::to_string(&target).unwrap();
        assert_eq!(json, "{\"remote\":{\"host\":\"build-host\"}}");
    }

    #[test]
    fn missing_field_is_local() {
        #[derive(Deserialize)]
        struct Wrap {
            #[serde(default)]
            exec_target: ExecTarget,
        }
        let w: Wrap = serde_json::from_str("{}").unwrap();
        assert_eq!(w.exec_target, ExecTarget::Local);
    }

    #[test]
    fn null_is_local() {
        let back: ExecTarget = serde_json::from_str("null").unwrap();
        assert_eq!(back, ExecTarget::Local);
    }

    #[test]
    fn unknown_variant_degrades_to_local_without_panic() {
        // Simulate a payload written by a future build (e.g. `Container`).
        // An older build must load it as Local, not error.
        let back: ExecTarget = serde_json::from_str("{\"container\":{\"image\":\"ubuntu\"}}").unwrap();
        assert_eq!(back, ExecTarget::Local);
    }

    #[test]
    fn unknown_bare_string_degrades_to_local() {
        let back: ExecTarget = serde_json::from_str("\"wsl\"").unwrap();
        assert_eq!(back, ExecTarget::Local);
    }

    #[test]
    fn local_tagged_object_is_local() {
        let back: ExecTarget = serde_json::from_str("{\"local\":null}").unwrap();
        assert_eq!(back, ExecTarget::Local);
    }

    #[test]
    fn remote_with_missing_host_is_a_hard_error() {
        // A known variant with a malformed payload must NOT silently become
        // Local — that would hide a real misconfiguration.
        let res = serde_json::from_str::<ExecTarget>("{\"remote\":{}}");
        assert!(res.is_err());
    }

    #[test]
    fn is_remote_and_as_remote() {
        assert!(!ExecTarget::Local.is_remote());
        assert!(ExecTarget::Local.as_remote().is_none());
        let ssh = SshTarget::new("h");
        let r = ExecTarget::Remote(ssh.clone());
        assert!(r.is_remote());
        assert_eq!(r.as_remote(), Some(&ssh));
    }
}
