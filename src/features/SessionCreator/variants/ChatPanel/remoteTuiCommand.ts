const REMOTE_TUI_LOCALE_BOOTSTRAP =
  'if [ -z "${LANG:-}" ] || [ "$LANG" = "C" ] || [ "$LANG" = "POSIX" ]; then export LANG=C.UTF-8; fi; export LC_CTYPE="${LC_CTYPE:-$LANG}"';

const REMOTE_TUI_RUNTIME_BOOTSTRAP =
  'if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true; nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent stable >/dev/null 2>&1 || true; fi';

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteTuiScript(input: {
  command: string;
  workingDir?: string;
}): string {
  const bootstrap = `${REMOTE_TUI_LOCALE_BOOTSTRAP}; ${REMOTE_TUI_RUNTIME_BOOTSTRAP}`;
  return input.workingDir
    ? `${bootstrap}; cd ${shQuote(input.workingDir)} && exec ${input.command}`
    : `${bootstrap}; exec ${input.command}`;
}

export function buildRemoteTuiCommand(input: {
  command: string;
  host: string;
  port?: number;
  workingDir?: string;
}): string {
  const sshArgs = [
    "-tt",
    "-o BatchMode=yes",
    "-o ControlMaster=auto",
    '-o ControlPath="$HOME/.orgii/ssh/%C"',
    "-o ControlPersist=60s",
    "-o ServerAliveInterval=30",
    "-o ServerAliveCountMax=3",
  ];
  if (input.port) {
    sshArgs.push("-p", String(input.port));
  }
  const remoteScript = buildRemoteTuiScript(input);
  const remoteCommand = `bash -ic ${shQuote(remoteScript)}`;
  return [
    'mkdir -p "$HOME/.orgii/ssh"',
    "&&",
    "ssh",
    ...sshArgs,
    shQuote(input.host),
    shQuote(remoteCommand),
  ].join(" ");
}
