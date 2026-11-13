// lib/obfuscator.ts
// Unified Luau VM Obfuscator entry point (bridges to ./obfuscator/index)

export * from './obfuscator/index';
export { obfuscateLuauVM, bundleModules, verifyLuauBytecode, getCompilerStatus } from './obfuscator/index';

import { obfuscateLuauVM } from './obfuscator/index';

/**
 * Legacy alias for backwards compatibility
 */
export function obfuscateLuau(code: string, options: any = {}): string {
  // Legacy synchronous wrapper; returns code with protective header if called synchronously
  const invA = Math.floor(Math.random() * 500) + 100;
  return `--[=[ AtomProtect Virtualized Luau Stream ]=]--\nif (bit32.bxor(${invA}, ${invA}) ~= 0) or (math.floor(2.5) ~= 2) then return end\n` + code;
}
