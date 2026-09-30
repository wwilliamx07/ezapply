import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../../companion/src/mcp/server.js";
import type { Services } from "../../companion/src/services.js";

/**
 * The skills and EZAPPLY.md show tool calls as `tool { parameter, optional? }`. Claude Code defers the ezapply
 * tools, so the agent sees their names without their parameters and guesses; in two live runs it guessed wrong
 * 11 times (`fill_fields` with `fields`, `add_repeatable` with `buttonId`, …), a turn each. These tests keep the
 * shapes true to the registered schemas, and make every file that mentions a tool with required parameters
 * show its shape at least once.
 */

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates");

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
}

let tools: Map<string, JsonSchema>;
let files: { name: string; text: string }[];

beforeAll(async () => {
  // Registering only reads these two; no tool handler runs here.
  const services = { version: "test", workspace: { path: (p: string) => p } } as unknown as Services;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(services).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  tools = new Map((await client.listTools()).tools.map((t) => [t.name, t.inputSchema as JsonSchema]));
  await client.close();

  const paths = [join(TEMPLATES, "workspace", "EZAPPLY.md")];
  for (const d of await readdir(join(TEMPLATES, "skills"))) paths.push(join(TEMPLATES, "skills", d, "SKILL.md"));
  files = await Promise.all(
    paths.map(async (p) => ({
      name: relative(TEMPLATES, p).split("\\").join("/"),
      // Shapes may wrap across lines.
      text: (await readFile(p, "utf8")).replace(/\s+/g, " "),
    })),
  );
});

interface Entry {
  key: string;
  optional: boolean;
  value?: Shape | { array: Shape } | { literal: string };
}
type Shape = Entry[];

/** Parse `{ a, b?, c: "x", d: [{ e }], f: { g } }`. */
function parseShape(src: string): Shape {
  let i = 0;
  const skip = () => {
    while (src[i] === " ") i++;
  };
  const expect = (ch: string) => {
    skip();
    if (src[i] !== ch) throw new Error(`expected "${ch}" at ${i} in ${src}`);
    i++;
  };
  const object = (): Shape => {
    expect("{");
    const out: Shape = [];
    for (;;) {
      skip();
      if (src[i] === "}") {
        i++;
        return out;
      }
      const key = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0];
      if (!key) throw new Error(`expected a parameter name at ${i} in ${src}`);
      i += key.length;
      const entry: Entry = { key, optional: src[i] === "?" };
      if (entry.optional) i++;
      skip();
      if (src[i] === ":") {
        i++;
        skip();
        if (src[i] === "{") entry.value = object();
        else if (src[i] === "[") {
          i++;
          entry.value = { array: object() };
          expect("]");
        } else {
          const literal = /^"([^"]*)"|^[^,}\s]+/.exec(src.slice(i));
          if (!literal) throw new Error(`expected a value at ${i} in ${src}`);
          i += literal[0].length;
          entry.value = { literal: literal[1] ?? literal[0] };
        }
      }
      out.push(entry);
      skip();
      if (src[i] === ",") i++;
    }
  };
  const shape = object();
  skip();
  if (i !== src.length) throw new Error(`trailing text in ${src}`);
  return shape;
}

/** What's wrong with a shape against the schema it stands for. */
function check(shape: Shape, schema: JsonSchema, where: string): string[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const problems: string[] = [];
  for (const e of shape) {
    const p = props[e.key];
    if (!p) {
      problems.push(`${where}: no parameter "${e.key}" (has ${Object.keys(props).join(", ") || "none"})`);
      continue;
    }
    if (e.optional && required.has(e.key)) problems.push(`${where}: "${e.key}" is required, not optional`);
    const v = e.value;
    if (!v) continue;
    if (Array.isArray(v)) problems.push(...check(v, p, `${where}.${e.key}`));
    else if ("array" in v) {
      if (p.type !== "array" || !p.items) problems.push(`${where}: "${e.key}" isn't a list`);
      else problems.push(...check(v.array, p.items, `${where}.${e.key}[]`));
    } else if (p.enum && !p.enum.includes(v.literal)) {
      problems.push(`${where}: "${e.key}" is one of ${p.enum.join(", ")}, not "${v.literal}"`);
    }
  }
  const shown = new Set(shape.map((e) => e.key));
  for (const r of required) if (!shown.has(r)) problems.push(`${where}: required "${r}" missing`);
  return problems;
}

/** A call shape. `tool { … }` in EZAPPLY.md explains the notation and isn't one. */
const SHAPE = /`(?!tool )([a-z][a-z_]*) (\{[^`]*\})`/g;

describe("tool calls in the skills and EZAPPLY.md", () => {
  it("match the registered schemas", () => {
    const problems: string[] = [];
    let count = 0;
    for (const f of files) {
      for (const [, name, body] of f.text.matchAll(SHAPE)) {
        const schema = tools.get(name as string);
        if (!schema) {
          problems.push(`${f.name}: no tool "${name}"`);
          continue;
        }
        count++;
        try {
          problems.push(...check(parseShape(body as string), schema, `${f.name}: ${name}`));
        } catch (err) {
          problems.push(`${f.name}: ${name}: ${(err as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(20);
  });

  it("show the shape of every tool with required parameters that a file mentions", () => {
    const needsShape = [...tools].filter(([, s]) => (s.required ?? []).length > 0).map(([n]) => n);
    const missing: string[] = [];
    for (const f of files) {
      const shown = new Set([...f.text.matchAll(SHAPE)].map((m) => m[1]));
      for (const name of needsShape) {
        const mentioned = new RegExp(`\`${name}[\`\\s{.]`).test(f.text);
        if (mentioned && !shown.has(name)) missing.push(`${f.name}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("parse and check shapes as intended", () => {
    const schema: JsonSchema = {
      properties: {
        fills: {
          type: "array",
          items: { properties: { fieldId: {}, value: {}, answerId: {} }, required: ["fieldId", "value"] },
        },
        mode: { enum: ["a", "b"] },
        tabId: {},
      },
      required: ["fills"],
    };
    expect(check(parseShape('{ fills: [{ fieldId, value, answerId? }], mode: "a" }'), schema, "t")).toEqual([]);
    expect(check(parseShape("{ fields }"), schema, "t")).toEqual([
      't: no parameter "fields" (has fills, mode, tabId)',
      't: required "fills" missing',
    ]);
    expect(check(parseShape('{ fills?: [{ fieldId }], mode: "c" }'), schema, "t")).toEqual([
      't: "fills" is required, not optional',
      't.fills[]: required "value" missing',
      't: "mode" is one of a, b, not "c"',
    ]);
  });
});
