import { TerminalImeInputController } from "./terminalImeInput";

describe("TerminalImeInputController", () => {
  it("passes normal terminal data through", () => {
    const controller = new TerminalImeInputController();

    expect(controller.handleTerminalData("a")).toBe("a");
    expect(controller.handleTerminalData("\r")).toBe("\r");
  });

  it("suppresses IME preedit data and sends only the committed text", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("ni")).toBeNull();
    expect(controller.handleTerminalData("nihao ")).toBeNull();

    expect(controller.handleCompositionEnd("你好")).toBe("你好");
    expect(controller.handleTerminalData("你好")).toBeNull();
  });

  it("falls back to the next terminal data when compositionend has no data", () => {
    const controller = new TerminalImeInputController();

    controller.handleCompositionStart();
    expect(controller.handleTerminalData("nihao ")).toBeNull();
    expect(controller.handleCompositionEnd("")).toBeNull();

    expect(controller.handleTerminalData("你好")).toBe("你好");
  });
});
