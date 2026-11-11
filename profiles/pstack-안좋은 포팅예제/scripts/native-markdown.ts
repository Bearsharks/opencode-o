// Build-time migration of unambiguous names. Behavioral rewrites live in overrides/.
export function nativeMarkdown(text: string): string {
  return text
    .replace(/Read \[the OpenCode adapter\][^\n]*\n\n/g, "")
    .replace(/, or `~\/\.cursor\/plugins\/`/g, "")
    .replace(/a todolist|a todo list/g, "a Markdown task checklist")
    .replace(/the todo list/g, "the task checklist")
    .replace(/`Read`/g, "`read`")
    .replace(/a tool call \(Shell, Grep, MCP, etc.\)/g, "a tool call (shell, read, MCP, etc.)")
    .replace(/`Task`/g, "`subagent`")
    .replace(/\bTask (tool|call|calls|subagent|error|response|spawn)/g, "subagent $1")
    .replace(/\bsubagent_type\b/g, "agent")
    .replace(/\bgeneralPurpose\b/g, "general")
    .replace(/\brun_in_background\b/g, "background")
    .replace(/\bAskQuestion\b/g, "question")
    .replace(/\bTodoWrite\b/g, "the Markdown task checklist")
    .replace(/~\/\.cursor\/skills\//g, "$OPENCODE_CONFIG_DIR/skills/")
    .replace(/\.cursor\/skills\//g, ".opencode/skills/")
    .replace(/Cursor's built-in `create-skill`/g, "the bundled `create-skill`")
    .replace(/Cursor's built-in for authoring SKILL.md files/g, "the bundled OpenCode skill authoring workflow")
    .replace(/ from (?:the )?`cursor-team-kit`(?: plugin)?/g, " bundled with this profile")
    .replace(/`cursor-team-kit` publishes/g, "This profile includes")
    .replace(/Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section(?: of the \*\*poteto-mode\*\* skill)?\./g,
      "Resolve the configured role, difficulty and urgency through pstack_models before calling subagent.")
    .replace(/using your configured (?:feature|refactoring|bug-fix|perf-issue|hillclimb) model \(default `grok-4\.7-xhigh-fast`\)/g,
      "using `agent: \"poteto-agent\"` and its configured or inherited model")
    .replace(/and an explicit model per the Subagents section/g, "and the configured or inherited agent model")
    .replace(/Cursor's `\/loop` command/g, "bounded iterations within the running OpenCode session")
    .replace(/`\/loop 1h`/g, "an hourly checkpoint within the running session (no wake after process exit)")
    .replace(/\/loop until/g, "continue until")
    .replace(/`\/loop`/g, "the running session's bounded iteration loop")
    .replace(/Cursor cloud agent/g, "independent OpenCode subagent in an authorized local worktree")
    .replace(/cloud-agent URL/g, "OpenCode session ID")
    .replace(/cloud VM/g, "authorized local worktree")
    .replace(/cloud agents/g, "local subagents with disjoint workspaces")
    .replace(/a Cursor restart/g, "an OpenCode restart");
}
