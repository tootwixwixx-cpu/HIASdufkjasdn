# AtomProtect Obfuscator

This folder is a **standalone** obfuscator server — completely separate from the main Next.js app.

## Quick Start

```bat
cd obfuscator
start.bat
```

Or manually:
```bash
npm install
node server.js
```

Dashboard opens at **http://localhost:3001**

## Modes

### ⚡ Polymorphic XOR Mode (default, no setup needed)
- Works immediately after `npm install`
- Wraps scripts in a rolling XOR keystream cipher with anti-hook detection
- Each run produces a unique output

### 🔥 Full VM Mode (download luau-compile.exe)
1. Download `luau-compile.exe` from https://github.com/luau-lang/luau/releases
2. Place it in `obfuscator/bin/luau-compile.exe`
3. Optionally also download `luau.exe` to `obfuscator/bin/luau.exe` for the Run button
4. Restart the server — it auto-detects and switches to Full VM Mode

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/status` | GET | Server status + tool detection |
| `/api/obfuscate` | POST | `{ code }` → `{ uuid, loadstring, output, stats }` |
| `/api/compile` | POST | `{ code }` → `{ ok, output, error }` |
| `/s/:uuid` | GET | Serve raw protected Lua (for loadstring) |
| `/api/scripts` | GET | List all saved scripts |
| `/api/scripts/:uuid` | DELETE | Delete a script |

## Keyboard Shortcuts (Dashboard)

- `Ctrl+Enter` — Obfuscate
- `Ctrl+Shift+Enter` — Run / Compile

## Folder Structure

```
obfuscator/
├── server.js          ← Express server (port 3001)
├── start.bat          ← One-click launcher
├── public/
│   └── index.html     ← Monaco editor dashboard
├── protected/         ← Saved obfuscated scripts
├── bin/
│   ├── luau-compile.exe  ← (download separately)
│   ├── luau.exe          ← (download separately)
│   ├── luau-analyze.exe  ← (download separately, used for local syntax checks)
│   └── luau-ast.exe      ← (download separately, optional AST dump)
├── tools/
│   └── obfuscate-test.js ← reusable local test driver (see "Testing" below)
└── core/
    ├── compiler.js             ← Lua → bytecode (shells out to luau-compile.exe)
    ├── lifter.js                ← Bytecode/disassembly → IR
    ├── bundler.js                ← Flattens multi-module projects into one source
    ├── pipeline.js                ← Orchestrator (compiler → lifter → transforms → generator)
    ├── polymorphic.js             ← XOR wrapper (fallback only when luau-compile.exe is missing)
    └── transforms/
        ├── stringEncrypt.js      ← RC4 + XOR-scatter string constant encryption
        ├── numberMutate.js       ← Numeric constants as arithmetic expressions
        ├── numberFormat.js       ← Lua number literal formatting helper
        ├── deadCode.js           ← Dead-code/junk instruction injection
        ├── junkEngine.js         ← Decoy opcode handlers + outer-layer junk
        ├── antiDump.js           ← Best-effort transient-buffer wipe (see note below)
        ├── antiTamper.js         ← Hook/timing tamper checks
        └── luraphGenerator.js    ← IR → the actual generated Lua VM (columnar struct-of-arrays
                                      interpreter with an opcode binary-search-tree dispatcher).
                                      This is the real "IR → Lua VM" stage; there is no separate
                                      vmGenerator.js.
```

**Note on `antiDump.js`:** despite the name, it only nils one transient local after execution — it does
**not** scrub the decrypted-string cache or the live VM/bytecode arrays, both of which stay resident in
memory for the life of the script. It raises the bar against a casual look, not a determined memory
dumper. `identifierMangle.js` (an unused, disconnected identifier-renamer) has been removed: because this
pipeline compiles source → bytecode → IR → a fresh VM, original Lua identifiers never survive into the
output, so there is nothing at the text level to rename.

## Testing

`tools/obfuscate-test.js` calls `core/pipeline.js`'s `obfuscate()` directly (no server needed) and then
shells out to `bin/luau-compile.exe` (the same tool the pipeline itself uses) for a fast local syntax
check on the result — `bin/luau-analyze.exe` is deliberately NOT used for this, since it's a strict type
checker that flags legitimate Roblox-only globals (`task`, `bit`, `getgenv`, `Vector3`, …) as "unknown"
with no way to load Roblox's type definitions, which is noise rather than a real failure.
Run it with `node tools/obfuscate-test.js <path-to-lua-file> [preset]`. It replaces the old ad-hoc pile of
`test_*.js`/`debug_*.js`/`inspect_*.js` scripts that previously accumulated at the repo root and in `bin/`.
