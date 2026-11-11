import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { root, source, original, ported, sha, type Rewrite } from "./port-skill";
const edits: Rewrite[] = JSON.parse(readFileSync(resolve(root, "porting/changes/guide.json"), "utf8"));
const paths = Object.keys(source.files).filter(path => path.startsWith("pstack/docs/guide/"));
if (edits.some(edit => !paths.includes(`pstack/${edit.file}`))) throw new Error("Guide rewrite references an unknown source file");
const files = [];
for (const path of paths) {
  const bytes = original(path);
  if (sha(bytes) !== source.files[path]) throw new Error(`Source mismatch: ${path}`);
  const output = ported(path, bytes, edits);
  if (path.endsWith(".md") && /Cursor|\.cursor\/|subagent_type|run_in_background|cursor-team-kit/.test(output.toString())) throw new Error(`Unported guide instruction: ${path}`);
  const destination = resolve(root, path.slice(7));
  if (existsSync(destination) && !readFileSync(destination).equals(output)) throw new Error(`Existing guide differs: ${path}`);
  mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, output);
  files.push({ path: path.slice(7), sourceSha256: sha(bytes), portSha256: sha(output), unchanged: bytes.equals(output) });
}
writeFileSync(resolve(root, "porting/guide.json"), JSON.stringify({ changes: edits, files, note: "Exact scoped substitutions only; all other prose and original illustrations preserved. Hosted VM/project UI gaps are explicitly stated, not described as equivalent local execution." }, null, 2) + "\n");
console.log(`PASS ${files.length} guide files: ${edits.length} reviewed edits; all other bytes retained`);
