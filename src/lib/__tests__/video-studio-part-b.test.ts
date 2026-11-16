import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

class RedirectSignal extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

let mockActor: { id: number; role: "ADMIN" | "AGENT" | "CUSTOMER"; email: string; name: string } | null = null;

const { mockS3Send } = vi.hoisted(() => ({
  mockS3Send: vi.fn(async (_cmd: unknown) => ({})),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockGetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockDeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockS3Client {
    send = mockS3Send;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  }),
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

import {
  checkSarvamStatusAction,
  createProjectAction,
  deleteProjectAction,
  deleteSceneAudioAction,
  duplicateProjectAction,
  generateSceneVoiceoverAction,
  restoreVersionAction,
  saveDraftAction,
  syncProjectAudioTimingAction,
  uploadSceneAudioAction,
} from "@/lib/actions/video-studio";
import { getProjectVersions, getProjectWithScenes } from "@/lib/data/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX, uploadPrivateStudioAsset } from "@/lib/video-studio/deps";
import { estimateAudioDurationSec } from "@/lib/video-studio/sarvam";
import { buildVersionedProjectJson } from "@/lib/video-studio/script-utils";
import { GET as audioRouteGet } from "@/app/api/admin/video-studio/audio/route";

const ADMIN_USER = {
  id: 950001,
  role: "ADMIN" as const,
  email: "video-studio-admin95@example.com",
  name: "Studio Admin Part B",
};

const CUSTOMER_USER = {
  id: 950002,
  role: "CUSTOMER" as const,
  email: "video-studio-cust95@example.com",
  name: "Studio Customer Part B",
};

const createdProjectIds: string[] = [];
const localPrivateKeys: string[] = [];
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

/** Builds a valid tiny WAV PCM buffer of the requested duration in seconds. */
function makeWavBuffer(durationSec = 1): Buffer {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const dataSize = Math.round(byteRate * durationSec);
  const buf = Buffer.alloc(44 + dataSize, 0x80);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

/** Builds a valid tiny ID3v2-tagged MP3 test payload. */
function makeMp3Buffer(tag = "v1"): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const payload = Buffer.from(`rebx-sarvam-mp3-${tag}`, "utf8");
  return Buffer.concat([header, frame, payload]);
}

async function privateFileExists(storageKey: string): Promise<boolean> {
  if (!storageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) return false;
  const filename = storageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
  try {
    await fs.access(path.join(process.cwd(), "storage", "video-studio", filename));
    return true;
  } catch {
    return false;
  }
}

async function readLocalPrivateFile(storageKey: string): Promise<Buffer> {
  const filename = storageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
  return fs.readFile(path.join(process.cwd(), "storage", "video-studio", filename));
}

async function cleanup() {
  const projects = await prisma.videoProject.findMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
    select: { metadata: true },
  });

  for (const p of projects) {
    const meta = p.metadata as { sceneAudio?: Record<string, { storageKey?: string }> } | null;
    if (meta?.sceneAudio) {
      for (const a of Object.values(meta.sceneAudio)) {
        if (a?.storageKey?.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
          localPrivateKeys.push(a.storageKey);
        }
      }
    }
  }

  await prisma.videoProject.deleteMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
  });

  for (const key of new Set(localPrivateKeys)) {
    if (key.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      const filename = key.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", filename)).catch(() => {});
    }
  }
}

describe("REBX AI Video Studio - Phase 3 Part B: Sarvam AI Voiceover Integration", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.createMany({
      data: [
        { id: ADMIN_USER.id, name: ADMIN_USER.name, email: ADMIN_USER.email, role: "ADMIN", passwordHash: "x" },
        { id: CUSTOMER_USER.id, name: CUSTOMER_USER.name, email: CUSTOMER_USER.email, role: "CUSTOMER", passwordHash: "x" },
      ],
    });
  });

  beforeEach(() => {
    mockActor = ADMIN_USER;
    process.env = { ...originalEnv, STORAGE_PROVIDER: "local" };
    mockS3Send.mockReset();
    mockS3Send.mockImplementation(async () => ({}));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  afterAll(cleanup);

  it("1. Handles missing SARVAM_API_KEY gracefully without exposing credentials", async () => {
    delete process.env.SARVAM_API_KEY;

    const status = await checkSarvamStatusAction();
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.configured).toBe(false);
      expect(status.data.model).toBe("bulbul:v3");
      expect(JSON.stringify(status.data)).not.toContain("SARVAM_API_KEY");
    }

    const proj = await createProjectAction({
      title: "Missing Key Voiceover Project",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Intro",
          narration: "Welcome to Tellapur luxury apartments.",
          imagePrompt: "Modern facade",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    createdProjectIds.push(proj.data.id);

    const scene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: proj.data.id } });
    const genRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: scene.narration,
      language: "English",
      voice: "shubh",
      format: "mp3",
    });

    expect(genRes.ok).toBe(false);
    if (!genRes.ok) {
      expect(genRes.error).toMatch(/SARVAM_API_KEY/);
      expect(genRes.error).toMatch(/upload an audio file manually/i);
    }
  });

  it("2. Validates narration length, voice, language, and model before calling Sarvam API", async () => {
    process.env.SARVAM_API_KEY = "sk_test_never_leak_999";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const proj = await createProjectAction({
      title: "Validation Voiceover Project",
      category: "market_update",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Scene 1",
          narration: "Initial text",
          imagePrompt: "Skyline",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    createdProjectIds.push(proj.data.id);
    const scene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: proj.data.id } });

    // Empty narration
    const emptyRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: "   ",
      language: "en-IN",
      voice: "shubh",
      format: "mp3",
    });
    expect(emptyRes.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Narration > 2500 characters
    const longRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: "a".repeat(2501),
      language: "en-IN",
      voice: "shubh",
      format: "mp3",
    });
    expect(longRes.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Unsupported legacy/unknown speaker
    const badVoiceRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: "Valid narration",
      language: "en-IN",
      voice: "meera",
      format: "mp3",
    });
    expect(badVoiceRes.ok).toBe(false);
    if (!badVoiceRes.ok) {
      expect(badVoiceRes.error).toMatch(/not supported by Sarvam model/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // Unsupported language
    const badLangRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: "Valid narration",
      language: "fr-FR",
      voice: "shubh",
      format: "mp3",
    });
    expect(badLangRes.ok).toBe(false);
    if (!badLangRes.ok) {
      expect(badLangRes.error).toMatch(/Unsupported Sarvam TTS language/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // Unsupported configured model
    process.env.SARVAM_TTS_MODEL = "bulbul:v99";
    const badModelRes = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: "Valid narration",
      language: "en-IN",
      voice: "shubh",
      format: "mp3",
    });
    expect(badModelRes.ok).toBe(false);
    if (!badModelRes.ok) {
      expect(badModelRes.error).toMatch(/Unsupported SARVAM_TTS_MODEL/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("3. Handles Sarvam API errors, rate limits, timeouts, invalid payloads, and secret redaction", async () => {
    const secret = "sk_sarvam_ultra_secret_token_42";
    process.env.SARVAM_API_KEY = secret;

    const proj = await createProjectAction({
      title: "Error Handling Project",
      category: "buyer_tips",
      sourceType: "CUSTOM_SCRIPT",
      language: "Hindi",
      tone: "Informative",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Tip 1",
          narration: "Always verify RERA registration before paying token money.",
          imagePrompt: "RERA document check",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    createdProjectIds.push(proj.data.id);
    const scene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: proj.data.id } });

    const baseInput = {
      projectId: proj.data.id,
      sceneId: scene.id,
      narration: scene.narration,
      language: "Hindi",
      voice: "priya",
      format: "mp3" as const,
    };

    // 401 unauthorized + verifies secret is never leaked back
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: `Bad key ${secret}` }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const unauthRes = await generateSceneVoiceoverAction(baseInput);
    expect(unauthRes.ok).toBe(false);
    if (!unauthRes.ok) {
      expect(unauthRes.error).toMatch(/Invalid or unauthorized Sarvam AI API key/);
      expect(unauthRes.error).not.toContain(secret);
    }

    // 429 rate limit
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Too many requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "15" },
      }),
    ) as unknown as typeof fetch;

    const rateRes = await generateSceneVoiceoverAction(baseInput);
    expect(rateRes.ok).toBe(false);
    if (!rateRes.ok) {
      expect(rateRes.error).toMatch(/rate limit exceeded.*15s/i);
    }

    // 500 server error with key echoed upstream -> redacted
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: `Upstream error for ${secret}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const err500 = await generateSceneVoiceoverAction(baseInput);
    expect(err500.ok).toBe(false);
    if (!err500.ok) {
      expect(err500.error).toMatch(/HTTP 500/);
      expect(err500.error).not.toContain(secret);
    }

    // Request timeout
    global.fetch = vi.fn(async () => {
      const e = new Error("The operation timed out.");
      e.name = "TimeoutError";
      throw e;
    }) as unknown as typeof fetch;

    const timeoutRes = await generateSceneVoiceoverAction(baseInput);
    expect(timeoutRes.ok).toBe(false);
    if (!timeoutRes.ok) {
      expect(timeoutRes.error).toMatch(/timed out/i);
    }

    // Invalid / missing audios response
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req_bad", audios: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const badPayload = await generateSceneVoiceoverAction(baseInput);
    expect(badPayload.ok).toBe(false);
    if (!badPayload.ok) {
      expect(badPayload.error).toMatch(/missing audio payload/i);
    }
  });

  it("4. Generates voiceover from mocked Sarvam response, persists metadata privately, never overwrites narration, and preserves previous audio on regeneration failure", async () => {
    process.env.SARVAM_API_KEY = "sk_sarvam_mock_key_ok";
    const mp3V1 = makeMp3Buffer("gen_v1");

    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({
        text: "Updated spoken script for preview",
        target_language_code: "te-IN",
        speaker: "priya",
        model: "bulbul:v3",
        pace: 1.0,
        speech_sample_rate: 24000,
        output_audio_codec: "mp3",
      });
      const headers = init?.headers as Record<string, string>;
      expect(headers["api-subscription-key"]).toBe("sk_sarvam_mock_key_ok");

      return new Response(
        JSON.stringify({
          request_id: "req_sarvam_101",
          audios: [mp3V1.toString("base64")],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const originalNarration = "Original saved DB narration";
    const proj = await createProjectAction({
      title: "Hyderabad Villa Voiceover",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "Telugu",
      tone: "Luxury",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Villa Entrance",
          narration: originalNarration,
          imagePrompt: "Luxury gatehouse",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    createdProjectIds.push(proj.data.id);

    const dbScene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: proj.data.id } });

    const gen1 = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: dbScene.id,
      narration: "Updated spoken script for preview",
      language: "Telugu",
      voice: "priya",
      format: "mp3",
    });

    expect(gen1.ok).toBe(true);
    if (!gen1.ok) return;

    const v1Audio = gen1.data.audio;
    localPrivateKeys.push(v1Audio.storageKey);

    expect(v1Audio.storageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)).toBe(true);
    expect(v1Audio.format).toBe("mp3");
    expect(v1Audio.mimeType).toBe("audio/mpeg");
    expect(v1Audio.model).toBe("bulbul:v3");
    expect(v1Audio.voice).toBe("priya");
    expect(v1Audio.languageCode).toBe("te-IN");
    expect(v1Audio.requestId).toBe("req_sarvam_101");
    expect(v1Audio.durationSec).toBeGreaterThan(0);
    expect(await privateFileExists(v1Audio.storageKey)).toBe(true);
    expect(await readLocalPrivateFile(v1Audio.storageKey)).toEqual(mp3V1);

    // Ensure scene narration in DB was NEVER overwritten
    const sceneAfter = await prisma.videoScene.findUniqueOrThrow({ where: { id: dbScene.id } });
    expect(sceneAfter.narration).toBe(originalNarration);

    // Ensure getProjectWithScenes & VersionedProjectJson hydrate audio metadata
    const hydrated = await getProjectWithScenes(proj.data.id);
    expect(hydrated?.scenes[0].audio?.storageKey).toBe(v1Audio.storageKey);
    expect(hydrated?.versionedJson.scenes[0].audio?.model).toBe("bulbul:v3");
    const jsonView = buildVersionedProjectJson({
      ...hydrated!.project,
      projectId: hydrated!.project.id,
      scenes: hydrated!.scenes,
    });
    expect(jsonView.scenes[0].audio?.model).toBe("bulbul:v3");

    // Failed regeneration MUST preserve v1 audio file AND DB metadata
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Temporary outage" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const failedRegen = await generateSceneVoiceoverAction({
      projectId: proj.data.id,
      sceneId: dbScene.id,
      narration: "Trying regeneration during outage",
      language: "Telugu",
      voice: "shubh",
      format: "mp3",
    });

    expect(failedRegen.ok).toBe(false);
    expect(await privateFileExists(v1Audio.storageKey)).toBe(true);
    expect(await readLocalPrivateFile(v1Audio.storageKey)).toEqual(mp3V1);

    const hydratedAfterFail = await getProjectWithScenes(proj.data.id);
    expect(hydratedAfterFail?.scenes[0].audio?.storageKey).toBe(v1Audio.storageKey);
    expect(hydratedAfterFail?.scenes[0].audio?.voice).toBe("priya");
  });

  it("5. Cleans up replaced audio, supports manual audio upload with signature validation, and protects shared assets on duplicated projects", async () => {
    process.env.SARVAM_API_KEY = "sk_sarvam_mock_lifecycle";

    const proj = await createProjectAction({
      title: "Audio Shared Lifecycle",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Balcony",
          narration: "Step onto your private balcony.",
          imagePrompt: "Balcony view",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    const origId = proj.data.id;
    createdProjectIds.push(origId);
    const origScene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: origId } });

    // Reject disguised invalid audio file
    const badFd = new FormData();
    badFd.set("projectId", origId);
    badFd.set("sceneId", origScene.id);
    badFd.set("file", new File([Buffer.from("<html><script>alert(1)</script></html>")], "evil.mp3", { type: "audio/mpeg" }));
    const badUpload = await uploadSceneAudioAction(badFd);
    expect(badUpload.ok).toBe(false);
    if (!badUpload.ok) {
      expect(badUpload.error).toMatch(/Invalid or corrupted audio file/i);
    }

    // Upload genuine 2-second WAV audio manually
    const wavBytes = makeWavBuffer(2);
    const wavFd = new FormData();
    wavFd.set("projectId", origId);
    wavFd.set("sceneId", origScene.id);
    wavFd.set("language", "English");
    wavFd.set("file", new File([new Uint8Array(wavBytes)], "custom.wav", { type: "audio/wav" }));
    const upWav = await uploadSceneAudioAction(wavFd);
    expect(upWav.ok).toBe(true);
    if (!upWav.ok) return;
    const manualKey = upWav.data.audio.storageKey;
    localPrivateKeys.push(manualKey);

    expect(upWav.data.audio.model).toBe("manual-upload");
    expect(upWav.data.audio.format).toBe("wav");
    expect(upWav.data.audio.durationSec).toBe(2);
    expect(await privateFileExists(manualKey)).toBe(true);

    // Replace with Sarvam MP3 -> old manual WAV must be deleted safely
    const sarvamMp3 = makeMp3Buffer("replaced_v2");
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req_replace", audios: [sarvamMp3.toString("base64")] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const gen2 = await generateSceneVoiceoverAction({
      projectId: origId,
      sceneId: origScene.id,
      narration: origScene.narration,
      language: "English",
      voice: "aditya",
      format: "mp3",
    });
    expect(gen2.ok).toBe(true);
    if (!gen2.ok) return;

    const sarvamKey = gen2.data.audio.storageKey;
    localPrivateKeys.push(sarvamKey);
    expect(await privateFileExists(manualKey)).toBe(false);
    expect(await privateFileExists(sarvamKey)).toBe(true);

    // Duplicate project -> copy must remap sceneAudio key and share sarvamKey
    const dup = await duplicateProjectAction(origId);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    const copyId = dup.data.id;
    createdProjectIds.push(copyId);

    const hydratedCopy = await getProjectWithScenes(copyId);
    expect(hydratedCopy?.scenes[0].audio?.storageKey).toBe(sarvamKey);
    expect(hydratedCopy?.scenes[0].audio?.audioUrl).toContain(`projectId=${copyId}`);

    // Delete original scene's audio -> shared file MUST survive for duplicated copy
    const delOrigAudio = await deleteSceneAudioAction({ projectId: origId, sceneId: origScene.id });
    expect(delOrigAudio.ok).toBe(true);
    expect(await privateFileExists(sarvamKey)).toBe(true);

    // Delete original project -> shared file MUST still survive for duplicated copy
    const delOrigProj = await deleteProjectAction(origId);
    expect(delOrigProj.ok).toBe(true);
    expect(await privateFileExists(sarvamKey)).toBe(true);

    // Delete duplicated copy -> now zero active projects reference it, file MUST be deleted
    const delCopyProj = await deleteProjectAction(copyId);
    expect(delCopyProj.ok).toBe(true);
    expect(await privateFileExists(sarvamKey)).toBe(false);
  });

  it("6. Preserves voiceover audio in saveDraftAction and restoreVersionAction", async () => {
    process.env.SARVAM_API_KEY = "sk_sarvam_snapshot_key";

    const proj = await createProjectAction({
      title: "Snapshot Audio Project",
      category: "area_guide",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "S1", narration: "First narration", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    const pid = proj.data.id;
    createdProjectIds.push(pid);
    const s1 = await prisma.videoScene.findFirstOrThrow({ where: { projectId: pid } });

    const mp3 = makeMp3Buffer("snap_audio");
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req_snap", audios: [mp3.toString("base64")] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const gen = await generateSceneVoiceoverAction({
      projectId: pid,
      sceneId: s1.id,
      narration: s1.narration,
      language: "English",
      voice: "shubh",
      format: "mp3",
    });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const snapAudioKey = gen.data.audio.storageKey;
    localPrivateKeys.push(snapAudioKey);

    // Save Draft -> records snapshot including scene audio
    const save1 = await saveDraftAction({
      projectId: pid,
      title: "Snapshot Audio Project",
      category: "area_guide",
      status: "DRAFT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: s1.id, order: 1, title: "S1 With Audio", narration: "First narration", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(save1.ok).toBe(true);
    if (!save1.ok) return;
    expect(save1.data.scenes[0].audio?.storageKey).toBe(snapAudioKey);

    const versionsAfterSave1 = await getProjectVersions(pid);
    const versionWithAudio = versionsAfterSave1[0];
    const initialVersionWithoutAudio = versionsAfterSave1[versionsAfterSave1.length - 1];

    // Restore back to initial snapshot (before audio) -> clears audio & deletes unreferenced file
    const restoreV1 = await restoreVersionAction(pid, initialVersionWithoutAudio.id);
    expect(restoreV1.ok).toBe(true);
    if (!restoreV1.ok) return;
    expect(restoreV1.data.scenes[0].audio).toBeNull();
    expect(await privateFileExists(snapAudioKey)).toBe(false);

    // Confirm audio snapshot recorded properly before v1 restore
    expect(versionWithAudio.reason).toBe("Saved changes");
  });

  it("7. Enforces ADMIN authorization, project/scene ownership, and private Range streaming on audio endpoint", async () => {
    process.env.SARVAM_API_KEY = "sk_sarvam_auth_test";

    const p1 = await createProjectAction({
      title: "Auth Audio Project 1",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "Owned Scene", narration: "Owned audio text", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
      ],
    });
    const p2 = await createProjectAction({
      title: "Auth Audio Project 2",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "Other Scene", narration: "Other text", imagePrompt: "P2", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    createdProjectIds.push(p1.data.id, p2.data.id);

    const s1 = await prisma.videoScene.findFirstOrThrow({ where: { projectId: p1.data.id } });
    const s2 = await prisma.videoScene.findFirstOrThrow({ where: { projectId: p2.data.id } });

    const mp3Data = makeMp3Buffer("private_stream");
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req_auth", audios: [mp3Data.toString("base64")] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const gen = await generateSceneVoiceoverAction({
      projectId: p1.data.id,
      sceneId: s1.id,
      narration: s1.narration,
      language: "English",
      voice: "shubh",
      format: "mp3",
    });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    localPrivateKeys.push(gen.data.audio.storageKey);

    // Cross-project ownership checks (ADMIN trying to target project2's scene under project1)
    const crossGen = await generateSceneVoiceoverAction({
      projectId: p1.data.id,
      sceneId: s2.id,
      narration: "Tamper",
      language: "English",
      voice: "shubh",
      format: "mp3",
    });
    expect(crossGen.ok).toBe(false);
    if (!crossGen.ok) expect(crossGen.error).toMatch(/Scene not found in this project/);

    const crossDel = await deleteSceneAudioAction({ projectId: p1.data.id, sceneId: s2.id });
    expect(crossDel.ok).toBe(false);

    // Non-ADMIN CUSTOMER blocked from all Part B server actions
    mockActor = CUSTOMER_USER;
    await expect(checkSarvamStatusAction()).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);
    await expect(
      generateSceneVoiceoverAction({
        projectId: p1.data.id,
        sceneId: s1.id,
        narration: "Hello",
        language: "English",
        voice: "shubh",
        format: "mp3",
      }),
    ).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);
    await expect(deleteSceneAudioAction({ projectId: p1.data.id, sceneId: s1.id })).rejects.toThrow(
      /NEXT_REDIRECT:\/unauthorized/,
    );

    const custAudioReq = new NextRequest(
      `http://localhost:3000/api/admin/video-studio/audio?projectId=${p1.data.id}&sceneId=${s1.id}`,
    );
    const custAudioRes = await audioRouteGet(custAudioReq);
    expect(custAudioRes.status).toBe(403);

    // Unauthenticated user blocked with 401 on audio route & /login redirect on actions
    mockActor = null;
    await expect(checkSarvamStatusAction()).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    const unauthAudioRes = await audioRouteGet(custAudioReq);
    expect(unauthAudioRes.status).toBe(401);

    // Authorized ADMIN receives full audio (200) and byte Range streaming (206)
    mockActor = ADMIN_USER;
    const adminFullRes = await audioRouteGet(custAudioReq);
    expect(adminFullRes.status).toBe(200);
    expect(adminFullRes.headers.get("content-type")).toBe("audio/mpeg");
    expect(adminFullRes.headers.get("cache-control")).toContain("no-store");
    const returnedBytes = Buffer.from(await adminFullRes.arrayBuffer());
    expect(returnedBytes).toEqual(mp3Data);

    const rangeReq = new NextRequest(
      `http://localhost:3000/api/admin/video-studio/audio?projectId=${p1.data.id}&sceneId=${s1.id}`,
      { headers: { range: "bytes=0-9" } },
    );
    const rangeRes = await audioRouteGet(rangeReq);
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("content-range")).toBe(`bytes 0-9/${mp3Data.length}`);
    const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
    expect(rangeBytes).toEqual(mp3Data.subarray(0, 10));

    // Cross-project request rejected even for ADMIN
    const crossAudioReq = new NextRequest(
      `http://localhost:3000/api/admin/video-studio/audio?projectId=${p1.data.id}&sceneId=${s2.id}`,
    );
    const crossAudioRes = await audioRouteGet(crossAudioReq);
    expect(crossAudioRes.status).toBe(404);
  });

  it("8. Uploads private audio to DigitalOcean Spaces with ACL=private in production and blocks public fallback", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.STORAGE_PROVIDER;
    delete process.env.SPACES_KEY;
    delete process.env.SPACES_SECRET;
    delete process.env.SPACES_BUCKET;
    delete process.env.SPACES_REGION;

    const sampleBuf = makeMp3Buffer("prod_spaces");
    await expect(
      uploadPrivateStudioAsset({
        buffer: sampleBuf,
        contentType: "audio/mpeg",
        key: "video-studio/p_prod/audio_1.mp3",
      }),
    ).rejects.toThrow(/DigitalOcean Spaces storage is not configured for production/);

    process.env.SPACES_KEY = "prod-key";
    process.env.SPACES_SECRET = "prod-secret";
    process.env.SPACES_BUCKET = "rebx-prod-bucket";
    process.env.SPACES_REGION = "blr1";

    const key = await uploadPrivateStudioAsset({
      buffer: sampleBuf,
      contentType: "audio/mpeg",
      key: "video-studio/p_prod/audio_1.mp3",
    });

    expect(key).toBe("video-studio/p_prod/audio_1.mp3");
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const cmdInput = (mockS3Send.mock.calls[0]?.[0] as unknown as {
      input: { Bucket: string; Key: string; ACL: string; ContentType: string };
    }).input;
    expect(cmdInput.Bucket).toBe("rebx-prod-bucket");
    expect(cmdInput.Key).toBe("video-studio/p_prod/audio_1.mp3");
    expect(cmdInput.ACL).toBe("private");
    expect(cmdInput.ContentType).toBe("audio/mpeg");
  });

  it("9. Measures accurate MPEG-2 128kbps & VBR MP3 durations instead of 64kbps byte-rate inflation and syncs stored timing", async () => {
    function buildMpeg2L3CbrMp3(frameCount: number, bitrateIdx = 0x0c): Buffer {
      // MPEG-2 Layer III: versionBits=2 (0x10), layerBits=1 (0x02), no CRC (0x01) => 0xf3
      // sampleRateIdx=1 => 24000 Hz (0x04), bitrateIdx=0x0c => 128 kbps (384 bytes/frame)
      const bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
      const bitrateBps = bitrates[bitrateIdx] * 1000;
      const frameSize = Math.floor(((576 / 8) * bitrateBps) / 24000);
      const frames: Buffer[] = [];
      for (let i = 0; i < frameCount; i++) {
        const f = Buffer.alloc(frameSize, 0);
        f[0] = 0xff;
        f[1] = 0xf3;
        f[2] = (bitrateIdx << 4) | 0x04;
        f[3] = 0xc0; // mono
        frames.push(f);
      }
      return Buffer.concat(frames);
    }

    // 273 frames * 384B = 104,832 bytes at 128 kbps -> exact 6.552s -> 6.6s (NOT 13.1s from 64kbps assumption)
    const cbr128 = buildMpeg2L3CbrMp3(273, 0x0c);
    expect(cbr128.length).toBe(104_832);
    expect(estimateAudioDurationSec(cbr128, "mp3", "dummy")).toBe(6.6);

    // 200 frames at 64 kbps (bitrateIdx=8 -> 192B/frame) -> 4.8s
    const cbr64 = buildMpeg2L3CbrMp3(200, 0x08);
    expect(estimateAudioDurationSec(cbr64, "mp3")).toBe(4.8);

    // Xing VBR header inside first MPEG-2 mono frame (side info = 9 bytes -> tag at +13) claiming 418 frames (10.032s -> 10.0s)
    const vbrBuf = buildMpeg2L3CbrMp3(3, 0x0c);
    vbrBuf.write("Xing", 13, "ascii");
    vbrBuf.writeUInt32BE(0x00000001, 17); // frames flag
    vbrBuf.writeUInt32BE(418, 21);
    expect(estimateAudioDurationSec(vbrBuf, "mp3")).toBe(10.0);

    // End-to-end syncProjectAudioTimingAction: repairs legacy inflated durationSec (13.1 -> 6.6, 20.1 -> 10.0) & fits scene 2 (8s -> 10s)
    process.env.SARVAM_API_KEY = "sk_sarvam_sync_test";
    const proj = await createProjectAction({
      title: "Timing Sync Project",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 20,
      aspectRatio: "1:1",
      scenes: [
        { id: "init_1", order: 1, title: "Scene 1", narration: "Intro narration", imagePrompt: "P1", imageUrl: null, duration: 7, locked: false },
        { id: "init_2", order: 2, title: "Scene 2", narration: "Longer narration", imagePrompt: "P2", imageUrl: null, duration: 8, locked: false },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    createdProjectIds.push(proj.data.id);

    const dbScenes = await prisma.videoScene.findMany({
      where: { projectId: proj.data.id },
      orderBy: { order: "asc" },
    });

    const mp3Scene1 = buildMpeg2L3CbrMp3(273, 0x0c); // 6.6s -> fits inside 7s
    const mp3Scene2 = buildMpeg2L3CbrMp3(417, 0x0c); // 10.008s -> 10.0s -> exceeds 8s, fits cleanly to 10s
    const key1 = await uploadPrivateStudioAsset({
      buffer: mp3Scene1,
      contentType: "audio/mpeg",
      key: `video-studio/${proj.data.id}/audio_sync_1_${Date.now()}.mp3`,
    });
    const key2 = await uploadPrivateStudioAsset({
      buffer: mp3Scene2,
      contentType: "audio/mpeg",
      key: `video-studio/${proj.data.id}/audio_sync_2_${Date.now()}.mp3`,
    });
    localPrivateKeys.push(key1, key2);

    // Seed inflated legacy metadata (simulating earlier 64kbps bug: 13.1s and 20.1s)
    await prisma.videoProject.update({
      where: { id: proj.data.id },
      data: {
        metadata: {
          sceneAudio: {
            [dbScenes[0].id]: {
              audioUrl: `/api/admin/video-studio/audio?projectId=${proj.data.id}&sceneId=${dbScenes[0].id}`,
              storageKey: key1,
              format: "mp3",
              mimeType: "audio/mpeg",
              durationSec: 13.1,
              sizeBytes: mp3Scene1.length,
              model: "bulbul:v3",
              status: "ready",
              generatedAt: new Date().toISOString(),
            },
            [dbScenes[1].id]: {
              audioUrl: `/api/admin/video-studio/audio?projectId=${proj.data.id}&sceneId=${dbScenes[1].id}`,
              storageKey: key2,
              format: "mp3",
              mimeType: "audio/mpeg",
              durationSec: 20.1,
              sizeBytes: mp3Scene2.length,
              model: "bulbul:v3",
              status: "ready",
              generatedAt: new Date().toISOString(),
            },
          },
        },
      },
    });

    const syncRes = await syncProjectAudioTimingAction({
      projectId: proj.data.id,
      fitSceneDurations: true,
    });
    expect(syncRes.ok).toBe(true);
    if (!syncRes.ok) return;

    expect(syncRes.data.updatedAudioCount).toBe(2);
    expect(syncRes.data.updatedSceneDurationCount).toBe(1); // Only Scene 2 bumped (8s -> 10s); Scene 1 stays 7s!
    expect(syncRes.data.scenes[0].audio?.durationSec).toBe(6.6);
    expect(syncRes.data.scenes[0].duration).toBe(7);
    expect(syncRes.data.scenes[1].audio?.durationSec).toBe(10);
    expect(syncRes.data.scenes[1].duration).toBe(10);
  });
});
