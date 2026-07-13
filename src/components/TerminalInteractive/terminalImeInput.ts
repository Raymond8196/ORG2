export class TerminalImeInputController {
  private isComposing = false;
  private pendingCommittedText: string | null = null;

  handleCompositionStart(): void {
    this.isComposing = true;
    this.pendingCommittedText = null;
  }

  handleCompositionEnd(data: string): string | null {
    this.isComposing = false;
    if (!data) return null;
    this.pendingCommittedText = data;
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
    return data;
  }
}
