/**
 * usePanelPlacement: a panel that opens over everything, where it fits.
 *
 * A menu or a listbox drawn under its trigger has two enemies in the page
 * around it. The first is the window's edge: near the bottom or the side
 * the panel would run off screen, and a row nobody can reach is a row
 * nobody can choose. The second is the stacking order. A panel drawn inside
 * its trigger's box can be painted over by anything later in the page with
 * a z-index of its own, whatever z-index the panel carries: the Network
 * header is `sticky z-10`, the selected contact row is `z-10` too and comes
 * later, so the sort menu opened under the row and looked transparent.
 *
 * So the panel goes into the browser's top layer, through the Popover API
 * (`popover="manual"` plus `showPopover()`). The top layer paints above every
 * stacking context and every `overflow: hidden`, and the panel stays where
 * it is in the DOM, so a click inside it is still a click inside its
 * trigger's wrapper, a dialog's focus trap still sees its rows, and a screen
 * reader still finds it right after its trigger. A browser without the API
 * ignores the attribute and gets the panel fixed in place, which is what it
 * had before.
 *
 * Placement is measured once, right after the panel opens and before the
 * browser paints it:
 *
 * 1. It sits under the trigger with a 4 px gap. Past the bottom of the
 *    window, with room above the trigger, it opens upwards.
 * 2. It lines up with the trigger's `align` edge. Past the side of the
 *    window, with room the other way, it lines up with the other edge.
 * 3. Whatever is left is clamped 8 px inside the window.
 *
 * A fixed panel does not move with the page, so a scroll that moves the
 * trigger closes the panel, and so does a resize. A scroll inside the panel
 * (its own rows) does not.
 *
 * Escape inside the panel closes the panel and returns focus to the trigger,
 * and nothing else happens: the hook takes the key in the window's capture
 * phase, before a dialog around the panel (Radix listens on the document,
 * also in the capture phase) can read it as its own dismissal.
 *
 * `ActionMenu` and `Select` share this, so the two open the same way.
 *
 * @module hooks/usePanelPlacement
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export type PanelEdge = "start" | "end";

export interface PanelPlacement {
  /** True when the panel opens upwards. */
  dropUp: boolean;
  /** The trigger edge the panel lines up with once measured. */
  edge: PanelEdge;
  /**
   * Spread onto the panel: the top layer attribute, the fixed position and
   * the entrance origin as `--menu-origin`.
   */
  panelProps: {
    /** Set only where the browser has a top layer to put the panel in. */
    popover?: "manual";
    className: string;
    style: CSSProperties;
  };
}

/** How close to the window's edge a panel may sit, in px. */
const MARGIN = 8;
/** The gap between the trigger and the panel, in px. */
const GAP = 4;

type Popover = HTMLElement & { showPopover?: () => void };

/**
 * Whether the browser has the Popover API. Without it the `popover`
 * attribute must stay off: a browser (and jsdom) that knows the attribute's
 * `display: none` but not `showPopover()` would never show the panel.
 */
const hasTopLayer = () =>
  typeof HTMLElement !== "undefined" &&
  typeof (HTMLElement.prototype as Popover).showPopover === "function";

/** Puts the panel in the top layer. */
const show = (panel: HTMLElement) => {
  const node = panel as Popover;
  if (typeof node.showPopover !== "function") return;
  try {
    node.showPopover();
  } catch {
    // Already shown, or not yet connected: the panel is on screen anyway.
  }
};

export function usePanelPlacement({
  open,
  align,
  trigger,
  panel,
  matchWidth = false,
  onClose,
}: {
  open: boolean;
  /** The edge asked for. The measurement can overrule it. */
  align: PanelEdge;
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  /** The panel is at least as wide as the trigger: a field's list. */
  matchWidth?: boolean;
  /** Called when a scroll moves the trigger, or the window resizes. */
  onClose?: () => void;
}): PanelPlacement {
  const [dropUp, setDropUp] = useState(false);
  const [edge, setEdge] = useState<PanelEdge>(align);
  const [position, setPosition] = useState<CSSProperties>({});
  /** Where the trigger was when the panel opened. */
  const anchorRef = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setDropUp(false);
      setEdge(align);
      setPosition({});
      anchorRef.current = null;
      return;
    }
    const node = panel.current;
    const anchorNode = trigger.current;
    if (!node || !anchorNode) return;

    // Into the top layer first: a popover that is not open has no box.
    show(node);
    const anchor = anchorNode.getBoundingClientRect();
    anchorRef.current = anchor;
    if (matchWidth) node.style.minWidth = `${Math.round(anchor.width)}px`;
    const box = node.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;

    let up = false;
    let top = anchor.bottom + GAP;
    if (
      top + box.height > height - MARGIN &&
      anchor.top - GAP - box.height >= MARGIN
    ) {
      up = true;
      top = anchor.top - GAP - box.height;
    }
    top = Math.max(MARGIN, Math.min(top, height - box.height - MARGIN));

    const fits = (left: number) =>
      left >= MARGIN && left + box.width <= width - MARGIN;
    const startLeft = anchor.left;
    const endLeft = anchor.right - box.width;
    let side = align;
    if (side === "start" && !fits(startLeft) && fits(endLeft)) side = "end";
    else if (side === "end" && !fits(endLeft) && fits(startLeft))
      side = "start";
    let left = side === "end" ? endLeft : startLeft;
    left = Math.max(MARGIN, Math.min(left, width - box.width - MARGIN));

    setDropUp(up);
    setEdge(side);
    setPosition({
      top: Math.round(top),
      left: Math.round(left),
      minWidth: matchWidth ? Math.round(anchor.width) : undefined,
    });
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !onClose) return;
    // Escape closes the panel and nothing else. A dialog around the panel
    // (Radix) listens for Escape on the document in the capture phase, so
    // a handler on the rows runs too late to keep the dialog open. The
    // window's capture phase comes first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const node = panel.current;
      const target = event.target;
      if (!node || !(target instanceof Node) || !node.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      trigger.current?.focus();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        panel.current &&
        panel.current.contains(target)
      ) {
        return;
      }
      const before = anchorRef.current;
      const now = trigger.current?.getBoundingClientRect();
      if (!before || !now) return;
      if (
        Math.abs(now.top - before.top) > 1 ||
        Math.abs(now.left - before.left) > 1
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, panel, trigger]);

  return {
    dropUp,
    edge,
    panelProps: {
      popover: hasTopLayer() ? "manual" : undefined,
      className: "fixed z-50",
      style: {
        ...position,
        "--menu-origin": `${dropUp ? "bottom" : "top"} ${
          edge === "end" ? "right" : "left"
        }`,
      } as CSSProperties,
    },
  };
}
