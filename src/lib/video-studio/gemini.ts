import "server-only";
import { GoogleGenAI } from "@google/genai";
import { buildGeminiSystemPrompt, buildGeminiUserPrompt } from "./prompts";
import {
  geminiScriptInputSchema,
  type AspectRatio,
  type ContentCategory,
  type GeminiScriptOutput,
  type Language,
  type Tone,
} from "./schemas";
import { extractAndParseJson } from "./script-utils";

export interface GenerateGeminiScriptParams {
  topic: string;
  category: ContentCategory;
  targetAudience: string;
  language: Language;
  tone: Tone;
  desiredDuration: number;
  aspectRatio: AspectRatio;
  sourceSummary?: string;
}

/**
 * Checks whether the server has a configured Gemini API key.
 * Never exposes the key itself.
 */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

/**
 * Returns the configured Gemini model name or the recommended default.
 */
export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

/**
 * Generates a structured real estate video script via Google Gemini.
 * Follows REBX domain constraints and validates output against schema.
 */
export async function generateGeminiScript(
  params: GenerateGeminiScriptParams,
): Promise<GeminiScriptOutput> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Gemini API key is not configured on the server. " +
        "Please set GEMINI_API_KEY in your .env or server environment variables " +
        "(obtain an API key from Google AI Studio at https://aistudio.google.com/apikey), " +
        "or use Option B to import script JSON manually.",
    );
  }

  const systemInstruction = buildGeminiSystemPrompt();
  const userPrompt = buildGeminiUserPrompt(params);
  const modelName = getGeminiModelName();

  let rawText = "";

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelName,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
    });

    rawText = response.text ?? "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("API_KEY_INVALID") || msg.includes("401") || msg.includes("UNAUTHENTICATED")) {
      throw new Error(
        "Invalid Gemini API key. Please verify the GEMINI_API_KEY in your server configuration.",
      );
    }
    if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
      throw new Error(
        "Gemini API rate limit or quota exceeded. Please wait a moment and try again, or use manual JSON import.",
      );
    }

    throw new Error(`Failed to generate script with Gemini: ${msg}`);
  }

  if (!rawText.trim()) {
    throw new Error("Gemini returned an empty response. Please try again with a different topic or prompt.");
  }

  // Parse JSON
  const parsed = extractAndParseJson(rawText);
  if (!parsed.ok) {
    throw new Error(`Gemini response could not be parsed as JSON: ${parsed.error}`);
  }

  // Validate against Zod schema
  const validation = geminiScriptInputSchema.safeParse(parsed.data);
  if (!validation.success) {
    const firstIssue = validation.error.issues[0]?.message ?? "Invalid script structure";
    throw new Error(`Generated script did not match expected structure: ${firstIssue}`);
  }

  return validation.data;
}

