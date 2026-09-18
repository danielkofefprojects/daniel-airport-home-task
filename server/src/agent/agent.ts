import { createAgent, modelFallbackMiddleware, toolCallLimitMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { tools } from "./tools/index.js";
import { createFallbackModel, createPrimaryModel } from "./model.js";
import { focusAirportsMiddleware, toolLoggingMiddleware, trimHistoryMiddleware } from "./middleware.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

export function buildAgent() {
  return createAgent({
    model: createPrimaryModel(),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    checkpointer: new MemorySaver(),
    middleware: [
      trimHistoryMiddleware,
      focusAirportsMiddleware,
      toolLoggingMiddleware,
      toolCallLimitMiddleware({ runLimit: 6 }),
      modelFallbackMiddleware(createFallbackModel())
    ]
  });
}
