# A-Max context-strategy design (proposed)

> **Status: proposed; not implemented.** This document is a design direction
> for a future A-Max context-strategy system. It does not add selector logic,
> episode logging, a strategy registry, persistence, worktrees, or adaptive
> learning to the current profile.

## Current boundary

Today, A-Max uses process-local cards for background Terra work. A card moves
through `Working`, `Review`, `Done`, or `Blocked`; the orchestrator reviews a
result before marking it `Done`. Terra may run in the background, while Runner
is always a foreground task. Parallel work relies on prompt-level disjoint edit
scopes, and A-Max has no fixed concurrency cap. These are current behavioral
contracts, not features supplied by the proposed design.

The proposal preserves those contracts. In particular, a future strategy must
not treat a background completion as accepted work, assume isolated worktrees,
or make Runner asynchronous.

## Proposed records

The proposed system separates stable policy, selectable guidance, task context,
and evidence instead of placing them in one growing prompt. The names below are
conceptual records, not existing types or storage formats.

```ts
type SafetyContract = Readonly<{
  version: string;
  nonNegotiableRules: string[];
  completionGates: string[];
}>;

type StrategySpec = {
  id: "standard" | "investigate_first" | "parallel_disjoint" | "high_assurance";
  version: string;
  requiredCapabilities: string[];
  contextRules: string[];
  verificationPlan: string[];
};

type ContextPacket = {
  role: "HTOrchestrator" | "Terra" | "Runner";
  taskScope: string;
  contract: SafetyContract;
  strategy: Pick<StrategySpec, "id" | "version" | "contextRules">;
  relevantEvidence: string[];
};

type VerificationReport = {
  checks: Array<{ name: string; result: "pass" | "fail" | "unknown"; evidence: string[] }>;
  metrics: MetricVector;
  gateStatus: "ready_for_review" | "blocked";
};

type StrategyDecision = {
  selectorVersion: string;
  chosen: StrategySpec["id"];
  candidates: StrategySpec["id"][];
  featureSnapshot: Record<string, string | boolean | number | "unknown">;
  rationale: string[];
};

type EpisodeLog = {
  decision: StrategyDecision;
  environment: EnvironmentFingerprint;
  verification: VerificationReport;
  reviewedOutcome?: "accepted" | "rejected" | "inconclusive";
};

type EnvironmentFingerprint = {
  profileVersion: string;
  modelAndToolVersions: Record<string, string | "unknown">;
  capabilities: string[];
};
```

`SafetyContract` is immutable within an episode: a strategy may add caution,
but may not relax it. `StrategySpec` is independently versioned so a change in
guidance or required capabilities is attributable. `ContextPacket` is
task-specific and role-specific rather than a complete transcript. A future
`EpisodeLog` would join a decision, its evidence, and its environment; it does
not imply that A-Max currently records or persists episodes.

## Proposed flow

The intended flow is deliberately simple and reviewable:

```text
user instruction
  -> task features
  -> deterministic selector
  -> role-specific context assembly
  -> execution
  -> structured verification
  -> episode log
  -> human-reviewed offline improvement
```

The selector and context assembler would be deterministic for a given feature
snapshot, strategy version, and capability set. Execution remains subject to
the current card and review workflow. Offline review, rather than live
self-modification, would decide whether a later selector or strategy version
is worth proposing.

## Initial strategy set and selection

The initial proposal has only four macro-strategies. It intentionally avoids a
Cartesian product of reading, delegation, verification, and tool options; such
a space would be difficult to explain, test, and review.

| Strategy | Proposed use |
| --- | --- |
| `standard` | Clear, bounded work using the normal conservative workflow. |
| `investigate_first` | Ambiguous ownership, unfamiliar code, conflicting evidence, or a question that must be resolved before edits. |
| `parallel_disjoint` | Low-to-moderate-risk work with explicitly independent, prompt-level scopes that can be reviewed separately. |
| `high_assurance` | Security-, data-, release-, or irreversibility-sensitive work, or work needing unusually strong verification. |

Suggested task features include risk class; external or irreversible effects;
scope size; edit-versus-investigation intent; ownership and evidence ambiguity;
independent disjoint subtasks; expected verification cost; sensitive-data or
policy involvement; and available model/tool capabilities. Features should
retain `unknown` rather than inventing precision.

The initial selector is proposed as a fallback-first ordered rule:

1. If available evidence identifies high risk, choose `high_assurance`. If its
   required capability is unavailable, block for review rather than silently
   weakening the strategy.
2. Otherwise, if risk or ownership is unknown, or decision-critical evidence
   is missing or ambiguous, choose `investigate_first`. An investigation that
   identifies high risk must return to the first rule.
3. Otherwise, choose `parallel_disjoint` only when independent scopes are
   explicit, the required capability is available, and each result can receive
   the normal review-before-`Done` treatment.
4. Otherwise choose `standard`.

Only missing non-critical features or an unrecognized non-critical task detail
may leave `standard` eligible. Unknown risk, ownership, or decision-critical
evidence must not silently fall back to `standard`. This rule does not introduce
a concurrency limit and does not make a parallel assignment safe without
disjoint scopes.

## Role-specific packets

Each proposed packet should contain only the information needed by its role:

- **HTOrchestrator:** user outcome, feature snapshot, selected strategy and
  rationale, safety contract, scope partition, capability checks, and the
  evidence required to accept cards. It retains responsibility for Review
  before Done.
- **Terra:** one bounded edit or investigation scope, applicable non-negotiable
  rules, relevant files and evidence, handoff expectations, and its required
  verification. It receives no authority to accept its own result.
- **Runner:** a foreground verification question, acceptance criteria,
  relevant changed scope, and commands or observations to collect. It is not a
  background worker in this proposal.

The packet boundary is a relevance mechanism, not a secrecy or isolation
boundary. It does not create worktrees or prevent conflicting edits by itself.

## Completion evidence

Proposed hard completion gates are: the task scope is identified; applicable
non-negotiable safety rules are satisfied; required verification is attempted
or a blocker is recorded; evidence supports every required acceptance claim;
and an orchestrator reviews the evidence before `Done`. A failed gate blocks
completion. An unobserved gate must be recorded as unknown and cannot be
treated as a pass.

For comparisons that are useful but not themselves hard gates, a compact metric
vector can preserve evidence without collapsing it into one reward:

```ts
type OperationalMeasurements = {
  elapsedMs?: number | "unknown";
  tokens?: number | "unknown";
  cost?: number | "unknown";
  toolCalls?: number | "unknown";
  changedScope?: { paths: number; lines?: number } | "unknown";
  reworkCount?: number | "unknown";
  environment: EnvironmentFingerprint;
  provenance: string[];
};

type MetricVector = {
  taskOutcome: "supported" | "contradicted" | "unknown";
  scopeCompliance: "supported" | "contradicted" | "unknown";
  verificationCoverage: "supported" | "contradicted" | "unknown";
  safetyCompliance: "supported" | "contradicted" | "unknown";
  operational?: OperationalMeasurements;
};
```

Evidence strength should be marked independently as `none`, `reported`,
`direct`, or `independently reviewed`. `unknown` and `unobserved` are neither
failure nor success: they remain unknown. A hard gate may require stronger
evidence, but an optional metric without observation must not be scored as a
failure. Measurements are proposed comparison dimensions only; provenance and
the environment fingerprint are required because latency, tokens, cost, tool
availability, and scope can vary by provider and task. Current A-Max does not
collect these measurements.

## Improvement boundaries and drift

Selector improvement and strategy-spec improvement are separate proposed
change paths. A selector change alters the feature-to-strategy mapping; a
strategy-spec change alters the instructions, capabilities, or verification
requirements for a named strategy. Each should be versioned and reviewed
separately so an outcome is not attributed to an undifferentiated prompt
change.

Model and tool drift should be handled through capability-based requirements,
adapters, versioned contracts/specifications, and an
`EnvironmentFingerprint`. An adapter may translate a required capability to a
specific model or tool interface, but must report when that capability is
missing or changed. A fingerprint makes an offline result conditional on its
environment rather than assuming it transfers unchanged.

## Learning limits and staged rollout

An episode only observes the selected strategy's outcome; it does not reveal
the counterfactual outcome of every other strategy. Proposed mitigations are
to log the top two eligible candidates and rationale, use offline paired replay
where comparable tasks and environments permit it, and run a shadow selector
that records a recommendation without controlling production work. Random
exploration is not appropriate for high-risk production work.

The proposed minimal rollout is staged:

1. Observe the current baseline with reviewable outcomes. Current A-Max has no
   structured episode logging, so this stage must not claim it does.
2. Add the four deterministic strategies and their explicit decision records.
3. Review outcomes offline, then version any approved selector or
   strategy-spec changes.
4. Consider constrained adaptive routing only after sufficient held-out
   evidence shows that it preserves the required gates.

## Research inspiration, not validation

The [context-optimization preprint](https://arxiv.org/abs/2607.25415) and its
[reference implementation](https://github.com/dpaul0501/context-optimization-rl)
inspired this staged approach through the preprint's practical-budget
static-baseline result. The static-first lesson here is to establish and assess
fixed, auditable strategies before considering adaptation. Neither the preprint
nor its implementation validates this proposed A-Max design, its selector, or
its expected outcomes; local held-out evidence and human review would still be
required.
