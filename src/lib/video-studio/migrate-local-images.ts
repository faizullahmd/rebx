import "server-only";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import {
  getLegacyPublicVideoStudioDir,
  getPrivateVideoStudioImagesDir,
  prisma,
} from "@/lib/video-studio/deps";
import {
  ADMIN_SCENE_IMAGE_ROUTE_PREFIX,
  LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX,
} from "@/lib/video-studio/script-utils";

export type MigratedSceneImageEntry = {
  filename: string;
  sizeBytes: number;
  sha256: string;
  alreadyPresent: boolean;
  originalRemoved: boolean;
};

export type LegacySceneImageMigrationResult = {
  legacyDir: string;
  targetDir: string;
  scannedFiles: number;
  migratedFiles: MigratedSceneImageEntry[];
  updatedSceneCount: number;
  updatedVersionCount: number;
  preservedRenderJobCount: number;
};

async function computeFileDigest(filePath: string): Promise<{ sizeBytes: number; sha256: string }> {
  const bytes = await fs.readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { sizeBytes: bytes.length, sha256 };
}

function isSafeLegacyImageFilename(name: string): boolean {
  if (!name || name === ".gitkeep" || name === "." || name === ".." || name.includes("..")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) && /\.(jpg|jpeg|png|webp)$/i.test(name);
}

/**
 * Safely migrates legacy local scene images from `public/uploads/video-studio/`
 * into private storage `storage/video-studio/images/`:
 * 1. Copies every regular image file into private storage using atomic temp file -> verify -> rename.
 * 2. Verifies exact byte size and SHA-256 checksum on destination BEFORE updating any DB reference.
 * 3. Transactionally rewrites `/uploads/video-studio/<file>` references in `VideoScene` and
 *    `VideoVersion.snapshot` to `/api/admin/video-studio/image/<file>` (while leaving immutable
 *    `VideoRenderJob` snapshots untouched so existing `snapshotHash` integrity remains intact).
 * 4. Re-verifies destination checksum before deleting verified originals from `public/uploads/video-studio/`.
 */
export async function migrateLegacyPublicSceneImages(opts?: {
  legacyDir?: string;
  targetDir?: string;
  deleteOriginalsAfterVerify?: boolean;
  dryRun?: boolean;
  verifyHook?: (info: { filename: string; sourcePath: string; targetPath: string }) => Promise<void>;
}): Promise<LegacySceneImageMigrationResult> {
  const legacyDir = opts?.legacyDir ?? getLegacyPublicVideoStudioDir(path);
  const targetDir = opts?.targetDir ?? getPrivateVideoStudioImagesDir(path);
  const deleteOriginals = opts?.deleteOriginalsAfterVerify ?? true;
  const dryRun = opts?.dryRun ?? false;

  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(legacyDir, { withFileTypes: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      return {
        legacyDir,
        targetDir,
        scannedFiles: 0,
        migratedFiles: [],
        updatedSceneCount: 0,
        updatedVersionCount: 0,
        preservedRenderJobCount: 0,
      };
    }
    throw err;
  }

  const candidateFiles = entries
    .filter((entry) => entry.name !== ".gitkeep")
    .map((entry) => entry.name);

  for (const filename of candidateFiles) {
    if (!isSafeLegacyImageFilename(filename)) {
      throw new Error(`Refused to migrate unexpected file in legacy directory: "${filename}"`);
    }
    const sourcePath = path.join(legacyDir, filename);
    const lstat = await fs.lstat(sourcePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      throw new Error(`Refused to migrate non-regular file or symlink: "${filename}"`);
    }
  }

  const stagedCopies: Array<{
    filename: string;
    sourcePath: string;
    targetPath: string;
    sizeBytes: number;
    sha256: string;
    alreadyPresent: boolean;
  }> = [];

  if (!dryRun && candidateFiles.length > 0) {
    await fs.mkdir(targetDir, { recursive: true });
  }

  for (const filename of candidateFiles) {
    const sourcePath = path.join(legacyDir, filename);
    const targetPath = path.join(targetDir, filename);
    const sourceDigest = await computeFileDigest(sourcePath);

    let alreadyPresent = false;

    if (!dryRun) {
      let destExists = false;
      try {
        const destStat = await fs.lstat(targetPath);
        if (destStat.isSymbolicLink() || !destStat.isFile()) {
          throw new Error(`Destination path for "${filename}" is not a regular file.`);
        }
        destExists = true;
      } catch (err) {
        if ((err as { code?: string })?.code !== "ENOENT") {
          throw err;
        }
      }

      if (destExists) {
        const destDigest = await computeFileDigest(targetPath);
        if (
          destDigest.sizeBytes !== sourceDigest.sizeBytes ||
          destDigest.sha256 !== sourceDigest.sha256
        ) {
          throw new Error(
            `Migration checksum conflict for "${filename}": destination file exists with different content.`,
          );
        }
        alreadyPresent = true;
      } else {
        const tempPath = path.join(
          targetDir,
          `.${filename}.migrate_${randomBytes(4).toString("hex")}.tmp`,
        );
        try {
          await fs.copyFile(sourcePath, tempPath);
          if (opts?.verifyHook) {
            await opts.verifyHook({ filename, sourcePath, targetPath: tempPath });
          }
          const copiedDigest = await computeFileDigest(tempPath);
          if (
            copiedDigest.sizeBytes !== sourceDigest.sizeBytes ||
            copiedDigest.sha256 !== sourceDigest.sha256
          ) {
            throw new Error(
              `Verification failed after copying "${filename}": size/SHA-256 mismatch.`,
            );
          }
          await fs.rename(tempPath, targetPath);

          const finalDigest = await computeFileDigest(targetPath);
          if (
            finalDigest.sizeBytes !== sourceDigest.sizeBytes ||
            finalDigest.sha256 !== sourceDigest.sha256
          ) {
            throw new Error(`Post-rename verification failed for "${filename}".`);
          }
        } catch (err) {
          await fs.unlink(tempPath).catch(() => {});
          throw err;
        }
      }
    }

    stagedCopies.push({
      filename,
      sourcePath,
      targetPath,
      sizeBytes: sourceDigest.sizeBytes,
      sha256: sourceDigest.sha256,
      alreadyPresent,
    });
  }

  // Build map of verified private images currently available on destination
  const verifiedTargetFiles = new Set<string>(stagedCopies.map((c) => c.filename));
  try {
    const existingPrivate = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of existingPrivate) {
      if (entry.isFile() && isSafeLegacyImageFilename(entry.name)) {
        verifiedTargetFiles.add(entry.name);
      }
    }
  } catch (err) {
    if ((err as { code?: string })?.code !== "ENOENT") {
      throw err;
    }
  }

  let updatedSceneCount = 0;
  let updatedVersionCount = 0;
  let preservedRenderJobCount = 0;

  if (!dryRun) {
    const dbStats = await prisma.$transaction(async (tx) => {
      let sceneUpdates = 0;
      let versionUpdates = 0;

      const legacyScenes = await tx.videoScene.findMany({
        where: {
          OR: [
            { imageUrl: { startsWith: LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX } },
            { imagePath: { startsWith: LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX } },
          ],
        },
        select: { id: true, imageUrl: true, imagePath: true },
      });

      for (const scene of legacyScenes) {
        const nextUrl = mapLegacyRefIfVerified(scene.imageUrl, verifiedTargetFiles);
        const nextPath = mapLegacyRefIfVerified(scene.imagePath, verifiedTargetFiles);
        if (nextUrl !== scene.imageUrl || nextPath !== scene.imagePath) {
          await tx.videoScene.update({
            where: { id: scene.id },
            data: {
              imageUrl: nextUrl,
              imagePath: nextPath,
            },
          });
          sceneUpdates++;
        }
      }

      const versions = await tx.videoVersion.findMany({
        select: { id: true, snapshot: true },
      });

      for (const ver of versions) {
        const snap = ver.snapshot as { scenes?: Array<{ imageUrl?: unknown }> } | null;
        if (!snap || typeof snap !== "object" || !Array.isArray(snap.scenes)) continue;

        let changed = false;
        const nextScenes = snap.scenes.map((s) => {
          if (typeof s?.imageUrl !== "string") return s;
          const mapped = mapLegacyRefIfVerified(s.imageUrl, verifiedTargetFiles);
          if (mapped && mapped !== s.imageUrl) {
            changed = true;
            return { ...s, imageUrl: mapped };
          }
          return s;
        });

        if (changed) {
          await tx.videoVersion.update({
            where: { id: ver.id },
            data: {
              snapshot: {
                ...snap,
                scenes: nextScenes,
              } as unknown as Prisma.InputJsonValue,
            },
          });
          versionUpdates++;
        }
      }

      const preservedJobs = await tx.videoRenderJob.count();
      return { sceneUpdates, versionUpdates, preservedJobs };
    });

    updatedSceneCount = dbStats.sceneUpdates;
    updatedVersionCount = dbStats.versionUpdates;
    preservedRenderJobCount = dbStats.preservedJobs;
  }

  const migratedFiles: MigratedSceneImageEntry[] = [];
  for (const item of stagedCopies) {
    let originalRemoved = false;
    if (!dryRun && deleteOriginals) {
      const verifyBeforeDelete = await computeFileDigest(item.targetPath);
      if (
        verifyBeforeDelete.sizeBytes !== item.sizeBytes ||
        verifyBeforeDelete.sha256 !== item.sha256
      ) {
        throw new Error(
          `Aborted deleting original "${item.filename}" because destination verification failed.`,
        );
      }
      await fs.unlink(item.sourcePath);
      originalRemoved = true;
    }

    migratedFiles.push({
      filename: item.filename,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      alreadyPresent: item.alreadyPresent,
      originalRemoved,
    });
  }

  return {
    legacyDir,
    targetDir,
    scannedFiles: candidateFiles.length,
    migratedFiles,
    updatedSceneCount,
    updatedVersionCount,
    preservedRenderJobCount,
  };
}

function mapLegacyRefIfVerified(
  value: string | null,
  verifiedFilenames: Set<string>,
): string | null {
  if (!value) return value;
  if (!value.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)) return value;
  const filename = value.slice(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX.length);
  if (!verifiedFilenames.has(filename)) return value;
  return `${ADMIN_SCENE_IMAGE_ROUTE_PREFIX}${filename}`;
}

