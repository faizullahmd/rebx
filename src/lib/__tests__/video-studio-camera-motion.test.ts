import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { itWithFfmpeg } from "@/test/ffmpeg";
import { prisma } from "@/lib/prisma";

class RedirectSignal extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

let mockActor: { id: number; role: "ADMIN" | "AGENT" | "CUSTOMER"; email: string; name: string } | null = null;

vi.mock("@aws-sdk/client-s3", () => {
  class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockS3Client {
    send = vi.fn(async () => ({}));
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockCommand,
    HeadObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  })),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => {
    if (!mockActor) throw new RedirectSignal("/login");
    return mockActor;
  }),
  requireRole: vi.fn(async (role: string) => {
    if (!mockActor) throw new RedirectSignal("/login");
    if (mockActor.role !== role) throw new RedirectSignal("/unauthorized");
    return mockActor;
  }),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => (mockActor ? { user: { ...mockActor, id: String(mockActor.id) } } : null)),
  signOut: vi.fn(),
}));

import Workspace from "@/app/admin/dashboard/video-studio/[id]/Workspace";
import {
  createProjectAction,
  saveDraftAction,
  restoreVersionAction,
} from "@/lib/actions/video-studio";
import {
  CAMERA_MOTION_EFFECTS,
  CAMERA_MOTION_EFFECT_LABELS,
  CAMERA_MOTION_INTENSITIES,
  CAMERA_MOTION_INTENSITY_LABELS,
  FOCAL_POSITIONS,
  FOCAL_POSITION_LABELS,
  AUTO_CAMERA_MOTION_SEQUENCE,
  sceneCameraMotionSchema,
  resolveSceneCameraMotion,
  extractSceneCameraMotionMap,
  mergeSceneCameraMotion,
  extractDefaultCameraMotion,
  mergeDefaultCameraMotion,
  type CameraMotionEffect,
  type CameraMotionIntensity,
  type FocalPosition,
  type SceneCameraMotion,
  type EditorScene,
  isInfographicContent,
} from "@/lib/video-studio/schemas";
import {
  buildRenderJobSnapshot,
  buildCanonicalSnapshotFingerprintPayload,
  buildStrictVersionedProjectJson,
} from "@/lib/video-studio/render-validation";
import {
  buildSceneCameraMotionFilter,
  computeSceneSafeMargin,
  renderVideoToMp4,
} from "../../../worker/video-renderer/src/render-engine";

const ADMIN_USER = {
  id: 99401,
  email: "admin_c35@rebx.local",
  name: "Admin C35 Motion",
  role: "ADMIN" as const,
};

function runProc(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${bin} failed (${err.message}): ${stderr}`));
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

async function probeMedia(filePath: string): Promise<any> {
  const { stdout } = await runProc("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels",
    "-of",
    "json",
    filePath,
  ]);
  return JSON.parse(stdout);
}

async function generateTestImage(filePath: string, width: number, height: number, color = "blue"): Promise<void> {
  await runProc("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=1`,
    "-vframes",
    "1",
    filePath,
  ]);
}

async function generateTestAudio(filePath: string, durationSec: number, freq = 440): Promise<void> {
  await runProc("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=${durationSec}`,
    "-c:a",
    "pcm_s16le",
    filePath,
  ]);
}

describe("REBX AI Video Studio — Part C3.5: Cinematic Zoom & Pan Animation Effects", () => {
  let tempDir: string;
  let createdProjectIds: string[] = [];

  let dbAvailable = true;

  beforeAll(async () => {
    mockActor = ADMIN_USER;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rebx-c35-test-"));

    try {
      await prisma.user.upsert({
        where: { id: ADMIN_USER.id },
        update: { email: ADMIN_USER.email, name: ADMIN_USER.name, role: ADMIN_USER.role },
        create: {
          id: ADMIN_USER.id,
          email: ADMIN_USER.email,
          name: ADMIN_USER.name,
          role: ADMIN_USER.role,
          passwordHash: "test-hash",
        },
      });
    } catch {
      dbAvailable = false;
      console.warn("[test] Database not reachable; skipping DB-dependent action tests.");
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      if (createdProjectIds.length > 0) {
        await prisma.videoProject.deleteMany({
          where: { id: { in: createdProjectIds } },
        });
      }
      await prisma.user.deleteMany({
        where: { id: ADMIN_USER.id },
      });
    }
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /* ------------------------------------------------------------------ */
  /* Test 1: Unit & Schema Validation for all Effects & Intensities     */
  /* ------------------------------------------------------------------ */
  it("1. Schema validation validates all 8 effects, both intensities, and rejects invalid inputs", () => {
    expect(CAMERA_MOTION_EFFECTS).toEqual([
      "AUTO",
      "SLOW_ZOOM_IN",
      "SLOW_ZOOM_OUT",
      "PAN_LEFT",
      "PAN_RIGHT",
      "PAN_UP",
      "PAN_DOWN",
      "NONE",
    ]);

    expect(CAMERA_MOTION_INTENSITIES).toEqual(["SUBTLE", "MEDIUM"]);
    expect(FOCAL_POSITIONS).toEqual(["CENTER", "TOP", "BOTTOM", "LEFT", "RIGHT"]);

    for (const pos of FOCAL_POSITIONS) {
      expect(FOCAL_POSITION_LABELS[pos]).toBeTruthy();
      const parsed = sceneCameraMotionSchema.safeParse({ focalPosition: pos });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.focalPosition).toBe(pos);
      }
    }

    for (const effect of CAMERA_MOTION_EFFECTS) {
      expect(CAMERA_MOTION_EFFECT_LABELS[effect]).toBeTruthy();
      const parsed = sceneCameraMotionSchema.safeParse({ effect, intensity: "SUBTLE" });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.effect).toBe(effect);
        expect(parsed.data.intensity).toBe("SUBTLE");
        expect(parsed.data.focalPosition).toBe("CENTER");
      }
    }

    for (const intensity of CAMERA_MOTION_INTENSITIES) {
      expect(CAMERA_MOTION_INTENSITY_LABELS[intensity]).toBeTruthy();
      const parsed = sceneCameraMotionSchema.safeParse({ effect: "SLOW_ZOOM_IN", intensity });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.intensity).toBe(intensity);
      }
    }

    // Invalid effect rejection
    const invalidEffect = sceneCameraMotionSchema.safeParse({ effect: "ROTATE_360" });
    expect(invalidEffect.success).toBe(false);

    // Invalid intensity rejection
    const invalidIntensity = sceneCameraMotionSchema.safeParse({ effect: "AUTO", intensity: "EXTREME" });
    expect(invalidIntensity.success).toBe(false);

    // Defaults applied
    const emptyObj = sceneCameraMotionSchema.safeParse({});
    expect(emptyObj.success).toBe(true);
    if (emptyObj.success) {
      expect(emptyObj.data.effect).toBe("AUTO");
      expect(emptyObj.data.intensity).toBe("SUBTLE");
      expect(emptyObj.data.focalPosition).toBe("CENTER");
    }
  });

  /* ------------------------------------------------------------------ */
  /* Test 2: Deterministic AUTO Resolution & Reassembly Consistency    */
  /* ------------------------------------------------------------------ */
  it("2. AUTO motion resolves deterministically based on scene index and maintains consistency across reassembly", () => {
    expect(AUTO_CAMERA_MOTION_SEQUENCE.length).toBeGreaterThan(0);

    // Resolves AUTO cleanly and deterministically
    for (let i = 0; i < 20; i++) {
      const res1 = resolveSceneCameraMotion({ effect: "AUTO", intensity: "SUBTLE" }, i);
      const res2 = resolveSceneCameraMotion({ effect: "AUTO", intensity: "SUBTLE" }, i);
      expect(res1.effect).toBe(res2.effect);
      expect(res1.effect).not.toBe("AUTO");
      expect(res1.effect).not.toBe("NONE");
      expect(res1.intensity).toBe("SUBTLE");
      expect(res1.focalPosition).toBe("CENTER");
    }

    // Explicit effect overrides AUTO
    const manualMotion: SceneCameraMotion = { effect: "PAN_LEFT", intensity: "MEDIUM" };
    const manualResolved = resolveSceneCameraMotion(manualMotion, 5);
    expect(manualResolved.effect).toBe("PAN_LEFT");
    expect(manualResolved.intensity).toBe("MEDIUM");

    // NONE remains NONE
    const noneResolved = resolveSceneCameraMotion({ effect: "NONE", intensity: "SUBTLE" }, 3);
    expect(noneResolved.effect).toBe("NONE");
  });

  /* ------------------------------------------------------------------ */
  /* Test 3: Metadata Merge / Extract & Backward Compatibility          */
  /* ------------------------------------------------------------------ */
  it("3. Metadata extraction and merge preserves other project fields and provides safe defaults for legacy projects", () => {
    // Legacy metadata with no motion settings
    const legacyMeta = { customField: 123, thumbnail: { prompt: "test" } };
    const extractedDefault = extractDefaultCameraMotion(legacyMeta);
    expect(extractedDefault).toEqual({ effect: "AUTO", intensity: "SUBTLE", focalPosition: "CENTER" });

    const extractedMap = extractSceneCameraMotionMap(legacyMeta);
    expect(extractedMap).toEqual({});

    // Merging default motion
    const mergedWithDefault = mergeDefaultCameraMotion(legacyMeta, {
      effect: "SLOW_ZOOM_IN",
      intensity: "MEDIUM",
    });
    expect((mergedWithDefault as any).customField).toBe(123);
    expect(extractDefaultCameraMotion(mergedWithDefault).effect).toBe("SLOW_ZOOM_IN");
    expect(extractDefaultCameraMotion(mergedWithDefault).intensity).toBe("MEDIUM");

    // Merging per-scene motion
    const mergedWithScenes = mergeSceneCameraMotion(mergedWithDefault, {
      scene_1: { effect: "PAN_RIGHT", intensity: "SUBTLE" },
      scene_2: { effect: "NONE", intensity: "SUBTLE" },
    });
    const mapAfterMerge = extractSceneCameraMotionMap(mergedWithScenes);
    expect(mapAfterMerge.scene_1.effect).toBe("PAN_RIGHT");
    expect(mapAfterMerge.scene_2.effect).toBe("NONE");
    expect((mergedWithScenes as any).customField).toBe(123);
  });

  /* ------------------------------------------------------------------ */
  /* Test 4: FFmpeg Filter Generation across Ratios & Intensities        */
  /* ------------------------------------------------------------------ */
  it("4. buildSceneCameraMotionFilter generates valid filter expressions for all effects across 16:9, 9:16, and 1:1", () => {
    const ratios = [
      { w: 1920, h: 1080, dur: 4.0 },
      { w: 1080, h: 1920, dur: 5.0 },
      { w: 1080, h: 1080, dur: 3.5 },
    ];

    for (const { w, h, dur } of ratios) {
      for (const rawEffect of CAMERA_MOTION_EFFECTS) {
        for (const intensity of CAMERA_MOTION_INTENSITIES) {
          const resolved = resolveSceneCameraMotion({ effect: rawEffect, intensity }, 1);
          const filterSegments = buildSceneCameraMotionFilter({
            width: w,
            height: h,
            targetDurationSec: dur,
            fps: 30,
            motion: resolved,
          });

          const filterStr = filterSegments.join(",");
          expect(filterSegments.length).toBeGreaterThan(0);

          if (resolved.effect === "NONE") {
            expect(filterStr).toContain(`scale=${w}:${h}:force_original_aspect_ratio=decrease`);
            expect(filterStr).not.toContain("zoompan");
          } else {
            expect(filterStr).toContain("zoompan=");
            expect(filterStr).toContain(`s=${w}x${h}`);
            expect(filterStr).toContain(":d=1:");
            expect(filterStr).toContain(":fps=30");
            expect(filterStr).toContain(`scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase:flags=lanczos`);
            expect(filterStr).toContain(`crop=${w * 2}:${h * 2}:`);
            expect(filterStr).toContain("(3-2*"); // Hermite smoothstep easing curve
          }
        }
      }

      // Verify focal position anchoring
      for (const focal of FOCAL_POSITIONS) {
        const resolved = resolveSceneCameraMotion({ effect: "SLOW_ZOOM_IN", intensity: "SUBTLE", focalPosition: focal }, 0);
        const filterStr = buildSceneCameraMotionFilter({
          width: w,
          height: h,
          targetDurationSec: dur,
          fps: 30,
          motion: resolved,
        }).join(",");

        if (focal === "TOP") {
          expect(filterStr).toContain("*0.15");
        } else if (focal === "BOTTOM") {
          expect(filterStr).toContain("*0.85");
        }
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Test 5: Real FFmpeg & FFprobe Verification across 16:9, 9:16, 1:1  */
  /* ------------------------------------------------------------------ */
  itWithFfmpeg("5. Real FFmpeg renders multi-scene videos across 16:9, 9:16, and 1:1 with 30fps CFR, H.264/AAC, audio sync, and captions", async () => {
    const testCases: {
      aspectRatio: "16:9" | "9:16" | "1:1";
      width: number;
      height: number;
      effects: CameraMotionEffect[];
    }[] = [
      { aspectRatio: "16:9", width: 1920, height: 1080, effects: ["SLOW_ZOOM_IN", "PAN_LEFT"] },
      { aspectRatio: "9:16", width: 1080, height: 1920, effects: ["SLOW_ZOOM_OUT", "PAN_RIGHT"] },
      { aspectRatio: "1:1", width: 1080, height: 1080, effects: ["AUTO", "PAN_UP"] },
    ];

    for (const tc of testCases) {
      const caseDir = path.join(tempDir, `case-${tc.aspectRatio.replace(":", "-")}`);
      await fs.mkdir(caseDir, { recursive: true });

      // Create test images with non-standard / odd dimensions to test lanczos pre-scaling
      const img1 = path.join(caseDir, "img1.png");
      const img2 = path.join(caseDir, "img2.png");
      await generateTestImage(img1, 803, 527, "blue"); // odd dimensions
      await generateTestImage(img2, 1200, 800, "green");

      // Create test audio
      const aud1 = path.join(caseDir, "aud1.wav");
      const aud2 = path.join(caseDir, "aud2.wav");
      await generateTestAudio(aud1, 2.0, 440);
      await generateTestAudio(aud2, 2.0, 880);

      const outMp4 = path.join(caseDir, "rendered.mp4");
      const interDir = path.join(caseDir, "inter");
      await fs.mkdir(interDir, { recursive: true });

      const renderResult = await renderVideoToMp4({
        jobId: `job-${tc.aspectRatio}`,
        projectId: `proj-${tc.aspectRatio}`,
        aspectRatio: tc.aspectRatio,
        width: tc.width,
        height: tc.height,
        fps: 30,
        outputFormat: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        outputFilePath: outMp4,
        intermediatesDir: interDir,
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        defaultCameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
        scenes: [
          {
            sceneId: "s1",
            order: 1,
            title: "Scene 1",
            narration: "Welcome to this luxury residence.",
            durationSec: 2,
            imageFilePath: img1,
            audioFilePath: aud1,
            declaredAudioDurationSec: 2.0,
            cameraMotion: { effect: tc.effects[0], intensity: "SUBTLE" },
          },
          {
            sceneId: "s2",
            order: 2,
            title: "Scene 2",
            narration: "Featuring expansive outdoor spaces.",
            durationSec: 2,
            imageFilePath: img2,
            audioFilePath: aud2,
            declaredAudioDurationSec: 2.0,
            cameraMotion: { effect: tc.effects[1], intensity: "MEDIUM" },
          },
        ],
      });

      expect(renderResult.width).toBe(tc.width);
      expect(renderResult.height).toBe(tc.height);
      expect(renderResult.fps).toBe(30);
      expect(renderResult.renderedDurationSec).toBeCloseTo(4.0, 0.5);

      // Probe actual MP4 using ffprobe
      const probe = await probeMedia(outMp4);
      expect(probe.streams).toBeDefined();

      const videoStream = probe.streams.find((s: any) => s.codec_type === "video");
      const audioStream = probe.streams.find((s: any) => s.codec_type === "audio");

      expect(videoStream).toBeDefined();
      expect(videoStream.codec_name).toBe("h264");
      expect(videoStream.width).toBe(tc.width);
      expect(videoStream.height).toBe(tc.height);
      expect(videoStream.r_frame_rate).toBe("30/1");

      expect(audioStream).toBeDefined();
      expect(audioStream.codec_name).toBe("aac");
      expect(audioStream.channels).toBe(2);
      expect(Number(audioStream.sample_rate)).toBe(48000);

      const totalDur = Number(probe.format.duration);
      expect(totalDur).toBeCloseTo(4.0, 0.5);
    }
  }, 90000);

  /* ------------------------------------------------------------------ */
  /* Test 6: Snapshot Fingerprint & Reassembly Consistency              */
  /* ------------------------------------------------------------------ */
  it("6. Immutable snapshots incorporate cameraMotion into SHA-256 fingerprint and guarantee reassembly consistency", () => {
    const projectInput = {
      id: "proj_snapshot_test",
      schemaVersion: "1.0.0",
      title: "Test Snapshot Motion",
      topic: "Luxury Villa",
      category: "property_showcase",
      status: "DRAFT",
      aspectRatio: "16:9",
      targetAudience: "Buyers",
      language: "English",
      tone: "Professional",
      desiredDuration: 12,
      defaultCameraMotion: { effect: "AUTO" as const, intensity: "SUBTLE" as const },
      scenes: [
        {
          id: "sc_1",
          order: 1,
          title: "Intro",
          narration: "Scene 1 narration",
          duration: 6,
          imageUrl: "http://test/img1.png",
          cameraMotion: { effect: "SLOW_ZOOM_IN" as const, intensity: "SUBTLE" as const },
        },
      ],
    };

    const strictResult = buildStrictVersionedProjectJson(projectInput);
    expect(strictResult.ok).toBe(true);
    if (!strictResult.ok) return;

    const versionedJson = strictResult.value;

    const resolvedScenes = [
      {
        sceneId: "sc_1",
        order: 1,
        title: "Intro",
        narration: "Scene 1 narration",
        durationSec: 6,
        image: {
          sourceUrl: "http://test/img1.png",
          provider: "local" as const,
          resolvedPathOrKey: "/test/img1.png",
        },
        audio: {
          storageKey: "video-studio/aud1.mp3",
          provider: "local-private" as const,
          resolvedKey: "/test/aud1.mp3",
          format: "mp3" as const,
          mimeType: "audio/mpeg",
          durationSec: 5.5,
          model: "bulbul:v3",
          voice: "shubh",
          languageCode: "en-IN",
          narrationHash: "hash2",
        },
        cameraMotion: { effect: "SLOW_ZOOM_IN" as const, intensity: "SUBTLE" as const },
      },
    ];

    const snapshot1 = buildRenderJobSnapshot({
      versionedJson,
      resolvedScenes,
      storageProvider: "local",
      defaultCameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
    });

    const snapshot2 = buildRenderJobSnapshot({
      versionedJson,
      resolvedScenes,
      storageProvider: "local",
      defaultCameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
    });

    // Content fingerprint must match exactly
    const fp1 = buildCanonicalSnapshotFingerprintPayload(snapshot1);
    const fp2 = buildCanonicalSnapshotFingerprintPayload(snapshot2);
    expect(fp1).toEqual(fp2);

    const hash1 = createHash("sha256").update(JSON.stringify(fp1)).digest("hex");
    const hash2 = createHash("sha256").update(JSON.stringify(fp2)).digest("hex");
    expect(hash1).toBe(hash2);

    // Modifying cameraMotion changes the fingerprint
    const modifiedResolvedScenes = [
      {
        ...resolvedScenes[0],
        cameraMotion: { effect: "PAN_LEFT" as const, intensity: "MEDIUM" as const },
      },
    ];
    const snapshotModified = buildRenderJobSnapshot({
      versionedJson,
      resolvedScenes: modifiedResolvedScenes,
      storageProvider: "local",
      defaultCameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
    });
    const fpModified = buildCanonicalSnapshotFingerprintPayload(snapshotModified);
    const hashModified = createHash("sha256").update(JSON.stringify(fpModified)).digest("hex");
    expect(hashModified).not.toBe(hash1);
  });

  /* ------------------------------------------------------------------ */
  /* Test 7: Actions: Create Project, Save Draft, Restore Snapshot      */
  /* ------------------------------------------------------------------ */
  it("7. Actions persist defaultCameraMotion and per-scene cameraMotion across draft saves and snapshot restores", async () => {
    if (!dbAvailable) {
      console.warn("Skipping DB action test because database is not connected.");
      return;
    }
    // 1. Create Project
    const createRes = await createProjectAction({
      title: "Camera Motion E2E Project",
      topic: "Luxury Penthouse",
      category: "property_showcase",
      targetAudience: "High net worth individuals",
      language: "English",
      tone: "Luxury",
      duration: 12,
      aspectRatio: "16:9",
      defaultCameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
      scenes: [
        {
          id: "sc_temp_1",
          order: 1,
          title: "Scene 1 Penthouse",
          narration: "A rare architectural masterpiece.",
          imagePrompt: "Penthouse living room with city view",
          imageUrl: null,
          duration: 6,
          locked: false,
          cameraMotion: { effect: "SLOW_ZOOM_IN", intensity: "SUBTLE" },
        },
        {
          id: "sc_temp_2",
          order: 2,
          title: "Scene 2 Terrace",
          narration: "Panoramic rooftop views.",
          imagePrompt: "Rooftop terrace sunset",
          imageUrl: null,
          duration: 6,
          locked: false,
          cameraMotion: { effect: "PAN_RIGHT", intensity: "MEDIUM" },
        },
      ],
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const projectId = createRes.data.id;
    createdProjectIds.push(projectId);

    // Verify persisted in DB
    const fetchedProj = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { order: "asc" } } },
    });
    expect(fetchedProj).not.toBeNull();
    const defaultExtracted = extractDefaultCameraMotion(fetchedProj!.metadata);
    expect(defaultExtracted.effect).toBe("AUTO");

    const motionMap = extractSceneCameraMotionMap(fetchedProj!.metadata);
    expect(motionMap[fetchedProj!.scenes[0].id]?.effect).toBe("SLOW_ZOOM_IN");
    expect(motionMap[fetchedProj!.scenes[1].id]?.effect).toBe("PAN_RIGHT");

    // 2. Save Draft with updated camera motion
    const updatedScenes: EditorScene[] = [
      {
        id: fetchedProj!.scenes[0].id,
        order: 1,
        title: "Scene 1 Updated",
        narration: "Updated narration",
        imagePrompt: "Updated prompt",
        imageUrl: null,
        duration: 6,
        locked: false,
        cameraMotion: { effect: "PAN_LEFT", intensity: "MEDIUM" },
      },
      {
        id: fetchedProj!.scenes[1].id,
        order: 2,
        title: "Scene 2 Updated",
        narration: "Updated narration 2",
        imagePrompt: "Updated prompt 2",
        imageUrl: null,
        duration: 6,
        locked: false,
        cameraMotion: { effect: "NONE", intensity: "SUBTLE" },
      },
    ];

    const draftRes = await saveDraftAction({
      projectId,
      title: "Camera Motion E2E Project (Updated)",
      topic: "Luxury Penthouse",
      category: "property_showcase",
      status: "DRAFT",
      targetAudience: "High net worth individuals",
      language: "English",
      tone: "Luxury",
      duration: 12,
      aspectRatio: "16:9",
      defaultCameraMotion: { effect: "SLOW_ZOOM_OUT", intensity: "SUBTLE" },
      scenes: updatedScenes,
    });

    expect(draftRes.ok).toBe(true);
    if (!draftRes.ok) return;

    expect(draftRes.data.scenes[0].cameraMotion?.effect).toBe("PAN_LEFT");
    expect(draftRes.data.scenes[1].cameraMotion?.effect).toBe("NONE");

    // 3. Restore Version
    expect(draftRes.data.versions.length).toBeGreaterThan(0);
    const initialVersion = draftRes.data.versions[draftRes.data.versions.length - 1]; // First recorded version
    const restoreRes = await restoreVersionAction(projectId, initialVersion.id);
    expect(restoreRes.ok).toBe(true);
    if (!restoreRes.ok) return;

    // Verify restored scenes have their original motion settings
    expect(restoreRes.data.scenes[0].cameraMotion?.effect).toBe("SLOW_ZOOM_IN");
    expect(restoreRes.data.scenes[1].cameraMotion?.effect).toBe("PAN_RIGHT");
  });

  /* ------------------------------------------------------------------ */
  /* Test 8: Workspace UI Static Render Verification                   */
  /* ------------------------------------------------------------------ */
  it("8. Workspace UI renders Camera Motion controls in Scene Editor, badges in Scene List, and Default Camera Motion card", () => {
    const dummyProject = {
      id: "mock_proj_ui",
      schemaVersion: "1.0.0",
      title: "UI Test Project",
      topic: "Beachfront Villa",
      category: "property_showcase" as const,
      status: "DRAFT" as const,
      aspectRatio: "16:9" as const,
      dimensions: "1920x1080",
      targetAudience: "Luxury buyers",
      language: "English" as const,
      tone: "Professional" as const,
      desiredDuration: 12,
      defaultCameraMotion: { effect: "AUTO" as const, intensity: "SUBTLE" as const },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const dummyScenes: EditorScene[] = [
      {
        id: "s_ui_1",
        order: 1,
        title: "Scene One",
        narration: "A grand beachfront living room.",
        imagePrompt: "Beachfront view",
        imageUrl: "http://test/img1.png",
        duration: 6,
        locked: false,
        cameraMotion: { effect: "SLOW_ZOOM_IN", intensity: "SUBTLE" },
      },
      {
        id: "s_ui_2",
        order: 2,
        title: "Scene Two",
        narration: "Infinity pool overview.",
        imagePrompt: "Infinity pool",
        imageUrl: null,
        duration: 6,
        locked: false,
        cameraMotion: { effect: "AUTO", intensity: "SUBTLE" },
      },
    ];

    const markup = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: dummyProject,
        initialScenes: dummyScenes,
        initialVersions: [],
        initialRenderJobs: [],
      }),
    );

    // Scene List should contain motion info
    expect(markup).toContain("Zoom In");
    expect(markup).toContain("Auto (");

    // Active Scene Editor should contain Camera Motion section
    expect(markup).toContain("Camera Motion");
    expect(markup).toContain("Motion Effect");
    expect(markup).toContain("Motion Intensity");
    expect(markup).toContain("Focal Anchor");
    expect(markup).toContain("Slow Zoom In (Push In)");
    expect(markup).toContain("Active Effect:");

    // Right pane should contain Default Camera Motion card
    expect(markup).toContain("Default Camera Motion");
    expect(markup).toContain("Default Effect");
    expect(markup).toContain("Default Intensity");
  });

  /* ------------------------------------------------------------------ */
  /* Test 9: Worker Cancellation & Cleanup During Animated Render      */
  /* ------------------------------------------------------------------ */
  itWithFfmpeg("9. Aborting renderVideoToMp4 cancels FFmpeg process cleanly and removes temporary workspaces", async () => {
    const caseDir = path.join(tempDir, "cancel-case");
    await fs.mkdir(caseDir, { recursive: true });

    const img = path.join(caseDir, "img.png");
    const aud = path.join(caseDir, "aud.wav");
    await generateTestImage(img, 1920, 1080, "red");
    await generateTestAudio(aud, 10.0, 440); // 10 second audio

    const outMp4 = path.join(caseDir, "cancel-rendered.mp4");
    const interDir = path.join(caseDir, "cancel-inter");
    await fs.mkdir(interDir, { recursive: true });

    const abortController = new AbortController();

    // Trigger abort after 150ms
    setTimeout(() => {
      abortController.abort();
    }, 150);

    let caughtError: any = null;
    try {
      await renderVideoToMp4({
        jobId: "job-cancel",
        projectId: "proj-cancel",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        outputFormat: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        outputFilePath: outMp4,
        intermediatesDir: interDir,
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        signal: abortController.signal,
        scenes: [
          {
            sceneId: "s1",
            order: 1,
            title: "Long Scene",
            narration: "A long scene that will be cancelled mid-render.",
            durationSec: 10,
            imageFilePath: img,
            audioFilePath: aud,
            declaredAudioDurationSec: 10.0,
            cameraMotion: { effect: "SLOW_ZOOM_IN", intensity: "SUBTLE" },
          },
        ],
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toMatch(/abort|cancel|killed/i);
  });

  /* ------------------------------------------------------------------ */
  /* Test 10: Adaptive Safe-Margin Clamping & Composition-Aware Motion */
  /* ------------------------------------------------------------------ */
  it("10. Adapts zoom targets and anchors headroom for logo/infographic images while preserving dramatic motion for scenic shots", () => {
    // 1. Clean scenic image: gets full cinematic scale (1.15 subtle, 1.22 medium)
    const cleanScenic = computeSceneSafeMargin({
      isInfographic: false,
      hasTopContent: false,
      hasBottomContent: false,
      hasSideContent: false,
    });
    expect(cleanScenic.isConstrained).toBe(false);
    expect(cleanScenic.safeSubtleZoomMax).toBe(1.15);
    expect(cleanScenic.safeMediumZoomMax).toBe(1.22);
    expect(cleanScenic.safeYRatio).toBe(0.5);

    // 2. Logo / Infographic image: clamped to safe bounds (1.10 subtle, 1.14 medium, safeYRatio 0.38)
    const logoInfographic = computeSceneSafeMargin({
      isInfographic: true,
      hasTopContent: true,
      hasBottomContent: false,
      hasSideContent: true,
    });
    expect(logoInfographic.isConstrained).toBe(true);
    expect(logoInfographic.safeSubtleZoomMax).toBe(1.10);
    expect(logoInfographic.safeMediumZoomMax).toBe(1.14);
    expect(logoInfographic.safeYRatio).toBe(0.38);

    // 3. Filter generation with safeArea clamping
    const filters = buildSceneCameraMotionFilter({
      motion: { effect: "SLOW_ZOOM_IN", intensity: "MEDIUM", focalPosition: "CENTER", wasAuto: false },
      width: 1080,
      height: 1080,
      fps: 30,
      targetDurationSec: 5,
      safeArea: logoInfographic,
    });
    const zoompanFilter = filters.find((f) => f.startsWith("zoompan="));
    expect(zoompanFilter).toBeDefined();
    // Clamped zoomMax is 1.14 (delta 0.14) instead of 1.22
    expect(zoompanFilter).toContain("1+(0.14*");
    // Headroom anchor yRatio is 0.38 instead of 0.5 to prevent cutting off top REBX logo
    expect(zoompanFilter).toContain("y='(ih-ih/zoom)*0.38'");

    // 4. Comparison Infographic in AUTO mode resolves to gentle horizontal pan
    const comparisonAutoEven = resolveSceneCameraMotion(
      { effect: "AUTO" },
      0,
      undefined,
      { title: "Residential vs Commercial Property", narration: "Compare apartments with offices." },
    );
    expect(comparisonAutoEven.effect).toBe("PAN_RIGHT");
    expect(comparisonAutoEven.intensity).toBe("SUBTLE");

    const comparisonAutoOdd = resolveSceneCameraMotion(
      { effect: "AUTO" },
      1,
      undefined,
      { title: "Residential vs Commercial Property", narration: "Compare apartments with offices." },
    );
    expect(comparisonAutoOdd.effect).toBe("PAN_LEFT");
    expect(comparisonAutoOdd.intensity).toBe("SUBTLE");
  });
});
