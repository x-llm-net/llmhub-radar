import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

import { Link } from "@/components/common/link";

export const metadata: Metadata = {
  title: "开发者 API | LLMHub Radar",
  description: "使用 LLMHub Radar 公共 API 批量查询服务商稳定性、状态和评分。",
  alternates: {
    canonical: "https://llm-hub.store/developers/api",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const endpoint = "/api/radar/providers/query";
const exampleRequest = `POST ${endpoint}
Content-Type: application/json

{
  "slugs": ["skyhope", "example-ai"]
}`;

const exampleResponse = `{
  "apiVersion": "v1",
  "generatedAt": "2026-06-29T10:00:00.000Z",
  "window": { "label": "7d" },
  "items": [
    {
      "slug": "skyhope",
      "name": "Skyhope",
      "status": "operational",
      "observedHealthScore": 96.77,
      "grade": "A",
      "confidenceLevel": "medium",
      "availability7dBasisPoints": 9677,
      "sampleCount7d": 1114,
      "p95FirstTokenMs": 6485,
      "statusPageUrl": "https://llm-hub.store/skyhope"
    }
  ],
  "missing": []
}`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-muted overflow-x-auto rounded-lg border p-4 text-sm leading-6">
      <code>{children}</code>
    </pre>
  );
}

export default function Page() {
  return (
    <main className="bg-background min-h-dvh">
      <section className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="size-4" />
              返回首页
            </Link>
          </Button>
          <Badge variant="outline">Public API</Badge>
        </div>

        <div className="space-y-8">
          <header className="space-y-4">
            <h1 className="text-4xl leading-tight font-semibold tracking-normal">
              批量查询服务商稳定性
            </h1>
            <p className="text-muted-foreground max-w-2xl text-base leading-7">
              这个 API 面向中转站聚合、导航和榜单网站。你可以按 slug
              批量获取公开服务商的实时状态、7 天观测可用率、评分和首 token
              延迟摘要。
            </p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">请求</h2>
            <CodeBlock>{exampleRequest}</CodeBlock>
            <p className="text-muted-foreground text-sm leading-6">
              每次最多提交 20 个 slug。接口只返回已公开、已加入公共池的服务商。
              响应带有 ETag 和 10 分钟公共缓存，建议客户端尊重
              <code className="bg-muted mx-1 rounded px-1">Cache-Control</code>
              并使用
              <code className="bg-muted mx-1 rounded px-1">If-None-Match</code>
              减少重复请求。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">响应</h2>
            <CodeBlock>{exampleResponse}</CodeBlock>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "observedHealthScore",
                "等于 7 天观测可用率百分数，例如 96.77。",
              ],
              ["grade", "S/A/B/C/D/F/unknown，适合做列表粗筛。"],
              [
                "confidenceLevel",
                "high/medium/low/insufficient，表示样本可信度。",
              ],
            ].map(([title, description]) => (
              <div key={title} className="rounded-lg border p-4">
                <div className="font-mono text-sm font-semibold">{title}</div>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {description}
                </p>
              </div>
            ))}
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">和 iframe 的区别</h2>
            <p className="text-muted-foreground text-sm leading-6">
              iframe 适合某个中转站长把自己的服务状态嵌到官网；开发者 API
              适合聚合站一次查询多个服务商并自行渲染列表。两者服务的是不同用户，
              所以入口和文档分开。
            </p>
            <p className="text-muted-foreground text-sm leading-6">
              当前接口使用 POST 请求，直接在浏览器地址栏打开不会返回查询结果。
              请按上面的请求示例调用。
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
