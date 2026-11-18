import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localClient } from "./api";

const exec = promisify(execFile);
async function trackedDocument(directory: string, path: string, revision: string) {
  if (
    !/^[^:\x00\r\n]+\.(?:md|mdx|rst|txt)$/i.test(path) ||
    path.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw Error("Use a tracked, repository-relative spec path.");
  try {
    return (await exec("git", ["show", revision + ":" + path], { cwd: directory, maxBuffer: 4 * 1024 * 1024 }))
      .stdout;
  } catch {
    throw Error("Could not read the referenced version of the agreement.");
  }
}

export async function decisionSource(ref: string, directory: string, sessionID: string) {
  if (ref === "AGENTS.md") return trackedDocument(directory, ref, "HEAD");
  const match = /^msg:(ses_[\w-]+)\/(msg_[\w-]+)(?:#(.+))?$/.exec(ref);
  if (!match && ref !== "request")
    throw Error("Cite request, msg:<sessionID>/<messageID>[#spec.md], or AGENTS.md.");
  const api = await localClient();
  const session = await api.session.get({ sessionID: match?.[1] ?? sessionID });
  const project = (await api.location.get({ directory })).project;
  if (
    session.projectID !== project.id ||
    (project.id === "global" && session.location.directory !== directory) ||
    session.parentID ||
    session.agent === "shipping"
  )
    throw Error("Use the original working chat's user message or the project policy, not a delegate's brief.");
  const message = match
    ? await api.session.message.get({ sessionID: session.id, messageID: match[2] })
    : (await api.session.context({ sessionID })).findLast((m) => m.type === "user");
  if (message?.type !== "user")
    throw Error("Use an actual user message in the project, not a reviewer or scheduled wake.");
  const path = match?.[3];
  if (!path) return message.text;
  const literal = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = message.text.match(
    new RegExp("(?:/blob/([0-9a-f]{7,40})/|(?:^|[\\s(`]))" + literal + "(?=$|[\\s)`#])", "u"),
  );
  if (!link) throw Error("That specification is not referenced by the cited user message.");
  return trackedDocument(directory, path, link[1] ?? "HEAD");
}
