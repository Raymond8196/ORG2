const ASCII_PRINTABLE_PATTERN = /^[\x20-\x7e]+$/;

function wasAlreadyEchoedByXterm(data: string, echoBuffer: string): boolean {
  return (
    data.length > 0 &&
    ASCII_PRINTABLE_PATTERN.test(data) &&
    echoBuffer.endsWith(data)
  );
}

export class TerminalImeInputController {
  private isComposing = false;
  private pendingCommittedText: string | null = null;
  private asciiEchoBuffer = "";

  handleCompositionStart(): void {
    this.isComposing = true;
    this.pendingCommittedText = null;
    this.asciiEchoBuffer = "";
  }

  isCompositionActive(): boolean {
    return this.isComposing;
  }

  handleCompositionEnd(data: string): string | null {
    this.isComposing = false;
    if (!data) return null;
    if (wasAlreadyEchoedByXterm(data, this.asciiEchoBuffer)) {
      this.asciiEchoBuffer = "";
      return null;
    }
    this.pendingCommittedText = data;
    this.asciiEchoBuffer = "";
    return data;
  }

  handleTerminalData(data: string): string | null {
    if (!data) return null;
    if (this.isComposing) return null;
    if (this.pendingCommittedText === data) {
      this.pendingCommittedText = null;
      return null;
    }
    this.pendingCommittedText = null;
    this.trackEchoedTerminalData(data);
    return data;
  }

  private trackEchoedTerminalData(data: string): void {
    if (data === "\x7f") {
      this.asciiEchoBuffer = this.asciiEchoBuffer.slice(0, -1);
      return;
    }
    if (ASCII_PRINTABLE_PATTERN.test(data)) {
      this.asciiEchoBuffer = (this.asciiEchoBuffer + data).slice(-80);
      return;
    }
    this.asciiEchoBuffer = "";
  }
}
