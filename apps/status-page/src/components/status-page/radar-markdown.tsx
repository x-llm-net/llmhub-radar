"use client";

import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import { Fragment, createElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import rehypeReact from "rehype-react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeReact, {
    createElement,
    Fragment,
    jsx,
    jsxs,
    components: {
      a: ({
        href,
        children,
        ...props
      }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (!href || !isSafeHref(href)) {
          return <span {...props}>{children}</span>;
        }
        return (
          <a href={href} target="_blank" rel="noreferrer" {...props}>
            {children}
          </a>
        );
      },
      img: () => null,
      code: (props: HTMLAttributes<HTMLElement>) => (
        <code
          className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]"
          {...props}
        />
      ),
      pre: (props: HTMLAttributes<HTMLPreElement>) => (
        <pre
          className="bg-muted overflow-x-auto rounded-md border p-3 text-xs"
          {...props}
        />
      ),
    } as { [key: string]: React.ComponentType<unknown> },
  });

function isSafeHref(href: string) {
  if (href.startsWith("/")) return true;
  try {
    const protocol = new URL(href).protocol;
    return ["http:", "https:", "mailto:"].includes(protocol);
  } catch {
    return false;
  }
}

export function RadarMarkdown({ value }: { value: string }) {
  const rendered = processor.processSync(value).result;

  return (
    <div className="space-y-1 [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-4 [&_li]:list-disc [&_ol]:list-decimal [&_p]:first:mt-0 [&_p]:last:mb-0 [&_strong]:font-semibold">
      {rendered}
    </div>
  );
}
