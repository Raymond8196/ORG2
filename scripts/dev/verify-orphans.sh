#!/usr/bin/env bash
# verify-orphans.sh — Ctrl+C 关闭 tauri:dev 后立即运行,验证进程残留。
#
# 用法:
#   1. pnpm tauri:dev
#   2. Ctrl+C
#   3. bash scripts/dev/verify-orphans.sh          # 第一次:看本次会话残留
#   4. bash scripts/dev/cleanup-orphans.sh          # 跑官方清理
#   5. bash scripts/dev/verify-orphans.sh           # 第二次:对比 cleanup 漏杀的
#
# 支持平台:Linux / macOS。当前 shell 不需要是 tauri:dev 的父 shell。

set -u

LABEL_WIDTH=34
found_total=0

hr() { printf '=%.0s' {1..70}; echo; }

emit() {
  # emit <category> <pattern> <bug-tag> <use-args(0|1)>
  local label="$1" pattern="$2" tag="$3" use_args="$4"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  printf "%-*s %-12s " "$LABEL_WIDTH" "[$label]" "$tag"
  if [ -z "$pids" ]; then
    echo "无"
    return
  fi
  echo "命中 ↓"
  for p in $pids; do
    local ppid cmd ppid_note
    ppid=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    if [ "$use_args" = "1" ]; then
      cmd=$(ps -o args= -p "$p" 2>/dev/null | cut -c1-88)
    else
      cmd=$(ps -o comm= -p "$p" 2>/dev/null)
    fi
    if [ "$ppid" = "1" ] || [ -z "$ppid" ]; then
      ppid_note="PPID=$ppid ⚠️init收养=孤儿"
    else
      ppid_note="PPID=$ppid"
    fi
    printf "%*s   PID %-7s %-32s %s\n" "" "" "$p" "$ppid_note" "$cmd"
    found_total=$((found_total + 1))
  done
}

echo "ORGII tauri:dev 残留进程验证"
echo "时间: $(date)    平台: $(uname -s) $(uname -r)"
hr

# ── 端口 1998 ──────────────────────────────────────────────
printf "%-*s %-12s " "$LABEL_WIDTH" "[端口 1998]" ""
if command -v ss >/dev/null 2>&1; then
  hit=$(ss -ltnp 2>/dev/null | grep ':1998' || true)
  if [ -n "$hit" ]; then echo "占用 ↓"; echo "  $hit"; found_total=$((found_total+1)); else echo "空闲"; fi
elif command -v lsof >/dev/null 2>&1; then
  hit=$(lsof -ti :1998 2>/dev/null || true)
  if [ -n "$hit" ]; then echo "占用 PID=$hit"; found_total=$((found_total+1)); else echo "空闲"; fi
else
  echo "⚠️ ss 和 lsof 都不可用 → 命中 B4"
fi

# ── cleanup 能杀的类别 ───────────────────────────────────
emit "webpack build watcher"        "build.js --watch"            "cleanup✓"  1
emit "esbuild service"              "esbuild --service"           "cleanup✓"  1
emit "ORG2 Dev (title)"             "ORG2 Dev"                    "cleanup✓"  1

# ── cleanup 杀不到的类别(命中即确认 A1) ─────────────────
emit "cargo run (无 no-default)"    "cargo run"                   "A1漏"      1
emit "org2 应用本体"                "target/(debug|release)/org2" "A1漏"      1
emit "@tauri-apps/cli tauri dev"    "tauri-apps/cli"              "A1漏"      1
emit "node tauri.js"                "scripts/dev/tauri.js"        "launcher"  1
emit "node tauri-launcher.cjs"      "tauri-launcher.cjs"          "launcher"  1

# ── PTY shell 孤儿(A2 重点:PPID=1 的 shell) ───────────
printf "%-*s %-12s " "$LABEL_WIDTH" "[PTY shell 孤儿]" "A2"
pty_found=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if [ "$pty_found" = "0" ]; then echo "命中 ↓"; fi
  pty_found=1
  p=$(echo "$line" | awk '{print $1}')
  cmd=$(ps -o args= -p "$p" 2>/dev/null | cut -c1-88)
  printf "%*s   PID %-7s PPID=1 ⚠️init收养   %s\n" "" "" "$p" "$cmd"
  found_total=$((found_total + 1))
done < <(ps -eo pid,ppid,args 2>/dev/null | awk '$2==1 && /[\/ ](bash|zsh|sh)( |$)/ {print}')
[ "$pty_found" = "0" ] && echo "无"

hr
echo "总残留进程数: $found_total"
echo
echo "解读:"
echo "  • 'cleanup✓' 类别残留   → 确认 A6(退出未触发清理,且 SIGTERM 未在窗口内完成)"
echo "  • 'A1漏' 类别残留       → 确认 A1(cleanup 模式覆盖不全,杀不到 org2/cargo/tauri-cli)"
echo "  • 'A2' 任意命中          → 确认 PTY shell setsid 孤儿(pgrep -P 查不到)"
echo "  • 任一项 PPID=1          → 该进程已脱离父进程,是真实孤儿"
echo
echo "下一步对照:运行 'bash scripts/dev/cleanup-orphans.sh' 后重新运行本脚本。"
echo "  若 'A1漏' / 'A2' 类别在 cleanup 后【仍然存在】→ 铁证 cleanup 无力清理它们。"
