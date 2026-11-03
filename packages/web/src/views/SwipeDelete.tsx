import { useEffect, useRef, useState, type ReactNode } from "react";

const ACTION = 108;
const TAP_SLOP = 16;

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, [role='button']"));
}

export function SwipeDelete({
  label = "Удалить из Изучаю",
  direction = "left",
  disabled,
  onDelete,
  children,
}: {
  label?: string;
  direction?: "left" | "right";
  disabled?: boolean;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const frontRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const startRef = useRef<{ x: number; y: number; origin: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const suppressClick = useRef(false);
  const disabledRef = useRef(disabled);
  const directionRef = useRef(direction);
  disabledRef.current = disabled;
  directionRef.current = direction;

  function moveTo(next: number) {
    const clamped =
      directionRef.current === "right"
        ? Math.max(0, Math.min(ACTION + 20, next))
        : Math.min(0, Math.max(-ACTION - 20, next));
    offsetRef.current = clamped;
    setOffset(clamped);
  }

  useEffect(() => {
    const node = frontRef.current;
    if (!node) return;

    function capturePointer(event: PointerEvent) {
      const el = frontRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic events may not have an active pointer */
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (disabledRef.current) return;
      startRef.current = { x: event.clientX, y: event.clientY, origin: offsetRef.current };
      axisRef.current = null;
      suppressClick.current = false;
    }

    function onPointerMove(event: PointerEvent) {
      const start = startRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!axisRef.current) {
        if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        if (axisRef.current === "h") {
          setDragging(true);
          capturePointer(event);
        }
      }
      if (axisRef.current !== "h") return;
      suppressClick.current = true;
      event.preventDefault();
      moveTo(start.origin + dx);
    }

    function onPointerUp() {
      if (!startRef.current) return;
      startRef.current = null;
      setDragging(false);
      if (axisRef.current === "h") {
        const opened =
          directionRef.current === "right"
            ? offsetRef.current > ACTION * 0.45
            : offsetRef.current < -ACTION * 0.45;
        moveTo(opened ? (directionRef.current === "right" ? ACTION : -ACTION) : 0);
      }
      axisRef.current = null;
    }

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove, { passive: false });
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerUp);
    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const open = direction === "right" ? offset > 12 : offset < -12;

  return (
    <div className="swipe-row">
      <button
        type="button"
        className={`swipe-action${direction === "right" ? " swipe-action-start swipe-enroll" : ""}`}
        disabled={disabled}
        onClick={onDelete}
      >
        {label}
      </button>
      <div
        ref={frontRef}
        className={`swipe-front${dragging ? " dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onClickCapture={(event) => {
          if (suppressClick.current || open) {
            event.preventDefault();
            event.stopPropagation();
            if (open && !suppressClick.current) moveTo(0);
            suppressClick.current = false;
            return;
          }
          if (isInteractive(event.target) && event.target !== event.currentTarget) return;
          const inner = event.currentTarget.querySelector<HTMLElement>("button, a, [role='button']");
          if (!inner) return;
          event.preventDefault();
          event.stopPropagation();
          inner.click();
        }}
      >
        {children}
      </div>
    </div>
  );
}
