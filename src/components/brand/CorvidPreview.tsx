/**
 * The bird the "Corvid motion" row is about, to try: in its ring beside the
 * three choices, living faster than the sidebar's so a person sees what it
 * does while reading the row. Press it and it does what the chosen level
 * does: at "full" a flight round the window and back to this ring, at
 * "subtle" a flutter where it sits. At "off" it is a still picture and not
 * a button, since a control that does nothing is an empty Tab stop.
 *
 * The button is named "Try the corvid". The drawing stays `aria-hidden`.
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
