import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { redactSensitiveString } from "./logger";

export type FfmpegToolName = "ffmpeg" | "ffprobe";

export type ExecutableProbeSource =
  | "env"
  | "path"
  | "windows_registry_path"
  | "common_dir"
  | "none";

export type ExecutableErrorCode =
  | "NOT_FOUND"
  | "INVALID_PATH"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "NON_ZERO_EXIT"
  | "UNEXPECTED_OUTPUT"
  | "EXECUTION_FAILED";

export type ParsedToolVersion = {
  raw: string;
  major: number | null;
  minor: number | null;
  patch: number | null;
};

export type ExecutableProbeResult = {
  tool: FfmpegToolName;
  available: boolean;
  source: ExecutableProbeSource;
  executablePath: string | null;
  version: string | null;
  versionBanner: string | null;
  parsedVersion: ParsedToolVersion | null;
  errorCode: ExecutableErrorCode | null;
  error: string | null;
};

export type FfmpegEnvironmentStatus = {
  platform: NodeJS.Platform;
  checkedAt: string;
  ffmpeg: ExecutableProbeResult;
  ffprobe: ExecutableProbeResult;
  readyForPartC32Rendering: boolean;
};

export type EnvMap = Record<string, string | undefined>;

export type ExecFileResult = {
  stdout: string;
  stderr: string;
};

export type ExecFileOptions = {
  timeout?: number;
  windowsHide?: boolean;
  shell?: false;
  maxBuffer?: number;
  env?: EnvMap;
};

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<ExecFileResult>;

export type FfmpegProbeDeps = {
  execFile?: ExecFileLike;
  existsSync?: (targetPath: string) => boolean;
  isDirectory?: (targetPath: string) => boolean;
  platform?: NodeJS.Platform;
  env?: EnvMap;
  resolveWindowsRegistryPathEntries?: () => Promise<string[]>;
};

const DEFAULT_PROBE_TIMEOUT_MS = 4000;
const REGISTRY_QUERY_TIMEOUT_MS = 4500;
const MAX_PROBE_BUFFER_BYTES = 1024 * 1024;

const SAFE_CHILD_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "SYSTEMDRIVE",
  "HOME",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "LANG",
  "LC_ALL",
]);

const SAFE_WINDOWS_EXPAND_KEYS = [
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
] as const;

export function safeExecFile(
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: "utf8",
        timeout: options.timeout,
        windowsHide: options.windowsHide ?? true,
        shell: false,
        maxBuffer: options.maxBuffer ?? MAX_PROBE_BUFFER_BYTES,
        env: options.env as NodeJS.ProcessEnv | undefined,
      },
      (err, stdout, stderr) => {
        if (err) {
          const enriched = err as Error & { stdout?: string; stderr?: string };
          if (typeof stdout === "string" && enriched.stdout === undefined) {
            enriched.stdout = stdout;
          }
          if (typeof stderr === "string" && enriched.stderr === undefined) {
            enriched.stderr = stderr;
          }
          reject(enriched);
          return;
        }
        resolve({
          stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
          stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
        });
      },
    );
  });
}

function getEnvCaseInsensitive(
  env: EnvMap,
  keyName: string,
): string | undefined {
  if (keyName in env && typeof env[keyName] === "string") {
    return env[keyName];
  }
  const upperTarget = keyName.toUpperCase();
  for (const [k, v] of Object.entries(env)) {
    if (k.toUpperCase() === upperTarget && typeof v === "string") {
      return v;
    }
  }
  return undefined;
}

/**
 * Strips all secrets and application config from child-process env, forwarding only
 * non-sensitive OS runtime variables required to locate and launch executables.
 */
export function buildSafeProbeChildEnv(
  sourceEnv: EnvMap = process.env,
): EnvMap {
  const safeEnv: EnvMap = {};
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (typeof v === "string" && SAFE_CHILD_ENV_KEYS.has(k.toUpperCase())) {
      safeEnv[k] = v;
    }
  }
  return safeEnv;
}

export function normalizeExecutablePathInput(
  raw?: string | null,
):
  | { provided: false }
  | { provided: true; valid: true; value: string }
  | { provided: true; valid: false; error: string } {
  if (raw === undefined || raw === null) {
    return { provided: false };
  }

  let value = raw.trim();
  if (!value) {
    return { provided: false };
  }

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1).trim();
  }

  if (!value) {
    return { provided: false };
  }

  if (/[\0\r\n]/.test(value)) {
    return {
      provided: true,
      valid: false,
      error: "Executable path contains invalid control characters.",
    };
  }

  return { provided: true, valid: true, value };
}

export function expandSafeWindowsEnvVars(
  input: string,
  env: EnvMap = process.env,
): string {
  return input.replace(/%([^%]+)%/g, (fullMatch, varName: string) => {
    const upper = varName.trim().toUpperCase();
    if (!SAFE_WINDOWS_EXPAND_KEYS.includes(upper as (typeof SAFE_WINDOWS_EXPAND_KEYS)[number])) {
      return fullMatch;
    }
    const resolved = getEnvCaseInsensitive(env, upper);
    return resolved ?? fullMatch;
  });
}

function splitPathVariable(rawPath: string | undefined, platform: NodeJS.Platform): string[] {
  if (!rawPath?.trim()) return [];
  const delimiter = platform === "win32" ? ";" : ":";
  const out: string[] = [];
  for (const segment of rawPath.split(delimiter)) {
    const cleaned = segment.trim().replace(/^"(.*)"$/, "$1").trim();
    if (cleaned) {
      out.push(cleaned);
    }
  }
  return out;
}

function parseRegQueryPathOutput(
  stdout: string,
  env: EnvMap,
): string[] {
  const dirs: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i.exec(line);
    if (!match) continue;
    const expanded = expandSafeWindowsEnvVars(match[1], env);
    for (const dir of splitPathVariable(expanded, "win32")) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * Safely reads current Windows User and Machine PATH entries from the Registry
 * using `reg.exe` without shell interpolation, so executables installed after
 * an IDE/terminal session was launched can still be discovered reliably.
 */
export async function readWindowsRegistryPathEntries(opts?: {
  execFileFn?: ExecFileLike;
  env?: EnvMap;
}): Promise<string[]> {
  const execFn = opts?.execFileFn ?? safeExecFile;
  const env = opts?.env ?? process.env;
  const safeChildEnv = buildSafeProbeChildEnv(env);
  const regKeys = [
    "HKCU\\Environment",
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  ];

  const results = await Promise.allSettled(
    regKeys.map((regKey) =>
      execFn("reg.exe", ["query", regKey, "/v", "Path"], {
        timeout: REGISTRY_QUERY_TIMEOUT_MS,
        windowsHide: true,
        shell: false,
        maxBuffer: 256 * 1024,
        env: safeChildEnv,
      }),
    ),
  );

  const collected: string[] = [];
  for (const res of results) {
    if (res.status === "fulfilled") {
      collected.push(...parseRegQueryPathOutput(res.value.stdout, env));
    }
  }
  return Array.from(new Set(collected));
}

export function parseFfmpegVersionOutput(
  tool: FfmpegToolName,
  stdout: string,
  stderr: string,
): { version: string; versionBanner: string; parsedVersion: ParsedToolVersion } | null {
  const primaryOutput = stdout.trim() ? stdout : stderr;
  if (!primaryOutput.trim()) {
    return null;
  }

  const lines = primaryOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) {
    return null;
  }

  const bannerRegex = new RegExp(`^${tool}\\s+version\\s+([^\\s]+)`, "i");
  const match = bannerRegex.exec(firstLine);
  if (!match?.[1]) {
    return null;
  }

  const rawVersion = match[1];
  const semverMatch = /^v?n?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(rawVersion);

  return {
    version: rawVersion,
    versionBanner: firstLine,
    parsedVersion: {
      raw: rawVersion,
      major: semverMatch ? Number(semverMatch[1]) : null,
      minor: semverMatch ? Number(semverMatch[2]) : null,
      patch: semverMatch && semverMatch[3] !== undefined ? Number(semverMatch[3]) : null,
    },
  };
}

function defaultIsDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function joinPathForPlatform(platform: NodeJS.Platform, dir: string, file: string): string {
  return platform === "win32" ? path.win32.join(dir, file) : path.posix.join(dir, file);
}

function dirnameForPlatform(platform: NodeJS.Platform, targetPath: string): string {
  return platform === "win32" ? path.win32.dirname(targetPath) : path.posix.dirname(targetPath);
}

function discoverWinGetFfmpegBinDirs(localAppData: string): string[] {
  const packagesDir = path.win32.join(localAppData, "Microsoft", "WinGet", "Packages");
  const discovered: string[] = [];

  try {
    const packageEntries = fs.readdirSync(packagesDir, { withFileTypes: true });
    let inspectedPackages = 0;

    for (const pkg of packageEntries) {
      if (!pkg.isDirectory() || !/ffmpeg/i.test(pkg.name)) continue;
      inspectedPackages++;
      if (inspectedPackages > 15) break;

      const pkgPath = path.win32.join(packagesDir, pkg.name);
      discovered.push(path.win32.join(pkgPath, "bin"), pkgPath);

      try {
        const subEntries = fs.readdirSync(pkgPath, { withFileTypes: true });
        let inspectedSubdirs = 0;
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          inspectedSubdirs++;
          if (inspectedSubdirs > 15) break;
          const subPath = path.win32.join(pkgPath, sub.name);
          discovered.push(path.win32.join(subPath, "bin"), subPath);
        }
      } catch {
        // Ignore unreadable WinGet package subdirectories
      }
    }
  } catch {
    // WinGet Packages directory may not exist
  }

  return discovered;
}

function getCommonInstallDirs(platform: NodeJS.Platform, env: EnvMap): string[] {
  if (platform === "win32") {
    const dirs: string[] = [];
    const localAppData = getEnvCaseInsensitive(env, "LOCALAPPDATA");
    const userProfile = getEnvCaseInsensitive(env, "USERPROFILE");
    if (localAppData) {
      dirs.push(joinPathForPlatform("win32", localAppData, "Microsoft\\WinGet\\Links"));
      dirs.push(...discoverWinGetFfmpegBinDirs(localAppData));
    }
    if (userProfile) {
      dirs.push(joinPathForPlatform("win32", userProfile, "scoop\\shims"));
    }
    dirs.push(
      "C:\\ProgramData\\chocolatey\\bin",
      "C:\\ffmpeg\\bin",
      "C:\\Program Files\\ffmpeg\\bin",
      "C:\\Program Files (x86)\\ffmpeg\\bin",
    );
    return Array.from(new Set(dirs));
  }

  return ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/snap/bin", "/app/.apt/usr/bin"];
}

type CandidateEntry = {
  executable: string;
  source: Exclude<ExecutableProbeSource, "none">;
};

function createCandidateDeduplicator(platform: NodeJS.Platform) {
  const seen = new Set<string>();
  return {
    pushIfUnique(list: CandidateEntry[], candidate: CandidateEntry) {
      const key = platform === "win32" ? candidate.executable.toLowerCase() : candidate.executable;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(candidate);
      }
    },
  };
}

function classifyExecFailure(params: {
  err: unknown;
  tool: FfmpegToolName;
  candidate: string;
  source: Exclude<ExecutableProbeSource, "none">;
  timeoutMs: number;
  secrets: readonly string[];
}): { errorCode: ExecutableErrorCode; message: string } {
  const { err, tool, candidate, source, timeoutMs, secrets } = params;
  const errObj = (err && typeof err === "object" ? err : {}) as {
    code?: string | number;
    status?: number;
    killed?: boolean;
    signal?: string | null;
    name?: string;
    message?: string;
    stderr?: string;
    stdout?: string;
  };

  if (
    (errObj.killed && (errObj.signal === "SIGTERM" || errObj.signal === "SIGKILL")) ||
    errObj.code === "ETIMEDOUT" ||
    errObj.name === "AbortError" ||
    (typeof errObj.message === "string" && /timed?\s*out/i.test(errObj.message))
  ) {
    return {
      errorCode: "TIMEOUT",
      message: `${tool} -version timed out after ${timeoutMs}ms (${candidate}).`,
    };
  }

  if (errObj.code === "ENOENT") {
    if (source === "env") {
      const envVar = tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
      return {
        errorCode: "NOT_FOUND",
        message: redactSensitiveString(
          `Configured ${envVar} executable was not found: ${candidate}`,
          secrets,
        ),
      };
    }
    return {
      errorCode: "NOT_FOUND",
      message: `${tool} executable not found in PATH or standard installation directories.`,
    };
  }

  if (errObj.code === "EISDIR") {
    return {
      errorCode: "INVALID_PATH",
      message: redactSensitiveString(
        `Configured path points to a directory rather than an executable: ${candidate}`,
        secrets,
      ),
    };
  }

  if (errObj.code === "EACCES" || errObj.code === "EPERM") {
    return {
      errorCode: "PERMISSION_DENIED",
      message: redactSensitiveString(
        `Permission denied executing ${tool} (${candidate}).`,
        secrets,
      ),
    };
  }

  const numericExit =
    typeof errObj.code === "number"
      ? errObj.code
      : typeof errObj.status === "number"
        ? errObj.status
        : null;
  if (numericExit !== null || errObj.signal) {
    const rawDetail = `${errObj.stderr ?? ""}\n${errObj.stdout ?? ""}`.trim();
    const detailLine = rawDetail ? rawDetail.split(/\r?\n/)[0]?.trim().slice(0, 180) : "";
    const reason =
      numericExit !== null ? `exit code ${numericExit}` : `signal ${errObj.signal ?? "unknown"}`;
    const baseMsg = detailLine
      ? `${tool} exited with ${reason}: ${detailLine}`
      : `${tool} exited with ${reason} (${candidate}).`;
    return {
      errorCode: "NON_ZERO_EXIT",
      message: redactSensitiveString(baseMsg, secrets),
    };
  }

  const rawMsg =
    err instanceof Error && err.message.trim()
      ? err.message.trim()
      : `Failed to execute ${tool} (${candidate}).`;
  return {
    errorCode: "EXECUTION_FAILED",
    message: redactSensitiveString(rawMsg, secrets),
  };
}

async function probeCandidates(params: {
  tool: FfmpegToolName;
  candidates: readonly CandidateEntry[];
  timeoutMs: number;
  secrets: readonly string[];
  execFileFn: ExecFileLike;
  safeChildEnv: EnvMap;
}): Promise<{
  match: ExecutableProbeResult | null;
  bestFailure: { errorCode: ExecutableErrorCode; message: string } | null;
}> {
  let bestFailure: { errorCode: ExecutableErrorCode; message: string } | null = null;

  for (const candidate of params.candidates) {
    try {
      const { stdout, stderr } = await params.execFileFn(candidate.executable, ["-version"], {
        timeout: params.timeoutMs,
        windowsHide: true,
        shell: false,
        maxBuffer: MAX_PROBE_BUFFER_BYTES,
        env: params.safeChildEnv,
      });

      const parsed = parseFfmpegVersionOutput(params.tool, stdout ?? "", stderr ?? "");
      if (parsed) {
        return {
          match: {
            tool: params.tool,
            available: true,
            source: candidate.source,
            executablePath: candidate.executable,
            version: parsed.version,
            versionBanner: parsed.versionBanner,
            parsedVersion: parsed.parsedVersion,
            errorCode: null,
            error: null,
          },
          bestFailure: null,
        };
      }

      const unexpectedFailure: { errorCode: ExecutableErrorCode; message: string } = {
        errorCode: "UNEXPECTED_OUTPUT",
        message: redactSensitiveString(
          `Executed ${candidate.executable}, but output did not match expected "${params.tool} version ..." format.`,
          params.secrets,
        ),
      };
      if (!bestFailure || bestFailure.errorCode === "NOT_FOUND") {
        bestFailure = unexpectedFailure;
      }
    } catch (err) {
      const classified = classifyExecFailure({
        err,
        tool: params.tool,
        candidate: candidate.executable,
        source: candidate.source,
        timeoutMs: params.timeoutMs,
        secrets: params.secrets,
      });

      if (classified.errorCode !== "NOT_FOUND") {
        bestFailure = classified;
      } else if (!bestFailure) {
        bestFailure = classified;
      }
    }
  }

  return { match: null, bestFailure };
}

export async function discoverExecutableVersion(params: {
  tool: FfmpegToolName;
  explicitPath?: string;
  timeoutMs?: number;
  secrets?: readonly string[];
  deps?: FfmpegProbeDeps;
}): Promise<ExecutableProbeResult> {
  const deps = params.deps ?? {};
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const existsSyncFn = deps.existsSync ?? fs.existsSync;
  const isDirectoryFn = deps.isDirectory ?? defaultIsDirectory;
  const execFileFn = deps.execFile ?? safeExecFile;
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const secrets = params.secrets ?? [];
  const safeChildEnv = buildSafeProbeChildEnv(env);
  const exeName = platform === "win32" ? `${params.tool}.exe` : params.tool;

  const normalizedExplicit = normalizeExecutablePathInput(params.explicitPath);

  // Branch 1: Explicit FFMPEG_PATH / FFPROBE_PATH override.
  // Never silently fall back to PATH if an explicit path is misconfigured or broken.
  if (normalizedExplicit.provided) {
    const envVarName = params.tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
    if (!normalizedExplicit.valid) {
      return {
        tool: params.tool,
        available: false,
        source: "env",
        executablePath: null,
        version: null,
        versionBanner: null,
        parsedVersion: null,
        errorCode: "INVALID_PATH",
        error: redactSensitiveString(`${envVarName}: ${normalizedExplicit.error}`, secrets),
      };
    }

    const explicitValue = normalizedExplicit.value;
    if (existsSyncFn(explicitValue) && isDirectoryFn(explicitValue)) {
      return {
        tool: params.tool,
        available: false,
        source: "env",
        executablePath: null,
        version: null,
        versionBanner: null,
        parsedVersion: null,
        errorCode: "INVALID_PATH",
        error: redactSensitiveString(
          `Configured ${envVarName} points to a directory rather than an executable file (${explicitValue}).`,
          secrets,
        ),
      };
    }

    const explicitProbe = await probeCandidates({
      tool: params.tool,
      candidates: [{ executable: explicitValue, source: "env" }],
      timeoutMs,
      secrets,
      execFileFn,
      safeChildEnv,
    });
    if (explicitProbe.match) {
      return explicitProbe.match;
    }

    return {
      tool: params.tool,
      available: false,
      source: "env",
      executablePath: null,
      version: null,
      versionBanner: null,
      parsedVersion: null,
      errorCode: explicitProbe.bestFailure?.errorCode ?? "NOT_FOUND",
      error:
        explicitProbe.bestFailure?.message ??
        `${params.tool} executable not found at configured ${envVarName}.`,
    };
  }

  // Branch 2: Automatic discovery (process PATH -> Windows Registry PATH -> common directories)
  const dedup = createCandidateDeduplicator(platform);

  // Phase 2a: Process PATH
  const pathCandidates: CandidateEntry[] = [];
  const rawProcessPath =
    getEnvCaseInsensitive(env, "PATH") ?? getEnvCaseInsensitive(env, "Path");
  for (const dir of splitPathVariable(rawProcessPath, platform)) {
    const candidateExe = joinPathForPlatform(platform, dir, exeName);
    if (existsSyncFn(candidateExe) && !isDirectoryFn(candidateExe)) {
      dedup.pushIfUnique(pathCandidates, { executable: candidateExe, source: "path" });
    }
  }
  dedup.pushIfUnique(pathCandidates, { executable: params.tool, source: "path" });

  const pathProbe = await probeCandidates({
    tool: params.tool,
    candidates: pathCandidates,
    timeoutMs,
    secrets,
    execFileFn,
    safeChildEnv,
  });
  if (pathProbe.match) {
    return pathProbe.match;
  }

  let bestFailure = pathProbe.bestFailure;

  // Phase 2b (Windows only): Check updated User/Machine Registry PATH when inherited process PATH is stale
  if (platform === "win32") {
    const registryDirs = deps.resolveWindowsRegistryPathEntries
      ? await deps.resolveWindowsRegistryPathEntries()
      : deps.execFile
        ? []
        : await readWindowsRegistryPathEntries({ env });

    const registryCandidates: CandidateEntry[] = [];
    for (const dir of registryDirs) {
      const candidateExe = joinPathForPlatform("win32", dir, exeName);
      if (existsSyncFn(candidateExe) && !isDirectoryFn(candidateExe)) {
        dedup.pushIfUnique(registryCandidates, {
          executable: candidateExe,
          source: "windows_registry_path",
        });
      }
    }

    if (registryCandidates.length > 0) {
      const regProbe = await probeCandidates({
        tool: params.tool,
        candidates: registryCandidates,
        timeoutMs,
        secrets,
        execFileFn,
        safeChildEnv,
      });
      if (regProbe.match) {
        return regProbe.match;
      }
      if (regProbe.bestFailure && regProbe.bestFailure.errorCode !== "NOT_FOUND") {
        bestFailure = regProbe.bestFailure;
      }
    }
  }

  // Phase 2c: Common platform installation locations
  const commonCandidates: CandidateEntry[] = [];
  for (const dir of getCommonInstallDirs(platform, env)) {
    const candidateExe = joinPathForPlatform(platform, dir, exeName);
    if (existsSyncFn(candidateExe) && !isDirectoryFn(candidateExe)) {
      dedup.pushIfUnique(commonCandidates, {
        executable: candidateExe,
        source: "common_dir",
      });
    }
  }

  if (commonCandidates.length > 0) {
    const commonProbe = await probeCandidates({
      tool: params.tool,
      candidates: commonCandidates,
      timeoutMs,
      secrets,
      execFileFn,
      safeChildEnv,
    });
    if (commonProbe.match) {
      return commonProbe.match;
    }
    if (commonProbe.bestFailure && commonProbe.bestFailure.errorCode !== "NOT_FOUND") {
      bestFailure = commonProbe.bestFailure;
    }
  }

  return {
    tool: params.tool,
    available: false,
    source: "none",
    executablePath: null,
    version: null,
    versionBanner: null,
    parsedVersion: null,
    errorCode: bestFailure?.errorCode ?? "NOT_FOUND",
    error:
      bestFailure?.message ??
      `${params.tool} executable not found in PATH or standard installation directories.`,
  };
}

async function probeCompanionSiblingDirectory(params: {
  missingTool: FfmpegToolName;
  siblingExecutablePath: string;
  timeoutMs?: number;
  secrets?: readonly string[];
  deps?: FfmpegProbeDeps;
}): Promise<ExecutableProbeResult | null> {
  const deps = params.deps ?? {};
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const existsSyncFn = deps.existsSync ?? fs.existsSync;
  const isDirectoryFn = deps.isDirectory ?? defaultIsDirectory;
  const execFileFn = deps.execFile ?? safeExecFile;
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const secrets = params.secrets ?? [];
  const safeChildEnv = buildSafeProbeChildEnv(env);
  const exeName = platform === "win32" ? `${params.missingTool}.exe` : params.missingTool;

  const siblingDir = dirnameForPlatform(platform, params.siblingExecutablePath);
  if (!siblingDir || siblingDir === ".") {
    return null;
  }

  const candidateExe = joinPathForPlatform(platform, siblingDir, exeName);
  if (!existsSyncFn(candidateExe) || isDirectoryFn(candidateExe)) {
    return null;
  }

  const probe = await probeCandidates({
    tool: params.missingTool,
    candidates: [{ executable: candidateExe, source: "common_dir" }],
    timeoutMs,
    secrets,
    execFileFn,
    safeChildEnv,
  });

  return probe.match;
}

/**
 * Read-only availability check for FFmpeg and FFprobe.
 * Does not install binaries or execute media rendering pipelines.
 */
export async function checkFfmpegEnvironment(opts?: {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  secrets?: readonly string[];
  deps?: FfmpegProbeDeps;
}): Promise<FfmpegEnvironmentStatus> {
  const baseDeps = opts?.deps;
  let sharedRegistryPromise: Promise<string[]> | null = null;
  const sharedDeps: FfmpegProbeDeps | undefined =
    baseDeps?.resolveWindowsRegistryPathEntries || !baseDeps?.execFile
      ? {
          ...baseDeps,
          resolveWindowsRegistryPathEntries: () => {
            if (!sharedRegistryPromise) {
              sharedRegistryPromise = baseDeps?.resolveWindowsRegistryPathEntries
                ? baseDeps.resolveWindowsRegistryPathEntries()
                : readWindowsRegistryPathEntries({ env: baseDeps?.env });
            }
            return sharedRegistryPromise;
          },
        }
      : baseDeps;

  let [ffmpeg, ffprobe] = await Promise.all([
    discoverExecutableVersion({
      tool: "ffmpeg",
      explicitPath: opts?.ffmpegPath,
      timeoutMs: opts?.timeoutMs,
      secrets: opts?.secrets,
      deps: sharedDeps,
    }),
    discoverExecutableVersion({
      tool: "ffprobe",
      explicitPath: opts?.ffprobePath,
      timeoutMs: opts?.timeoutMs,
      secrets: opts?.secrets,
      deps: sharedDeps,
    }),
  ]);

  // If automatic discovery found one companion executable, check its directory for the other tool
  // (never bypasses explicit FFMPEG_PATH / FFPROBE_PATH overrides).
  if (
    ffmpeg.available &&
    ffmpeg.executablePath &&
    !ffprobe.available &&
    ffprobe.errorCode === "NOT_FOUND" &&
    !normalizeExecutablePathInput(opts?.ffprobePath).provided
  ) {
    const siblingMatch = await probeCompanionSiblingDirectory({
      missingTool: "ffprobe",
      siblingExecutablePath: ffmpeg.executablePath,
      timeoutMs: opts?.timeoutMs,
      secrets: opts?.secrets,
      deps: sharedDeps,
    });
    if (siblingMatch) {
      ffprobe = siblingMatch;
    }
  } else if (
    ffprobe.available &&
    ffprobe.executablePath &&
    !ffmpeg.available &&
    ffmpeg.errorCode === "NOT_FOUND" &&
    !normalizeExecutablePathInput(opts?.ffmpegPath).provided
  ) {
    const siblingMatch = await probeCompanionSiblingDirectory({
      missingTool: "ffmpeg",
      siblingExecutablePath: ffprobe.executablePath,
      timeoutMs: opts?.timeoutMs,
      secrets: opts?.secrets,
      deps: sharedDeps,
    });
    if (siblingMatch) {
      ffmpeg = siblingMatch;
    }
  }

  return {
    platform: baseDeps?.platform ?? process.platform,
    checkedAt: new Date().toISOString(),
    ffmpeg,
    ffprobe,
    readyForPartC32Rendering: ffmpeg.available && ffprobe.available,
  };
}

/* ---------- Part C3.2.4: Safe FFmpeg Execution & FFprobe Verification ---------- */

export type WorkerFfmpegErrorCode =
  | "FFMPEG_UNAVAILABLE"
  | "FFMPEG_EXEC_FAILED"
  | "FFMPEG_TIMEOUT"
  | "FFMPEG_CANCELLED"
  | "FFPROBE_EXEC_FAILED"
  | "INVALID_MEDIA_INPUT"
  | "INVALID_RENDER_OUTPUT";

export class WorkerFfmpegError extends Error {
  code: WorkerFfmpegErrorCode;
  exitCode?: number | null;
  stderrTail?: string;

  constructor(
    code: WorkerFfmpegErrorCode,
    message: string,
    opts?: { exitCode?: number | null; stderrTail?: string },
  ) {
    super(message);
    this.name = "WorkerFfmpegError";
    this.code = code;
    this.exitCode = opts?.exitCode ?? null;
    this.stderrTail = opts?.stderrTail;
  }
}

const MAX_FFMPEG_STDERR_BYTES = 16 * 1024;
const MAX_FFMPEG_PROGRESS_LINE_CHARS = 4096;
const MAX_FFPROBE_BUFFER_BYTES = 2 * 1024 * 1024;
const SIGKILL_GRACE_MS = 1500;

/**
 * Redacts secrets, configured private directories, and host filesystem path prefixes
 * so logs and job failure messages never leak credentials or internal server paths.
 */
export function sanitizeFfmpegErrorText(
  rawText: string,
  opts?: {
    secrets?: readonly string[];
    redactDirs?: readonly string[];
  },
): string {
  let out = redactSensitiveString(rawText ?? "", opts?.secrets ?? []);

  const dirsToStrip = new Set<string>([
    process.cwd(),
    os.tmpdir(),
    ...(opts?.redactDirs ?? []),
  ]);

  const sortedDirs = Array.from(dirsToStrip)
    .map((d) => d?.trim())
    .filter((d): d is string => Boolean(d && d.length >= 3))
    .sort((a, b) => b.length - a.length);

  for (const dir of sortedDirs) {
    const normalizedFwd = dir.replace(/\\/g, "/");
    for (const variant of [dir, normalizedFwd]) {
      if (variant.length >= 3) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, process.platform === "win32" ? "gi" : "g"), "[redacted-dir]");
      }
    }
  }

  // Also strip Windows drive paths (`C:\foo\bar\file.jpg` -> `[path]/file.jpg`) and POSIX storage/home paths
  out = out.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n\s]+\\)+([^\\/:*?"<>|\r\n\s]+)/g, "[path]/$1");
  out = out.replace(/\/(?:home|root|var|tmp|opt|app|Users|storage)\/(?:[^\s:'"`]+\/)*([^\s:'"`/]+)/gi, "[path]/$1");

  return out;
}

export function parseFfmpegTimeToSeconds(raw: string): number | null {
  const clean = raw.trim();
  if (!clean || clean === "N/A") return null;
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(clean);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

export function parseFfprobeFrameRate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (!clean || clean === "0/0" || clean === "N/A") return null;
  if (clean.includes("/")) {
    const [numRaw, denRaw] = clean.split("/");
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) {
      return null;
    }
    return num / den;
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type FfmpegProgressSample = {
  frame: number | null;
  fps: number | null;
  outTimeUs: number | null;
  outTimeSec: number | null;
  totalSizeBytes: number | null;
  speed: string | null;
  progress: "continue" | "end" | null;
  ratio: number | null;
};

export type RunFfmpegResult = {
  durationMs: number;
  stderrTail: string;
  lastProgress: FfmpegProgressSample | null;
};

function appendBoundedStderrTail(existing: Buffer, chunk: Buffer, maxBytes: number): Buffer {
  const combined = Buffer.concat([existing, chunk]);
  if (combined.byteLength <= maxBytes) {
    return combined;
  }
  return combined.subarray(combined.byteLength - maxBytes);
}

function createAbortError(message: string): WorkerFfmpegError {
  return new WorkerFfmpegError("FFMPEG_CANCELLED", message);
}

function killChildSafely(child: ReturnType<typeof spawn>): void {
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const killTimer = setTimeout(() => {
    try {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    } catch {
      // Child already exited
    }
  }, SIGKILL_GRACE_MS);
  if (typeof killTimer.unref === "function") {
    killTimer.unref();
  }
}

/**
 * Safely executes FFmpeg via `spawn` with `shell: false`, argument arrays, bounded stderr tail,
 * line-buffered `-progress pipe:1` parsing, timeout enforcement, and AbortSignal cancellation.
 */
export async function runFfmpegWithProgress(params: {
  ffmpegPath: string;
  args: readonly string[];
  expectedDurationSec?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  redactDirs?: readonly string[];
  maxStderrBytes?: number;
  env?: EnvMap;
  onProgress?: (sample: FfmpegProgressSample) => void;
}): Promise<RunFfmpegResult> {
  const ffmpegPath = params.ffmpegPath.trim();
  if (!ffmpegPath) {
    throw new WorkerFfmpegError("FFMPEG_UNAVAILABLE", "FFmpeg executable path is empty.");
  }

  if (params.signal?.aborted) {
    throw createAbortError("FFmpeg render cancelled before execution.");
  }

  const timeoutMs = params.timeoutMs ?? 300_000;
  const maxStderrBytes = params.maxStderrBytes ?? MAX_FFMPEG_STDERR_BYTES;
  const expectedDurationSec =
    params.expectedDurationSec && params.expectedDurationSec > 0
      ? params.expectedDurationSec
      : null;

  // Ensure -progress pipe:1 and -nostats are always enabled for real progress telemetry
  const finalArgs = ["-nostdin", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...params.args];

  const startedAt = Date.now();
  const safeChildEnv = buildSafeProbeChildEnv(params.env ?? process.env);

  return new Promise<RunFfmpegResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let stderrTailBuf: Buffer = Buffer.alloc(0);
    let stdoutLineBuf = "";
    let lastProgress: FfmpegProgressSample | null = null;

    let currentBlock: {
      frame: number | null;
      fps: number | null;
      outTimeUs: number | null;
      outTimeSec: number | null;
      totalSizeBytes: number | null;
      speed: string | null;
    } = {
      frame: null,
      fps: null,
      outTimeUs: null,
      outTimeSec: null,
      totalSizeBytes: null,
      speed: null,
    };

    const child = spawn(ffmpegPath, finalArgs, {
      shell: false,
      windowsHide: true,
      env: safeChildEnv as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timeoutTimer: NodeJS.Timeout | null = null;
    const cleanupHooks = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (params.signal) {
        params.signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      if (settled || cancelled) return;
      cancelled = true;
      killChildSafely(child);
    };

    if (params.signal) {
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killChildSafely(child);
      }, timeoutMs);
      if (typeof timeoutTimer.unref === "function") {
        timeoutTimer.unref();
      }
    }

    const emitBlock = (progressStatus: "continue" | "end") => {
      const outTimeSec =
        progressStatus === "end" && expectedDurationSec !== null
          ? Math.max(currentBlock.outTimeSec ?? 0, expectedDurationSec)
          : currentBlock.outTimeSec;

      const ratio =
        expectedDurationSec && outTimeSec !== null
          ? Math.min(1, Math.max(0, outTimeSec / expectedDurationSec))
          : progressStatus === "end"
            ? 1
            : null;

      const sample: FfmpegProgressSample = {
        frame: currentBlock.frame,
        fps: currentBlock.fps,
        outTimeUs: currentBlock.outTimeUs,
        outTimeSec,
        totalSizeBytes: currentBlock.totalSizeBytes,
        speed: currentBlock.speed,
        progress: progressStatus,
        ratio,
      };
      lastProgress = sample;
      try {
        params.onProgress?.(sample);
      } catch {
        // Ignore non-fatal progress callback error
      }
    };

    const handleProgressLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) return;

      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();

      switch (key) {
        case "frame": {
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0) currentBlock.frame = Math.round(n);
          break;
        }
        case "fps": {
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0) currentBlock.fps = n;
          break;
        }
        case "out_time_us": {
          const us = Number(val);
          if (Number.isFinite(us) && us >= 0) {
            currentBlock.outTimeUs = us;
            currentBlock.outTimeSec = us / 1_000_000;
          }
          break;
        }
        case "out_time": {
          const parsedSec = parseFfmpegTimeToSeconds(val);
          if (parsedSec !== null && currentBlock.outTimeSec === null) {
            currentBlock.outTimeSec = parsedSec;
          }
          break;
        }
        case "out_time_ms": {
          // FFmpeg historically writes microseconds in out_time_ms; use only if out_time_us and out_time absent
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0 && currentBlock.outTimeUs === null && currentBlock.outTimeSec === null) {
            currentBlock.outTimeUs = n;
            currentBlock.outTimeSec = n / 1_000_000;
          }
          break;
        }
        case "total_size": {
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0) currentBlock.totalSizeBytes = n;
          break;
        }
        case "speed": {
          if (val && val !== "N/A") currentBlock.speed = val;
          break;
        }
        case "progress": {
          if (val === "continue" || val === "end") {
            emitBlock(val);
            currentBlock = {
              frame: null,
              fps: null,
              outTimeUs: null,
              outTimeSec: null,
              totalSizeBytes: null,
              speed: null,
            };
          }
          break;
        }
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutLineBuf += chunk.toString("utf8");
      if (stdoutLineBuf.length > MAX_FFMPEG_PROGRESS_LINE_CHARS * 4) {
        stdoutLineBuf = stdoutLineBuf.slice(-MAX_FFMPEG_PROGRESS_LINE_CHARS);
      }
      let newlineIdx = stdoutLineBuf.indexOf("\n");
      while (newlineIdx >= 0) {
        const line = stdoutLineBuf.slice(0, newlineIdx);
        stdoutLineBuf = stdoutLineBuf.slice(newlineIdx + 1);
        handleProgressLine(line);
        newlineIdx = stdoutLineBuf.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTailBuf = appendBoundedStderrTail(stderrTailBuf, chunk, maxStderrBytes);
    });

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupHooks();

      if (cancelled || params.signal?.aborted) {
        reject(createAbortError("FFmpeg render job was cancelled."));
        return;
      }

      const rawMsg = err instanceof Error ? err.message : "Failed to start FFmpeg process.";
      const sanitized = sanitizeFfmpegErrorText(rawMsg, {
        secrets: params.secrets,
        redactDirs: params.redactDirs,
      });
      reject(new WorkerFfmpegError("FFMPEG_EXEC_FAILED", `FFmpeg spawn error: ${sanitized}`));
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanupHooks();

      if (stdoutLineBuf.trim()) {
        handleProgressLine(stdoutLineBuf);
      }

      const sanitizedTail = sanitizeFfmpegErrorText(stderrTailBuf.toString("utf8").trim(), {
        secrets: params.secrets,
        redactDirs: params.redactDirs,
      });

      if (cancelled || params.signal?.aborted) {
        reject(createAbortError("FFmpeg render job was cancelled."));
        return;
      }

      if (timedOut) {
        reject(
          new WorkerFfmpegError(
            "FFMPEG_TIMEOUT",
            `FFmpeg rendering timed out after ${timeoutMs}ms.`,
            { exitCode: code, stderrTail: sanitizedTail },
          ),
        );
        return;
      }

      if (code !== 0) {
        const lastErrorLine =
          sanitizedTail
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-2)
            .join(" | ") || `signal ${signal ?? "unknown"}`;
        reject(
          new WorkerFfmpegError(
            "FFMPEG_EXEC_FAILED",
            `FFmpeg failed with exit code ${code ?? "null"}: ${lastErrorLine.slice(0, 350)}`,
            { exitCode: code, stderrTail: sanitizedTail },
          ),
        );
        return;
      }

      resolve({
        durationMs: Date.now() - startedAt,
        stderrTail: sanitizedTail,
        lastProgress,
      });
    });
  });
}

const ffprobeJsonSchema = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      duration: z.string().optional(),
      size: z.string().optional(),
      bit_rate: z.string().optional(),
    })
    .optional(),
  streams: z
    .array(
      z.object({
        index: z.number().int().optional(),
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        pix_fmt: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        avg_frame_rate: z.string().optional(),
        r_frame_rate: z.string().optional(),
        sample_rate: z.string().optional(),
        channels: z.number().optional(),
        duration: z.string().optional(),
        nb_frames: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type ProbedVideoStream = {
  index: number;
  codecName: string;
  pixelFormat: string | null;
  width: number;
  height: number;
  fps: number | null;
  durationSec: number | null;
  nbFrames: number | null;
};

export type ProbedAudioStream = {
  index: number;
  codecName: string;
  sampleRate: number | null;
  channels: number | null;
  durationSec: number | null;
};

export type ProbedMediaInfo = {
  fileSizeBytes: number;
  formatName: string;
  durationSec: number | null;
  bitRate: number | null;
  videoStreams: ProbedVideoStream[];
  audioStreams: ProbedAudioStream[];
};

function parsePositiveFiniteNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Safely runs FFprobe on a local file without shell interpolation and returns structured media metadata.
 */
export async function probeMediaFile(params: {
  ffprobePath: string;
  filePath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  redactDirs?: readonly string[];
  env?: EnvMap;
}): Promise<ProbedMediaInfo> {
  const ffprobePath = params.ffprobePath.trim();
  if (!ffprobePath) {
    throw new WorkerFfmpegError("FFMPEG_UNAVAILABLE", "FFprobe executable path is empty.");
  }

  if (params.signal?.aborted) {
    throw createAbortError("Media probe cancelled.");
  }

  let fileStat: fs.Stats;
  try {
    fileStat = await fsPromises.stat(params.filePath);
  } catch {
    throw new WorkerFfmpegError(
      "INVALID_MEDIA_INPUT",
      "Media file does not exist or cannot be accessed for inspection.",
    );
  }

  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new WorkerFfmpegError(
      "INVALID_MEDIA_INPUT",
      "Media file is empty or is not a regular file.",
    );
  }

  const safeChildEnv = buildSafeProbeChildEnv(params.env ?? process.env);
  const timeoutMs = params.timeoutMs ?? 15_000;

  const { stdout } = await new Promise<ExecFileResult>((resolve, reject) => {
    const child = execFile(
      ffprobePath,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        params.filePath,
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        shell: false,
        maxBuffer: MAX_FFPROBE_BUFFER_BYTES,
        env: safeChildEnv as NodeJS.ProcessEnv,
      },
      (err, stdoutStr, stderrStr) => {
        if (params.signal) {
          params.signal.removeEventListener("abort", onAbort);
        }
        if (err) {
          if (params.signal?.aborted) {
            reject(createAbortError("Media probe cancelled."));
            return;
          }
          const detail = sanitizeFfmpegErrorText(
            `${stderrStr ?? ""} ${err.message ?? ""}`.trim(),
            { secrets: params.secrets, redactDirs: params.redactDirs },
          );
          reject(
            new WorkerFfmpegError(
              "FFPROBE_EXEC_FAILED",
              `FFprobe inspection failed: ${detail.slice(0, 300)}`,
            ),
          );
          return;
        }
        resolve({
          stdout: typeof stdoutStr === "string" ? stdoutStr : String(stdoutStr ?? ""),
          stderr: typeof stderrStr === "string" ? stderrStr : String(stderrStr ?? ""),
        });
      },
    );

    const onAbort = () => {
      killChildSafely(child);
    };
    if (params.signal) {
      params.signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(stdout);
  } catch {
    throw new WorkerFfmpegError(
      "FFPROBE_EXEC_FAILED",
      "FFprobe returned non-JSON inspection output.",
    );
  }

  const parsed = ffprobeJsonSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new WorkerFfmpegError(
      "FFPROBE_EXEC_FAILED",
      "FFprobe JSON output did not match expected media metadata schema.",
    );
  }

  const formatName = parsed.data.format?.format_name?.trim() ?? "";
  const formatDurationSec = parsePositiveFiniteNumber(parsed.data.format?.duration);
  const formatSize = parsePositiveFiniteNumber(parsed.data.format?.size);
  const bitRate = parsePositiveFiniteNumber(parsed.data.format?.bit_rate);

  const videoStreams: ProbedVideoStream[] = [];
  const audioStreams: ProbedAudioStream[] = [];

  for (let i = 0; i < parsed.data.streams.length; i++) {
    const stream = parsed.data.streams[i];
    if (stream.codec_type === "video") {
      const fps =
        parseFfprobeFrameRate(stream.avg_frame_rate) ??
        parseFfprobeFrameRate(stream.r_frame_rate);
      videoStreams.push({
        index: stream.index ?? i,
        codecName: (stream.codec_name ?? "").toLowerCase(),
        pixelFormat: stream.pix_fmt ?? null,
        width: Number(stream.width ?? 0),
        height: Number(stream.height ?? 0),
        fps,
        durationSec: parsePositiveFiniteNumber(stream.duration) ?? formatDurationSec,
        nbFrames: parsePositiveFiniteNumber(stream.nb_frames),
      });
    } else if (stream.codec_type === "audio") {
      audioStreams.push({
        index: stream.index ?? i,
        codecName: (stream.codec_name ?? "").toLowerCase(),
        sampleRate: parsePositiveFiniteNumber(stream.sample_rate),
        channels: parsePositiveFiniteNumber(stream.channels),
        durationSec: parsePositiveFiniteNumber(stream.duration) ?? formatDurationSec,
      });
    }
  }

  return {
    fileSizeBytes: formatSize ?? fileStat.size,
    formatName,
    durationSec: formatDurationSec,
    bitRate,
    videoStreams,
    audioStreams,
  };
}

export type VerifiedMp4OutputMetadata = {
  container: "mp4";
  formatName: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: "h264";
  pixelFormat: "yuv420p";
  audioCodec: "aac" | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  bitRate: number | null;
  renderedDurationSec: number;
  videoDurationSec: number;
  audioDurationSec: number | null;
  fileSizeBytes: number;
};

/**
 * Inspects a rendered MP4 via FFprobe and enforces container, H.264/yuv420p video,
 * AAC audio, exact width/height, FPS, non-zero file size, and valid duration/A-V sync.
 * Throws WorkerFfmpegError("INVALID_RENDER_OUTPUT") on incomplete, corrupted, or mismatched files.
 */
export async function verifyRenderedMp4Output(params: {
  ffprobePath: string;
  filePath: string;
  expectedWidth: number;
  expectedHeight: number;
  expectedFps: number;
  expectedDurationSec?: number;
  requireAudio?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  redactDirs?: readonly string[];
}): Promise<VerifiedMp4OutputMetadata> {
  const requireAudio = params.requireAudio ?? true;

  let probe: ProbedMediaInfo;
  try {
    probe = await probeMediaFile({
      ffprobePath: params.ffprobePath,
      filePath: params.filePath,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
      secrets: params.secrets,
      redactDirs: params.redactDirs,
    });
  } catch (err) {
    if (err instanceof WorkerFfmpegError && err.code === "FFMPEG_CANCELLED") {
      throw err;
    }
    const detail = err instanceof Error ? err.message : "FFprobe could not inspect rendered MP4.";
    throw new WorkerFfmpegError("INVALID_RENDER_OUTPUT", `Rendered output validation failed: ${detail}`);
  }

  if (probe.fileSizeBytes <= 0) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      "Rendered MP4 file size is zero bytes.",
    );
  }

  const formatTokens = probe.formatName
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!formatTokens.includes("mp4")) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      `Rendered container format "${probe.formatName || "unknown"}" is not a valid MP4 container.`,
    );
  }

  const video = probe.videoStreams[0];
  if (!video) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      "Rendered MP4 does not contain a valid video stream.",
    );
  }

  if (video.codecName !== "h264") {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      `Rendered video codec "${video.codecName || "unknown"}" must be h264.`,
    );
  }

  if (video.pixelFormat !== "yuv420p") {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      `Rendered video pixel format "${video.pixelFormat || "unknown"}" must be yuv420p.`,
    );
  }

  if (video.width !== params.expectedWidth || video.height !== params.expectedHeight) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      `Rendered MP4 dimensions ${video.width}x${video.height} do not match expected ${params.expectedWidth}x${params.expectedHeight}.`,
    );
  }

  if (video.fps === null || Math.abs(video.fps - params.expectedFps) > 0.75) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      `Rendered MP4 frame rate (${video.fps?.toFixed(2) ?? "unknown"}) does not match expected ${params.expectedFps} fps.`,
    );
  }

  const videoDurationSec = video.durationSec ?? probe.durationSec;
  if (!videoDurationSec || videoDurationSec <= 0) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      "Rendered MP4 reports no valid positive video duration.",
    );
  }

  const audio = probe.audioStreams[0] ?? null;
  if (requireAudio && !audio) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      "Rendered MP4 is missing the required AAC audio stream.",
    );
  }

  if (audio) {
    if (audio.codecName !== "aac") {
      throw new WorkerFfmpegError(
        "INVALID_RENDER_OUTPUT",
        `Rendered audio codec "${audio.codecName || "unknown"}" must be aac.`,
      );
    }
    if (!audio.sampleRate || !audio.channels || audio.channels < 1) {
      throw new WorkerFfmpegError(
        "INVALID_RENDER_OUTPUT",
        "Rendered MP4 audio stream has invalid sample rate or channel count.",
      );
    }
    if (audio.durationSec !== null) {
      const avDiff = Math.abs(audio.durationSec - videoDurationSec);
      const maxAllowedDrift = Math.max(0.75, videoDurationSec * 0.08);
      if (avDiff > maxAllowedDrift) {
        throw new WorkerFfmpegError(
          "INVALID_RENDER_OUTPUT",
          `Rendered MP4 audio (${audio.durationSec.toFixed(2)}s) and video (${videoDurationSec.toFixed(2)}s) durations are out of sync.`,
        );
      }
    }
  }

  const renderedDurationSec = probe.durationSec ?? videoDurationSec;
  if (!renderedDurationSec || renderedDurationSec <= 0) {
    throw new WorkerFfmpegError(
      "INVALID_RENDER_OUTPUT",
      "Rendered MP4 container reports zero or missing duration.",
    );
  }

  if (params.expectedDurationSec && params.expectedDurationSec > 0) {
    const minValid = Math.max(0.5, params.expectedDurationSec * 0.85);
    const maxValid = params.expectedDurationSec + 2.5;
    if (renderedDurationSec < minValid || renderedDurationSec > maxValid) {
      throw new WorkerFfmpegError(
        "INVALID_RENDER_OUTPUT",
        `Rendered MP4 duration (${renderedDurationSec.toFixed(2)}s) is inconsistent with expected duration (${params.expectedDurationSec.toFixed(2)}s).`,
      );
    }
  }

  return {
    container: "mp4",
    formatName: probe.formatName,
    width: video.width,
    height: video.height,
    fps: params.expectedFps,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: audio ? "aac" : null,
    audioSampleRate: audio?.sampleRate ?? null,
    audioChannels: audio?.channels ?? null,
    bitRate: probe.bitRate,
    renderedDurationSec: Number(renderedDurationSec.toFixed(3)),
    videoDurationSec: Number(videoDurationSec.toFixed(3)),
    audioDurationSec:
      audio?.durationSec !== null && audio?.durationSec !== undefined
        ? Number(audio.durationSec.toFixed(3))
        : null,
    fileSizeBytes: probe.fileSizeBytes,
  };
}
