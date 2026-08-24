export interface FileLoadRequest {
  readonly filePath: string;
  readonly generation: number;
}

/**
 * Owns file-read generations independently from React state.
 *
 * Paths are not request identities: A -> B -> A can leave two A reads alive at
 * once. Only the latest generation may commit state, release the active marker,
 * or publish a late background mtime result.
 */
export class FileLoadCoordinator {
  private generation = 0;
  private activeRequest: FileLoadRequest | null = null;

  begin(filePath: string): FileLoadRequest | null {
    if (this.activeRequest?.filePath === filePath) {
      return null;
    }

    const request = { filePath, generation: ++this.generation };
    this.activeRequest = request;
    return request;
  }

  isActive(request: FileLoadRequest): boolean {
    return this.activeRequest?.generation === request.generation;
  }

  isLatest(request: FileLoadRequest): boolean {
    return this.generation === request.generation;
  }

  finish(request: FileLoadRequest): boolean {
    if (!this.isActive(request)) return false;
    this.activeRequest = null;
    return true;
  }

  cancel(): void {
    this.generation += 1;
    this.activeRequest = null;
  }
}
