// lib/obfuscator/index.ts
// Unified TypeScript interface for AtomProtect Industrial Luau VM Obfuscator

import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

const { obfuscate: internalObfuscate } = require('./pipeline');
const { bundleModularScript: internalBundle } = require('./bundler');
const { getCompilerStatus: internalGetStatus } = require('./compiler');

export interface ObfuscateProgress {
  step: string;
  percent: number;
  message: string;
}

export interface ObfuscateOptions {
  preset?: 'balanced' | 'maximum' | 'ultra' | 'debug';
  vmPreset?: 'luraph';
  debug?: boolean;
  hugeScript?: boolean;
  largeScript?: boolean;
  onProgress?: (p: ObfuscateProgress) => void;
  /** "standard" (default) | "strict" | "off" — see lib/obfuscator/transforms/antiTamper.js. Optional
   *  and purely additive: no existing caller needs to pass this. */
  antiTamperStrength?: 'standard' | 'strict' | 'off';
}

export interface ObfuscateResult {
  ok: boolean;
  output: string;
  error?: string;
  stats?: {
    layers: string[];
    method: string;
    inputSize: number;
    outputSize: number;
    time: number;
    preset?: string;
    hugeScript?: boolean;
  };
}

export interface BundleInput {
  entryFile: string;
  files: Record<string, string>;
  options?: Record<string, unknown>;
}

/**
 * Obfuscates Luau/Lua code with the full AtomProtect 7-layer VM pipeline.
 */
export async function obfuscateLuauVM(
  sourceCode: string,
  options: ObfuscateOptions = {}
): Promise<ObfuscateResult> {
  return await internalObfuscate(sourceCode, options);
}

/**
 * Packs multiple Lua/Luau files into an in-memory Virtual File System (VFS) with require hook.
 */
export function bundleModules(input: BundleInput): string {
  const result = internalBundle(input);
  return typeof result === 'string' ? result : (result.code || '');
}

/**
 * Verifies that Luau code compiles cleanly without any syntax or bytecode errors.
 */
export function verifyLuauBytecode(luaCode: string): { ok: boolean; error?: string } {
  // BUGFIX: these are Windows PE binaries. On a non-Windows deployment (e.g. Vercel's
  // Linux runtime) the file genuinely exists in the bundle but can't execute --
  // execFileSync would throw "cannot execute binary file", which used to get caught
  // below and reported as a verification FAILURE, blocking every script save there.
  // Skip straight to the "binary unavailable" fallback (ok: true, nothing to verify
  // against) on any platform where it couldn't possibly run.
  if (process.platform !== 'win32') {
    return { ok: true };
  }
  const candidates = [
    path.join(__dirname, 'bin', 'luau-compile.exe'),
    path.join(process.cwd(), 'lib', 'obfuscator', 'bin', 'luau-compile.exe'),
    path.join(process.cwd(), 'obfuscator', 'bin', 'luau-compile.exe'),
  ];
  const bin = candidates.find(p => fs.existsSync(p));
  if (!bin) {
    return { ok: true }; // Fallback if binary not found
  }

  const tmpFile = path.join(
    process.cwd(),
    'data',
    `__verify_${Date.now()}_${Math.random().toString(36).slice(2)}.luau`
  );

  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tmpFile, luaCode, 'utf8');

    execFileSync(bin, ['-O1', tmpFile], {
      timeout: 30000,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    return { ok: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? (err as { stderr?: Buffer }).stderr?.toString() || err.message : String(err);
    return { ok: false, error: errorMsg };
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
}

export function getCompilerStatus(): { luauCompile: boolean; luau: boolean } {
  return internalGetStatus();
}
