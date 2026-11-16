import {
  ASPECT_RATIO_CONFIG,
  CONTENT_CATEGORY_LABELS,
  type AspectRatio,
  type ContentCategory,
  type Language,
  type Tone,
} from "./schemas";
import { WORDS_PER_SECOND } from "./script-utils";

export const REBX_PLATFORM_CONTEXT = `
ABOUT REBX (Real Estate Broker Exchange):
- REBX is a modern real-estate broker exchange platform connecting property buyers, renters, verified real-estate agents, and leading developers.
- It operates in high-growth Indian residential and commercial corridors (including Hyderabad: Tellapur, Kokapet, Gandipet, Gachibowli, Financial District) as well as selective international markets.
- Primary currencies are Indian Rupee (INR / ₹) formatted cleanly in Crores (Cr) and Lakhs (L), or USD ($) for international listings.
- Target personas:
  1. Customers (Homebuyers & Renters): looking for verified listings, scheduling in-person or virtual site visits, comparing carpet area vs super built-up area, and negotiating direct transparent deals.
  2. Agents & Brokers: managing client inquiries, booking advances, earning transparent commissions, and sharing exclusive listings.
  3. Developers & Builders: showcasing high-rise gated communities, villas, RERA-approved project milestones, and managing developer inquiries.
- Key principles:
  - Strict compliance with RERA (Real Estate Regulatory Authority) standards and legal transparency.
  - Zero false claims: never invent guaranteed returns, rental yields, price appreciation, or unverified amenities.
  - Plain, spoken voiceover narration designed for short-form social media (YouTube landscape, Instagram Reels, TikTok, and Instagram Feed).
`;

export function buildGeminiSystemPrompt(): string {
  return `You are an expert real estate video producer and scriptwriter for REBX (Real Estate Broker Exchange).
${REBX_PLATFORM_CONTEXT}

Your job is to generate a concise, engaging, short-form video script with scene-by-scene narration and detailed image generation prompts.

STRICT FORMATTING & SCRIPTWRITING RULES:
1. Scene 1 must be a strong hook: one short question or surprising, attention-grabbing fact that can be spoken in under 4 seconds.
2. The final scene must be a clear call to action (CTA), directing viewers to browse verified listings or schedule site visits on REBX.
3. narration is SPOKEN AUDIO ONLY: do not include sound effects, stage directions, scene numbers, hashtags, or emojis in narration text.
4. Calculate duration based on realistic speaking speed (assume ${WORDS_PER_SECOND} words per second). Each scene duration should typically be 4 to 12 seconds, totaling approximately the requested target duration.
5. imagePrompt must be a detailed visual description for AI image generation (e.g. Midjourney / Photorealistic 4K architectural photography, natural sunlight, wide angles, high aesthetic quality). Do not put text or watermarks in image prompts.
6. Return ONLY a valid JSON object matching the requested schema. No conversational filler or markdown fences outside the JSON.`;
}

export function buildGeminiUserPrompt(params: {
  topic: string;
  category: ContentCategory;
  targetAudience: string;
  language: Language;
  tone: Tone;
  desiredDuration: number;
  aspectRatio: AspectRatio;
  sourceSummary?: string;
}): string {
  const ratioConfig = ASPECT_RATIO_CONFIG[params.aspectRatio] ?? ASPECT_RATIO_CONFIG["16:9"];

  const sections: string[] = [
    `Create a high-performing real estate video script with the following parameters:`,
    `- Topic / Focus: ${params.topic}`,
    `- Content Category: ${CONTENT_CATEGORY_LABELS[params.category] ?? params.category}`,
    `- Target Audience: ${params.targetAudience || "General property seekers, homebuyers, and real-estate enthusiasts"}`,
    `- Language: ${params.language}`,
    `- Tone: ${params.tone}`,
    `- Target Total Duration: ~${params.desiredDuration} seconds`,
    `- Video Aspect Ratio: ${params.aspectRatio} (${ratioConfig.dimensions})`,
  ];

  if (params.sourceSummary?.trim()) {
    sections.push(
      `\nFACTUAL SOURCE MATERIAL (Use ONLY facts found below; do not invent features, prices, or claims):\n"""\n${params.sourceSummary.trim()}\n"""`,
    );
  }

  sections.push(`
REQUIRED JSON OUTPUT STRUCTURE:
{
  "title": "Short Catchy Video Title (max 80 chars)",
  "description": "One sentence summary of what this video delivers",
  "thumbnailPrompt": "Detailed visual description for an eye-catching YouTube / social media thumbnail cover image in ${params.aspectRatio} format, high aesthetic, photorealistic",
  "scenes": [
    {
      "title": "Scene 1: Hook Title",
      "narration": "Spoken voiceover script for scene 1",
      "imagePrompt": "Detailed photorealistic visual prompt for this scene in ${params.aspectRatio} format",
      "duration": 5
    },
    {
      "title": "Scene 2: Key Detail",
      "narration": "Spoken voiceover script for scene 2",
      "imagePrompt": "Detailed visual prompt for scene 2",
      "duration": 8
    },
    {
      "title": "Scene 3: Call to Action",
      "narration": "Spoken voiceover script for call to action",
      "imagePrompt": "Detailed visual prompt for call to action",
      "duration": 6
    }
  ]
}
`);

  return sections.join("\n");
}

