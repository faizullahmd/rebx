import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import {
  buildSceneCaptionCues,
  chunkNarrationIntoCaptionPhrases,
  escapeAssDialogueLine,
  escapeFfmpegFilterPathValue,
  formatAssTimestamp,
  generateSceneAssSubtitleContent,
  resolveCaptionFontName,
  splitNarrationIntoSentences,
  wrapPhraseToBalancedLines,
} from "../../../worker/video-renderer/src/captions";
import {
  checkFfmpegEnvironment,
  type FfmpegEnvironmentStatus,
} from "../../../worker/video-renderer/src/ffmpeg";
import { renderVideoToMp4 } from "../../../worker/video-renderer/src/render-engine";

const tempDirsToCleanup: string[] = [];
let ffmpegEnv: FfmpegEnvironmentStatus;
let ffmpegBin: string;
let ffprobeBin: string;

async function createTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  tempDirsToCleanup.push(dir);
  return dir;
}

function execBinary(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, shell: false, timeout: 20_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${file} failed: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}

async function synthesizeSolidImage(params: {
  outPath: string;
  width: number;
  height: number;
  color: string;
}): Promise<void> {
  await execBinary(ffmpegBin, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${params.color}:s=${params.width}x${params.height}:d=1`,
    "-frames:v",
    "1",
    "-y",
    params.outPath,
  ]);
}

async function synthesizeToneWav(params: {
  outPath: string;
  durationSec: number;
  frequencyHz?: number;
}): Promise<void> {
  await execBinary(ffmpegBin, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${params.frequencyHz ?? 440}:sample_rate=24000:duration=${params.durationSec}`,
    "-af",
    "volume=0.25",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-y",
    params.outPath,
  ]);
}

async function extractRawRgbFrame(params: {
  mp4Path: string;
  timestampSec: number;
  width: number;
  height: number;
  rawOutPath: string;
}): Promise<Buffer> {
  await execBinary(ffmpegBin, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    params.timestampSec.toFixed(2),
    "-i",
    params.mp4Path,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-y",
    params.rawOutPath,
  ]);
  const buf = await fs.readFile(params.rawOutPath);
  expect(buf.byteLength).toBe(params.width * params.height * 3);
  return buf;
}

function analyzeFrameRegion(params: {
  rgb: Buffer;
  frameWidth: number;
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
}): {
  whiteTextPixels: number;
  blackOutlinePixels: number;
  slice: Buffer;
} {
  let whiteTextPixels = 0;
  let blackOutlinePixels = 0;
  const rows: Buffer[] = [];
  const stride = params.frameWidth * 3;

  for (let y = params.yStart; y < params.yEnd; y++) {
    const rowStart = y * stride + params.xStart * 3;
    const rowEnd = y * stride + params.xEnd * 3;
    rows.push(params.rgb.subarray(rowStart, rowEnd));

    for (let x = params.xStart; x < params.xEnd; x++) {
      const idx = y * stride + x * 3;
      const r = params.rgb[idx];
      const g = params.rgb[idx + 1];
      const b = params.rgb[idx + 2];

      if (r >= 210 && g >= 210 && b >= 210) {
        whiteTextPixels++;
      } else if (r <= 25 && g <= 25 && b <= 25) {
        blackOutlinePixels++;
      }
    }
  }

  return {
    whiteTextPixels,
    blackOutlinePixels,
    slice: Buffer.concat(rows),
  };
}

describeWithFfmpeg("REBX AI Video Studio - Burned-in Spoken Captions (Option 1)", () => {
  beforeAll(async () => {
    ffmpegEnv = await checkFfmpegEnvironment();
    if (
      !ffmpegEnv.readyForPartC32Rendering ||
      !ffmpegEnv.ffmpeg.executablePath ||
      !ffmpegEnv.ffprobe.executablePath
    ) {
      throw new Error("Local FFmpeg 9.0.1 and FFprobe 9.0.1 must be available for caption tests.");
    }
    ffmpegBin = ffmpegEnv.ffmpeg.executablePath;
    ffprobeBin = ffmpegEnv.ffprobe.executablePath;
  });

  afterAll(async () => {
    for (const dir of tempDirsToCleanup.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("1. Splits sentences cleanly while preserving abbreviations, Rupee numbers, and Indic dandas", () => {
    const sentences = splitNarrationIntoSentences(
      "Rs. 1,00,000 fee applies e.g. in money suits! Check Section 7 vs. 2.5% slab.\nअपना पहला घर जांचें। फिर निवेश करें।",
    );

    expect(sentences).toEqual([
      "Rs. 1,00,000 fee applies e.g. in money suits!",
      "Check Section 7 vs. 2.5% slab.",
      "अपना पहला घर जांचें।",
      "फिर निवेश करें।",
    ]);
  });

  it("2. Chunks and wraps narration into balanced 1–2 line phrases matching all three aspect ratios", () => {
    const narration =
      "For example, a suit seeking recovery of money can be filed based on valuation.";

    const squareChunks = chunkNarrationIntoCaptionPhrases(narration, "1:1");
    expect(squareChunks.length).toBe(2);
    expect(squareChunks[0].lines).toHaveLength(2);
    expect(squareChunks[0].lines[0]).toBe("For example, a suit seeking");
    expect(squareChunks[0].lines[1]).toBe("recovery of money can");
    expect(squareChunks[1].lines.join(" ")).toBe("be filed based on valuation.");

    for (const ratio of ["16:9", "9:16", "1:1"] as const) {
      const phrases = chunkNarrationIntoCaptionPhrases(
        "Planning to buy your first home? Before making one of the biggest investments of your life, here are five important things you must check!",
        ratio,
      );
      expect(phrases.length).toBeGreaterThanOrEqual(2);
      for (const phrase of phrases) {
        expect(phrase.lines.length).toBeGreaterThanOrEqual(1);
        expect(phrase.lines.length).toBeLessThanOrEqual(2);
        expect(phrase.lines.every((l) => l.trim().length > 0)).toBe(true);
      }
    }

    expect(chunkNarrationIntoCaptionPhrases("   \n\t  ", "1:1")).toEqual([]);

    const longTokenWrapped = wrapPhraseToBalancedLines(
      "Supercalifragilisticexpialidociousword property",
      24,
    );
    expect(longTokenWrapped.length).toBeGreaterThanOrEqual(1);
    expect(longTokenWrapped.length).toBeLessThanOrEqual(2);
  });

  it("3. Allocates monotonic speech-synced cue timestamps bounded by probedAudioDurationSec", () => {
    const cues = buildSceneCaptionCues({
      narration:
        "For example, a suit seeking recovery of money. Always verify title papers carefully.",
      targetDurationSec: 6,
      probedAudioDurationSec: 3.4,
      aspectRatio: "1:1",
    });

    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].startSec).toBeCloseTo(0.04, 2);
    // Must end inside active voiceover (<= ~3.4s), well before the 6s silent tail
    expect(cues[cues.length - 1].endSec).toBeLessThanOrEqual(3.4);
    expect(cues[cues.length - 1].endSec).toBeGreaterThanOrEqual(3.2);

    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].endSec).toBeGreaterThan(cues[i].startSec);
      if (i > 0) {
        expect(cues[i].startSec).toBe(cues[i - 1].endSec);
      }
    }

    // Scene without optional audio falls back smoothly across targetDurationSec
    const silentSceneCues = buildSceneCaptionCues({
      narration: "Visual walkthrough without narration track.",
      targetDurationSec: 4,
      probedAudioDurationSec: null,
      aspectRatio: "16:9",
    });
    expect(silentSceneCues.length).toBeGreaterThanOrEqual(1);
    expect(silentSceneCues[silentSceneCues.length - 1].endSec).toBeGreaterThan(3.5);
    expect(silentSceneCues[silentSceneCues.length - 1].endSec).toBeLessThanOrEqual(3.98);
  });

  it("4. Generates valid UTF-8 BOM ASS subtitles with bold white outline style, safe escaping, and Indic fonts", () => {
    expect(formatAssTimestamp(65.43)).toBe("0:01:05.43");
    expect(escapeAssDialogueLine("{tag}\\Ntest}")).toContain("\\{tag\\}");
    expect(escapeAssDialogueLine("C:\\new\\path")).not.toMatch(/\\n/);

    expect(resolveCaptionFontName({ language: "English", text: "Hello", platform: "win32" })).toBe(
      "Arial",
    );
    expect(resolveCaptionFontName({ language: "Hindi", text: "नमस्ते", platform: "win32" })).toBe(
      "Nirmala UI",
    );
    expect(
      resolveCaptionFontName({ language: "English", text: "हिंदी शब्द", platform: "win32" }),
    ).toBe("Nirmala UI");

    const cues = buildSceneCaptionCues({
      narration: "Amount is ₹1,00,000 {verified}.",
      targetDurationSec: 4,
      probedAudioDurationSec: 2.5,
      aspectRatio: "1:1",
    });

    const ass = generateSceneAssSubtitleContent({
      cues,
      aspectRatio: "1:1",
      language: "English",
      platform: "win32",
    });

    expect(ass.startsWith("\uFEFF")).toBe(true);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("ScaledBorderAndShadow: yes");
    // Bold (-1), BorderStyle=1 (outline, no opaque box), white text, black outline, Alignment=2
    expect(ass).toContain("Style: Caption,Arial,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,-1,0,0,0,100,100,0,0,1,");
    expect(ass).toContain(",2,64,64,62,1");
    expect(ass).toContain("Dialogue: 0,");
    expect(ass).toContain("\\{verified\\}");

    const escaped = escapeFfmpegFilterPathValue(
      "C:\\tmp\\cap 'quote' [dir]\\scene_001_captions.ass",
    );
    expect(escaped).toContain("C\\\\:/tmp/");
    expect(escaped).toContain("\\[dir\\]");
  });

  it("5. Burns synchronized phrase-by-phrase captions into real 1:1, 16:9 (Hindi), and 9:16 MP4 videos and removes temp ASS files", async () => {
    const baseWorkDir = await createTempDir("rebx-captions-real");
    // Deliberately include spaces, apostrophe, and brackets inside workspace paths to verify FFmpeg filter escaping
    const workDir = path.join(baseWorkDir, "cap 'quote' [dir] (p)");
    await fs.mkdir(workDir, { recursive: true });

    const img1 = path.join(workDir, "blue.png");
    const wavShort = path.join(workDir, "voice_3_2s.wav");
    await synthesizeSolidImage({ outPath: img1, width: 1080, height: 1080, color: "0x1E3A5F" });
    await synthesizeToneWav({ outPath: wavShort, durationSec: 3.2, frequencyHz: 440 });

    const mp4Square = path.join(workDir, "square_captioned.mp4");
    const intermSquare = path.join(workDir, "interm-square");

    const res1 = await renderVideoToMp4({
      jobId: "job-cap-square",
      projectId: "proj-cap-square",
      language: "English",
      aspectRatio: "1:1",
      width: 1080,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      watermark: false,
      scenes: [
        {
          sceneId: "s1",
          order: 1,
          title: "Court Fee Example",
          narration:
            "For example, a suit seeking recovery of money can be filed based on valuation.",
          durationSec: 5,
          imageFilePath: img1,
          audioFilePath: wavShort,
        },
      ],
      outputFilePath: mp4Square,
      intermediatesDir: intermSquare,
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });

    expect(res1.plan.scenes[0].captionCues.length).toBeGreaterThanOrEqual(2);
    expect(res1.intermediatesCleaned).toBe(true);
    await expect(fs.access(intermSquare)).rejects.toThrow();

    // Extract frames at cue 1 (~0.6s), cue 2 (~2.4s), and silent padding tail (~4.5s)
    const f1 = await extractRawRgbFrame({
      mp4Path: mp4Square,
      timestampSec: 0.6,
      width: 1080,
      height: 1080,
      rawOutPath: path.join(workDir, "f1.rgb"),
    });
    const f2 = await extractRawRgbFrame({
      mp4Path: mp4Square,
      timestampSec: 2.5,
      width: 1080,
      height: 1080,
      rawOutPath: path.join(workDir, "f2.rgb"),
    });
    const fTail = await extractRawRgbFrame({
      mp4Path: mp4Square,
      timestampSec: 4.5,
      width: 1080,
      height: 1080,
      rawOutPath: path.join(workDir, "f_tail.rgb"),
    });

    // Top background area stays clean scene blue (zero white caption overflow)
    const topBand = analyzeFrameRegion({
      rgb: f1,
      frameWidth: 1080,
      xStart: 100,
      xEnd: 980,
      yStart: 40,
      yEnd: 200,
    });
    expect(topBand.whiteTextPixels).toBe(0);

    // Lower-center band at 0.6s & 2.5s has white caption letters + black stroke outline
    const capBand1 = analyzeFrameRegion({
      rgb: f1,
      frameWidth: 1080,
      xStart: 80,
      xEnd: 1000,
      yStart: 820,
      yEnd: 1060,
    });
    const capBand2 = analyzeFrameRegion({
      rgb: f2,
      frameWidth: 1080,
      xStart: 80,
      xEnd: 1000,
      yStart: 820,
      yEnd: 1060,
    });
    const capBandTail = analyzeFrameRegion({
      rgb: fTail,
      frameWidth: 1080,
      xStart: 80,
      xEnd: 1000,
      yStart: 820,
      yEnd: 1060,
    });

    expect(capBand1.whiteTextPixels).toBeGreaterThan(500);
    expect(capBand1.blackOutlinePixels).toBeGreaterThan(500);
    expect(capBand2.whiteTextPixels).toBeGreaterThan(500);
    expect(capBand2.blackOutlinePixels).toBeGreaterThan(500);

    // Frame 1 and Frame 2 render distinct spoken phrases
    expect(capBand1.slice.equals(capBand2.slice)).toBe(false);

    // During silent padding after audio finishes (4.5s > 3.2s), caption disappears cleanly
    expect(capBandTail.whiteTextPixels).toBe(0);

    // Also verify 16:9 Hindi multi-scene with crossfade + 9:16 portrait render cleanly with captions visible
    const wav2s = path.join(workDir, "voice_2s.wav");
    await synthesizeToneWav({ outPath: wav2s, durationSec: 2.0, frequencyHz: 520 });

    const mp4Hindi16x9 = path.join(workDir, "hindi_16x9.mp4");
    const resHi = await renderVideoToMp4({
      jobId: "job-cap-hi",
      projectId: "proj-cap-hi",
      language: "Hindi",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      transition: "crossfade",
      transitionDurationSec: 0.4,
      scenes: [
        {
          sceneId: "h1",
          order: 1,
          title: "Hindi Intro",
          narration: "अपना पहला घर खरीदने से पहले ये पाँच ज़रूरी बातें जाँच लें।",
          durationSec: 2,
          imageFilePath: img1,
          audioFilePath: wav2s,
        },
        {
          sceneId: "h2",
          order: 2,
          title: "Hindi Step Two",
          narration: "बिल्डर का रेरा रजिस्ट्रेशन और ज़मीन के कागज़ ज़रूर देखें।",
          durationSec: 2,
          imageFilePath: img1,
          audioFilePath: wav2s,
        },
      ],
      outputFilePath: mp4Hindi16x9,
      intermediatesDir: path.join(workDir, "interm-hi"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(resHi.width).toBe(1920);
    expect(resHi.height).toBe(1080);
    expect(resHi.plan.scenes[0].captionCues.length).toBeGreaterThanOrEqual(1);

    const fHi = await extractRawRgbFrame({
      mp4Path: mp4Hindi16x9,
      timestampSec: 0.5,
      width: 1920,
      height: 1080,
      rawOutPath: path.join(workDir, "f_hi.rgb"),
    });
    const capBandHi = analyzeFrameRegion({
      rgb: fHi,
      frameWidth: 1920,
      xStart: 200,
      xEnd: 1720,
      yStart: 820,
      yEnd: 1060,
    });
    expect(capBandHi.whiteTextPixels).toBeGreaterThan(500);
    expect(capBandHi.blackOutlinePixels).toBeGreaterThan(500);

    const mp4Portrait = path.join(workDir, "portrait_9x16.mp4");
    const res9x16 = await renderVideoToMp4({
      jobId: "job-cap-9x16",
      projectId: "proj-cap-9x16",
      language: "English",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      watermark: false,
      scenes: [
        {
          sceneId: "p1",
          order: 1,
          title: "Vertical Tour",
          narration: "Tour spacious sky villas in Hyderabad.",
          durationSec: 2,
          imageFilePath: img1,
          audioFilePath: wav2s,
        },
      ],
      outputFilePath: mp4Portrait,
      intermediatesDir: path.join(workDir, "interm-9x16"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(res9x16.width).toBe(1080);
    expect(res9x16.height).toBe(1920);

    const f9x16 = await extractRawRgbFrame({
      mp4Path: mp4Portrait,
      timestampSec: 0.5,
      width: 1080,
      height: 1920,
      rawOutPath: path.join(workDir, "f_9x16.rgb"),
    });
    const capBand9x16 = analyzeFrameRegion({
      rgb: f9x16,
      frameWidth: 1080,
      xStart: 80,
      xEnd: 1000,
      yStart: 1520,
      yEnd: 1800,
    });
    expect(capBand9x16.whiteTextPixels).toBeGreaterThan(400);
    expect(capBand9x16.blackOutlinePixels).toBeGreaterThan(400);
  }, 60_000);
});

