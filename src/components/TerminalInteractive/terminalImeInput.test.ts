import { TerminalImeInputController } from "./terminalImeInput";

describe("TerminalImeInputController", () => {
  it("passes normal terminal data through", () => {
    const controller = new TerminalImeInputController();

    expect(controller.handleTerminalData("a")).toBe("a");
    expect(controller.handleTerminalData("\r")).toBe("\r");
  });

  it("suppresses terminal data while composition is active", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("nihao ")).toBeNull();
    expect(controller.handleCompositionEnd("你好")).toBe("你好");
  });

  it("suppresses duplicate terminal data after compositionend sends text", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("nihao ")).toBeNull();
    expect(controller.handleCompositionEnd("你好")).toBe("你好");
    expect(controller.handleTerminalData("你好")).toBeNull();
  });

  it("falls back to terminal data when compositionend has no data", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("nihao ")).toBeNull();
    expect(controller.handleCompositionEnd("")).toBeNull();
    expect(controller.handleTerminalData("你好")).toBe("你好");
  });

  it("does not duplicate ASCII committed by a Chinese IME after xterm already echoed it", () => {
    const controller = new TerminalImeInputController();

    for (const char of "abc") {
      expect(controller.handleTerminalData(char)).toBe(char);
    }

    expect(controller.handleCompositionEnd("abc")).toBeNull();
  });

  it("still sends ASCII composition text when xterm did not echo it", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("abc")).toBeNull();
    expect(controller.handleCompositionEnd("abc")).toBe("abc");
  });
});
