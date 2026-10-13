/* Equivalent code for a web-chat request (the «چت» playground mode): curl, JavaScript and Python,
   all against the OpenAI-compatible /v1/chat/completions of the gateway. */

export type CodeMsg = { role: "system" | "user" | "assistant"; content: string };
export type CodeReq = { model: string; messages: CodeMsg[]; temperature: number; stream: boolean };
export type CodeLang = "curl" | "js" | "python";

const KEY = "gk-YOUR-KEY";
const shellQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const pyStr = (s: string) => JSON.stringify(s); // JSON strings are valid Python literals
const indent = (s: string, n: number) => s.split("\n").map((l, i) => (i ? " ".repeat(n) + l : l)).join("\n");

export function chatCode(lang: CodeLang, base: string, r: CodeReq): string {
  const body = { model: r.model, messages: r.messages, temperature: r.temperature, ...(r.stream ? { stream: true } : {}) };
  if (lang === "curl") {
    return `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\${r.stream ? "\n  -N \\" : ""}
  -d ${shellQuote(JSON.stringify(body, null, 2))}`;
  }
  if (lang === "js") {
    const msgs = indent(JSON.stringify(r.messages, null, 2), 2);
    return r.stream
      ? `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}/v1", apiKey: process.env.GEREH_API_KEY ?? "${KEY}" });
const stream = await client.chat.completions.create({
  model: ${JSON.stringify(r.model)},
  temperature: ${r.temperature},
  stream: true,
  messages: ${msgs},
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`
      : `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}/v1", apiKey: process.env.GEREH_API_KEY ?? "${KEY}" });
const r = await client.chat.completions.create({
  model: ${JSON.stringify(r.model)},
  temperature: ${r.temperature},
  messages: ${msgs},
});
console.log(r.choices[0].message.content);`;
  }
  const msgs = "[\n" + r.messages.map((m) => `        {"role": ${pyStr(m.role)}, "content": ${pyStr(m.content)}},`).join("\n") + "\n    ]";
  return r.stream
    ? `import os
from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key=os.environ.get("GEREH_API_KEY", "${KEY}"))
stream = client.chat.completions.create(
    model=${pyStr(r.model)},
    temperature=${r.temperature},
    stream=True,
    messages=${msgs},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`
    : `import os
from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key=os.environ.get("GEREH_API_KEY", "${KEY}"))
r = client.chat.completions.create(
    model=${pyStr(r.model)},
    temperature=${r.temperature},
    messages=${msgs},
)
print(r.choices[0].message.content)`;
}

/** rows → CSV (RFC 4180 quoting, BOM so spreadsheet apps read Persian correctly) */
export function toCsv(rows: (string | number | boolean | null)[][]): string {
  const cell = (v: string | number | boolean | null) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
