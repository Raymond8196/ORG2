import {
  isImeInputEvent,
  isImeKeyEvent,
  isPostCompositionDuplicateInput,
} from "./terminalImeDomEvents";

describe("terminal IME DOM event guards", () => {
  it("detects IME keyboard events", () => {
    expect(isImeKeyEvent({ isComposing: true, key: "a", keyCode: 65 })).toBe(
      true
    );
    expect(
      isImeKeyEvent({ isComposing: false, key: "Process", keyCode: 229 })
    ).toBe(true);
    expect(isImeKeyEvent({ isComposing: false, key: "a", keyCode: 65 })).toBe(
      false
    );
  });

  it("detects IME input events", () => {
    expect(
      isImeInputEvent({
        inputType: "insertCompositionText",
        isComposing: false,
      })
    ).toBe(true);
    expect(
      isImeInputEvent({ inputType: "insertText", isComposing: true })
    ).toBe(true);
    expect(
      isImeInputEvent({ inputType: "insertText", isComposing: false })
    ).toBe(false);
  });

  it("detects duplicate insertText immediately after composition commit", () => {
    expect(
      isPostCompositionDuplicateInput(
        { data: "a", inputType: "insertText" },
        "a",
        true
      )
    ).toBe(true);
    expect(
      isPostCompositionDuplicateInput(
        { data: "a", inputType: "insertText" },
        "a",
        false
      )
    ).toBe(false);
    expect(
      isPostCompositionDuplicateInput(
        { data: "b", inputType: "insertText" },
        "a",
        true
      )
    ).toBe(false);
  });
});
