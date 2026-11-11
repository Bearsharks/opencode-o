# benny

benny gives you two externally hosted OpenCode automations for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and automation sources. they do not appear as slash skills.

## set it up

1. point the OpenCode agent at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.opencode/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
3. let setup record the required pinned `oc-pstack` runtime in `.opencode/benny/runtime.json`. The external automation provider must provision and verify that profile for every run:

```json
{
  "launcher": "oc-pstack",
  "profile": "pstack",
  "sourceCommit": "de8ee15dd1194627d21eb5fcd41cb1873208dabb",
  "requiredSkills": ["how", "why", "tdd", "unslop"]
}
```

4. keep user-owned configuration outside the copied pack, for example in `.opencode/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
5. commit `.opencode/benny/runtime.json`, `.opencode/automations/benny/`, and any secret-free configuration before enabling either automation.
6. review each new automation draft or update existing automations in their editors. then send a harmless test report and verify every source-channel post stays in the original thread.

## OpenCode execution prerequisites

This pack preserves the operational procedures but is dormant. OpenCode does not provide a managed Slack report subscription, a hosted automation editor, fresh cloud checkouts, or credential-stripped workers through this profile. A local webhook routine alone does not supply these capabilities. Do not enable Benny or claim end-to-end automation equivalence without a verified external automation provider implementing those prerequisites.

The provider must authenticate Slack events, retain the original channel and root timestamp, deduplicate deliveries, select the committed repository revision, launch `oc-pstack`, and expose only the configured integrations. Its setup must include a concrete draft, explicit approval, a readiness check, and a saved editor configuration, one automation at a time. With no such provider, prepare the configuration and report activation as `BLOCKED`. Do not invent a built-in automation command or call an undocumented backend.

Native subagents inherit runtime access; a read-only instruction is not credential isolation. If tools and credentials cannot be excluded as required, keep the work in the coordinator. When delegation is eligible, use `subagent(agent: "general", background: true, role: ...)`, consolidate the brief, and retain every no-Slack-write restriction. Use `how explorer` for code investigation, `judgment and prose` for media review, and `bug-fix` for bounded code work. Pass the explicitly configured Benny model as native `model` when assigned, and apply the pstack effort/speed rules. The automation provider selects `models.triage` or `models.reproduce` for its parent session. Models must be advertised native `provider/model#variant` references.
