import { type Static, Type } from "typebox";

const strict = { additionalProperties: false } as const;

export const EffortLevelSchema = Type.Union([
  Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("extreme"),
]);
export type EffortLevel = Static<typeof EffortLevelSchema>;

export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
  Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

export const EnforcementSlotSchema = Type.Object({
  method: Type.String(),
  config: Type.Optional(Type.Unknown()),
}, strict);

export const CommandVerifySchema = Type.Object({
  kind: Type.Literal("command"),
  command: Type.String(),
  cwd: Type.String(),
  equivalents: Type.Array(Type.String()),
  allowExtraArgs: Type.Boolean(),
  timeoutSec: Type.Number(),
}, strict);
export type CommandVerify = Static<typeof CommandVerifySchema>;

export const ReportedVerifySchema = Type.Object({
  kind: Type.Literal("reported"),
  how: Type.String(),
  checks: Type.Array(EnforcementSlotSchema),
}, strict);
export type ReportedVerify = Static<typeof ReportedVerifySchema>;

export const DoneConditionSchema = Type.Object({
  id: Type.String(),
  statement: Type.String(),
  basis: Type.Optional(Type.String()),
  verify: Type.Union([CommandVerifySchema, ReportedVerifySchema]),
}, strict);
export type DoneCondition = Static<typeof DoneConditionSchema>;

const draftSourceKinds = [
  Type.Literal("user-message"), Type.Literal("user-rules"), Type.Literal("repo-rules"),
  Type.Literal("repo-config"), Type.Literal("material"), Type.Literal("judge"),
] as const;

export const ProhibitionSourceSchema = Type.Object({
  kind: Type.Union([...draftSourceKinds]),
  ref: Type.Optional(Type.String()),
}, strict);
export type ProhibitionSource = Static<typeof ProhibitionSourceSchema>;

export const ProhibitionSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
  source: ProhibitionSourceSchema,
}, strict);
export type Prohibition = Static<typeof ProhibitionSchema>;

export const MaterialSchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  mediaType: Type.String(),
  describe: Type.String(),
  origin: Type.Object({
    kind: Type.Union([
      Type.Literal("figma"), Type.Literal("atlassian"), Type.Literal("case"),
      Type.Literal("user-file"), Type.Literal("other"),
    ]),
    ref: Type.Optional(Type.String()),
  }, strict),
}, strict);
export type Material = Static<typeof MaterialSchema>;

export const RuntimeKnobsSchema = Type.Object({
  model: Type.String(),
  thinkingLevel: ThinkingLevelSchema,
  workerCap: Type.Number(),
  workerThinkingLevel: ThinkingLevelSchema,
}, strict);
export type RuntimeKnobs = Static<typeof RuntimeKnobsSchema>;

export const ContractSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  contractId: Type.String(),
  createdAt: Type.String(),
  source: Type.Union([Type.Literal("judge"), Type.Literal("fixed"), Type.Literal("fallback"), Type.Literal("file")]),
  repo: Type.Object({
    root: Type.String(),
    headSha: Type.String(),
    branch: Type.Optional(Type.String()),
    repoKey: Type.String(),
  }, strict),
  goal: Type.Object({ original: Type.String(), refined: Type.String() }, strict),
  doneConditions: Type.Array(DoneConditionSchema),
  prohibitions: Type.Array(ProhibitionSchema),
  materials: Type.Array(MaterialSchema),
  effort: Type.Object({
    level: EffortLevelSchema,
    decidedBy: Type.Union([
      Type.Literal("classifier"), Type.Literal("fixed"), Type.Literal("fallback"), Type.Literal("override"),
    ]),
  }, strict),
  runtime: RuntimeKnobsSchema,
  paths: Type.Object({ runDir: Type.String(), materialsDir: Type.String() }, strict),
}, strict);
export type Contract = Static<typeof ContractSchema>;

export const JudgeDraftSchema = Type.Object({
  refinedGoal: Type.String({
    description: "The user's request restated precisely. Clarify only; add no new decisions.",
  }),
  doneConditions: Type.Array(Type.Object({
    statement: Type.String({ description: "What must be true when the work is done." }),
    basis: Type.Optional(Type.String({ description: "Why this condition applies (audit only; not shown to the agent)." })),
    verify: Type.Union([
      Type.Object({
        kind: Type.Literal("command"),
        command: Type.String({ description: "Exact shell command whose success proves the condition." }),
        cwd: Type.Optional(Type.String({ description: "Directory relative to the repo root. Default \".\"." })),
        equivalents: Type.Optional(Type.Array(Type.String(), { description: "Other commands that count as the same check." })),
        allowExtraArgs: Type.Optional(Type.Boolean({ description: "Whether extra arguments after the command still count. Default false." })),
        timeoutSec: Type.Optional(Type.Integer({ minimum: 1, description: "Default 900." })),
      }),
      Type.Object({
        kind: Type.Literal("reported"),
        how: Type.String({ description: "How the agent should check this condition and what to report." }),
      }),
    ]),
  })),
  prohibitions: Type.Array(Type.Object({
    text: Type.String(),
    source: Type.Object({
      kind: Type.Union([...draftSourceKinds]),
      ref: Type.Optional(Type.String({ description: "Where the prohibition comes from, e.g. a file path or quote." })),
    }),
  })),
  materialIds: Type.Array(Type.String(), { description: "Ids of captured materials relevant to the work, e.g. M1." }),
});
export type JudgeDraft = Static<typeof JudgeDraftSchema>;
