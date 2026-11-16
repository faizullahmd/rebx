import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import {
  buildSafeProbeChildEnv,
  checkFfmpegEnvironment,
  discoverExecutableVersion,
  expandSafeWindowsEnvVars,
  parseFfmpegVersionOutput,
  readWindowsRegistryPathEntries,
  type EnvMap,
  type ExecFileLike,
  type ExecFileOptions,
} from "../../../worker/video-renderer/src/ffmpeg";

describe("REBX AI Video Studio - Phase 3 Part C3.2.2: FFmpeg Environment Integration", () => {
  it("1. Discovers FFmpeg 9.0.1 and FFprobe 9.0.1 on Windows PATH safely without shell interpolation", async () => {
    const calls: Array<{ file: string; args: readonly string[]; options: ExecFileOptions }> = [];

    const mockExecFile: ExecFileLike = async (file, args, options) => {
      calls.push({ file, args, options });
      if (file === "C:\\FFmpeg\\bin\\ffmpeg.exe") {
        return {
          stdout:
            "ffmpeg version 9.0.1-essentials_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers\n",
          stderr: "",
        };
      }
      if (file === "C:\\FFmpeg\\bin\\ffprobe.exe") {
        return {
          stdout:
            "ffprobe version 9.0.1-essentials_build-www.gyan.dev Copyright (c) 2007-2026 the FFmpeg developers\n",
          stderr: "",
        };
      }
      const err = new Error(`ENOENT: ${file}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    };

    const status = await checkFfmpegEnvironment({
      deps: {
        platform: "win32",
        env: {
          Path: "C:\\Windows\\System32;C:\\FFmpeg\\bin",
          SystemRoot: "C:\\Windows",
        },
        existsSync: (p) =>
          p === "C:\\FFmpeg\\bin\\ffmpeg.exe" || p === "C:\\FFmpeg\\bin\\ffprobe.exe",
        isDirectory: () => false,
        execFile: mockExecFile,
      },
    });

    expect(status.platform).toBe("win32");
    expect(status.readyForPartC32Rendering).toBe(true);

    expect(status.ffmpeg).toMatchObject({
      tool: "ffmpeg",
      available: true,
      source: "path",
      executablePath: "C:\\FFmpeg\\bin\\ffmpeg.exe",
      version: "9.0.1-essentials_build-www.gyan.dev",
      parsedVersion: {
        raw: "9.0.1-essentials_build-www.gyan.dev",
        major: 9,
        minor: 0,
        patch: 1,
      },
      errorCode: null,
      error: null,
    });

    expect(status.ffprobe).toMatchObject({
      tool: "ffprobe",
      available: true,
      source: "path",
      executablePath: "C:\\FFmpeg\\bin\\ffprobe.exe",
      version: "9.0.1-essentials_build-www.gyan.dev",
      parsedVersion: {
        raw: "9.0.1-essentials_build-www.gyan.dev",
        major: 9,
        minor: 0,
        patch: 1,
      },
      errorCode: null,
      error: null,
    });

    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.args).toEqual(["-version"]);
      expect(call.options.shell).toBe(false);
      expect(call.options.windowsHide).toBe(true);
    }
  });

  it("2. Recovers Windows PATH additions from Registry when process PATH is stale without expanding secrets", async () => {
    const winGetBin =
      "C:\\Users\\dev\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg\\bin";

    // Verify Registry query parsing & safe env expansion
    const regMockExecFile: ExecFileLike = async (_file, args) => {
      if (args.includes("HKCU\\Environment")) {
        return {
          stdout: [
            "",
            "HKEY_CURRENT_USER\\Environment",
            "    Path    REG_EXPAND_SZ    %LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg\\bin;%SECRET_API_KEY%",
            "",
          ].join("\r\n"),
          stderr: "",
        };
      }
      return {
        stdout: "HKEY_LOCAL_MACHINE\\...\r\n    Path    REG_SZ    C:\\Windows\\System32\r\n",
        stderr: "",
      };
    };

    const parsedRegDirs = await readWindowsRegistryPathEntries({
      execFileFn: regMockExecFile,
      env: {
        LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
        SECRET_API_KEY: "must-never-expand",
      },
    });
    expect(parsedRegDirs).toContain(winGetBin);
    expect(parsedRegDirs).not.toContain("must-never-expand");
    expect(parsedRegDirs).toContain("%SECRET_API_KEY%");
    expect(
      expandSafeWindowsEnvVars("%USERPROFILE%\\tools;%SARVAM_API_KEY%", {
        USERPROFILE: "C:\\Users\\dev",
        SARVAM_API_KEY: "super-secret",
      }),
    ).toBe("C:\\Users\\dev\\tools;%SARVAM_API_KEY%");

    // Verify fallback discovery finds FFmpeg/FFprobe via Registry PATH when process PATH lacks them
    const probeExecFile: ExecFileLike = async (file) => {
      if (file === `${winGetBin}\\ffmpeg.exe`) {
        return { stdout: "ffmpeg version 9.0.1 Copyright (c) 2000-2026\n", stderr: "" };
      }
      if (file === `${winGetBin}\\ffprobe.exe`) {
        return { stdout: "ffprobe version 9.0.1 Copyright (c) 2007-2026\n", stderr: "" };
      }
      const err = new Error("not found") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    };

    const status = await checkFfmpegEnvironment({
      deps: {
        platform: "win32",
        env: { PATH: "C:\\Windows\\System32" },
        existsSync: (p) =>
          p === `${winGetBin}\\ffmpeg.exe` || p === `${winGetBin}\\ffprobe.exe`,
        isDirectory: () => false,
        execFile: probeExecFile,
        resolveWindowsRegistryPathEntries: async () => parsedRegDirs,
      },
    });

    expect(status.readyForPartC32Rendering).toBe(true);
    expect(status.ffmpeg.source).toBe("windows_registry_path");
    expect(status.ffmpeg.executablePath).toBe(`${winGetBin}\\ffmpeg.exe`);
    expect(status.ffprobe.source).toBe("windows_registry_path");
    expect(status.ffprobe.executablePath).toBe(`${winGetBin}\\ffprobe.exe`);
  });

  it("3. Supports FFMPEG_PATH / FFPROBE_PATH config overrides and refuses silent PATH fallback when explicit path is invalid", async () => {
    // Config parsing checks
    const parsedCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: "worker-secret-test-value-0123456789",
      FFMPEG_PATH: '  "D:\\CustomTools\\ffmpeg.exe"  ',
      FFPROBE_PATH: "'D:\\CustomTools\\ffprobe.exe'",
      FFMPEG_PROBE_TIMEOUT_MS: "",
    });
    expect(parsedCfg.ffmpegPath).toBe("D:\\CustomTools\\ffmpeg.exe");
    expect(parsedCfg.ffprobePath).toBe("D:\\CustomTools\\ffprobe.exe");
    expect(parsedCfg.ffmpegProbeTimeoutMs).toBe(4000);
    expect(parsedCfg.processingEnabled).toBe(false);

    expect(() =>
      loadWorkerConfig({
        RENDER_WORKER_SECRET: "worker-secret-test-value-0123456789",
        FFMPEG_PATH: "C:\\bad\0path\\ffmpeg.exe",
      }),
    ).toThrow(/FFMPEG_PATH/);

    expect(() =>
      loadWorkerConfig({
        RENDER_WORKER_SECRET: "worker-secret-test-value-0123456789",
        FFMPEG_PROBE_TIMEOUT_MS: "10",
      }),
    ).toThrow(/FFMPEG_PROBE_TIMEOUT_MS/);

    // Explicit paths succeed directly with source="env"
    const customExec: ExecFileLike = async (file) => {
      if (file === "D:\\CustomTools\\ffmpeg.exe") {
        return { stdout: "ffmpeg version 9.0.1-custom\n", stderr: "" };
      }
      if (file === "D:\\CustomTools\\ffprobe.exe") {
        return { stdout: "ffprobe version 9.0.1-custom\n", stderr: "" };
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const okCustom = await checkFfmpegEnvironment({
      ffmpegPath: parsedCfg.ffmpegPath,
      ffprobePath: parsedCfg.ffprobePath,
      deps: {
        platform: "win32",
        env: { PATH: "C:\\Windows\\System32" },
        existsSync: () => true,
        isDirectory: () => false,
        execFile: customExec,
      },
    });
    expect(okCustom.readyForPartC32Rendering).toBe(true);
    expect(okCustom.ffmpeg.source).toBe("env");
    expect(okCustom.ffprobe.source).toBe("env");

    // Broken explicit path must NOT silently fall back to system PATH ffmpeg
    const fallbackTrapExec = vi.fn<ExecFileLike>(async (file) => {
      if (file === "ffmpeg") {
        return { stdout: "ffmpeg version 9.0.1-global\n", stderr: "" };
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const brokenExplicit = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "D:\\Missing\\ffmpeg.exe",
      deps: {
        platform: "win32",
        env: { PATH: "C:\\FFmpeg\\bin" },
        existsSync: () => false,
        isDirectory: () => false,
        execFile: fallbackTrapExec,
      },
    });
    expect(brokenExplicit.available).toBe(false);
    expect(brokenExplicit.source).toBe("env");
    expect(brokenExplicit.errorCode).toBe("NOT_FOUND");
    expect(fallbackTrapExec).toHaveBeenCalledTimes(1);
    expect(fallbackTrapExec).toHaveBeenCalledWith(
      "D:\\Missing\\ffmpeg.exe",
      ["-version"],
      expect.objectContaining({ shell: false }),
    );

    // Explicit path pointing to a directory returns INVALID_PATH cleanly
    const dirExplicit = await discoverExecutableVersion({
      tool: "ffprobe",
      explicitPath: "D:\\CustomTools",
      deps: {
        platform: "win32",
        existsSync: (p) => p === "D:\\CustomTools",
        isDirectory: (p) => p === "D:\\CustomTools",
        execFile: fallbackTrapExec,
      },
    });
    expect(dirExplicit.available).toBe(false);
    expect(dirExplicit.source).toBe("env");
    expect(dirExplicit.errorCode).toBe("INVALID_PATH");
  });

  it("4. Handles missing executables, permission errors, timeouts, non-zero exit codes, and unexpected output", async () => {
    // Missing binary
    const missing = await discoverExecutableVersion({
      tool: "ffmpeg",
      deps: {
        platform: "win32",
        env: {},
        existsSync: () => false,
        isDirectory: () => false,
        execFile: async () => {
          throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        },
      },
    });
    expect(missing.available).toBe(false);
    expect(missing.errorCode).toBe("NOT_FOUND");
    expect(missing.source).toBe("none");

    // Permission denied
    const denied = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "/opt/ffmpeg",
      deps: {
        platform: "linux",
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async () => {
          throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
        },
      },
    });
    expect(denied.available).toBe(false);
    expect(denied.errorCode).toBe("PERMISSION_DENIED");

    // Timeout via killed + SIGTERM
    const timedOut = await discoverExecutableVersion({
      tool: "ffprobe",
      explicitPath: "C:\\ffmpeg\\ffprobe.exe",
      timeoutMs: 250,
      deps: {
        platform: "win32",
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async () => {
          throw Object.assign(new Error("Command failed: SIGTERM"), {
            killed: true,
            signal: "SIGTERM",
          });
        },
      },
    });
    expect(timedOut.available).toBe(false);
    expect(timedOut.errorCode).toBe("TIMEOUT");
    expect(timedOut.error).toContain("250ms");

    // Non-zero exit code with stderr detail
    const nonZero = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "/usr/bin/ffmpeg",
      deps: {
        platform: "linux",
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async () => {
          throw Object.assign(new Error("Command failed with exit code 1"), {
            code: 1,
            stderr: "Missing shared library libavcodec.so.61\nsecond line ignored",
            stdout: "",
          });
        },
      },
    });
    expect(nonZero.available).toBe(false);
    expect(nonZero.errorCode).toBe("NON_ZERO_EXIT");
    expect(nonZero.error).toContain("exit code 1");
    expect(nonZero.error).toContain("Missing shared library");

    // Unexpected stdout (wrong tool output or non-ffmpeg binary exiting 0)
    const wrongBinary = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "C:\\Program Files\\nodejs\\node.exe",
      deps: {
        platform: "win32",
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async () => ({ stdout: "v26.5.0\n", stderr: "" }),
      },
    });
    expect(wrongBinary.available).toBe(false);
    expect(wrongBinary.errorCode).toBe("UNEXPECTED_OUTPUT");

    const swappedTool = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "C:\\ffmpeg\\ffprobe.exe",
      deps: {
        platform: "win32",
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async () => ({
          stdout: "ffprobe version 9.0.1 Copyright (c) 2007-2026\n",
          stderr: "",
        }),
      },
    });
    expect(swappedTool.available).toBe(false);
    expect(swappedTool.errorCode).toBe("UNEXPECTED_OUTPUT");
    expect(parseFfmpegVersionOutput("ffmpeg", "", "")).toBeNull();
  });

  it("5. Discovers Linux binaries via PATH without .exe suffix and parses Ubuntu & git version strings", async () => {
    const status = await checkFfmpegEnvironment({
      deps: {
        platform: "linux",
        env: { PATH: "/usr/local/bin:/usr/bin" },
        existsSync: (p) => p === "/usr/bin/ffmpeg" || p === "/usr/bin/ffprobe",
        isDirectory: () => false,
        execFile: async (file) => {
          if (file === "/usr/bin/ffmpeg") {
            return {
              stdout: "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers\n",
              stderr: "",
            };
          }
          if (file === "/usr/bin/ffprobe") {
            return {
              stdout: "ffprobe version N-117402-gabcdef Copyright (c) 2007-2026\n",
              stderr: "",
            };
          }
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      },
    });

    expect(status.platform).toBe("linux");
    expect(status.readyForPartC32Rendering).toBe(true);
    expect(status.ffmpeg.source).toBe("path");
    expect(status.ffmpeg.executablePath).toBe("/usr/bin/ffmpeg");
    expect(status.ffmpeg.parsedVersion).toEqual({
      raw: "6.1.1-3ubuntu5",
      major: 6,
      minor: 1,
      patch: 1,
    });
    expect(status.ffprobe.parsedVersion).toEqual({
      raw: "N-117402-gabcdef",
      major: null,
      minor: null,
      patch: null,
    });
  });

  it("6. Never exposes API keys, secrets, or sensitive env variables to child processes or error outputs", async () => {
    const secretValues = [
      "secret-worker-token-xyz123",
      "secret-sarvam-key-abc456",
      "secret-gemini-key-789",
      "mysql://user:secret_pass@db:3306/rebx",
    ];
    let capturedChildEnv: EnvMap | undefined;

    const fullEnv: EnvMap = {
      PATH: "C:\\FFmpeg\\bin",
      SystemRoot: "C:\\Windows",
      RENDER_WORKER_SECRET: secretValues[0],
      SARVAM_API_KEY: secretValues[1],
      GEMINI_API_KEY: secretValues[2],
      DATABASE_URL: secretValues[3],
      AUTH_SECRET: "auth-secret-should-not-forward",
      SPACES_SECRET: "spaces-secret-should-not-forward",
    };

    const safeChild = buildSafeProbeChildEnv(fullEnv);
    expect(safeChild.PATH).toBe("C:\\FFmpeg\\bin");
    expect(safeChild.RENDER_WORKER_SECRET).toBeUndefined();
    expect(safeChild.SARVAM_API_KEY).toBeUndefined();
    expect(safeChild.GEMINI_API_KEY).toBeUndefined();
    expect(safeChild.DATABASE_URL).toBeUndefined();
    expect(safeChild.AUTH_SECRET).toBeUndefined();
    expect(safeChild.SPACES_SECRET).toBeUndefined();

    const failedProbe = await discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: "C:\\bad\\ffmpeg.exe",
      secrets: secretValues,
      deps: {
        platform: "win32",
        env: fullEnv,
        existsSync: () => true,
        isDirectory: () => false,
        execFile: async (_file, _args, options) => {
          capturedChildEnv = options.env;
          throw Object.assign(new Error("exit 1"), {
            code: 1,
            stderr: `Authorization: Bearer super-header-secret token=${secretValues[0]}`,
          });
        },
      },
    });

    expect(capturedChildEnv).toBeDefined();
    expect(capturedChildEnv?.RENDER_WORKER_SECRET).toBeUndefined();
    expect(capturedChildEnv?.SARVAM_API_KEY).toBeUndefined();
    expect(capturedChildEnv?.DATABASE_URL).toBeUndefined();
    expect(failedProbe.available).toBe(false);
    expect(failedProbe.error).not.toContain("super-header-secret");
    expect(failedProbe.error).not.toContain(secretValues[0]);
    expect(failedProbe.error).toContain("[REDACTED]");
  });

  it("7. Keeps worker FFmpeg check independent of Next.js, Prisma, and REBX web app code", () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const workerSrcDir = path.resolve(currentDir, "../../../worker/video-renderer/src");
    const files = fs.readdirSync(workerSrcDir).filter((f) => f.endsWith(".ts"));

    expect(files).toContain("ffmpeg.ts");
    expect(files).toContain("check-ffmpeg.ts");
    expect(files).toContain("env.ts");

    for (const file of files) {
      const content = fs.readFileSync(path.join(workerSrcDir, file), "utf8");
      expect(content).not.toMatch(/from\s+["']next(?:\/|["'])/);
      expect(content).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(content).not.toMatch(/from\s+["']@\//);
    }
  });

  it("8. Deduplicates Windows Registry PATH lookups across parallel ffmpeg and ffprobe probes and discovers portable WinGet Packages paths", async () => {
    const winGetBin = "C:\\Tools\\WinGet\\Packages\\Gyan.FFmpeg\\bin";
    const regLookupMock = vi.fn(async () => [winGetBin]);

    const sharedStatus = await checkFfmpegEnvironment({
      deps: {
        platform: "win32",
        env: { PATH: "C:\\Windows\\System32" },
        existsSync: (p) =>
          p === `${winGetBin}\\ffmpeg.exe` || p === `${winGetBin}\\ffprobe.exe`,
        isDirectory: () => false,
        resolveWindowsRegistryPathEntries: regLookupMock,
        execFile: async (file) => {
          if (file === `${winGetBin}\\ffmpeg.exe`) {
            return { stdout: "ffmpeg version 9.0.1 Copyright (c) 2000-2026\n", stderr: "" };
          }
          if (file === `${winGetBin}\\ffprobe.exe`) {
            return { stdout: "ffprobe version 9.0.1 Copyright (c) 2007-2026\n", stderr: "" };
          }
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      },
    });

    expect(sharedStatus.readyForPartC32Rendering).toBe(true);
    expect(sharedStatus.ffmpeg.source).toBe("windows_registry_path");
    expect(sharedStatus.ffprobe.source).toBe("windows_registry_path");
    expect(regLookupMock).toHaveBeenCalledTimes(1);

    // Also verify generic WinGet Packages directory scan using an isolated temp LOCALAPPDATA root
    const tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "rebx-winget-probe-"));
    try {
      const binDir = path.join(
        tempLocalAppData,
        "Microsoft",
        "WinGet",
        "Packages",
        "Gyan.FFmpeg.Sample_8wekyb3d8bbwe",
        "ffmpeg-9.0.1-essentials_build",
        "bin",
      );
      fs.mkdirSync(binDir, { recursive: true });
      const fakeFfmpeg = path.join(binDir, "ffmpeg.exe");
      const fakeFfprobe = path.join(binDir, "ffprobe.exe");
      fs.writeFileSync(fakeFfmpeg, "");
      fs.writeFileSync(fakeFfprobe, "");

      const pkgStatus = await checkFfmpegEnvironment({
        deps: {
          platform: "win32",
          env: {
            PATH: "C:\\Windows\\System32",
            LOCALAPPDATA: tempLocalAppData,
          },
          resolveWindowsRegistryPathEntries: async () => [],
          execFile: async (file) => {
            if (file === fakeFfmpeg) {
              return { stdout: "ffmpeg version 9.0.1-winget\n", stderr: "" };
            }
            if (file === fakeFfprobe) {
              return { stdout: "ffprobe version 9.0.1-winget\n", stderr: "" };
            }
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          },
        },
      });

      expect(pkgStatus.readyForPartC32Rendering).toBe(true);
      expect(pkgStatus.ffmpeg.source).toBe("common_dir");
      expect(pkgStatus.ffprobe.source).toBe("common_dir");
      expect(pkgStatus.ffmpeg.executablePath).toBe(fakeFfmpeg);
      expect(pkgStatus.ffprobe.executablePath).toBe(fakeFfprobe);
    } finally {
      fs.rmSync(tempLocalAppData, { recursive: true, force: true });
    }
  });

  it("9. Discovers FFmpeg and FFprobe independently, supports companion sibling recovery in auto-discovery, and never bypasses explicit overrides", async () => {
    // Independent discovery across separate PATH directories
    const dirA = "D:\\BinariesA";
    const dirB = "D:\\BinariesB";
    const separateStatus = await checkFfmpegEnvironment({
      deps: {
        platform: "win32",
        env: { PATH: `${dirA};${dirB}` },
        existsSync: (p) => p === `${dirA}\\ffmpeg.exe` || p === `${dirB}\\ffprobe.exe`,
        isDirectory: () => false,
        execFile: async (file) => {
          if (file === `${dirA}\\ffmpeg.exe`) {
            return { stdout: "ffmpeg version 9.0.1-dirA\n", stderr: "" };
          }
          if (file === `${dirB}\\ffprobe.exe`) {
            return { stdout: "ffprobe version 9.0.1-dirB\n", stderr: "" };
          }
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      },
    });

    expect(separateStatus.readyForPartC32Rendering).toBe(true);
    expect(separateStatus.ffmpeg.executablePath).toBe(`${dirA}\\ffmpeg.exe`);
    expect(separateStatus.ffprobe.executablePath).toBe(`${dirB}\\ffprobe.exe`);

    // Companion sibling recovery when auto-discovery finds ffmpeg first and initial ffprobe lookup returns ENOENT
    let ffprobeCalls = 0;
    const companionDir = "D:\\SuiteBin";
    const siblingRecoveryStatus = await checkFfmpegEnvironment({
      deps: {
        platform: "win32",
        env: { PATH: companionDir },
        existsSync: (p) =>
          p === `${companionDir}\\ffmpeg.exe` || p === `${companionDir}\\ffprobe.exe`,
        isDirectory: () => false,
        execFile: async (file) => {
          if (file === `${companionDir}\\ffmpeg.exe`) {
            return { stdout: "ffmpeg version 9.0.1-suite\n", stderr: "" };
          }
          if (file === `${companionDir}\\ffprobe.exe`) {
            ffprobeCalls++;
            if (ffprobeCalls === 1) {
              throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
            }
            return { stdout: "ffprobe version 9.0.1-suite\n", stderr: "" };
          }
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      },
    });

    expect(siblingRecoveryStatus.readyForPartC32Rendering).toBe(true);
    expect(siblingRecoveryStatus.ffmpeg.executablePath).toBe(`${companionDir}\\ffmpeg.exe`);
    expect(siblingRecoveryStatus.ffprobe.executablePath).toBe(`${companionDir}\\ffprobe.exe`);
    expect(siblingRecoveryStatus.ffprobe.source).toBe("common_dir");

    // Explicit invalid FFPROBE_PATH must NOT silently fall back to companion sibling ffprobe.exe
    const explicitFailStatus = await checkFfmpegEnvironment({
      ffprobePath: "D:\\InvalidOverride\\ffprobe.exe",
      deps: {
        platform: "win32",
        env: { PATH: companionDir },
        existsSync: (p) =>
          p === `${companionDir}\\ffmpeg.exe` || p === `${companionDir}\\ffprobe.exe`,
        isDirectory: () => false,
        execFile: async (file) => {
          if (file === `${companionDir}\\ffmpeg.exe`) {
            return { stdout: "ffmpeg version 9.0.1-suite\n", stderr: "" };
          }
          if (file === `${companionDir}\\ffprobe.exe`) {
            return { stdout: "ffprobe version 9.0.1-suite\n", stderr: "" };
          }
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      },
    });

    expect(explicitFailStatus.ffmpeg.available).toBe(true);
    expect(explicitFailStatus.ffprobe.available).toBe(false);
    expect(explicitFailStatus.ffprobe.source).toBe("env");
    expect(explicitFailStatus.ffprobe.errorCode).toBe("NOT_FOUND");
    expect(explicitFailStatus.readyForPartC32Rendering).toBe(false);
  });
});
