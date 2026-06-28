"use client";

import { cn } from "@openstatus/ui/lib/utils";
import { useEffect, useRef } from "react";

import { ALL_EMBED_SECTIONS, useEmbed } from "@/hooks/use-embed";

export function EmbedShell({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { mode, sections } = useEmbed();
  const rootRef = useRef<HTMLDivElement>(null);
  const hideAttrs = ALL_EMBED_SECTIONS.reduce<Record<string, "true">>(
    (acc, section) => {
      if (!sections.includes(section)) acc[`data-hide-${section}`] = "true";
      return acc;
    },
    {},
  );

  useEffect(() => {
    if (!mode || window.parent === window) return;

    const root = rootRef.current;
    if (!root) return;

    const getHeight = () => {
      return Math.max(
        root.scrollHeight,
        root.offsetHeight,
        root.getBoundingClientRect().height,
      );
    };

    const post = (type: "llmhub:embed-height" | "llmhub:embed-ready") => {
      window.parent.postMessage(
        {
          height: Math.ceil(getHeight()),
          path: window.location.pathname,
          source: "llmhub-radar",
          type,
        },
        "*",
      );
    };

    const postHeight = () => post("llmhub:embed-height");
    const observer = new ResizeObserver(postHeight);
    observer.observe(root);

    post("llmhub:embed-ready");
    const frame = window.requestAnimationFrame(postHeight);
    const timer = window.setTimeout(postHeight, 300);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [mode]);

  return (
    <div
      {...props}
      ref={rootRef}
      data-embed={mode ? "true" : undefined}
      className={cn("group/embed", className)}
      {...hideAttrs}
    >
      {children}
    </div>
  );
}
