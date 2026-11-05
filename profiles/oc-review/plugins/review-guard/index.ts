import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"

export const allowedTools = new Set([
  "job_messages_createSession", "job_messages_readPeerMessages",
  "freefy_review_read", "freefy_review_list", "freefy_review_search",
  "freefy_review_check", "freefy_review_submit",
])

export default {
  id: "oc-review.execution-guard",
  effect: (ctx: any) => Effect.gen(function* () {
    yield* ctx.tool.transform((editor: any) => {
      for (const tool of editor.list()) if (!allowedTools.has(tool.id)) editor.remove(tool.id)
      // The reviewer does not have the generic execute tool. Expose its two
      // queue readers natively instead of leaving unreachable Code Mode entries.
      for (const name of ["job_messages_createSession", "job_messages_readPeerMessages"]) {
        editor.update(name, (tool: any) => { tool.options = { ...tool.options, codemode: false } })
      }
    })
    for (const name of ["context", "generate", "compaction"]) {
      yield* ctx.session.hook(name, (event: any) => Effect.sync(() => {
        for (const tool of Object.keys(event.tools)) if (!allowedTools.has(tool)) delete event.tools[tool]
      }))
    }
    yield* ctx.tool.hook("execute.before", (event: any) =>
      event.agent === "worker" && allowedTools.has(event.tool)
        ? Effect.void
        : Effect.fail(new Tool.Error({ message: "독립 리뷰에서는 제품 편집·임의 셸·추가 에이전트·직접 완료 보고를 실행하지 않습니다." })))
  }),
}
