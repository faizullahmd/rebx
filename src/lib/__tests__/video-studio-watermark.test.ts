import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_WATERMARK_CONFIG,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  WATERMARK_SIZES,
  WATERMARK_SIZE_LABELS,
  calculateWatermarkLayout,
  extractWatermarkConfig,
  mergeWatermarkConfig,
  watermarkConfigSchema,
  type WatermarkConfig,
} from "@/lib/video-studio/schemas";
import {
  buildStrictVersionedProjectJson,
  buildRenderJobSnapshot,
  buildCanonicalSnapshotFingerprintPayload,
} from "@/lib/video-studio/render-validation";
import {
  buildAssemblyFfmpegArgs,
  resolveWatermarkLogoPath,
  type RenderExecutionPlan,
} from "../../../worker/video-renderer/src/render-engine";

const execFileAsync = promisify(execFile);

describe("REBX AI Video Studio — C3.6 Brand Watermark Overlay", () => {
  let testTempDir: string;
  let sampleLogoPath: string;

  beforeAll(async () => {
    testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rebx-watermark-test-"));
    sampleLogoPath = resolveWatermarkLogoPath() || path.resolve(process.cwd(), "public/logo-watermark.png");
    if (!fsSync.existsSync(sampleLogoPath)) {
      sampleLogoPath = path.resolve(process.cwd(), "public/logo.png");
    }
  });

  afterAll(async () => {
    await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {});
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Schemas, Defaults & Helpers                                             */
  /* -------------------------------------------------------------------------- */

  describe("Schemas & Metadata Helpers", () => {
    it("provides the canonical default watermark configuration", () => {
      expect(DEFAULT_WATERMARK_CONFIG).toEqual({
        enabled: true,
        position: "TOP_RIGHT",
        size: "MEDIUM",
        opacity: 0.92,
      });
    });

    it("validates valid watermark configurations", () => {
      const parsed = watermarkConfigSchema.safeParse({
        enabled: true,
        position: "TOP_LEFT",
        size: "LARGE",
        opacity: 0.85,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.position).toBe("TOP_LEFT");
        expect(parsed.data.size).toBe("LARGE");
        expect(parsed.data.opacity).toBe(0.85);
      }
    });

    it("rejects invalid watermark positions, sizes, or out-of-range opacities", () => {
      expect(
        watermarkConfigSchema.safeParse({ position: "CENTER" }).success,
      ).toBe(false);
      expect(
        watermarkConfigSchema.safeParse({ size: "HUGE" }).success,
      ).toBe(false);
      expect(
        watermarkConfigSchema.safeParse({ opacity: 1.5 }).success,
      ).toBe(false);
      expect(
        watermarkConfigSchema.safeParse({ opacity: 0.05 }).success,
      ).toBe(false);
    });

    it("extractWatermarkConfig defaults to enabled when metadata is missing (backward compatibility)", () => {
      expect(extractWatermarkConfig(null)).toEqual(DEFAULT_WATERMARK_CONFIG);
      expect(extractWatermarkConfig({})).toEqual(DEFAULT_WATERMARK_CONFIG);
      expect(extractWatermarkConfig({ watermark: null })).toEqual(DEFAULT_WATERMARK_CONFIG);

      const custom: WatermarkConfig = {
        enabled: false,
        position: "BOTTOM_LEFT",
        size: "SMALL",
        opacity: 0.7,
      };
      expect(extractWatermarkConfig({ watermark: custom })).toEqual(custom);
    });

    it("mergeWatermarkConfig properly sets and unsets watermark in metadata", () => {
      const custom: WatermarkConfig = {
        enabled: true,
        position: "TOP_LEFT",
        size: "LARGE",
        opacity: 0.95,
      };
      const merged = mergeWatermarkConfig({ otherField: 123 }, custom);
      expect(merged).toEqual({ otherField: 123, watermark: custom });

      const removed = mergeWatermarkConfig(merged, null);
      expect(removed.watermark).toBeUndefined();
      expect(removed.otherField).toBe(123);
    });

    it("has complete position and size label mappings", () => {
      for (const pos of WATERMARK_POSITIONS) {
        expect(WATERMARK_POSITION_LABELS[pos]).toBeTruthy();
      }
      for (const sz of WATERMARK_SIZES) {
        expect(WATERMARK_SIZE_LABELS[sz]).toBeTruthy();
      }
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Responsive Layout Calculations                                         */
  /* -------------------------------------------------------------------------- */

  describe("Layout Calculations Across Aspect Ratios", () => {
    it("calculates balanced medium layout for landscape 16:9 (1920x1080)", () => {
      const layout = calculateWatermarkLayout(1920, 1080, "16:9", DEFAULT_WATERMARK_CONFIG);
      expect(layout.enabled).toBe(true);
      // ~14% width of 1920 = 269 -> even 270
      expect(layout.logoWidth).toBe(270);
      expect(layout.logoHeight).toBe(52); // 270 / 5.207 ~ 51.85 -> 52
      expect(layout.logoWidth % 2).toBe(0);
      expect(layout.logoHeight % 2).toBe(0);
      // Top-right corner margins
      expect(layout.x).toBe(1920 - 48 - 270); // 1602
      expect(layout.y).toBe(38);
      expect(layout.opacity).toBe(0.92);
    });

    it("calculates mobile-friendly layout for vertical 9:16 (1080x1920) with punchhole safety", () => {
      const layout = calculateWatermarkLayout(1080, 1920, "9:16", DEFAULT_WATERMARK_CONFIG);
      expect(layout.enabled).toBe(true);
      // 22% width of 1080 = 238
      expect(layout.logoWidth).toBe(238);
      expect(layout.logoHeight).toBe(46);
      expect(layout.logoWidth % 2).toBe(0);
      expect(layout.logoHeight % 2).toBe(0);
      // Safe headroom margin on mobile: 4.5% of 1920 = ~86px
      expect(layout.y).toBe(86);
      expect(layout.x).toBe(1080 - 43 - 238); // 799
    });

    it("calculates balanced layout for square 1:1 (1080x1080)", () => {
      const layout = calculateWatermarkLayout(1080, 1080, "1:1", DEFAULT_WATERMARK_CONFIG);
      expect(layout.enabled).toBe(true);
      // 18% width of 1080 = 194
      expect(layout.logoWidth).toBe(194);
      expect(layout.logoHeight).toBe(38);
      expect(layout.x).toBe(1080 - 38 - 194); // 848
      expect(layout.y).toBe(38);
    });

    it("supports all 4 corners accurately", () => {
      const w = 1920;
      const h = 1080;
      const marginX = 48;
      const marginY = 38;
      const logoW = 270;
      const logoH = 52;

      const tr = calculateWatermarkLayout(w, h, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        position: "TOP_RIGHT",
      });
      expect(tr.x).toBe(w - marginX - logoW);
      expect(tr.y).toBe(marginY);

      const tl = calculateWatermarkLayout(w, h, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        position: "TOP_LEFT",
      });
      expect(tl.x).toBe(marginX);
      expect(tl.y).toBe(marginY);

      const br = calculateWatermarkLayout(w, h, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        position: "BOTTOM_RIGHT",
      });
      expect(br.x).toBe(w - marginX - logoW);
      expect(br.y).toBe(h - marginY - logoH);

      const bl = calculateWatermarkLayout(w, h, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        position: "BOTTOM_LEFT",
      });
      expect(bl.x).toBe(marginX);
      expect(bl.y).toBe(h - marginY - logoH);
    });

    it("handles SMALL and LARGE size presets proportionally", () => {
      const small = calculateWatermarkLayout(1920, 1080, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        size: "SMALL",
      });
      const med = calculateWatermarkLayout(1920, 1080, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        size: "MEDIUM",
      });
      const large = calculateWatermarkLayout(1920, 1080, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        size: "LARGE",
      });

      expect(small.logoWidth).toBeLessThan(med.logoWidth);
      expect(med.logoWidth).toBeLessThan(large.logoWidth);
    });

    it("returns zero dimensions when disabled", () => {
      const disabled = calculateWatermarkLayout(1920, 1080, "16:9", {
        ...DEFAULT_WATERMARK_CONFIG,
        enabled: false,
      });
      expect(disabled.enabled).toBe(false);
      expect(disabled.logoWidth).toBe(0);
      expect(disabled.logoHeight).toBe(0);
    });

    it("deterministically resolves logo-watermark.png as the primary watermark asset", () => {
      const resolved = resolveWatermarkLogoPath();
      expect(resolved).toBeTruthy();
      expect(resolved?.endsWith("logo-watermark.png")).toBe(true);
      expect(fsSync.existsSync(resolved!)).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Snapshot, Validation & Deduplication Persistence                        */
  /* -------------------------------------------------------------------------- */

  describe("Snapshot & Fingerprint Integration", () => {
    it("preserves watermark in versioned JSON and render snapshots", () => {
      const projectInput = {
        id: "proj_wm_1",
        title: "Watermark Test Project",
        category: "market_update",
        status: "DRAFT",
        aspectRatio: "16:9",
        language: "English",
        tone: "Professional",
        desiredDuration: 10,
        watermark: {
          enabled: true,
          position: "TOP_RIGHT" as const,
          size: "LARGE" as const,
          opacity: 0.9,
        },
        scenes: [
          {
            id: "sc_1",
            order: 1,
            title: "Scene 1",
            narration: "Welcome to REBX property insights.",
            imageUrl: "/uploads/img1.png",
            duration: 10,
          },
        ],
      };

      const strictJson = buildStrictVersionedProjectJson(projectInput);
      expect(strictJson.ok).toBe(true);
      if (!strictJson.ok) return;

      expect(strictJson.value.videoSettings.watermark).toEqual({
        enabled: true,
        position: "TOP_RIGHT",
        size: "LARGE",
        opacity: 0.9,
      });

      const snapshot = buildRenderJobSnapshot({
        versionedJson: strictJson.value,
        resolvedScenes: [
          {
            sceneId: "sc_1",
            order: 1,
            title: "Scene 1",
            narration: "Welcome to REBX property insights.",
            durationSec: 10,
            image: { sourceUrl: "/uploads/img1.png", provider: "local", resolvedPathOrKey: "/path/img1.png" },
            audio: {
              storageKey: "aud1.mp3",
              provider: "local-private",
              resolvedKey: "/path/aud1.mp3",
              format: "mp3",
              mimeType: "audio/mpeg",
              durationSec: 9.5,
              model: "bulbul:v3",
              voice: "shubh",
              languageCode: "en-IN",
              narrationHash: "h123",
            },
          },
        ],
        storageProvider: "local",
      });

      expect(snapshot.renderSettings.watermark).toEqual({
        enabled: true,
        position: "TOP_RIGHT",
        size: "LARGE",
        opacity: 0.9,
      });

      // Fingerprint should reflect watermark settings
      const fp1 = buildCanonicalSnapshotFingerprintPayload(snapshot);
      const snapshotDisabled = {
        ...snapshot,
        renderSettings: {
          ...snapshot.renderSettings,
          watermark: { ...DEFAULT_WATERMARK_CONFIG, enabled: false },
        },
      };
      const fp2 = buildCanonicalSnapshotFingerprintPayload(snapshotDisabled);
      expect(fp1).not.toBe(fp2);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. FFmpeg Stage 2 Assembly Argument Generation                             */
  /* -------------------------------------------------------------------------- */

  describe("FFmpeg Assembly Command Generation", () => {
    it("adds logo input and overlays watermark onto assembled video canvas when enabled", () => {
      const mockPlan: RenderExecutionPlan = {
        jobId: "job_wm_1",
        projectId: "proj_wm_1",
        language: "en-IN",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        transition: "cut",
        transitionDurationSec: 0,
        scenes: [],
        boundaries: [],
        nominalTotalDurationSec: 10,
        expectedFinalDurationSec: 10,
        intermediatesDir: "/tmp/intermediates",
        outputFilePath: "/tmp/out.mp4",
        watermark: DEFAULT_WATERMARK_CONFIG,
        watermarkLayout: calculateWatermarkLayout(1920, 1080, "16:9", DEFAULT_WATERMARK_CONFIG),
        watermarkLogoPath: sampleLogoPath,
      };

      const args = buildAssemblyFfmpegArgs({
        plan: mockPlan,
        intermediatePaths: ["/tmp/scene1.mkv", "/tmp/scene2.mkv"],
        tempMp4OutputPath: "/tmp/final.mp4",
      });

      // Logo should be input index 2 (after inputs 0 and 1)
      const inputIndices = args.reduce<number[]>((acc, cur, idx) => {
        if (cur === "-i") acc.push(idx + 1);
        return acc;
      }, []);
      expect(inputIndices.length).toBe(3);
      expect(args[inputIndices[2]]).toBe(sampleLogoPath);

      // Filter complex should route assembled scenes through [v_assembled] and overlay [wm]
      const filterComplexIdx = args.indexOf("-filter_complex");
      expect(filterComplexIdx).toBeGreaterThan(-1);
      const filterStr = args[filterComplexIdx + 1];

      expect(filterStr).toContain("[vconcat]");
      expect(filterStr).toContain("[v_assembled]");
      expect(filterStr).toContain("[2:v]scale=270:52:flags=lanczos,format=rgba,colorchannelmixer=aa=0.92[wm]");
      expect(filterStr).toContain("[v_assembled][wm]overlay=x=1602:y=38:format=auto,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]");
    });

    it("omits logo input and overlays when watermark is disabled", () => {
      const mockPlan: RenderExecutionPlan = {
        jobId: "job_wm_2",
        projectId: "proj_wm_2",
        language: "en-IN",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        transition: "cut",
        transitionDurationSec: 0,
        scenes: [],
        boundaries: [],
        nominalTotalDurationSec: 10,
        expectedFinalDurationSec: 10,
        intermediatesDir: "/tmp/intermediates",
        outputFilePath: "/tmp/out.mp4",
        watermark: { ...DEFAULT_WATERMARK_CONFIG, enabled: false },
        watermarkLayout: calculateWatermarkLayout(1920, 1080, "16:9", {
          ...DEFAULT_WATERMARK_CONFIG,
          enabled: false,
        }),
        watermarkLogoPath: sampleLogoPath,
      };

      const args = buildAssemblyFfmpegArgs({
        plan: mockPlan,
        intermediatePaths: ["/tmp/scene1.mkv", "/tmp/scene2.mkv"],
        tempMp4OutputPath: "/tmp/final.mp4",
      });

      // Exactly 2 inputs (no watermark input)
      const inputIndices = args.reduce<number[]>((acc, cur, idx) => {
        if (cur === "-i") acc.push(idx + 1);
        return acc;
      }, []);
      expect(inputIndices.length).toBe(2);

      const filterComplexIdx = args.indexOf("-filter_complex");
      const filterStr = args[filterComplexIdx + 1];
      expect(filterStr).not.toContain("[v_assembled]");
      expect(filterStr).not.toContain("[wm]");
      expect(filterStr).toContain("[vout]");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Real FFmpeg Video Render & Alpha Verification across all 3 Ratios       */
  /* -------------------------------------------------------------------------- */

  describe("Real FFmpeg Render & Alpha Verification", () => {
    it("renders stationary REBX logo watermark without black box or color distortion", async () => {
      const hasLogo = fsSync.existsSync(sampleLogoPath);
      expect(hasLogo).toBe(true);
      if (!hasLogo) return;

      const outVideoPath = path.join(testTempDir, "real_watermark_test.mp4");
      const testFrameStart = path.join(testTempDir, "frame_start.png");
      const testFrameMid = path.join(testTempDir, "frame_mid.png");
      const testFrameEnd = path.join(testTempDir, "frame_end.png");

      const layout = calculateWatermarkLayout(1080, 1080, "1:1", DEFAULT_WATERMARK_CONFIG);

      // Synthesize a 3-second test video with camera motion simulation (changing background color)
      // and overlay the actual REBX logo with the exact Stage 2 filter chain
      const ffmpegArgs = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=1080x1080:rate=30:duration=2.5",
        "-i",
        sampleLogoPath,
        "-filter_complex",
        `[1:v]scale=${layout.logoWidth}:${layout.logoHeight}:flags=lanczos,format=rgba,colorchannelmixer=aa=0.92[wm];` +
          `[0:v][wm]overlay=x=${layout.x}:y=${layout.y}:format=auto,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]`,
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        outVideoPath,
      ];

      await execFileAsync("ffmpeg", ffmpegArgs);
      expect(fsSync.existsSync(outVideoPath)).toBe(true);

      // Extract frames at start (0.2s), mid (1.2s), and end (2.2s)
      await execFileAsync("ffmpeg", ["-y", "-ss", "0.2", "-i", outVideoPath, "-frames:v", "1", testFrameStart]);
      await execFileAsync("ffmpeg", ["-y", "-ss", "1.2", "-i", outVideoPath, "-frames:v", "1", testFrameMid]);
      await execFileAsync("ffmpeg", ["-y", "-ss", "2.2", "-i", outVideoPath, "-frames:v", "1", testFrameEnd]);

      expect(fsSync.existsSync(testFrameStart)).toBe(true);
      expect(fsSync.existsSync(testFrameMid)).toBe(true);
      expect(fsSync.existsSync(testFrameEnd)).toBe(true);

      // Probe raw pixels in the watermark region across all frames
      // Logo is at x=848..1042, y=38..75
      // Inspect pixel data via ffmpeg crop
      const inspectBox = async (framePath: string) => {
        const rawBox = path.join(testTempDir, `crop_${path.basename(framePath)}.raw`);
        await execFileAsync("ffmpeg", [
          "-y",
          "-i",
          framePath,
          "-vf",
          `crop=${layout.logoWidth}:${layout.logoHeight}:${layout.x}:${layout.y},format=rgba`,
          "-f",
          "rawvideo",
          rawBox,
        ]);
        const buf = await fs.readFile(rawBox);
        let greenCount = 0;
        let whiteCount = 0;
        for (let i = 0; i < buf.length; i += 4) {
          const r = buf[i];
          const g = buf[i + 1];
          const b = buf[i + 2];
          // REBX bright green symbol has high G and lower R/B (around #69D836)
          if (g > 150 && g > r * 1.3 && g > b * 1.3) {
            greenCount++;
          }
          // White letters have high R, G, B
          if (r > 200 && g > 200 && b > 200) {
            whiteCount++;
          }
        }
        return { greenCount, whiteCount };
      };

      const startPix = await inspectBox(testFrameStart);
      const midPix = await inspectBox(testFrameMid);
      const endPix = await inspectBox(testFrameEnd);

      // Logo green symbol & white text must be present in all frames
      expect(startPix.greenCount).toBeGreaterThan(100);
      expect(startPix.whiteCount).toBeGreaterThan(300);

      expect(midPix.greenCount).toBeGreaterThan(100);
      expect(midPix.whiteCount).toBeGreaterThan(300);

      expect(endPix.greenCount).toBeGreaterThan(100);
      expect(endPix.whiteCount).toBeGreaterThan(300);

      // Verify stationary placement: the number of symbol & wordmark pixels within the exact coordinates
      // must remain virtually identical across the entire video duration (no drift, no jumping)
      expect(Math.abs(startPix.greenCount - midPix.greenCount)).toBeLessThanOrEqual(5);
      expect(Math.abs(midPix.greenCount - endPix.greenCount)).toBeLessThanOrEqual(5);
      expect(Math.abs(startPix.whiteCount - midPix.whiteCount)).toBeLessThanOrEqual(15);
    });
  });
});

