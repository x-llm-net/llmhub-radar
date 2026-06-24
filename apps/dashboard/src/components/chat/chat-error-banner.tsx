import { useTranslations } from "next-intl";

type Props = {
  error: Error;
};

const RATE_LIMIT_RESET_RE = /Reset at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/;

export function ChatErrorBanner({ error }: Props) {
  const t = useTranslations("chat.error");
  const message = error.message ?? "";
  const isRateLimit = /Rate limit/i.test(message);
  const resetTime = getResetTime(message);
  return (
    <div className="bg-destructive/10 text-destructive border-t px-4 py-2 text-sm">
      {isRateLimit
        ? t("rateLimit", {
            suffix: resetTime ? t("retryAt", { time: resetTime }) : "",
          })
        : t("generic")}
    </div>
  );
}

function getResetTime(message: string): string | null {
  const match = message.match(RATE_LIMIT_RESET_RE);
  if (!match) return null;
  const resetAt = new Date(match[1]);
  if (Number.isNaN(resetAt.getTime())) return null;
  const time = resetAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
}
