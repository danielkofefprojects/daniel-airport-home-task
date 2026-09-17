import { ChatGroq } from "@langchain/groq";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createPrimaryModel(): ChatGroq {
  return new ChatGroq({
    apiKey: requireEnv("GROQ_API_KEY"),
    model: process.env["GROQ_MODEL_PRIMARY"] ?? "openai/gpt-oss-120b",
    maxRetries: 3
  });
}

export function createFallbackModel(): ChatGroq {
  return new ChatGroq({
    apiKey: requireEnv("GROQ_API_KEY"),
    model: process.env["GROQ_MODEL_FALLBACK"] ?? "llama-3.3-70b-versatile",
    maxRetries: 3
  });
}
