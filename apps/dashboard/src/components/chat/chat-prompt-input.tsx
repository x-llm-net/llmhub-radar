import { Button } from "@openstatus/ui/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@openstatus/ui/components/ui/input-group";
import { Spinner } from "@openstatus/ui/components/ui/spinner";
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

type Props = {
  onSubmit: (text: string) => void;
  onStop?: () => void;
  status?: ChatStatus;
};

export function ChatPromptInput({ onSubmit, onStop, status }: Props) {
  const t = useTranslations("chat.prompt");
  const [value, setValue] = useState("");
  const isGenerating = status === "submitted" || status === "streaming";

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || isGenerating) return;
    onSubmit(text);
    setValue("");
  }, [value, isGenerating, onSubmit]);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submit();
    },
    [submit],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // IMEs (CJK input) finalize a candidate with Enter; don't submit mid-composition.
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleClick = useCallback(() => {
    if (isGenerating && onStop) {
      onStop();
    }
  }, [isGenerating, onStop]);

  return (
    <div className="bg-background sticky bottom-0 z-10 border-t px-3 pt-3 pb-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-1">
        <form onSubmit={handleSubmit}>
          <InputGroup>
            <InputGroupTextarea
              placeholder={t("placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              // Override the workspace `min-h-16` so an empty input is one row tall.
              className="min-h-0"
            />
            <InputGroupAddon
              align="block-end"
              className="justify-end px-2 py-2"
            >
              <Button
                type={isGenerating && onStop ? "button" : "submit"}
                size="icon-sm"
                onClick={handleClick}
                disabled={!isGenerating && !value.trim()}
                aria-label={isGenerating ? t("stop") : t("send")}
              >
                {status === "submitted" ? (
                  <Spinner />
                ) : status === "streaming" ? (
                  <SquareIcon className="size-4" />
                ) : status === "error" ? (
                  <XIcon className="size-4" />
                ) : (
                  <CornerDownLeftIcon className="size-4" />
                )}
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="text-muted-foreground text-center text-xs">
          {t("poweredBy")}
        </p>
      </div>
    </div>
  );
}
