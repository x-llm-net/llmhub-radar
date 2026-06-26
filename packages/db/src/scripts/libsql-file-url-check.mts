import { createClient } from "@libsql/client";

const urls = [
  "file:./.codex-runtime/test-a.db",
  "file:C:/Users/keke.qiu/xllm-xhs-post/llmhub-radar/.codex-runtime/test-b.db",
  "file:///C:/Users/keke.qiu/xllm-xhs-post/llmhub-radar/.codex-runtime/test-c.db",
];

for (const url of urls) {
  try {
    const client = createClient({ url });
    await client.execute("create table if not exists t (id integer);");
    await client.execute("insert into t (id) values (1);");
    const rs = await client.execute("select count(*) as c from t;");
    console.log(JSON.stringify({ url, ok: true, rows: rs.rows }, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify({ url, ok: false, error: String(error) }, null, 2),
    );
  }
}
