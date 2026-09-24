/**
 * CorvidPreview — the bird the "Corvid motion" row is about, to try.
 *
 * A setting about motion is hard to choose from a sentence. This is the
 * bird itself, in its ring beside the three choices, living at a faster
 * pace than the sidebar's so a person sees what it does in the time it
 * takes to read the row. It is a perch in its own right: press it and it
 * does what the chosen level does, from here. At "full" it leaves the ring
 * for a flight round the window and lands back in this ring. At "subtle" it
 * flutters where it sits. At "off", from the account or from reduced motion,
 * it is a still picture and not a button: a control that does nothing is a
 * Tab stop with nothing behind it.
 *
 * It is a button named "Try the corvid". The drawing inside stays
 * `aria-hidden`, like every mark.
 */
import { useCallback, useRef } from "react";
import { CorvidMark } from "./CorvidMark";
import { useCorvidControls } from "../../hooks/useCorvidLife";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { flyCorvid } from "../../lib/corvid";

export const CorvidPreview = () => {
  const perch = useRef<HTMLSpanElement>(null);
  const level = useCorvidLevel();
  const bird = useCorvidControls();

  const onClick = useCallback(() => {
    flyCorvid({ kind: "loop", perch: perch.current });
  }, []);

  if (level === "off") {
    return (
      <span className="shrink-0 p-1 text-primary">
        <CorvidMark size={36} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => bird.hover(true)}
      onPointerLeave={() => bird.hover(false)}
      onFocus={() => bird.hover(true)}
      onBlur={() => bird.hover(false)}
      className="shrink-0 rounded-xl p-1 text-primary"
      aria-label="Try the corvid"
      title="Press to see what it does"
    >
      <span ref={perch} className="flex">
        <CorvidMark size={36} alive tempo={3} controls={bird} />
      </span>
    </button>
  );
};
