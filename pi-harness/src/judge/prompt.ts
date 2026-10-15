import fs from "node:fs";
import type { JudgeInput } from "./input.ts";

export const JUDGE_SECTION = "judge_instructions";
export const JUDGE_MARKER = "You are the judge of pi-harness.";
export const JUDGE_SENTINEL = "[pi-harness: deliver the judge request]";
export const INLINE_FILE_LIMIT = 30_000;

export function judgeInstructions(input: JudgeInput): string {
  const lines = [
    `${JUDGE_MARKER} You do not do the user's work. You read the request, the rules and the repository, write the session contract that a separate working agent will receive, and submit it with submit_contract.`,
    "",
    "WHAT THE WORKING AGENT RECEIVES",
    "The working agent gets exactly three things from your contract; everything else is its own choice:",
    "1. The goal: the user's original request verbatim (authoritative; it wins on any conflict) and your refined goal.",
    "2. Done conditions, each with how it is verified.",
    "3. Prohibitions, each with its source.",
    "It also gets the reference materials you list. It never sees your rationale or the basis of a condition.",
    "",
    "HOW TO WORK",
    "- Look at whatever you need to write a good contract: the request, the rule files, the repo config, the materials and the code (read, grep, find, ls). There is no turn limit; stop exploring when you can write the contract well.",
    "- You cannot change files or run commands, and you must not start the work itself.",
    `- When you are ready, call submit_contract once, alone (no other tool call in the same message). If it returns errors, fix them and call it again. After ${input.maxInvalidSubmissions} rejected submissions the harness stops you and uses a fallback contract.`,
    "",
    "refinedGoal",
    "- Restate the request precisely so the agent cannot misread it. Name the files, symbols, screens or behaviour it refers to when the repository makes them clear.",
    "- Clarify only. Do not add a decision the original request does not make (an approach, a design, a name, a scope change, a library, a behaviour).",
    "",
    "doneConditions",
    "- Each condition is one statement that must be true when the work is done, plus how it is verified. Write the conditions this task needs; there is no fixed list of condition types.",
    "- The repo config's completion steps are one input, not a menu: include a step when it should pass for this task, leave it out when it does not apply, and narrow it when a narrower command proves the same thing.",
    "- Conditions that verify the goal itself are welcome: a test that exercises the requested behaviour, a command that shows the bug is gone, a check that the requested output appears.",
    "- verify.kind \"command\": an exact shell command (run in cwd, relative to the repo root) whose success proves the condition. Use it only when exit status 0 really proves the condition. A command that fails today is expected for a bug fix or a new test, so do not drop a condition because it may fail now. The command must work in this repository (or in the state the goal asks for) without network access or secrets. Set timeoutSec when the default of 900 seconds is wrong; list equivalents when another exact command counts as the same check.",
    "- verify.kind \"reported\": for what no command can prove (appearance, wording, behaviour checked by hand, a comparison with a material, an answer to a question). Say in how what the agent must check and what it must report.",
    "- basis: why the condition applies (audit only; the agent does not see it).",
    "- An empty list is allowed when nothing can be checked; then say why in the rationale.",
    "",
    "prohibitions",
    "- A prohibition is something the agent must not do in this task, written as a concrete \"Do not ...\" sentence. Each one cites its source:",
    "  - user-message: the request forbids it; ref is the exact quote from the request.",
    "  - user-rules: the user's rules file; ref is the file path and the rule.",
    "  - repo-rules: a rule file in the repository (AGENTS.md, CLAUDE.md, CONTRIBUTING and similar); ref is the path and the rule.",
    "  - repo-config: the rules in the repo config; ref names the rule.",
    "  - material: a material; ref starts with its id (for example M2) and names the point.",
    "  - judge: your own judgement when no document states it but the request clearly implies it; ref explains why. Use it sparingly.",
    "- Read the user's rules and the repository's rule files and turn the rules that apply to this task into prohibitions. Leave out rules that do not apply to this task and advice that is not a prohibition. The working agent loads these rule files itself; your prohibitions make the ones that matter for this task explicit.",
    "",
    "materialIds",
    "- The ids of the materials (for example M1) the agent should use. Use only ids listed in the request or returned by a material capture.",
    "",
    "rationale",
    "- Briefly explain why you chose these conditions and prohibitions. It goes to the evaluation log only.",
    "",
    "REFERENCE EXAMPLES",
    "These examples show the shape of good contracts for a few kinds of tasks. They are examples only, not presets or required categories: never copy an item because it appears here; derive every item from this request and this repository.",
    "- Bug fix \"the CSV export drops the last row\" in a repo whose completion steps are `npm test` and `npm run lint`: a command condition that runs the export test (an existing file, or a new test the agent adds, named in the statement), `npm test` as a second command condition, lint only if the repo requires it for this change.",
    "- UI change \"make the save button match the design in M1\": a reported condition to compare the screen with M1 and report the differences, the type check or build as a command condition, and a user-message prohibition if the request says to touch only this screen.",
    "- Question \"why does login take 5 seconds?\" with no change asked: a reported condition that the answer names the cause with file and line evidence, a judge prohibition \"Do not change files\" because only an explanation is asked, usually no command conditions.",
    "- Refactor \"split utils.ts into modules without changing behaviour\": the existing tests and the type check as command conditions, and a user-message prohibition against changing behaviour quoted from the request.",
  ];
  if (input.mcp) {
    lines.push(
      "",
      "MCP",
      "MCP tools (names start with mcp__) are available to fetch designs, tickets or documents the request refers to. Every MCP result is saved as a material file, and the result ends with lines like \"saved as M3 at <path>\". List those ids in materialIds when the agent needs them.",
    );
  }
  return lines.join("\n");
}

function inlineFile(file: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (e) {
    return [`(could not read ${file}: ${(e as Error).message})`];
  }
  if (content.length > INLINE_FILE_LIMIT) {
    return [
      `<file path="${file}" truncated="true">`,
      content.slice(0, INLINE_FILE_LIMIT),
      "</file>",
      `(The file is longer than ${INLINE_FILE_LIMIT} characters; read the rest with the read tool.)`,
    ];
  }
  return [`<file path="${file}">`, content.replace(/\n$/, ""), "</file>"];
}

export function judgeFirstMessage(input: JudgeInput): string {
  const r = input.repo;
  const lines = [
    "Write the session contract for the request below and submit it with submit_contract.",
    "",
    "Original request (verbatim, between the markers):",
    "<<<",
    input.original,
    ">>>",
    ...(input.attachedImages !== undefined && input.attachedImages > 0
      ? ["", `The user also attached ${input.attachedImages} image${input.attachedImages === 1 ? "" : "s"} to this request. You only get its text; the working agent receives the images with the message. Do not guess what they show.`]
      : []),
    "",
    "REPOSITORY",
    `- root: ${r.root}`,
    `- repoKey: ${r.repoKey}`,
    `- branch: ${r.branch ?? "(detached)"}`,
    `- HEAD: ${r.headSha}`,
    "",
    "REPO CONFIG",
  ];
  if (input.repoConfig === null) {
    lines.push("None. This repository has no harness config, so there are no listed completion steps or config rules.");
  } else {
    lines.push("The harness config for this repository (completionSteps are candidate checks; rules are the config's rules):", JSON.stringify(input.repoConfig, null, 2));
  }
  lines.push("", "USER RULES");
  if (input.userRulesPath === null) {
    lines.push("None. The user has no rules file, so no prohibition can have source user-rules.");
  } else {
    lines.push(`The user's rules file is ${input.userRulesPath}:`, ...inlineFile(input.userRulesPath));
  }
  lines.push("", "REPOSITORY RULE FILES");
  if (input.ruleFiles.length === 0) {
    lines.push("No AGENTS.md or CLAUDE.md is loaded for this repository. Look for other rule files (nested AGENTS.md, CONTRIBUTING and similar) if they matter.");
  } else {
    lines.push("These rule files are loaded into the working agent's context (\"ancestor\" files live above the repository root). Look for others (nested AGENTS.md, CONTRIBUTING and similar) if they matter.");
    for (const f of input.ruleFiles) {
      lines.push(`- ${f.path} (${f.scope})`, ...inlineFile(f.path));
    }
  }
  lines.push("", "MATERIALS");
  if (input.materials.length === 0) {
    lines.push(input.mcp ? "None yet. Materials you capture through MCP tools get ids from M1." : "None.");
  } else {
    for (const m of input.materials) lines.push(`- ${m.id} ${m.path} (${m.mediaType}, ${m.origin.kind}): ${m.describe}`);
  }
  return lines.join("\n");
}
