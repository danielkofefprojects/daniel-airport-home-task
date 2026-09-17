import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";
import { checkConfiguredModels } from "./agent/checkModels.js";

const app = express();
const port = Number(process.env["PORT"] ?? 3001);

app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use("/api", healthRouter);
app.use("/api", chatRouter);

app.use(errorHandler);

void checkConfiguredModels();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
