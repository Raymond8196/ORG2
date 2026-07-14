export function isImeKeyEvent(
  event: Pick<KeyboardEvent, "isComposing" | "key" | "keyCode">
): boolean {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

export function isImeInputEvent(
  event: Pick<InputEvent, "inputType" | "isComposing">
): boolean {
  return (
    event.isComposing ||
    event.inputType === "insertCompositionText" ||
    event.inputType === "deleteCompositionText"
  );
}

export function isPostCompositionDuplicateInput(
  event: Pick<InputEvent, "data" | "inputType">,
  committedText: string,
  active: boolean
): boolean {
  return (
    active &&
    event.inputType === "insertText" &&
    typeof event.data === "string" &&
    event.data === committedText
  );
}
