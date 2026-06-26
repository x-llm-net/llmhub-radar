import { cn } from "@/lib/utils";

export function Wordmark({
  size = 24,
  showText = false,
  className,
  href = "/",
  target,
  rel,
  ...props
}: Omit<React.ComponentProps<"a">, "children"> & {
  size?: 24 | 32;
  showText?: boolean;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={cn("flex items-center gap-2", className)}
      {...props}
    >
      <img
        src="/llmhub-radar-logo.png"
        alt=""
        className="object-contain"
        style={{ height: size, width: size }}
        aria-hidden="true"
      />
      {showText ? (
        <span
          className={cn(
            "font-cal text-foreground",
            size === 32 ? "text-base" : "text-sm",
          )}
        >
          LLMHub Radar
        </span>
      ) : null}
    </a>
  );
}
