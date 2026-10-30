import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Native scroll-reveal (Relume timeline rhythm, no motion library).
 * Observes the element once; on first intersection adds .is-visible to itself
 * plus any [data-reveal] / [data-stagger] descendants so a single ref on a
 * panel cascades. Reduced motion, missing IntersectionObserver, or unmounted
 * refs resolve visible immediately. Also auto-assigns --reveal-index to
 * [data-stagger] children for the CSS cascade delay.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: { threshold?: number }): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const threshold = options?.threshold ?? 0.12;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const assignIndexes = (list: Element) => {
      Array.from((list as HTMLElement).children).forEach((child, i) => {
        (child as HTMLElement).style.setProperty("--reveal-index", String(i));
      });
    };
    const reveal = () => {
      node.classList.add("is-visible");
      for (const el of node.querySelectorAll("[data-reveal],[data-stagger]")) el.classList.add("is-visible");
      for (const list of node.querySelectorAll("[data-stagger]")) assignIndexes(list);
      if (node.hasAttribute("data-stagger")) assignIndexes(node);
    };
    if (prefersReducedMotion() || typeof IntersectionObserver !== "function") {
      reveal();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}

/**
 * Count-up with industrial tick (Relume stat-card rhythm, native).
 * Eases from previous value toward `value` over `duration`, returns the
 * current display string plus a `bump` flag to apply data-tick="bump" for
 * one frame on change. Reduced motion jumps straight to the value.
 */
export function useCountUp(value: number, duration = 600): { display: string; bump: boolean } {
  const [display, setDisplay] = useState(value);
  const [bump, setBump] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    if (from === value) return;
    prev.current = value;
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    setBump(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else setBump(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return { display: display.toString().padStart(2, "0"), bump };
}
