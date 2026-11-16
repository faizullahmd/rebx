import { afterEach, describe, expect, it, vi } from "vitest";

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
    DeleteObjectCommand: MockDeleteObjectCommand,
  };
});

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import fs from "fs/promises";
import path from "path";
import { buildSpacesPublicUrl, extractSpacesObjectKey } from "@/lib/storage";
import { deleteSceneImage, getStorageProvider, uploadSceneImage } from "@/lib/video-studio/deps";
import { generateGeminiScript, getGeminiModelName, isGeminiConfigured } from "@/lib/video-studio/gemini";
import { buildGeminiSystemPrompt, buildGeminiUserPrompt } from "@/lib/video-studio/prompts";
import {
  geminiScriptInputSchema,
  type AspectRatio,
  type ContentCategory,
} from "@/lib/video-studio/schemas";

describe("REBX AI Video Studio - Phase 2 & Part A Storage + Gemini Tests", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockS3Send.mockReset();
    mockS3Send.mockImplementation(async () => ({}));
  });

  /* ---------------- 1. Storage Provider Switching ---------------- */
  describe("1. Environment-based Storage Provider Selection", () => {
    it("rejects STORAGE_PROVIDER='local' when NODE_ENV is production", () => {
      process.env.STORAGE_PROVIDER = "local";
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(() => getStorageProvider()).toThrow(/STORAGE_PROVIDER="local" is not allowed in production/);

      process.env.STORAGE_PROVIDER = "filesystem";
      expect(() => getStorageProvider()).toThrow(/STORAGE_PROVIDER="filesystem" is not allowed in production/);
    });

    it("rejects unsupported STORAGE_PROVIDER values", () => {
      process.env.STORAGE_PROVIDER = "unknown-disk";
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(() => getStorageProvider()).toThrow(/unsupported STORAGE_PROVIDER/);
    });

    it("allows explicit STORAGE_PROVIDER='spaces' in development", () => {
      process.env.STORAGE_PROVIDER = "spaces";
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      expect(getStorageProvider()).toBe("spaces");
    });

    it("selects 'spaces' in production when STORAGE_PROVIDER is unset or 'spaces'", () => {
      delete process.env.STORAGE_PROVIDER;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(getStorageProvider()).toBe("spaces");

      process.env.STORAGE_PROVIDER = "spaces";
      expect(getStorageProvider()).toBe("spaces");
    });

    it("defaults to 'local' in development/test when STORAGE_PROVIDER is unset", () => {
      delete process.env.STORAGE_PROVIDER;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      expect(getStorageProvider()).toBe("local");
    });
  });

  /* ---------------- 2. Production Storage Protection & CDN Key Handling ---------------- */
  describe("2. Production Storage Credentials & Spaces/CDN Deletion", () => {
    it("throws explicit configuration error naming missing variables including SPACES_REGION", async () => {
      process.env.STORAGE_PROVIDER = "spaces";
      delete process.env.SPACES_KEY;
      delete process.env.SPACES_SECRET;
      delete process.env.SPACES_BUCKET;
      delete process.env.SPACES_REGION;

      const dummyFile = new File([Buffer.from("dummy-image-data")], "test.jpg", { type: "image/jpeg" });

      await expect(uploadSceneImage(dummyFile, "video-studio/p1/scene_1.jpg")).rejects.toThrow(
        /SPACES_KEY.*SPACES_SECRET.*SPACES_BUCKET.*SPACES_REGION/,
      );

      process.env.SPACES_KEY = "k";
      process.env.SPACES_SECRET = "s";
      process.env.SPACES_BUCKET = "my-bucket";
      await expect(uploadSceneImage(dummyFile, "video-studio/p1/scene_1.jpg")).rejects.toThrow(/SPACES_REGION/);
    });

    it("normalizes SPACES_CDN_ENDPOINT and extracts object keys from standard & custom CDN URLs", () => {
      process.env.SPACES_BUCKET = "rebx-assets";
      process.env.SPACES_REGION = "blr1";
      process.env.SPACES_CDN_ENDPOINT = "https://cdn.rebx.in/";

      const publicUrl = buildSpacesPublicUrl("video-studio/proj1/scene_1.jpg");
      expect(publicUrl).toBe("https://cdn.rebx.in/video-studio/proj1/scene_1.jpg");

      expect(extractSpacesObjectKey(publicUrl)).toBe("video-studio/proj1/scene_1.jpg");
      expect(
        extractSpacesObjectKey("https://rebx-assets.blr1.digitaloceanspaces.com/video-studio/proj1/scene_1.jpg"),
      ).toBe("video-studio/proj1/scene_1.jpg");
      expect(
        extractSpacesObjectKey("https://rebx-assets.blr1.cdn.digitaloceanspaces.com/video-studio/proj1/scene_1.jpg"),
      ).toBe("video-studio/proj1/scene_1.jpg");
      expect(extractSpacesObjectKey("https://unrelated.example.com/video-studio/proj1/scene_1.jpg")).toBeNull();
    });

    it("deletes from Spaces using extracted object key for custom CDN URLs", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.STORAGE_PROVIDER;
      process.env.SPACES_KEY = "test-key";
      process.env.SPACES_SECRET = "test-secret";
      process.env.SPACES_BUCKET = "rebx-assets";
      process.env.SPACES_REGION = "blr1";
      process.env.SPACES_CDN_ENDPOINT = "https://cdn.rebx.in/";

      await deleteSceneImage("https://cdn.rebx.in/video-studio/proj1/scene_99.jpg");

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const sentCommand = mockS3Send.mock.calls[0]?.[0] as unknown as { input: { Bucket: string; Key: string } };
      expect(sentCommand.input).toEqual({
        Bucket: "rebx-assets",
        Key: "video-studio/proj1/scene_99.jpg",
      });
    });
  });

  /* ---------------- 3. Local Private Storage Upload & Deletion ---------------- */
  describe("3. Local Filesystem Upload and Deletion", () => {
    it("uploads scene images into private storage outside public/ and deletes them cleanly", async () => {
      process.env.STORAGE_PROVIDER = "local";

      const dummyContent = "sample-image-binary-payload";
      const dummyFile = new File([Buffer.from(dummyContent)], "sample_scene.jpg", { type: "image/jpeg" });
      const testKey = `video-studio/test-p1/scene_test_${Date.now()}.jpg`;

      const uploadedUrl = await uploadSceneImage(dummyFile, testKey);
      expect(uploadedUrl).toMatch(/^\/api\/admin\/video-studio\/image\/scene_test_\d+\.jpg$/);

      const filename = path.posix.basename(uploadedUrl);
      const privateFilePath = path.join(process.cwd(), "storage", "video-studio", "images", filename);
      const legacyPublicFilePath = path.join(process.cwd(), "public", "uploads", "video-studio", filename);

      const fileData = await fs.readFile(privateFilePath, "utf8");
      expect(fileData).toBe(dummyContent);
      await expect(fs.access(legacyPublicFilePath)).rejects.toThrow();

      await deleteSceneImage(uploadedUrl);
      await expect(fs.access(privateFilePath)).rejects.toThrow();
    });

    it("blocks local path traversal during deletion", async () => {
      await expect(deleteSceneImage("/api/admin/video-studio/image/../../.env")).rejects.toThrow(
        /Invalid local asset path/,
      );
      await expect(deleteSceneImage("/uploads/video-studio/../../.env")).rejects.toThrow(
        /Invalid local asset path/,
      );
    });
  });

  /* ---------------- 4. Google Gemini Configuration & Optionality ---------------- */
  describe("4. Google Gemini Configuration & Optionality", () => {
    it("detects when GEMINI_API_KEY is not configured", () => {
      delete process.env.GEMINI_API_KEY;
      expect(isGeminiConfigured()).toBe(false);

      process.env.GEMINI_API_KEY = "   ";
      expect(isGeminiConfigured()).toBe(false);
    });

    it("detects when GEMINI_API_KEY is configured", () => {
      process.env.GEMINI_API_KEY = "AIzaSyFakeKeyTest123456789";
      expect(isGeminiConfigured()).toBe(true);
    });

    it("returns configured model or defaults to gemini-2.5-flash", () => {
      delete process.env.GEMINI_MODEL;
      expect(getGeminiModelName()).toBe("gemini-2.5-flash");

      process.env.GEMINI_MODEL = "gemini-1.5-pro";
      expect(getGeminiModelName()).toBe("gemini-1.5-pro");
    });

    it("throws helpful error explaining how to configure GEMINI_API_KEY when key is missing", async () => {
      delete process.env.GEMINI_API_KEY;

      await expect(
        generateGeminiScript({
          topic: "Luxury Tellapur villas",
          category: "property_showcase",
          targetAudience: "Homebuyers",
          language: "English",
          tone: "Luxury",
          desiredDuration: 45,
          aspectRatio: "16:9",
        }),
      ).rejects.toThrow(/Gemini API key is not configured on the server/);
    });
  });

  /* ---------------- 5. Script Schema Validation (Option A & Option B) ---------------- */
  describe("5. Script Schema Validation", () => {
    it("validates camelCase Gemini / JSON script format", () => {
      const validPayload = {
        title: "Hyderabad Top 3 Growth Corridors",
        description: "An overview of Tellapur, Kokapet, and Financial District.",
        scenes: [
          {
            title: "Hook",
            narration: "Why are high-net-worth buyers flocking to West Hyderabad?",
            imagePrompt: "Photorealistic aerial skyline of Tellapur high-rises at sunset",
            duration: 5,
          },
          {
            title: "Call to Action",
            narration: "Explore verified RERA-approved properties on REBX.",
            imagePrompt: "Smartphone with REBX verified listing screen in modern apartment",
            duration: 6,
          },
        ],
      };

      const result = geminiScriptInputSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenes.length).toBe(2);
        expect(result.data.scenes[0].title).toBe("Hook");
        expect(result.data.scenes[0].duration).toBe(5);
      }
    });

    it("accepts snake_case keys (narration_text, image_prompt, duration_sec) for compatibility", () => {
      const snakeCasePayload = {
        title: "3 Things to Check on RERA Portal",
        scenes: [
          {
            title: "Hook: Don't Pay Token Money Yet",
            narration_text: "Never pay a builder advance without verifying these 3 things.",
            image_prompt: "Close up of legal documents with verified seal on marble desk",
            duration_sec: 6,
          },
        ],
      };

      const result = geminiScriptInputSchema.safeParse(snakeCasePayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenes[0].narration).toBe("Never pay a builder advance without verifying these 3 things.");
        expect(result.data.scenes[0].imagePrompt).toBe(
          "Close up of legal documents with verified seal on marble desk",
        );
        expect(result.data.scenes[0].duration).toBe(6);
      }
    });

    it("rejects invalid script without title or scenes", () => {
      const invalidNoTitle = {
        title: "",
        scenes: [{ title: "Scene 1", narration: "Test" }],
      };
      expect(geminiScriptInputSchema.safeParse(invalidNoTitle).success).toBe(false);

      const invalidNoScenes = {
        title: "Test Title",
        scenes: [],
      };
      expect(geminiScriptInputSchema.safeParse(invalidNoScenes).success).toBe(false);
    });
  });

  /* ---------------- 6. REBX Domain Prompt Structure ---------------- */
  describe("6. REBX Domain Prompt Structure", () => {
    it("system prompt enforces REBX context, RERA compliance, hook, and CTA rules", () => {
      const sysPrompt = buildGeminiSystemPrompt();
      expect(sysPrompt).toContain("REBX (Real Estate Broker Exchange)");
      expect(sysPrompt).toContain("RERA");
      expect(sysPrompt).toContain("Scene 1 must be a strong hook");
      expect(sysPrompt).toContain("call to action");
      expect(sysPrompt).toContain("narration is SPOKEN AUDIO ONLY");
    });

    it("user prompt includes aspect ratio dimensions, INR formatting, and requested duration", () => {
      const userPrompt = buildGeminiUserPrompt({
        topic: "Modern 3BHK in Tellapur",
        category: "property_showcase" as ContentCategory,
        targetAudience: "First-time buyers & IT executives",
        language: "English",
        tone: "Luxury",
        desiredDuration: 45,
        aspectRatio: "9:16" as AspectRatio,
        sourceSummary: "Price: ₹2.25 Cr, Carpet Area: 1,850 sq ft, RERA ID: P02400001234",
      });

      expect(userPrompt).toContain("Topic / Focus: Modern 3BHK in Tellapur");
      expect(userPrompt).toContain("9:16 (1080 × 1920)");
      expect(userPrompt).toContain("~45 seconds");
      expect(userPrompt).toContain("FACTUAL SOURCE MATERIAL");
      expect(userPrompt).toContain("₹2.25 Cr");
    });
  });
});
