import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_CONFIG,
  createProjectSchema,
  saveDraftSchema,
  type AspectRatio,
  type EditorScene,
} from "@/lib/video-studio/schemas";
import {
  buildVersionedProjectJson,
  countWords,
  estimateDurationSec,
  getProjectWarnings,
  hashNarrationText,
  newTempId,
  totalDuration,
} from "@/lib/video-studio/script-utils";

describe("REBX AI Video Studio - Phase 1 Specification Tests", () => {
  it("1. Validates all three aspect ratios with exact required dimensions", () => {
    expect(ASPECT_RATIOS).toContain("16:9");
    expect(ASPECT_RATIOS).toContain("9:16");
    expect(ASPECT_RATIOS).toContain("1:1");

    // 16:9: 1920 × 1080
    expect(ASPECT_RATIO_CONFIG["16:9"].dimensions).toBe("1920 × 1080");
    expect(ASPECT_RATIO_CONFIG["16:9"].width).toBe(1920);
    expect(ASPECT_RATIO_CONFIG["16:9"].height).toBe(1080);

    // 9:16: 1080 × 1920
    expect(ASPECT_RATIO_CONFIG["9:16"].dimensions).toBe("1080 × 1920");
    expect(ASPECT_RATIO_CONFIG["9:16"].width).toBe(1080);
    expect(ASPECT_RATIO_CONFIG["9:16"].height).toBe(1920);

    // 1:1: 1080 × 1080
    expect(ASPECT_RATIO_CONFIG["1:1"].dimensions).toBe("1080 × 1080");
    expect(ASPECT_RATIO_CONFIG["1:1"].width).toBe(1080);
    expect(ASPECT_RATIO_CONFIG["1:1"].height).toBe(1080);
  });

  it("2. Validates project creation schema with custom script fields", () => {
    const input = {
      title: "Tellapur Luxury High-Rise Showcase",
      topic: "Walkthrough of premium 3BHK flat",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      targetAudience: "HNIs and Tech Professionals",
      language: "English",
      tone: "Luxury",
      duration: 60,
      aspectRatio: "9:16",
      scenes: [
        {
          id: newTempId(),
          order: 1,
          title: "Hook Scene",
          narration: "Looking for an ultra-luxury lifestyle in Tellapur?",
          imagePrompt: "Photorealistic modern glass towers at twilight",
          imageUrl: null,
          duration: 5,
          locked: false,
        },
      ],
    };

    const parsed = createProjectSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe("Tellapur Luxury High-Rise Showcase");
      expect(parsed.data.aspectRatio).toBe("9:16");
      expect(parsed.data.language).toBe("English");
      expect(parsed.data.tone).toBe("Luxury");
    }
  });

  it("3. Scene management: Adding, deleting, duplicating, and reordering scenes", () => {
    let scenes: EditorScene[] = [
      { id: "s1", order: 1, title: "Scene 1", narration: "N1", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
      { id: "s2", order: 2, title: "Scene 2", narration: "N2", imagePrompt: "P2", imageUrl: "/img2.jpg", duration: 6, locked: false },
      { id: "s3", order: 3, title: "Scene 3", narration: "N3", imagePrompt: "P3", imageUrl: null, duration: 7, locked: false },
    ];

    // Duplicate Scene 2
    const duplicated: EditorScene = { ...scenes[1], id: "s2_copy", title: "Scene 2 (Copy)", order: 3 };
    scenes.splice(2, 0, duplicated);
    scenes = scenes.map((s, i) => ({ ...s, order: i + 1 }));
    expect(scenes.length).toBe(4);
    expect(scenes[2].title).toBe("Scene 2 (Copy)");
    expect(scenes[2].imageUrl).toBe("/img2.jpg");

    // Reorder: Move Scene 4 to Position 1
    const [moved] = scenes.splice(3, 1);
    scenes.splice(0, 0, moved);
    scenes = scenes.map((s, i) => ({ ...s, order: i + 1 }));
    expect(scenes[0].title).toBe("Scene 3");
    expect(scenes[0].order).toBe(1);

    // Delete Scene at Index 1
    scenes.splice(1, 1);
    scenes = scenes.map((s, i) => ({ ...s, order: i + 1 }));
    expect(scenes.length).toBe(3);
  });

  it("4. Calculates word count and duration estimates accurately", () => {
    const text = "Discover luxury high-rise apartments in Hyderabad with panoramic lake views.";
    expect(countWords(text)).toBe(10);
    // 10 words at 2.5 words/sec = 4 seconds
    expect(estimateDurationSec(text)).toBe(4);

    const scenes = [{ duration: 5 }, { duration: 10 }, { duration: 15 }];
    expect(totalDuration(scenes)).toBe(30);
  });

  it("5. Generates the required versioned project JSON structure (Section 6)", () => {
    const scenes: EditorScene[] = [
      {
        id: "scene_1",
        order: 1,
        title: "Grand Foyer",
        narration: "Welcome to your new luxury sanctuary.",
        imagePrompt: "Italian marble foyer with chandeliers and recessed golden lighting",
        imageUrl: "/uploads/video-studio/foyer.jpg",
        duration: 8,
        locked: false,
      },
      {
        id: "scene_2",
        order: 2,
        title: "Master Bedroom",
        narration: "Wake up to breathtaking panoramic balcony views every morning.",
        imagePrompt: "Spacious master bedroom with floor to ceiling glass windows",
        imageUrl: "/uploads/video-studio/bedroom.jpg",
        duration: 10,
        locked: false,
      },
    ];

    const json = buildVersionedProjectJson({
      projectId: "proj_123",
      title: "Tellapur Luxury High-Rise",
      category: "property_showcase",
      status: "DRAFT",
      aspectRatio: "9:16",
      desiredDuration: 60,
      targetAudience: "Luxury buyers",
      language: "English",
      tone: "Luxury",
      topic: "Detailed property tour",
      scenes,
    });

    expect(json.schemaVersion).toBe("1.0.0");
    expect(json.projectId).toBe("proj_123");
    expect(json.videoSettings.aspectRatio).toBe("9:16");
    expect(json.videoSettings.dimensions).toBe("1080 × 1920");
    expect(json.videoSettings.width).toBe(1080);
    expect(json.videoSettings.height).toBe(1920);
    expect(json.scenes.length).toBe(2);
    expect(json.scenes[0].imageUrl).toBe("/uploads/video-studio/foyer.jpg");
    expect(json.videoSettings.totalCalculatedDuration).toBe(18);
  });

  it("6. Validation checks: Warns for missing titles or long Reels", () => {
    const incompleteScenes: EditorScene[] = [
      { id: "s1", order: 1, title: "", narration: "Has text", imagePrompt: "", imageUrl: null, duration: 5, locked: false },
    ];
    const warnings = getProjectWarnings(incompleteScenes, "16:9");
    expect(warnings.some((w) => w.level === "error" && w.message.includes("missing a title"))).toBe(true);

    const longScenes: EditorScene[] = [
      { id: "s1", order: 1, title: "Scene 1", narration: "N1", imagePrompt: "P1", imageUrl: "/img.jpg", duration: 70, locked: false },
    ];
    const reelsWarnings = getProjectWarnings(longScenes, "9:16");
    expect(reelsWarnings.some((w) => w.level === "warn" && w.message.includes("Reels"))).toBe(true);
  });

  it("7. Uses real ready voiceover duration in Validation Checks when narration matches", () => {
    const narration =
      "Planning to buy your first home Before making one of the biggest investments of your life here are five important things you must check";
    // 23 words -> word heuristic ~9s > 7s+2? Let's make 25 words -> ~10s spoken
    const longText = `${narration} right now`;
    const baseScene: EditorScene = {
      id: "s1",
      order: 1,
      title: "Introduction",
      narration: longText,
      imagePrompt: "Home exterior",
      imageUrl: "/api/admin/video-studio/image/s1.jpg",
      duration: 7,
      locked: false,
      audio: {
        audioUrl: "/api/admin/video-studio/audio?projectId=p1&sceneId=s1",
        storageKey: "local-private:a1.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
        durationSec: 6.6,
        sizeBytes: 104832,
        model: "bulbul:v3",
        voice: "shubh",
        languageCode: "en-IN",
        narrationHash: hashNarrationText(longText),
        status: "ready",
        generatedAt: new Date().toISOString(),
      },
    };

    // Fresh ready audio (6.6s) fits cleanly in 7s -> NO false-positive narration warning
    const okWarnings = getProjectWarnings([baseScene], "1:1");
    expect(okWarnings.some((w) => w.message.includes("spoken") || w.message.includes("voiceover"))).toBe(false);

    // If real audio genuinely exceeds scene duration + 1s (e.g. 10.0s in 7s scene) -> warns cleanly
    const longerAudioWarnings = getProjectWarnings(
      [{ ...baseScene, audio: { ...baseScene.audio!, durationSec: 10.0 } }],
      "1:1",
    );
    expect(longerAudioWarnings.some((w) => w.message.includes("voiceover (10.0s) is longer than scene duration (7s)"))).toBe(true);

    // If narration was edited after audio generation -> falls back to spoken word estimate
    const editedNarrationWarnings = getProjectWarnings(
      [{ ...baseScene, narration: `${longText} plus several additional words written after audio generation` }],
      "1:1",
    );
    expect(editedNarrationWarnings.some((w) => w.message.includes("spoken) may exceed scene duration"))).toBe(true);
  });
});

