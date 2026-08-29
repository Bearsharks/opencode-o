# OpenCode agents profile

This lightweight, agent-only profile starts with `freefy-secretary`, a Freefy
issue-intake agent. It converts requests into executable GitHub Issues and lets
Freefy's existing `issues.opened` workflow handle delegation. The secretary can
delegate read-only Git, PR, repository, documentation, and web research to the
same hidden `runner` used by A-Max. The shared Runner includes the `orca-cli`
skill and Orca CLI command family so it can inspect
Orca-managed worktrees, terminals, repos, artifacts, and browser state.

## Install

From this checkout:

```bash
./scripts/install/agents.sh
```

The installer creates `oc-agents` in `$HOME/.local/bin`, or in the
directory supplied by `OPENCODE_O_BIN_DIR`. It does not modify global OpenCode
configuration. The wrapper activates this profile by setting
`OPENCODE_CONFIG_DIR` for that invocation, so restart an already-running
OpenCode process after installing or changing the profile.

## Use

```bash
oc-agents
oc-agents run "Freefy work request"
```

`freefy-secretary` is the default agent. It may read the known checkout at
`/Users/ck/Documents/freefy/` as needed and may create Issues in
`Bearsharks/freefy` with `gh`. For larger investigations it can call the hidden,
read-only `runner`, including independent parallel research calls. It does not
implement work, create an Orca worktree, manually dispatch a worker, or
duplicate the `issues.opened` workflow.

## Uninstall

```bash
./scripts/uninstall/agents.sh
```

Only the managed `oc-agents` wrapper is removed. Profile files and global
or project OpenCode configuration are left untouched.

## Non-goals and behavior

- No custom plugin, MCP server, skill, background runtime, database, or
  generated artifact is included.
- `runner` is a relative link to the Max profile's Runner definition, matching
  A-Max rather than maintaining a separate copy.
- The secretary creates an implementation Issue with the required Korean
  intake sections and the Freefy implementation marker, then reports the Issue
  URL and observed or pending workflow status.
- It asks only for blocking details that cannot safely be inferred from the
  repository and never claims creation or delegation without tool evidence.
