import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";

let client: ReturnType<typeof OpenCode.make> | undefined;
export async function localClient() {
  if (client) return client;
  const explicit = process.env.PSTACK_API_URL;
  const endpoint = explicit ? { url: explicit, auth: process.env.OPENCODE_SERVER_PASSWORD ? { type: "basic" as const, username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password: process.env.OPENCODE_SERVER_PASSWORD } : undefined }
    : await Service.discover({ version: version => version.startsWith("2.") });
  if (!endpoint) throw new Error("Use the managed oc-pstack service, or set PSTACK_API_URL and standard OpenCode authentication for a standalone server.");
  client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  return client;
}
