/**
 * usePanelPlacement: where a panel opens so that it stays on screen.
 *
 * A menu or a listbox is drawn under its trigger, lined up with one of the
 * trigger's edges. That is right until the trigger sits near the bottom of
 * the window, or near the side the panel lines up with. Then the panel would
 * run off screen, and a row nobody can reach is a row nobody can choose.
 *
 * So the panel is measured once, right after it opens and before the browser
 * paints it, and moved:
 *
 * 1. Past the bottom of the window, with room above the trigger: it opens
 *    upwards.
 * 2. Past the left edge: it lines up with the trigger's left edge instead.
 *    Past the right edge: with the trigger's right edge.
 *
 * `ActionMenu` and `Select` share this, so the two open the same way.
 *
 * @module hooks/usePanelPlacement
 */
import {
  useLayoutEffect,
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
  /** The positioning classes for the panel: which edge, which side. */
  className: string;
  /** The transform origin for the entrance, as `--menu-origin`. */
  style: CSSProperties;
}

/** How close to the window's edge a panel may sit, in px. */
const MARGIN = 8;

export function usePanelPlacement({
  open,
  align,
  trigger,
  panel,
}: {
  open: boolean;
  /** The edge asked for. The measurement can overrule it. */
  align: PanelEdge;
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
}): PanelPlacement {
  const [dropUp, setDropUp] = useState(false);
  const [edge, setEdge] = useState<PanelEdge>(align);

  useLayoutEffect(() => {
    if (!open) {
      setDropUp(false);
      setEdge(align);
      return;
    }
    const box = panel.current?.getBoundingClientRect();
    const anchor = trigger.current?.getBoundingClientRect();
    if (!box || !anchor) return;
    if (box.bottom > window.innerHeight) {
      setDropUp(anchor.top > box.height + MARGIN);
    }
    // Measured from wherever `align` first put it. The flip is taken only
    // when the other edge has the room this one lacks.
    if (
      box.left < MARGIN &&
      anchor.left + box.width <= window.innerWidth - MARGIN
    ) {
      setEdge("start");
    } else if (
      box.right > window.innerWidth - MARGIN &&
      anchor.right - box.width >= MARGIN
    ) {
      setEdge("end");
    }
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return {
    dropUp,
    edge,
    className: [
      edge === "end" ? "right-0" : "left-0",
      dropUp ? "bottom-full mb-1" : "top-full mt-1",
    ].join(" "),
    style: {
      "--menu-origin": `${dropUp ? "bottom" : "top"} ${
        edge === "end" ? "right" : "left"
      }`,
    } as CSSProperties,
  };
}
