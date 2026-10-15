import fs from "node:fs";
import path from "node:path";
import type { Material } from "../contract/schema.ts";

export type McpResultLike = {
  toolName: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: unknown;
  isError: boolean;
};

export type CaptureResult = { captured: Material[]; note: string };

type Block = {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  resource?: { uri?: string; mimeType?: string; text?: string; blob?: string };
};

const EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/html": ".html",
};

export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__");
}

export function mcpServerOf(toolName: string): string {
  return toolName.split("__")[1] ?? "";
}

export function originKindFor(toolName: string): Material["origin"]["kind"] {
  const server = mcpServerOf(toolName).toLowerCase();
  if (server.includes("figma")) return "figma";
  if (server.includes("atlassian") || server.includes("jira") || server.includes("confluence")) return "atlassian";
  return "other";
}

export function nextMaterialNumber(materials: Material[]): number {
  let max = 0;
  for (const m of materials) {
    const n = /^M(\d+)$/.exec(m.id)?.[1];
    if (n !== undefined) max = Math.max(max, Number(n));
  }
  return max + 1;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

function blocksOf(result: McpResultLike): { blocks: Block[]; nested: unknown } {
  const sc = result.structuredContent as { content?: unknown; structuredContent?: unknown } | undefined;
  if (sc !== null && typeof sc === "object" && Array.isArray(sc.content)) {
    return { blocks: sc.content as Block[], nested: sc.structuredContent };
  }
  return { blocks: result.content as Block[], nested: undefined };
}

export function captureMcpResult(result: McpResultLike, existing: Material[], dir: string): CaptureResult {
  if (!isMcpToolName(result.toolName) || result.isError) return { captured: [], note: "" };
  const sc = result.structuredContent as { isError?: unknown } | undefined;
  if (sc !== null && typeof sc === "object" && sc.isError === true) return { captured: [], note: "" };

  const { blocks, nested } = blocksOf(result);
  const texts: string[] = [];
  const binaries: Array<{ data: string; mimeType: string; label: string }> = [];
  for (const b of blocks) {
    if (b === null || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if ((b.type === "image" || b.type === "audio") && typeof b.data === "string") {
      binaries.push({ data: b.data, mimeType: b.mimeType ?? "application/octet-stream", label: b.type });
    } else if (b.type === "resource" && b.resource !== undefined) {
      if (typeof b.resource.text === "string") texts.push(`[resource ${b.resource.uri ?? ""}]\n${b.resource.text}`);
      else if (typeof b.resource.blob === "string") {
        binaries.push({ data: b.resource.blob, mimeType: b.resource.mimeType ?? "application/octet-stream", label: `resource ${b.resource.uri ?? ""}`.trim() });
      }
    } else if (b.type === "resource_link" && typeof b.uri === "string") {
      texts.push(`[resource link] ${b.name ?? ""} ${b.uri}`.replace(/\s+/g, " ").trim());
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  const all = [...existing];
  const captured: Material[] = [];
  const kind = originKindFor(result.toolName);
  let ref = result.toolName;
  try {
    const args = JSON.stringify(result.input);
    if (args !== undefined && args !== "{}") ref = `${result.toolName} ${args.length > 500 ? `${args.slice(0, 500)}...` : args}`;
  } catch {
    ref = result.toolName;
  }
  const add = (ext: string, mediaType: string, data: string | Buffer, describe: string) => {
    const id = `M${nextMaterialNumber(all)}`;
    const file = path.join(dir, `${id}-${safe(result.toolName)}${ext}`);
    fs.writeFileSync(file, data);
    const m: Material = { id, path: file, mediaType, describe, origin: { kind, ref } };
    all.push(m);
    captured.push(m);
  };

  if (texts.length > 0) add(".txt", "text/plain", `${texts.join("\n\n")}\n`, `${result.toolName} result text`);
  if (nested !== undefined && nested !== null) {
    add(".json", "application/json", `${JSON.stringify(nested, null, 2)}\n`, `${result.toolName} structured result`);
  }
  binaries.forEach((b, i) => {
    add(EXT[b.mimeType] ?? ".bin", b.mimeType, Buffer.from(b.data, "base64"), `${result.toolName} ${b.label} ${i + 1}`);
  });

  const note = captured.map((m) => `saved as ${m.id} at ${m.path} (${m.mediaType})`).join("\n");
  return { captured, note };
}
