use serde_json::{json, Value};

use super::*;

pub(crate) fn read_file_args_from_shell_args(shell_args: &Value) -> Option<Value> {
    read_file_arg_values_from_shell_args(shell_args)?
        .into_iter()
        .next()
}

pub(crate) fn read_file_arg_values_from_shell_args(shell_args: &Value) -> Option<Vec<Value>> {
    let command = shell_args.get("command").and_then(Value::as_str)?.trim();
    if command.is_empty() {
        return None;
    }

    let cwd = shell_args
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let commands = split_shell_read_command_chain(command)?;
    let command_count = commands.len();
    let mut read_args_values = Vec::with_capacity(command_count);

    for (index, command_part) in commands.iter().enumerate() {
        let tokens = shell_tokens(command_part);
        let read_args = read_file_args_from_tokens(&tokens)?;
        if command_count > 1 && read_args.limit.is_none() {
            return None;
        }
        let mut value = shell_read_args_to_value(
            read_args,
            command_part,
            &cwd,
            shell_args,
            command,
            index,
            command_count,
        );
        if command_count == 1 {
            if let Some(obj) = value.as_object_mut() {
                obj.remove("source_command");
                obj.remove("command_index");
                obj.remove("command_count");
            }
        }
        read_args_values.push(value);
    }

    if read_args_values.is_empty() {
        None
    } else {
        Some(read_args_values)
    }
}

pub(crate) fn shell_read_args_to_value(
    read_args: ShellReadArgs,
    command: &str,
    cwd: &str,
    shell_args: &Value,
    source_command: &str,
    command_index: usize,
    command_count: usize,
) -> Value {
    json!({
        "path": read_args.path.clone(),
        "file_path": read_args.path.clone(),
        "target_file": read_args.path,
        "offset": read_args.offset,
        "limit": read_args.limit,
        "command": command,
        "source_command": source_command,
        "command_index": command_index,
        "command_count": command_count,
        "cwd": cwd,
        "payload": shell_args.clone(),
    })
}

pub(crate) struct ShellReadArgs {
    path: String,
    offset: Option<i64>,
    limit: Option<i64>,
}

pub(crate) fn split_shell_read_command_chain(command: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(active_quote) = quote {
            current.push(ch);
            if ch == active_quote {
                quote = None;
            } else if ch == '\\' && active_quote == '"' {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            continue;
        }

        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            '&' if chars.peek() == Some(&'&') => {
                chars.next();
                push_shell_command_part(&mut parts, &mut current)?;
            }
            '|' if chars.peek() == Some(&'|') => return None,
            ';' => {
                push_shell_command_part(&mut parts, &mut current)?;
            }
            _ => current.push(ch),
        }
    }

    if quote.is_some() {
        return None;
    }
    push_shell_command_part(&mut parts, &mut current)?;
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

pub(crate) fn push_shell_command_part(parts: &mut Vec<String>, current: &mut String) -> Option<()> {
    let part = current.trim();
    if part.is_empty() {
        return None;
    }
    parts.push(part.to_string());
    current.clear();
    Some(())
}

pub(crate) fn read_file_args_from_tokens(tokens: &[String]) -> Option<ShellReadArgs> {
    if tokens.is_empty() {
        return None;
    }
    if let Some(read_args) = read_file_args_from_nl_sed_pipeline(tokens) {
        return Some(read_args);
    }
    if tokens.iter().any(|token| is_shell_separator(token)) {
        return None;
    }

    let executable = tokens[0].rsplit('/').next().unwrap_or(tokens[0].as_str());
    match executable {
        "cat" => read_file_args_from_cat(&tokens[1..]),
        "sed" => read_file_args_from_sed(&tokens[1..]),
        "head" => read_file_args_from_head_tail(&tokens[1..], true),
        "tail" => read_file_args_from_head_tail(&tokens[1..], false),
        _ => None,
    }
}

pub(crate) fn read_file_args_from_nl_sed_pipeline(tokens: &[String]) -> Option<ShellReadArgs> {
    if tokens
        .iter()
        .any(|token| matches!(token.as_str(), "&&" | "||" | ";"))
    {
        return None;
    }

    let mut pipe_indices = tokens
        .iter()
        .enumerate()
        .filter_map(|(index, token)| (token == "|").then_some(index));
    let pipe_index = pipe_indices.next()?;
    if pipe_indices.next().is_some() || pipe_index == 0 || pipe_index + 1 >= tokens.len() {
        return None;
    }

    let path = read_file_path_from_nl(&tokens[..pipe_index])?;
    let (offset, limit) = read_range_from_pipeline_sed(&tokens[(pipe_index + 1)..])?;
    Some(ShellReadArgs {
        path,
        offset,
        limit,
    })
}

pub(crate) fn read_file_path_from_nl(tokens: &[String]) -> Option<String> {
    if tokens.is_empty() {
        return None;
    }
    let executable = tokens[0].rsplit('/').next().unwrap_or(tokens[0].as_str());
    if executable != "nl" {
        return None;
    }

    let mut paths = Vec::new();
    let mut index = 1usize;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        if token == "--" {
            paths.extend(tokens[(index + 1)..].iter().cloned());
            break;
        }
        if token.starts_with('-') {
            index += if nl_option_consumes_next(token) { 2 } else { 1 };
            continue;
        }
        paths.push(token.to_string());
        index += 1;
    }

    single_shell_path_arg(&paths)
}

pub(crate) fn nl_option_consumes_next(token: &str) -> bool {
    matches!(
        token,
        "-b" | "-d" | "-f" | "-h" | "-i" | "-l" | "-n" | "-s" | "-v" | "-w"
    ) || matches!(
        token,
        "--body-numbering"
            | "--section-delimiter"
            | "--footer-numbering"
            | "--header-numbering"
            | "--line-increment"
            | "--join-blank-lines"
            | "--number-format"
            | "--number-separator"
            | "--starting-line-number"
            | "--number-width"
    )
}

pub(crate) fn read_range_from_pipeline_sed(tokens: &[String]) -> Option<(Option<i64>, Option<i64>)> {
    if tokens.is_empty() {
        return None;
    }
    let executable = tokens[0].rsplit('/').next().unwrap_or(tokens[0].as_str());
    if executable != "sed" {
        return None;
    }

    let mut index = 1usize;
    let mut has_quiet = false;
    let mut range_expr: Option<&str> = None;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        match token {
            "-n" | "--quiet" | "--silent" => {
                has_quiet = true;
                index += 1;
            }
            "-e" | "--expression" => {
                range_expr = tokens.get(index + 1).map(String::as_str);
                index += 2;
            }
            _ if token.starts_with('-') => return None,
            _ if range_expr.is_none() => {
                range_expr = Some(token);
                index += 1;
            }
            _ => return None,
        }
    }

    if !has_quiet {
        return None;
    }
    sed_range_to_offset_limit(range_expr?)
}

pub(crate) fn read_file_args_from_cat(tokens: &[String]) -> Option<ShellReadArgs> {
    let paths = shell_path_args(
        tokens,
        &["-n", "-b", "-s", "-v", "-e", "-t", "-A", "--number"],
    )?;
    let path = single_shell_path_arg(&paths)?;
    Some(ShellReadArgs {
        path,
        offset: None,
        limit: None,
    })
}

pub(crate) fn read_file_args_from_sed(tokens: &[String]) -> Option<ShellReadArgs> {
    let mut index = 0usize;
    let mut has_quiet = false;
    let mut range_expr: Option<&str> = None;
    let mut paths: Vec<String> = Vec::new();

    while index < tokens.len() {
        let token = tokens[index].as_str();
        match token {
            "-n" | "--quiet" | "--silent" => {
                has_quiet = true;
                index += 1;
            }
            "-e" | "--expression" => {
                range_expr = tokens.get(index + 1).map(String::as_str);
                index += 2;
            }
            "--" => {
                paths.extend(tokens[(index + 1)..].iter().cloned());
                break;
            }
            _ if token.starts_with('-') => return None,
            _ if range_expr.is_none() => {
                range_expr = Some(token);
                index += 1;
            }
            _ => {
                paths.push(token.to_string());
                index += 1;
            }
        }
    }

    if !has_quiet {
        return None;
    }
    let (offset, limit) = sed_range_to_offset_limit(range_expr?)?;
    let path = single_shell_path_arg(&paths)?;
    Some(ShellReadArgs {
        path,
        offset,
        limit,
    })
}

pub(crate) fn read_file_args_from_head_tail(tokens: &[String], is_head: bool) -> Option<ShellReadArgs> {
    let mut index = 0usize;
    let mut line_count: Option<i64> = None;
    let mut paths = Vec::new();

    while index < tokens.len() {
        let token = tokens[index].as_str();
        match token {
            "-n" | "--lines" => {
                line_count = tokens
                    .get(index + 1)
                    .and_then(|value| value.trim_start_matches('+').parse::<i64>().ok());
                index += 2;
            }
            "--" => {
                paths.extend(tokens[(index + 1)..].iter().cloned());
                break;
            }
            _ if token.starts_with("-n") && token.len() > 2 => {
                line_count = token[2..].trim_start_matches('+').parse::<i64>().ok();
                index += 1;
            }
            _ if token.starts_with("--lines=") => {
                line_count = token
                    .trim_start_matches("--lines=")
                    .trim_start_matches('+')
                    .parse::<i64>()
                    .ok();
                index += 1;
            }
            _ if token.starts_with('-') => return None,
            _ => {
                paths.push(token.to_string());
                index += 1;
            }
        }
    }

    let path = single_shell_path_arg(&paths)?;
    Some(ShellReadArgs {
        path,
        offset: if is_head { Some(0) } else { None },
        limit: line_count,
    })
}

pub(crate) fn shell_path_args(tokens: &[String], flag_allowlist: &[&str]) -> Option<Vec<String>> {
    let mut paths = Vec::new();
    let mut index = 0usize;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        if token == "--" {
            paths.extend(tokens[(index + 1)..].iter().cloned());
            break;
        }
        if token.starts_with('-') {
            if flag_allowlist.contains(&token) {
                index += 1;
                continue;
            }
            return None;
        }
        paths.push(token.to_string());
        index += 1;
    }
    Some(paths)
}

pub(crate) fn single_shell_path_arg(paths: &[String]) -> Option<String> {
    if paths.len() != 1 {
        return None;
    }
    let path = paths[0].trim();
    if path.is_empty() || path == "-" {
        return None;
    }
    Some(path.to_string())
}

pub(crate) fn sed_range_to_offset_limit(expr: &str) -> Option<(Option<i64>, Option<i64>)> {
    let expr = expr.trim().trim_end_matches(';');
    if expr.contains('/') || expr.contains('s') {
        return None;
    }
    let mut parts = expr
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty());
    let first_part = parts.next()?;
    let (offset, limit) = sed_single_range_to_offset_limit(first_part)?;
    for part in parts {
        sed_single_range_to_offset_limit(part)?;
    }
    if expr.contains(';') {
        return Some((offset, None));
    }
    Some((offset, limit))
}

pub(crate) fn sed_single_range_to_offset_limit(expr: &str) -> Option<(Option<i64>, Option<i64>)> {
    if !expr.ends_with('p') {
        return None;
    }
    let range = expr.trim_end_matches('p').trim();
    if let Some((start_raw, end_raw)) = range.split_once(',') {
        let start = start_raw.trim().parse::<i64>().ok()?;
        let end = end_raw.trim().parse::<i64>().ok()?;
        if start < 1 || end < start {
            return None;
        }
        return Some((Some(start - 1), Some(end - start + 1)));
    }
    let line = range.parse::<i64>().ok()?;
    if line < 1 {
        return None;
    }
    Some((Some(line - 1), Some(1)))
}
