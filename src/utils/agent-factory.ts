import { LLMAgent } from "../agent/llm-agent.js";

/**
 * Create an LLMAgent and run its async initialization.
 * @param temperature - Temperature for API requests (0.0-2.0, default: 0.7)
 * @param maxTokens - Maximum tokens for API responses (positive integer, default: undefined = API default)
 */
export async function createLLMAgent(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
  debugLogFile?: string,
  temperature?: number,
  maxTokens?: number,
  isHeadless?: boolean
): Promise<LLMAgent> {
  const agent = new LLMAgent(apiKey, baseURL, model, maxToolRounds, debugLogFile, temperature, maxTokens, isHeadless);
  await agent.initialize();
  return agent;
}
