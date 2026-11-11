import { test, expect } from "bun:test";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadSkills } from "./plugins/pstack/skills";
import { original, ported, root, source, sha, split } from "./scripts/port-skill";

test("pinned source archive and every registered skill retain reviewed source content and invocation policy", () => {
  expect(sha(readFileSync(resolve(root, "provenance/upstream.tar")))).toBe(source.archiveSha256);
  const skills = loadSkills(resolve(root, "skills"));
  expect(skills.length).toBeGreaterThan(0);
  const additional = readdirSync(resolve(root, "porting/additional")).map(file => JSON.parse(readFileSync(resolve(root, "porting/additional", file), "utf8")));
  expect(skills.map(skill => skill.id).sort()).toEqual([...source.order, ...additional.filter(r => r.registered).map(r => r.name)].sort());
  for (const skill of skills.filter(skill => source.order.includes(skill.name))) {
    const before = split(original(`pstack/skills/${skill.name}/SKILL.md`).toString());
    const record = JSON.parse(readFileSync(resolve(root, "porting", `${skill.name}.json`), "utf8"));
    const expected = split(ported(`pstack/skills/${skill.name}/SKILL.md`, original(`pstack/skills/${skill.name}/SKILL.md`), record.rewrites ?? []).toString());
    expect(skill.content).toBe(expected.body.slice(1));
    expect(skill.autoinvoke).toBe(!before.attributes["disable-model-invocation"]);
    expect(skill.description).toBe(expected.attributes.description);
    const sourcePaths = Object.keys(source.files).filter(p => p.startsWith(`pstack/skills/${skill.name}/`)).map(p => p.slice(7)).sort();
    expect(record.files.map((f: any) => f.path).sort()).toEqual(sourcePaths);
    for (const file of record.files) {
      expect(statSync(resolve(root, file.path)).mode & 0o111).toBe(source.modes[`pstack/${file.path}`] & 0o111);
      expect(readFileSync(resolve(root, file.path)).equals(ported(`pstack/${file.path}`, original(`pstack/${file.path}`), record.rewrites ?? []))).toBe(true);
      expect(sha(readFileSync(resolve(root, file.path)))).toBe(file.portSha256);
      expect(file.sourceSha256).toBe(source.files[`pstack/${file.path}`]);
    }
  }
});

test("companion and dormant automation files preserve source bytes outside reviewed native substitutions", () => {
  for (const file of readdirSync(resolve(root, "porting/additional"))) {
    const record = JSON.parse(readFileSync(resolve(root, "porting/additional", file), "utf8"));
    if (!record.sourceArchive) continue;
    const archive = resolve(root, record.sourceArchive);
    expect(sha(readFileSync(archive))).toBe(record.archiveSha256);
    for (const f of record.files) {
      const before = execFileSync("tar", ["-xOf", archive, f.sourcePath]);
      expect(sha(before)).toBe(f.sourceSha256);
      const after = readFileSync(resolve(root, f.path));
      expect(after.equals(ported(`pstack/${f.path}`, before, record.rewrites))).toBe(true);
      expect(sha(after)).toBe(f.portSha256);
    }
  }
  const registered = loadSkills(resolve(root, "skills")).map(skill => skill.name);
  for (const name of ["setup-benny", "triage-issue-reports", "reproduce-and-fix-issues"]) expect(registered).not.toContain(name);
});

test("comment-sicko preserves the complete original agent instructions", () => {
  const path = resolve(root, "agents/comment-sicko.md");
  const before = split(original("pstack/agents/comment-sicko.md").toString());
  const after = split(readFileSync(path, "utf8"));
  expect(after.body).toBe(before.body);
  expect(after.attributes.description).toBe(before.attributes.description);
  expect(after.attributes.mode).toBe("subagent");
});

test("every guide file retains all bytes outside its reviewed substitutions", () => {
  const record = JSON.parse(readFileSync(resolve(root, "porting/guide.json"), "utf8"));
  const paths = Object.keys(source.files).filter(path => path.startsWith("pstack/docs/guide/"));
  expect(record.files.map((file: any) => `pstack/${file.path}`).sort()).toEqual(paths.sort());
  for (const file of record.files) {
    const bytes = readFileSync(resolve(root, file.path));
    expect(bytes.equals(ported(`pstack/${file.path}`, original(`pstack/${file.path}`), record.changes))).toBe(true);
    expect(sha(bytes)).toBe(file.portSha256);
    expect(file.sourceSha256).toBe(source.files[`pstack/${file.path}`]);
  }
});

test("all 23 core playbooks retain their original headings and ordered step boundaries", () => {
  const paths = Object.keys(source.files).filter(path => path.startsWith("pstack/skills/poteto-mode/playbooks/") && path.endsWith(".md"));
  expect(paths).toHaveLength(23);
  const structure = (text: string) => text.split("\n").flatMap(line => /^#{1,6} /.test(line) ? [line] : /^\s*\d+\./.test(line) ? [line.match(/^\s*\d+\./)![0]] : []);
  for (const path of paths) expect(structure(readFileSync(resolve(root, path.slice(7)), "utf8"))).toEqual(structure(original(path).toString()));
});
