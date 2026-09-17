import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { HttpError } from "../middleware/errorHandler.js";
import { runAgent, streamAgent } from "../agent/run.js";

export const chatRouter = Router();

const chatBodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1)
});

chatRouter.post("/chat", validateBody(chatBodySchema), async (req, res, next) => {
  const { sessionId, message } = req.body as z.infer<typeof chatBodySchema>;
  const start = Date.now();
  try {
    const result = await runAgent(sessionId, message);
    console.log(
      `[chat] session=${sessionId} tools=[${result.toolsUsed.join(",")}] model=${result.model ?? "?"} ${Date.now() - start}ms`
    );
    res.json(result);
  } catch (err) {
    console.error(`[chat] session=${sessionId} failed after ${Date.now() - start}ms`);
    next(err);
  }
});

function sseWrite(res: import("express").Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

chatRouter.post("/chat/stream", validateBody(chatBodySchema), async (req, res) => {
  const { sessionId, message } = req.body as z.infer<typeof chatBodySchema>;
  const start = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    for await (const event of streamAgent(sessionId, message)) {
      if (event.type === "token") {
        sseWrite(res, "token", { text: event.text });
      } else {
        console.log(
          `[chat/stream] session=${sessionId} tools=[${event.result.toolsUsed.join(",")}] model=${event.result.model ?? "?"} ${Date.now() - start}ms`
        );
        sseWrite(res, "done", event.result);
      }
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : "INTERNAL_ERROR";
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    console.error(`[chat/stream] session=${sessionId} failed after ${Date.now() - start}ms: ${errorMessage}`);
    sseWrite(res, "error", { message: errorMessage, code, status });
  } finally {
    res.end();
  }
});
