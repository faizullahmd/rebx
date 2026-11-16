import "server-only";
import {
  resolveSarvamLanguageCode,
  SARVAM_AUDIO_FORMATS,
  SARVAM_LANGUAGES,
  SARVAM_MAX_NARRATION_CHARS,
  SARVAM_SAMPLE_RATES,
  SARVAM_SUPPORTED_MODELS,
  SARVAM_TTS_MODEL,
  SARVAM_VOICE_ID_SET,
  SARVAM_VOICES,
  type SarvamAudioFormat,
  type SarvamLanguageCode,
  type SarvamSampleRate,
  type SarvamTtsModel,
} from "./schemas";
import { countWords } from "./script-utils";

const SARVAM_TTS_ENDPOINT = "https://api.sarvam.ai/text-to-speech";
const SARVAM_TIMEOUT_MS = 30_000;

export type AudioContainerFormat = "mp3" | "wav" | "ogg" | "webm";

export interface SarvamSpeechParams {
  text: string;
  language: string;
  voice?: string;
  format?: SarvamAudioFormat;
  pace?: number;
  sampleRate?: SarvamSampleRate;
}

export interface SarvamSpeechResult {
  buffer: Buffer;
  format: SarvamAudioFormat;
  mimeType: string;
  model: SarvamTtsModel;
  voice: string;
  languageCode: SarvamLanguageCode;
  sampleRate: SarvamSampleRate;
  durationSec: number;
  requestId: string | null;
  generatedAt: string;
}

export interface ValidatedSarvamTtsRequest {
  text: string;
  languageCode: SarvamLanguageCode;
  voice: string;
  model: SarvamTtsModel;
  format: SarvamAudioFormat;
  mimeType: string;
  pace: number;
  sampleRate: SarvamSampleRate;
}

/**
 * Checks whether SARVAM_API_KEY is present on the server.
 * Never returns or logs the secret value.
 */
export function isSarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY?.trim());
}

/**
 * Returns the configured Sarvam TTS model after validating against supported models.
 */
export function getSarvamModelName(): SarvamTtsModel {
  const configured = process.env.SARVAM_TTS_MODEL?.trim();
  if (!configured) return SARVAM_TTS_MODEL;

  if ((SARVAM_SUPPORTED_MODELS as readonly string[]).includes(configured)) {
    return configured as SarvamTtsModel;
  }

  throw new Error(
    `Unsupported SARVAM_TTS_MODEL "${configured}". Supported models: ${SARVAM_SUPPORTED_MODELS.join(", ")}.`,
  );
}

/**
 * Safe admin status summary (contains zero API credentials).
 */
export function getSarvamConfigStatus() {
  let model: SarvamTtsModel = SARVAM_TTS_MODEL;
  let configError: string | null = null;
  try {
    model = getSarvamModelName();
  } catch (err) {
    configError = err instanceof Error ? err.message : "Invalid Sarvam TTS model configuration.";
  }

  return {
    configured: isSarvamConfigured() && !configError,
    configError,
    model,
    maxNarrationChars: SARVAM_MAX_NARRATION_CHARS,
    languages: SARVAM_LANGUAGES.map((l) => ({
      code: l.code,
      label: l.label,
      projectLanguage: l.projectLanguage,
    })),
    voices: SARVAM_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      gender: v.gender,
    })),
    formats: [...SARVAM_AUDIO_FORMATS],
  };
}

function redactSecret(message: string, secret?: string): string {
  let clean = message;
  if (secret && secret.length > 3) {
    clean = clean.split(secret).join("[REDACTED]");
  }
  return clean;
}

export function getAudioMimeType(format: AudioContainerFormat): string {
  switch (format) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
  }
}

/**
 * Verifies container file signatures for manually uploaded audio files so
 * renamed HTML/executable/non-audio payloads cannot be uploaded as scene audio.
 */
export function isValidAudioSignature(buffer: Buffer, format: AudioContainerFormat): boolean {
  if (!buffer || buffer.length < 4) return false;

  if (format === "wav") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE"
    );
  }

  if (format === "mp3") {
    // ID3v2 header
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return true;
    }
    // MPEG audio frame sync (11 bits set: 0xFF followed by 0xE0 mask, layer != 00)
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0) {
      return true;
    }
    // Scan first 512 bytes for frame sync (tolerant of small padding/metadata)
    const limit = Math.min(buffer.length - 1, 512);
    for (let i = 0; i < limit; i++) {
      if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0 && (buffer[i + 1] & 0x06) !== 0) {
        return true;
      }
    }
    return false;
  }

  if (format === "ogg") {
    return buffer.subarray(0, 4).toString("ascii") === "OggS";
  }

  if (format === "webm") {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }

  return false;
}

type ParsedMpegFrame = {
  versionBits: number; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  layerBits: number; // 3=L1, 2=L2, 1=L3
  bitrateBps: number;
  sampleRate: number;
  samplesPerFrame: number;
  frameSize: number;
  isMono: boolean;
};

const MPEG_V1_SAMPLERATES = [44100, 48000, 32000] as const;
const MPEG_V2_SAMPLERATES = [22050, 24000, 16000] as const;
const MPEG_V25_SAMPLERATES = [11025, 12000, 8000] as const;

const MPEG_BITRATES_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0] as const;
const MPEG_BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0] as const;
const MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const MPEG_BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0] as const;
const MPEG_BITRATES_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] as const;

function parseMpegAudioFrameHeader(buffer: Buffer, offset: number): ParsedMpegFrame | null {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  const b0 = buffer[offset];
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleRateIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;

  if (versionBits === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || sampleRateIdx === 3) {
    return null;
  }

  const sampleRate =
    versionBits === 3
      ? MPEG_V1_SAMPLERATES[sampleRateIdx]
      : versionBits === 2
        ? MPEG_V2_SAMPLERATES[sampleRateIdx]
        : MPEG_V25_SAMPLERATES[sampleRateIdx];

  let bitrateKbps = 0;
  if (versionBits === 3) {
    bitrateKbps =
      layerBits === 3
        ? MPEG_BITRATES_V1_L1[bitrateIdx]
        : layerBits === 2
          ? MPEG_BITRATES_V1_L2[bitrateIdx]
          : MPEG_BITRATES_V1_L3[bitrateIdx];
  } else {
    bitrateKbps = layerBits === 3 ? MPEG_BITRATES_V2_L1[bitrateIdx] : MPEG_BITRATES_V2_L23[bitrateIdx];
  }

  if (!sampleRate || bitrateKbps <= 0) return null;
  const bitrateBps = bitrateKbps * 1000;

  let samplesPerFrame: number;
  let frameSize: number;
  if (layerBits === 3) {
    samplesPerFrame = 384;
    frameSize = Math.floor((12 * bitrateBps) / sampleRate + padding) * 4;
  } else if (layerBits === 2) {
    samplesPerFrame = 1152;
    frameSize = Math.floor((144 * bitrateBps) / sampleRate) + padding;
  } else {
    samplesPerFrame = versionBits === 3 ? 1152 : 576;
    frameSize = Math.floor(((samplesPerFrame / 8) * bitrateBps) / sampleRate) + padding;
  }

  if (frameSize < 4) return null;

  return {
    versionBits,
    layerBits,
    bitrateBps,
    sampleRate,
    samplesPerFrame,
    frameSize,
    isMono: channelMode === 3,
  };
}

function readVbrTotalFrames(buffer: Buffer, frameStart: number, frame: ParsedMpegFrame): number | null {
  const sideInfoSize = frame.versionBits === 3 ? (frame.isMono ? 17 : 32) : frame.isMono ? 9 : 17;
  const xingOffset = frameStart + 4 + sideInfoSize;
  if (xingOffset + 12 <= buffer.length) {
    const tag = buffer.subarray(xingOffset, xingOffset + 4).toString("ascii");
    if (tag === "Xing" || tag === "Info") {
      const flags = buffer.readUInt32BE(xingOffset + 4);
      if ((flags & 0x01) !== 0) {
        const frames = buffer.readUInt32BE(xingOffset + 8);
        if (frames > 0) return frames;
      }
    }
  }

  const vbriOffset = frameStart + 36;
  if (vbriOffset + 18 <= buffer.length) {
    const tag = buffer.subarray(vbriOffset, vbriOffset + 4).toString("ascii");
    if (tag === "VBRI") {
      const frames = buffer.readUInt32BE(vbriOffset + 14);
      if (frames > 0) return frames;
    }
  }

  return null;
}

function estimateMp3DurationSecFromFrames(buffer: Buffer): { durationSec: number | null; detectedBitrateBps: number | null } {
  let startOffset = 0;
  if (buffer.length >= 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const tagSize =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    const hasFooter = (buffer[5] & 0x10) !== 0 ? 10 : 0;
    const candidate = 10 + tagSize + hasFooter;
    if (candidate > 0 && candidate < buffer.length - 4) {
      startOffset = candidate;
    }
  }

  const scanLimit = Math.min(buffer.length - 4, startOffset + 16_384);
  let firstPos = -1;
  let firstFrame: ParsedMpegFrame | null = null;
  let fallbackBitrateBps: number | null = null;

  for (let pos = startOffset; pos <= scanLimit; pos++) {
    const candidate = parseMpegAudioFrameHeader(buffer, pos);
    if (!candidate) continue;
    if (fallbackBitrateBps === null) {
      fallbackBitrateBps = candidate.bitrateBps;
    }
    const nextOffset = pos + candidate.frameSize;
    if (nextOffset + 4 <= buffer.length) {
      const nextFrame = parseMpegAudioFrameHeader(buffer, nextOffset);
      if (
        nextFrame &&
        nextFrame.versionBits === candidate.versionBits &&
        nextFrame.layerBits === candidate.layerBits
      ) {
        firstPos = pos;
        firstFrame = candidate;
        break;
      }
    }
  }

  if (firstPos < 0 || !firstFrame) {
    return { durationSec: null, detectedBitrateBps: fallbackBitrateBps };
  }

  const vbrFrames = readVbrTotalFrames(buffer, firstPos, firstFrame);
  if (vbrFrames && vbrFrames > 0) {
    return {
      durationSec: (vbrFrames * firstFrame.samplesPerFrame) / firstFrame.sampleRate,
      detectedBitrateBps: firstFrame.bitrateBps,
    };
  }

  let cursor = firstPos;
  let totalSec = 0;
  let frameCount = 0;

  while (cursor + 4 <= buffer.length) {
    // Stop before trailing ID3v1 "TAG" metadata block if present
    if (
      cursor + 128 === buffer.length &&
      buffer[cursor] === 0x54 &&
      buffer[cursor + 1] === 0x41 &&
      buffer[cursor + 2] === 0x47
    ) {
      break;
    }

    const frame = parseMpegAudioFrameHeader(buffer, cursor);
    if (!frame) break;
    if (cursor + frame.frameSize > buffer.length) {
      // Partial trailing frame
      const fraction = (buffer.length - cursor) / frame.frameSize;
      if (fraction > 0.25) {
        totalSec += (frame.samplesPerFrame / frame.sampleRate) * fraction;
        frameCount++;
      }
      break;
    }

    totalSec += frame.samplesPerFrame / frame.sampleRate;
    frameCount++;
    cursor += frame.frameSize;
  }

  if (frameCount >= 2 && totalSec > 0) {
    return { durationSec: totalSec, detectedBitrateBps: firstFrame.bitrateBps };
  }

  return { durationSec: null, detectedBitrateBps: firstFrame.bitrateBps };
}

/**
 * Measures duration in seconds accurately for WAV headers and MPEG MP3 frames
 * (CBR & VBR Xing/Info/VBRI), falling back cleanly to spoken word timing for short stubs.
 */
export function estimateAudioDurationSec(
  buffer: Buffer,
  format: AudioContainerFormat,
  fallbackText?: string,
): number {
  if (format === "wav" && buffer.length >= 44) {
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
      let offset = 12;
      let byteRate = 0;
      let dataSize = 0;

      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkDataStart = offset + 8;

        if (chunkId === "fmt " && chunkDataStart + 16 <= buffer.length) {
          byteRate = buffer.readUInt32LE(chunkDataStart + 8);
        } else if (chunkId === "data") {
          dataSize = Math.min(chunkSize, Math.max(0, buffer.length - chunkDataStart));
          break;
        }

        const nextOffset = chunkDataStart + chunkSize + (chunkSize % 2);
        if (nextOffset <= offset) break;
        offset = nextOffset;
      }

      if (byteRate > 0 && dataSize > 0) {
        return Math.round((dataSize / byteRate) * 10) / 10;
      }
    }
  }

  if (format === "mp3" && buffer.length >= 4) {
    const parsed = estimateMp3DurationSecFromFrames(buffer);
    if (parsed.durationSec !== null && parsed.durationSec > 0) {
      return Math.max(0.1, Math.round(parsed.durationSec * 10) / 10);
    }
    if (parsed.detectedBitrateBps && buffer.length >= 4000) {
      const approxFromHeaderRate = buffer.length / (parsed.detectedBitrateBps / 8);
      if (approxFromHeaderRate >= 0.3) {
        return Math.round(approxFromHeaderRate * 10) / 10;
      }
    }
  }

  // Fallback for OGG / WebM / stub fixtures
  const fallbackWords = fallbackText ? countWords(fallbackText) : 0;
  const approxFromBytes = buffer.length >= 4000 ? buffer.length / 8000 : 0;
  if (approxFromBytes >= 0.3) {
    return Math.round(approxFromBytes * 10) / 10;
  }

  if (fallbackWords > 0) {
    return Math.round(Math.max(1, fallbackWords / 2.5) * 10) / 10;
  }

  return 1.0;
}

/**
 * Validates all parameters before sending a request to Sarvam AI.
 * Ensures no unsupported model/voice/language combinations or invalid narration reach the API.
 */
export function validateSarvamTtsRequest(params: SarvamSpeechParams): ValidatedSarvamTtsRequest {
  const model = getSarvamModelName();

  const text = (params.text ?? "").trim();
  if (!text) {
    throw new Error("Scene narration cannot be empty. Add narration text before generating a voiceover.");
  }
  if (text.length > SARVAM_MAX_NARRATION_CHARS) {
    throw new Error(
      `Narration exceeds Sarvam AI's ${SARVAM_MAX_NARRATION_CHARS.toLocaleString()} character limit (${text.length.toLocaleString()} characters). Split long narration into shorter scenes.`,
    );
  }

  const languageCode = resolveSarvamLanguageCode(params.language ?? "");
  if (!languageCode) {
    throw new Error(
      `Unsupported Sarvam TTS language "${params.language}". Supported languages: ${SARVAM_LANGUAGES.map((l) => `${l.label} (${l.code})`).join(", ")}.`,
    );
  }

  const rawVoice = (params.voice ?? "shubh").trim().toLowerCase();
  if (!SARVAM_VOICE_ID_SET.has(rawVoice)) {
    throw new Error(
      `Voice "${params.voice}" is not supported by Sarvam model ${model}. Choose one of the supported bulbul:v3 voices (for example: shubh, priya, aditya, ritu, kavya).`,
    );
  }

  const format = params.format ?? "mp3";
  if (!(SARVAM_AUDIO_FORMATS as readonly string[]).includes(format)) {
    throw new Error(`Unsupported Sarvam audio format "${format}". Supported formats: ${SARVAM_AUDIO_FORMATS.join(", ")}.`);
  }

  const pace = params.pace ?? 1.0;
  if (!Number.isFinite(pace) || pace < 0.5 || pace > 2.0) {
    throw new Error(`Invalid speaking pace (${pace}). Pace must be between 0.5 and 2.0.`);
  }

  const sampleRate = params.sampleRate ?? 24000;
  if (!(SARVAM_SAMPLE_RATES as readonly number[]).includes(sampleRate)) {
    throw new Error(
      `Unsupported sample rate (${sampleRate} Hz). Supported sample rates: ${SARVAM_SAMPLE_RATES.join(", ")}.`,
    );
  }

  return {
    text,
    languageCode,
    voice: rawVoice,
    model,
    format,
    mimeType: getAudioMimeType(format),
    pace,
    sampleRate,
  };
}

/**
 * Generates scene voiceover speech using the official Sarvam AI Text-to-Speech REST API.
 */
export async function generateSarvamSpeech(params: SarvamSpeechParams): Promise<SarvamSpeechResult> {
  const validated = validateSarvamTtsRequest(params);

  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Sarvam AI API key is not configured on the server. " +
        "Set SARVAM_API_KEY in your .env or server environment variables " +
        "(obtain a key from https://dashboard.sarvam.ai/), or upload an audio file manually.",
    );
  }

  let response: Response;
  try {
    response = await fetch(SARVAM_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        text: validated.text,
        target_language_code: validated.languageCode,
        speaker: validated.voice,
        model: validated.model,
        pace: validated.pace,
        speech_sample_rate: validated.sampleRate,
        output_audio_codec: validated.format,
      }),
      signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Sarvam AI voiceover request timed out. Please try again.");
    }
    const safeMsg = redactSecret(e?.message || "Network error", apiKey);
    throw new Error(`Failed to reach Sarvam AI service: ${safeMsg}`);
  }

  if (!response.ok) {
    let upstreamDetail = "";
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const errJson = (await response.json()) as {
          message?: unknown;
          detail?: unknown;
          error?: { message?: unknown } | string;
        };
        if (typeof errJson?.message === "string") {
          upstreamDetail = errJson.message;
        } else if (typeof errJson?.detail === "string") {
          upstreamDetail = errJson.detail;
        } else if (typeof errJson?.error === "string") {
          upstreamDetail = errJson.error;
        } else if (errJson?.error && typeof errJson.error.message === "string") {
          upstreamDetail = errJson.error.message;
        }
      } else {
        upstreamDetail = (await response.text()).slice(0, 300);
      }
    } catch {
      upstreamDetail = "";
    }

    upstreamDetail = redactSecret(upstreamDetail.trim(), apiKey);

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Invalid or unauthorized Sarvam AI API key. Verify SARVAM_API_KEY in your server environment.",
      );
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after")?.trim();
      throw new Error(
        `Sarvam AI rate limit exceeded. Please wait${retryAfter ? ` ${retryAfter}s` : " a moment"} and try again.`,
      );
    }

    if (response.status === 400 || response.status === 422) {
      throw new Error(
        `Sarvam AI rejected the voiceover request${upstreamDetail ? `: ${upstreamDetail}` : "."}`,
      );
    }

    throw new Error(
      `Sarvam AI service error (HTTP ${response.status})${upstreamDetail ? `: ${upstreamDetail}` : ". Please try again."}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Sarvam AI returned a malformed non-JSON response.");
  }

  const parsed = payload as { request_id?: unknown; audios?: unknown };
  if (!parsed || !Array.isArray(parsed.audios) || typeof parsed.audios[0] !== "string") {
    throw new Error("Sarvam AI returned an invalid audio response (missing audio payload).");
  }

  let rawBase64 = parsed.audios[0].trim();
  const dataUrlIdx = rawBase64.indexOf(";base64,");
  if (dataUrlIdx !== -1) {
    rawBase64 = rawBase64.slice(dataUrlIdx + ";base64,".length).trim();
  }
  rawBase64 = rawBase64.replace(/\s+/g, "");

  if (!rawBase64 || rawBase64.length % 4 === 1 || !/^[A-Za-z0-9+/=_-]+$/.test(rawBase64)) {
    throw new Error("Sarvam AI returned corrupted or empty base64 audio data.");
  }

  const normalizedB64 = rawBase64.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(normalizedB64, "base64");
  if (buffer.length === 0) {
    throw new Error("Sarvam AI returned an empty audio file.");
  }

  const durationSec = estimateAudioDurationSec(buffer, validated.format, validated.text);
  const requestId = typeof parsed.request_id === "string" && parsed.request_id.trim() ? parsed.request_id.trim() : null;

  return {
    buffer,
    format: validated.format,
    mimeType: validated.mimeType,
    model: validated.model,
    voice: validated.voice,
    languageCode: validated.languageCode,
    sampleRate: validated.sampleRate,
    durationSec,
    requestId,
    generatedAt: new Date().toISOString(),
  };
}

