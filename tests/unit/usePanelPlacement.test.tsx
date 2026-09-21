// @vitest-environment jsdom
// =============================================================================
// usePanelPlacement: where a menu or a listbox opens
// =============================================================================
// The panel goes into the browser's top layer through the Popover API, so
// nothing later in the page can paint over it (the sort menu once opened
// under the selected contact row: header and row were both z-10). It is
// placed from the trigger's box: under it, or above it when the space below
// runs out, on the edge asked for, or the other edge when that one would
// run off the window. jsdom has no top layer, so the attribute is checked
// with and without a stubbed `showPopover`, and the numbers come from
// stubbed boxes.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  usePanelPlacement,
  type PanelEdge,
} from "../../src/hooks/usePanelPlacement";

type Box = Pick<DOMRect, "top" | "left" | "width" | "height">;

const rect = (b: Box): DOMRect =>
  ({
    ...b,
    x: b.left,
    y: b.top,
    right: b.left + b.width,
    bottom: b.top + b.height,
    toJSON: () => ({}),
  }) as DOMRect;

/** The boxes the stub hands back: the button is the trigger. */
let triggerBox: Box = { top: 100, left: 200, width: 100, height: 30 };
let panelBox: Box = { top: 0, left: 0, width: 150, height: 200 };

/** The prototype, typed so the API can be stubbed and taken away again. */
const proto = HTMLElement.prototype as unknown as {
  showPopover?: () => void;
};

function Harness({
  align = "start",
  matchWidth = false,
  onClose,
}: {
  align?: PanelEdge;
  matchWidth?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const placement = usePanelPlacement({
    open,
    align,
    trigger,
    panel,
    matchWidth,
    onClose: onClose ?? (() => setOpen(false)),
  });
  return (
    <div>
      <button ref={trigger} onClick={() => setOpen((v) => !v)}>
        Open
      </button>
      {open && (
        <div
          ref={panel}
          data-testid="panel"
          data-up={String(placement.dropUp)}
          data-edge={placement.edge}
          {...placement.panelProps}
        >
          panel
        </div>
      )}
    </div>
  );
}

function mount(props: React.ComponentProps<typeof Harness> = {}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return rect(this.tagName === "BUTTON" ? triggerBox : panelBox);
    },
  );
  render(<Harness {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  return screen.getByTestId("panel");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete proto.showPopover;
  triggerBox = { top: 100, left: 200, width: 100, height: 30 };
  panelBox = { top: 0, left: 0, width: 150, height: 200 };
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

describe("usePanelPlacement", () => {
  it("puts the panel in the top layer where the browser has one", () => {
    const showPopover = vi.fn();
    proto.showPopover = showPopover;
    const panel = mount();
    expect(panel.getAttribute("popover")).toBe("manual");
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(panel.className).toContain("fixed");
  });

  it("leaves the attribute off without the API, so the panel still shows", () => {
    const panel = mount();
    expect(panel.hasAttribute("popover")).toBe(false);
    expect(panel.className).toContain("fixed");
  });

  it("opens under the trigger on its start edge, with a 4 px gap", () => {
    const panel = mount();
    expect(panel.style.top).toBe("134px");
    expect(panel.style.left).toBe("200px");
    expect(panel.dataset.up).toBe("false");
    expect(panel.dataset.edge).toBe("start");
    expect(panel.style.getPropertyValue("--menu-origin")).toBe("top left");
  });

  it("lines up with the end edge when asked", () => {
    const panel = mount({ align: "end" });
    // The trigger's right edge is 300, the panel is 150 wide.
    expect(panel.style.left).toBe("150px");
    expect(panel.dataset.edge).toBe("end");
    expect(panel.style.getPropertyValue("--menu-origin")).toBe("top right");
  });

  it("drops up when the space below runs out and there is room above", () => {
    window.innerHeight = 600;
    triggerBox = { top: 500, left: 200, width: 100, height: 30 };
    const panel = mount();
    expect(panel.dataset.up).toBe("true");
    expect(panel.style.top).toBe("296px");
    expect(panel.style.getPropertyValue("--menu-origin")).toBe("bottom left");
  });

  it("stays inside the window when neither side has the room", () => {
    window.innerHeight = 300;
    triggerBox = { top: 100, left: 200, width: 100, height: 30 };
    const panel = mount();
    expect(panel.dataset.up).toBe("false");
    // 300 minus 200 minus the 8 px margin.
    expect(panel.style.top).toBe("92px");
  });

  it("flips to the end edge when the start edge would run off the right", () => {
    window.innerWidth = 400;
    triggerBox = { top: 100, left: 300, width: 80, height: 30 };
    const panel = mount();
    expect(panel.dataset.edge).toBe("end");
    expect(panel.style.left).toBe("230px");
  });

  it("flips to the start edge when the end edge would run off the left", () => {
    triggerBox = { top: 100, left: 20, width: 80, height: 30 };
    const panel = mount({ align: "end" });
    expect(panel.dataset.edge).toBe("start");
    expect(panel.style.left).toBe("20px");
  });

  it("is at least as wide as a field's trigger", () => {
    const panel = mount({ matchWidth: true });
    expect(panel.style.minWidth).toBe("100px");
  });

  it("has no width floor of its own for a menu", () => {
    const panel = mount();
    expect(panel.style.minWidth).toBe("");
  });

  it("closes when a scroll moves the trigger, and not when the panel scrolls", () => {
    const onClose = vi.fn();
    const panel = mount({ onClose });

    // A scroll that leaves the trigger where it was.
    fireEvent.scroll(document);
    expect(onClose).not.toHaveBeenCalled();

    // The panel's own rows scrolling.
    triggerBox = { ...triggerBox, top: 40 };
    fireEvent.scroll(panel);
    expect(onClose).not.toHaveBeenCalled();

    // The page scrolling under the panel.
    act(() => {
      fireEvent.scroll(document);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes Escape inside the panel before anything else, and returns focus", () => {
    const onClose = vi.fn();
    const panel = mount({ onClose });
    // A dialog's own Escape listener: on the document, capture phase.
    const dialog = vi.fn();
    document.addEventListener("keydown", dialog, { capture: true });
    try {
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        panel.dispatchEvent(escape);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(escape.defaultPrevented).toBe(true);
      expect(dialog).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Open" }),
      );

      // Escape anywhere else is not the panel's to take.
      const elsewhere = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.body.dispatchEvent(elsewhere);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(elsewhere.defaultPrevented).toBe(false);
      expect(dialog).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", dialog, { capture: true });
    }
  });

  it("closes when the window resizes", () => {
    const onClose = vi.fn();
    mount({ onClose });
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
