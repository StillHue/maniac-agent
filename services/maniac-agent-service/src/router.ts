import { callGroq } from './llm';

export type RouteDecision = 'llama' | 'north';

export async function classifyRequest(message: string): Promise<RouteDecision> {
  const prompt = `You are the Intelligent Router for the Maniac platform.
Your task is to classify the user's input into one of two routes:
1. "llama" (for simple questions, general knowledge, factual questions, quick explanations, e.g. "Who created Linux?", "What is the capital of France?", "How do React Hooks work?").
2. "north" (for complex tasks, request for coding, refactoring, architecture planning, multi-file analysis, deep reasoning).

Respond ONLY with the word "llama" or "north", in lowercase, with no punctuation or additional text.

User Input: "${message}"

Classification:`;

  try {
    const decision = await callGroq([
      { role: 'system', content: 'You are a precise classifier. Respond only with "llama" or "north".' },
      { role: 'user', content: prompt }
    ]);

    const cleanDecision = decision.trim().toLowerCase();
    if (cleanDecision.includes('north')) {
      return 'north';
    }
    return 'llama';
  } catch (error) {
    console.error('Classification failed, defaulting to llama:', error);
    return 'llama';
  }
}
