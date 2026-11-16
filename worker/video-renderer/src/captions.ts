import type { RenderAspectRatio } from "./render-engine";

export type CaptionCue = {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
  lines: [string] | [string, string];
};

export type AspectCaptionPreset = {
  aspectRatio: RenderAspectRatio;
  width: number;
  height: number;
  fontSize: number;
  outline: number;
  shadow: number;
  marginL: number;
  marginR: number;
  marginV: number;
  maxCharsPerLine: number;
  maxCharsPerCue: number;
  maxWordsPerCue: number;
};

export const CAPTION_STYLE_PRESETS: Record<RenderAspectRatio, AspectCaptionPreset> = {
  "16:9": {
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fontSize: 64,
    outline: 5,
    shadow: 2,
    marginL: 140,
    marginR: 140,
    marginV: 64,
    maxCharsPerLine: 36,
    maxCharsPerCue: 66,
    maxWordsPerCue: 10,
  },
  "1:1": {
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    fontSize: 60,
    outline: 5.5,
    shadow: 2,
    marginL: 64,
    marginR: 64,
    marginV: 62,
    maxCharsPerLine: 28,
    maxCharsPerCue: 52,
    maxWordsPerCue: 9,
  },
  "9:16": {
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fontSize: 60,
    outline: 5.5,
    shadow: 2,
    marginL: 64,
    marginR: 64,
    marginV: 190,
    maxCharsPerLine: 25,
    maxCharsPerCue: 46,
    maxWordsPerCue: 8,
  },
};

const INDIC_SCRIPT_REGEX = /[\u0900-\u0D7F]/;
const INDIC_LANGUAGE_NAMES = new Set([
  "hindi",
  "telugu",
  "tamil",
  "kannada",
  "marathi",
]);
const NONSPACING_MARKS_REGEX = /\p{Mn}|\p{Me}/gu;
const TRAILING_PUNCTUATION_FOR_WEIGHT_REGEX = /[\s.,!?;:—–\-"'“”‘’()[\]{}|।॥/\\]+/g;
const SENTENCE_TERMINATOR_REGEX = /[.!?।॥]["')\]”’]*$/;
const CLAUSE_SEPARATOR_REGEX = /[,;:—–]["')\]”’]*$/;
const ABBREVIATIONS_REGEX = /^(?:e\.g\.|i\.e\.|etc\.|vs\.|rs\.|dr\.|mr\.|mrs\.|ms\.|st\.|no\.|sq\.|ft\.)$/i;
const HANGING_SHORT_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "is",
  "are",
  "or",
  "as",
]);

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/**
 * Splits a string into user-perceived grapheme clusters so Indic matras/conjuncts
 * or surrogate pairs are never severed mid-character.
 */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (seg) => seg.segment);
  }
  return Array.from(text);
}

/**
 * Approximates horizontal visual character width by discounting zero-width combining
 * marks (`Mn`/`Me`) while counting base characters and spacing vowel signs.
 */
export function measureCaptionVisualLength(text: string): number {
  if (!text) return 0;
  const visibleOnly = text.replace(NONSPACING_MARKS_REGEX, "");
  return splitGraphemes(visibleOnly).length;
}

export function normalizeCaptionNarrationText(rawNarration: string): string {
  if (!rawNarration) return "";
  return rawNarration
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * Selects an appropriate system sans-serif font family so both English/Latin
 * and REBX's supported Indian languages render crisply in libass.
 */
export function resolveCaptionFontName(params: {
  language?: string | null;
  text: string;
  platform?: NodeJS.Platform;
}): string {
  const platform = params.platform ?? process.platform;
  const normalizedLang = params.language?.trim().toLowerCase() ?? "";
  const isIndic =
    INDIC_LANGUAGE_NAMES.has(normalizedLang) || INDIC_SCRIPT_REGEX.test(params.text);

  if (platform === "win32") {
    return isIndic ? "Nirmala UI" : "Arial";
  }

  return isIndic ? "Noto Sans" : "Arial";
}

function splitLongSingleToken(token: string, maxCharsPerLine: number): string[] {
  const safeLimit = Math.max(6, maxCharsPerLine);
  if (measureCaptionVisualLength(token) <= safeLimit) {
    return [token];
  }

  const graphemes = splitGraphemes(token);
  const pieces: string[] = [];
  let current = "";

  for (const g of graphemes) {
    const next = current + g;
    if (current && measureCaptionVisualLength(next) > safeLimit) {
      pieces.push(current);
      current = g;
    } else {
      current = next;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

/**
 * Splits normalized narration text into natural sentence boundaries while preserving
 * decimals (e.g., 2.5) and common abbreviations (e.g., Rs., Dr., e.g.).
 */
export function splitNarrationIntoSentences(normalizedText: string): string[] {
  if (!normalizedText) return [];

  const paragraphs = normalizedText
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const sentences: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let buffer: string[] = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      buffer.push(word);

      const isLastWord = i === words.length - 1;
      const endsSentence = SENTENCE_TERMINATOR_REGEX.test(word);
      const isAbbrev = ABBREVIATIONS_REGEX.test(word) || /^\d+\.$/.test(word);

      if (isLastWord || (endsSentence && !isAbbrev)) {
        sentences.push(buffer.join(" "));
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      sentences.push(buffer.join(" "));
    }
  }

  return sentences;
}

/**
 * Wraps a caption phrase into 1 or 2 visually balanced lines inside `maxCharsPerLine`.
 */
export function wrapPhraseToBalancedLines(
  phrase: string,
  maxCharsPerLine: number,
): [string] | [string, string] {
  const clean = phrase.trim().replace(/\s+/g, " ");
  if (!clean) return [""];

  if (measureCaptionVisualLength(clean) <= maxCharsPerLine) {
    return [clean];
  }

  const words = clean.split(" ").filter(Boolean);
  if (words.length <= 1) {
    const parts = splitLongSingleToken(clean, maxCharsPerLine);
    if (parts.length <= 1) return [clean];
    return [parts[0], parts.slice(1).join("")];
  }

  let bestScore = Number.POSITIVE_INFINITY;
  let bestSplit: [string, string] | null = null;

  for (let splitIdx = 1; splitIdx < words.length; splitIdx++) {
    const line1 = words.slice(0, splitIdx).join(" ");
    const line2 = words.slice(splitIdx).join(" ");
    const len1 = measureCaptionVisualLength(line1);
    const len2 = measureCaptionVisualLength(line2);

    const overflow1 = Math.max(0, len1 - maxCharsPerLine);
    const overflow2 = Math.max(0, len2 - maxCharsPerLine);
    const overflowPenalty = (overflow1 + overflow2) * 100;

    const imbalance = Math.abs(len1 - len2);
    const clauseBreakBonus = CLAUSE_SEPARATOR_REGEX.test(line1) ? -5 : 0;
    const topHeavyBonus = len1 >= len2 ? -1 : 0;

    const lastWordLine1 = words[splitIdx - 1].toLowerCase().replace(/[^a-z]/g, "");
    const firstWordLine2 = words[splitIdx].toLowerCase().replace(/[^a-z]/g, "");
    let orphanPenalty = 0;
    if (words.length >= 4 && HANGING_SHORT_WORDS.has(lastWordLine1) && splitIdx > 1) {
      orphanPenalty += 4;
    }
    if (words.length >= 4 && splitIdx === words.length - 1 && firstWordLine2.length <= 3) {
      orphanPenalty += 3;
    }

    const score = overflowPenalty + imbalance + clauseBreakBonus + topHeavyBonus + orphanPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestSplit = [line1, line2];
    }
  }

  return bestSplit ?? [clean];
}

function canFitCue(words: readonly string[], preset: AspectCaptionPreset): boolean {
  if (words.length === 0) return true;
  if (words.length > preset.maxWordsPerCue) return false;
  const joined = words.join(" ");
  if (measureCaptionVisualLength(joined) > preset.maxCharsPerCue) return false;
  const wrapped = wrapPhraseToBalancedLines(joined, preset.maxCharsPerLine);
  return wrapped.every((line) => measureCaptionVisualLength(line) <= preset.maxCharsPerLine);
}

/**
 * Splits narration into clean multi-word phrase chunks ready to wrap into 1–2 lines per cue.
 */
export function chunkNarrationIntoCaptionPhrases(
  rawNarration: string,
  aspectRatio: RenderAspectRatio,
): { text: string; lines: [string] | [string, string] }[] {
  const preset = CAPTION_STYLE_PRESETS[aspectRatio];
  const normalized = normalizeCaptionNarrationText(rawNarration);
  if (!normalized) return [];

  const sentences = splitNarrationIntoSentences(normalized);
  const allChunks: string[][] = [];

  for (const sentence of sentences) {
    const rawTokens = sentence.split(/\s+/).filter(Boolean);
    const tokens: string[] = [];
    for (const tok of rawTokens) {
      if (measureCaptionVisualLength(tok) > preset.maxCharsPerLine) {
        tokens.push(...splitLongSingleToken(tok, preset.maxCharsPerLine));
      } else {
        tokens.push(tok);
      }
    }

    const sentenceChunks: string[][] = [];
    let current: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const candidate = [...current, token];

      if (current.length > 0 && !canFitCue(candidate, preset)) {
        sentenceChunks.push(current);
        current = [token];
      } else {
        current = candidate;
      }

      const remaining = tokens.slice(i + 1);
      const isClauseBoundary = CLAUSE_SEPARATOR_REGEX.test(token);
      if (isClauseBoundary && remaining.length > 0) {
        const currentLen = measureCaptionVisualLength(current.join(" "));
        const isSubstantial =
          currentLen >= Math.ceil(preset.maxCharsPerCue * 0.45) || current.length >= 4;
        const remainderIsSubstantial =
          remaining.length >= 3 ||
          measureCaptionVisualLength(remaining.join(" ")) >= Math.ceil(preset.maxCharsPerLine * 0.65);

        if (isSubstantial && remainderIsSubstantial) {
          sentenceChunks.push(current);
          current = [];
        }
      }
    }

    if (current.length > 0) {
      sentenceChunks.push(current);
    }

    // Prevent awkward 1–2 word orphan tail inside a multi-chunk sentence by rebalancing the last pair
    if (sentenceChunks.length >= 2) {
      const last = sentenceChunks[sentenceChunks.length - 1];
      const prev = sentenceChunks[sentenceChunks.length - 2];
      const lastLen = measureCaptionVisualLength(last.join(" "));

      if (
        last.length <= 2 &&
        lastLen <= Math.floor(preset.maxCharsPerLine * 0.55) &&
        prev.length >= 4
      ) {
        const combined = [...prev, ...last];
        if (canFitCue(combined, preset)) {
          sentenceChunks.splice(sentenceChunks.length - 2, 2, combined);
        } else {
          let bestIdx: number | null = null;
          let bestDiff = Number.POSITIVE_INFINITY;
          for (let split = 2; split <= combined.length - 2; split++) {
            const firstHalf = combined.slice(0, split);
            const secondHalf = combined.slice(split);
            if (!canFitCue(firstHalf, preset) || !canFitCue(secondHalf, preset)) {
              continue;
            }
            const lenA = measureCaptionVisualLength(firstHalf.join(" "));
            const lenB = measureCaptionVisualLength(secondHalf.join(" "));
            const diff =
              Math.abs(lenA - lenB) -
              (CLAUSE_SEPARATOR_REGEX.test(firstHalf[firstHalf.length - 1]) ? 4 : 0);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = split;
            }
          }
          if (bestIdx !== null) {
            sentenceChunks.splice(
              sentenceChunks.length - 2,
              2,
              combined.slice(0, bestIdx),
              combined.slice(bestIdx),
            );
          }
        }
      }
    }

    allChunks.push(...sentenceChunks);
  }

  return allChunks.map((words) => {
    const text = words.join(" ");
    return {
      text,
      lines: wrapPhraseToBalancedLines(text, preset.maxCharsPerLine),
    };
  });
}

function computeChunkSpokenWeight(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  const spokenBody = text.replace(TRAILING_PUNCTUATION_FOR_WEIGHT_REGEX, "");
  const spokenGraphemes = measureCaptionVisualLength(spokenBody);

  let pauseWeight = 0;
  for (const w of words) {
    if (SENTENCE_TERMINATOR_REGEX.test(w)) {
      pauseWeight += 4.5;
    } else if (CLAUSE_SEPARATOR_REGEX.test(w)) {
      pauseWeight += 2.2;
    }
  }

  return Math.max(1.5, spokenGraphemes + words.length * 1.2 + pauseWeight);
}

/**
 * Generates synchronized CaptionCues for one scene across its active speech window:
 * - Uses FFprobe-measured `probedAudioDurationSec` when audio exists so captions
 *   track spoken narration instead of lingering over silent padding.
 * - Falls back cleanly across `targetDurationSec` when optional audio is omitted.
 */
export function buildSceneCaptionCues(params: {
  narration: string;
  targetDurationSec: number;
  probedAudioDurationSec: number | null;
  aspectRatio: RenderAspectRatio;
}): CaptionCue[] {
  const { narration, targetDurationSec, probedAudioDurationSec, aspectRatio } = params;
  if (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0) {
    return [];
  }

  const phrases = chunkNarrationIntoCaptionPhrases(narration, aspectRatio);
  if (phrases.length === 0) {
    return [];
  }

  const maxSceneCs = Math.max(10, Math.floor(targetDurationSec * 100) - 2);
  let startCs: number;
  let endCs: number;

  if (probedAudioDurationSec !== null && Number.isFinite(probedAudioDurationSec) && probedAudioDurationSec > 0) {
    const audioEndCs = Math.floor(probedAudioDurationSec * 100);
    startCs = Math.min(4, Math.max(0, Math.floor(audioEndCs * 0.03)));
    endCs = Math.min(maxSceneCs, Math.max(startCs + phrases.length, audioEndCs - 2));
  } else {
    startCs = Math.min(10, Math.floor(maxSceneCs * 0.04));
    endCs = Math.max(startCs + phrases.length, maxSceneCs - 8);
  }

  if (endCs <= startCs) {
    startCs = 0;
    endCs = Math.max(phrases.length, maxSceneCs);
  }

  const totalSpanCs = endCs - startCs;
  const weights = phrases.map((p) => computeChunkSpokenWeight(p.text));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || phrases.length;

  const cues: CaptionCue[] = [];
  let cursorCs = startCs;
  let accumulatedWeight = 0;

  for (let i = 0; i < phrases.length; i++) {
    accumulatedWeight += weights[i];
    const remainingCuesAfterThis = phrases.length - 1 - i;
    const isLast = i === phrases.length - 1;

    let nextBoundaryCs: number;
    if (isLast) {
      nextBoundaryCs = endCs;
    } else {
      const proportionalCs = startCs + Math.round((accumulatedWeight / totalWeight) * totalSpanCs);
      const minBoundary = cursorCs + 1;
      const maxBoundary = Math.max(minBoundary, endCs - remainingCuesAfterThis);
      nextBoundaryCs = Math.min(maxBoundary, Math.max(minBoundary, proportionalCs));
    }

    cues.push({
      index: i + 1,
      startSec: Number((cursorCs / 100).toFixed(2)),
      endSec: Number((nextBoundaryCs / 100).toFixed(2)),
      text: phrases[i].text,
      lines: phrases[i].lines,
    });

    cursorCs = nextBoundaryCs;
  }

  return cues;
}

export function formatAssTimestamp(seconds: number): string {
  const safeCs = Math.max(0, Math.round(seconds * 100));
  const cs = safeCs % 100;
  const totalSec = Math.floor(safeCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);

  return `${hours}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Escapes dialogue text for ASS events while intentionally allowing our `\N` line break.
 * - Replaces braces (`{`, `}`) with ASS-escaped forms (`\{`, `\}`) so override tags aren't injected.
 * - Neutralizes raw backslashes using a following Word Joiner (`U+2060`) so user text like `C:\new`
 *   cannot trigger `\n`, `\N`, or `\h` control sequences.
 */
export function escapeAssDialogueLine(rawLine: string): string {
  return rawLine
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\u2060")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/**
 * Generates complete UTF-8 (with BOM) ASS subtitle file content matching the
 * REBX bold white + thick black outline lower-center caption aesthetic.
 */
export function generateSceneAssSubtitleContent(params: {
  cues: readonly CaptionCue[];
  aspectRatio: RenderAspectRatio;
  language?: string | null;
  platform?: NodeJS.Platform;
}): string {
  const { cues, aspectRatio, language, platform } = params;
  const preset = CAPTION_STYLE_PRESETS[aspectRatio];
  const combinedText = cues.map((c) => c.text).join(" ");
  const fontName = resolveCaptionFontName({
    language,
    text: combinedText,
    platform,
  });

  const lines: string[] = [
    "[Script Info]",
    "; Generated by REBX AI Video Studio renderer",
    "ScriptType: v4.00+",
    `PlayResX: ${preset.width}`,
    `PlayResY: ${preset.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${preset.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,-1,0,0,0,100,100,0,0,1,${preset.outline},${preset.shadow},2,${preset.marginL},${preset.marginR},${preset.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const cue of cues) {
    const startTs = formatAssTimestamp(cue.startSec);
    const endTs = formatAssTimestamp(cue.endSec);
    const formattedText = cue.lines.map(escapeAssDialogueLine).join("\\N");
    lines.push(`Dialogue: 0,${startTs},${endTs},Caption,,0,0,0,,${formattedText}`);
  }

  return `\uFEFF${lines.join("\n")}\n`;
}

/**
 * Escapes an arbitrary filesystem path for FFmpeg's two-level filtergraph parser
 * (for filters such as `ass=filename=...` inside `-filter_complex`).
 *
 * Level 1 escapes filter option specials (`\`, `:`, `'`).
 * Level 2 escapes filtergraph description specials (`\`, `'`, `[`, `]`, `,`, `;`, space).
 */
export function escapeFfmpegFilterPathValue(filePath: string): string {
  const forwardSlashed = filePath.replace(/\\/g, "/");
  const lvl1 = forwardSlashed.replace(/([:\\'])/g, "\\$1");
  const lvl2 = lvl1.replace(/([\\'\[\],; ])/g, "\\$1");
  return lvl2;
}

