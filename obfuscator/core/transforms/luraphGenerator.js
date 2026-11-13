// core/transforms/luraphGenerator.js
// Industrial Luraph v14.4.2-Style Columnar Bytecode VM Generator
// Fully Virtualized Architecture with BST Opcode Dispatching, Multi-Tier Junk Code,
// Decoy Pipelines, and Support for All Luau Bytecode Opcodes.

'use strict';

const { toLuraphNumber } = require('./numberFormat');
const { generateDecryptionLua } = require('./stringEncrypt');
const { generateAntiDumpPostamble, generateStringCacheScrub } = require('./antiDump');
const { generateAntiTamperPreamble } = require('./antiTamper');
const {
  generateDecoyOpcodeHandlers,
  generateOuterLayerJunk,
  generateOuterLayerJunkLegacy,
  generateIntegrityBinder
} = require('./junkEngine');

// Resolves a jump/branch/loop target label to its 1-based instruction index. Previously every call
// site silently fell back to `1` (function start) on a lookup miss, which turns a lifter bug (e.g. a
// lost label) into a SILENT infinite loop / wrong branch at runtime instead of a clear error — the
// pipeline would report ok:true while shipping corrupted output. Throwing here instead surfaces any
// remaining label-resolution bug as a loud, debuggable pipeline failure.
function resolveJumpTarget(proto, targetLabel, insIdx, opName) {
  const idx = proto.labels ? proto.labels[targetLabel] : undefined;
  if (idx === undefined) {
    throw new Error(`Unresolved jump target "${targetLabel}" in proto ${proto.id} at instruction ${insIdx} (op ${opName})`);
  }
  return idx + 1;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LUA_RESERVED = new Set([
  'and','break','do','else','elseif','end','false','for','function','goto','if','in',
  'local','nil','not','or','repeat','return','then','true','until','while'
]);

function randomIdent(len = 2 + Math.floor(Math.random() * 3), used = new Set()) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alnum = alphabet + '0123456789_';
  let name;
  do {
    name = alphabet[Math.floor(Math.random() * alphabet.length)];
    for (let i = 1; i < len; i++) name += alnum[Math.floor(Math.random() * alnum.length)];
  } while (LUA_RESERVED.has(name) || used.has(name) || /^[0-9]/.test(name));
  used.add(name);
  return name;
}

/**
 * Opaque predicates that always evaluate true/false but resist trivial constant-folding
 * by mixing always-true arithmetic identities with the live opcode variable.
 */
function opaqueTrue(opVar) {
  const k = 2 + Math.floor(Math.random() * 7);
  const variants = [
    `((${opVar}-${opVar})==0)`,
    `((${opVar}*0)==0)`,
    `(not((${opVar}+${toLuraphNumber(k)})<(${opVar})))`,
    `(((${opVar}~=${opVar})and false)or true)`,
    `((${opVar}==${opVar})and(${opVar}==${opVar}))`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function opaqueFalse(opVar) {
  const variants = [
    `((${opVar}-${opVar})~=0)`,
    `((${opVar}*0)~=0)`,
    `(${opVar}~=${opVar})`,
    `((${opVar}==${opVar})and false)`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

/**
 * Builds a Recursive Binary Search Tree (BST) for opcode dispatching.
 * Opaque predicates enabled for normal scripts; disabled for hugeScript (parse cost).
 */
function buildBinarySearchTree(opList, opVar, opts = {}) {
  const useOpaque = opts.useOpaque !== false;
  const num = typeof opts.num === 'function' ? opts.num : toLuraphNumber;

  if (opList.length === 0) return '';
  if (opList.length === 1) {
    if (useOpaque && Math.random() < 0.25) {
      return `if ${opaqueTrue(opVar)} then ${opList[0].body};else ${opList[0].body};end;`;
    }
    return `${opList[0].body};`;
  }
  if (opList.length === 2) {
    const p1 = opList[0];
    const p2 = opList[1];
    const style = Math.random();
    let cond;
    if (style < 0.33) {
      cond = `${opVar}==${num(p1.id)}`;
    } else if (style < 0.66) {
      cond = `not(${opVar}~=${num(p1.id)})`;
    } else {
      cond = `${opVar}~=${num(p2.id)}`;
    }
    if (useOpaque && Math.random() < 0.4) {
      cond = `(${cond})and${opaqueTrue(opVar)}`;
    }
    return `if ${cond} then ${p1.body};else ${p2.body};end;`;
  }

  const mid = Math.floor(opList.length / 2);
  const midItem = opList[mid];
  const left = opList.slice(0, mid);
  const right = opList.slice(mid);

  const leftCode = buildBinarySearchTree(left, opVar, opts);
  const rightCode = buildBinarySearchTree(right, opVar, opts);

  const numStr = num(midItem.id);
  const branchStyle = Math.floor(Math.random() * 4);

  let leftFirst = true;
  let cond;
  if (branchStyle === 0) {
    cond = `${opVar}<${numStr}`;
    leftFirst = true;
  } else if (branchStyle === 1) {
    cond = `not(${opVar}>=${numStr})`;
    leftFirst = true;
  } else if (branchStyle === 2) {
    cond = `${opVar}>=${numStr}`;
    leftFirst = false;
  } else {
    cond = `not(${opVar}<${numStr})`;
    leftFirst = false;
  }

  if (useOpaque && Math.random() < 0.45) {
    if (Math.random() < 0.5) {
      cond = `(${cond})and${opaqueTrue(opVar)}`;
    } else {
      cond = `(${cond})or${opaqueFalse(opVar)}`;
    }
  }

  if (leftFirst) {
    return `if ${cond} then ${leftCode}else ${rightCode}end;`;
  }
  return `if ${cond} then ${rightCode}else ${leftCode}end;`;
}

/**
 * Generates Luraph-Style VM output from IR and encrypted string constants.
 */
function generateLuraphVM(ir, encResult, options = {}) {
  // Per-build randomized VM / column register names (kills fixed c/u/d/r fingerprint)
  const usedIds = new Set();
  const jrName   = randomIdent(2, usedIds);
  const vStk     = randomIdent(1, usedIds);
  const vPc      = randomIdent(1, usedIds);
  const vOp      = randomIdent(1, usedIds);
  const vEnv     = randomIdent(1, usedIds);
  const vArgs    = randomIdent(1, usedIds);
  const vRet     = randomIdent(1, usedIds);
  const vProto   = randomIdent(1, usedIds);
  const vConsts  = randomIdent(1, usedIds);
  const vTop     = randomIdent(1, usedIds);

  const colOp    = randomIdent(1, usedIds);
  const colA     = randomIdent(1, usedIds);
  const colB     = randomIdent(1, usedIds);
  const colC     = randomIdent(1, usedIds);
  const colExtra = randomIdent(1, usedIds);

  // Shared arithmetic/unary dispatchers: ADD/SUB/MUL/DIV/MOD/POW/IDIV (and their *K constant-operand
  // variants) are, individually, a single trivially-readable operator (`b+c`, `b-c`, ...) — regardless
  // of how much the opcode-ID-to-handler mapping below is shuffled per build, a reader who finds the
  // handler body at all learns the exact operation in one glance. Routing all of them through ONE
  // shared function, selected by a build-random "kind" constant, adds a genuine second hop: the
  // dispatch entry itself now only shows a call with an opaque number, and the operation is only
  // revealed by ALSO finding and reading this function's own (likewise opcode-number-styled) branch
  // chain. Same technique applied to the three unary ops (MINUS/NOT/LENGTH).
  const idBinOp  = randomIdent(2, usedIds);
  const idUnOp   = randomIdent(2, usedIds);
  const binOpKinds = shuffle(['ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'POW', 'IDIV']).reduce((acc, name, i) => {
    acc[name] = 11 + i * 7 + Math.floor(Math.random() * 5); // spread out, not a giveaway 0..6 sequence
    return acc;
  }, {});
  const unOpKinds = shuffle(['MINUS', 'NOT', 'LENGTH']).reduce((acc, name, i) => {
    acc[name] = 3 + i * 9 + Math.floor(Math.random() * 4);
    return acc;
  }, {});

  // Round 2: same technique extended to comparisons and table access — last session's self-
  // deobfuscation pass only covered arithmetic/unary; comparisons (EQ/LE/LT) and table reads/writes
  // were left as bare one-liners (`a==c`, `t[k]=v`), just as instantly recognizable as the arithmetic
  // ops were before idBinOp/idUnOp existed. idCmp returns a boolean so call sites keep their own
  // `if idCmp(...) then B else pc+1 end` branch (the branch target assignment must stay inline for
  // correctness) — only the predicate computation is indirected, which is exactly where the
  // readability weakness lived. idGet/idSet cover plain/string-key/numeric-key table access the same
  // way. Unconditional jumps (JUMP/JUMPBACK/JUMPX) are deliberately left alone — there's no logic to
  // hide there, only a pc assignment, so indirecting them would add overhead for zero obfuscation value.
  const idCmp = randomIdent(2, usedIds);
  const idGet = randomIdent(2, usedIds);
  const idSet = randomIdent(2, usedIds);
  const cmpKinds = shuffle(['EQ', 'LE', 'LT']).reduce((acc, name, i) => {
    acc[name] = 5 + i * 11 + Math.floor(Math.random() * 6);
    return acc;
  }, {});
  const getKinds = shuffle(['PLAIN', 'KEY', 'NUM']).reduce((acc, name, i) => {
    acc[name] = 2 + i * 8 + Math.floor(Math.random() * 5);
    return acc;
  }, {});
  const setKinds = shuffle(['PLAIN', 'KEY', 'NUM']).reduce((acc, name, i) => {
    acc[name] = 4 + i * 8 + Math.floor(Math.random() * 5);
    return acc;
  }, {});
  const ids = {
    strKey: randomIdent(3, usedIds),
    strS: randomIdent(2, usedIds),
    strTable: randomIdent(4, usedIds),
    strDecrypt: randomIdent(3, usedIds),
    strI: randomIdent(2, usedIds),
    strJ: randomIdent(2, usedIds),
    strN: randomIdent(2, usedIds),
    strBKeysEnc: randomIdent(4, usedIds),
    strBMap: randomIdent(3, usedIds),
    strSalt: randomIdent(3, usedIds),
    strBKeys: randomIdent(3, usedIds),
    strDk: randomIdent(3, usedIds),
    vm: randomIdent(3, usedIds),
    bc: randomIdent(3, usedIds),
    consts: 'p',
    buf: randomIdent(2, usedIds)
  };

  const debugErrors = options.debug === true || options.preset === 'debug';

  const { initCode: strInitCode, tableRef: strTableRef } = generateDecryptionLua(
    encResult.stringKey,
    encResult.encryptedStrings,
    ids,
    encResult.keys,
    encResult.numBuckets,
    toLuraphNumber
  );

  // Complete List of Supported Luau Bytecode Opcodes
  const OP_NAMES = [
    // Loads
    'LOADNIL', 'LOADB', 'LOADN', 'LOADK', 'LOADKX', 'MOVE',
    // Globals / Imports / Tables
    'GETGLOBAL', 'SETGLOBAL', 'GETIMPORT', 'GETTABLE', 'SETTABLE', 'GETTABLEKS', 'SETTABLEKS',
    'GETTABLEN', 'SETTABLEN',
    'NEWTABLE', 'DUPTABLE', 'SETLIST',
    // Arithmetic
    'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'POW', 'IDIV',
    'ADDK', 'SUBK', 'MULK', 'DIVK', 'MODK', 'POWK', 'IDIVK',
    'SUBRK', 'DIVRK',
    'UNM', 'MINUS', 'NOT', 'LEN', 'LENGTH', 'CONCAT',
    // Logic / Bitwise
    'AND', 'OR', 'ANDK', 'ORK',
    // Jumps & Control Flow
    'JUMP', 'JUMPBACK', 'JUMPX',
    'JUMPIF', 'JUMPIFNOT',
    'JUMPIFEQ', 'JUMPIFLE', 'JUMPIFLT', 'JUMPIFNOTEQ', 'JUMPIFNOTLE', 'JUMPIFNOTLT',
    'JUMPXEQKN', 'JUMPXEQKB', 'JUMPXEQKS', 'JUMPXEQK', 'JUMPXEQKNIL', 'JUMPIFEQK', 'JUMPIFNOTEQK',
    // Loops
    'FORNPREP', 'FORNLOOP',
    'FORGPREP', 'FORGLOOP', 'FORGPREP_INEXT', 'FORGPREP_NEXT',
    // Calls & Closures
    'CALL', 'CALLFB', 'RETURN', 'NAMECALL', 'FASTCALL', 'FASTCALL1', 'FASTCALL2', 'FASTCALL2K', 'FASTCALL3',
    'FASTPCALL', 'FASTPCALL1', 'FASTPCALL2',
    'NEWCLOSURE', 'DUPCLOSURE',
    // Upvalues & Varargs
    'GETUPVAL', 'SETUPVAL', 'CLOSEUPVALS', 'CAPTURE',
    'GETVARARGS', 'PREPVARARGS',
    // Nops
    'NOP', 'COVERAGE'
  ];

  // Distribute real and decoy opcodes into a strictly collision-free pool
  // Wider shuffled opcode ID space → different BST shape every build
  const allIds = shuffle(Array.from({ length: 280 }, (_, i) => i + 1));
  const OP_CODES = {};
  OP_NAMES.forEach((op, idx) => {
    OP_CODES[op] = allIds[idx];
  });
  const decoyIds = allIds.slice(OP_NAMES.length, OP_NAMES.length + 90);

  const handlers = [
    // Loads
    {
      id: OP_CODES.LOADNIL,
      body: `for _r=${colA}[${vPc}],${colA}[${vPc}]+${colB}[${vPc}] do (${vStk})[_r]=nil;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LOADB,
      body: `(${vStk})[${colA}[${vPc}]]=(${colB}[${vPc}]~=0);if ${colC}[${vPc}]~=0 then ${vPc}=${vPc}+1;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LOADN,
      body: `(${vStk})[${colA}[${vPc}]]=(${colB}[${vPc}]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LOADK,
      body: `(${vStk})[${colA}[${vPc}]]=(${vConsts}[${colB}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LOADKX,
      body: `(${vStk})[${colA}[${vPc}]]=(${vConsts}[${colB}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MOVE,
      body: `(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },

    // Globals & Imports
    {
      id: OP_CODES.GETGLOBAL,
      body: `(${vStk})[${colA}[${vPc}]]=${vEnv}[${vConsts}[${colB}[${vPc}]+1]];${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETGLOBAL,
      body: `${vEnv}[${vConsts}[${colB}[${vPc}]+1]]=(${vStk}[${colA}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.GETIMPORT,
      body: `do local _pth=${colExtra}[${vPc}];if _pth and _pth~="" then local _cached=_impCache[_pth];if _cached~=nil then if _cached==false then (${vStk})[${colA}[${vPc}]]=nil;else (${vStk})[${colA}[${vPc}]]=_cached;end;else local _cur=${vEnv};for _pt in string.gmatch(_pth,"[^%.]+") do if _cur~=nil then local _nxt;if typeof and typeof(_cur)=="Instance" and _cur.ClassName=="DataModel" then local _ok,_srv=pcall(_cur.GetService,_cur,_pt);if _ok and _srv then _nxt=_srv;end;end;if not _nxt then if type(_cur)=="table" then _nxt=_cur[_pt];else local _ok,_res=pcall(function() return _cur[_pt];end);if _ok then _nxt=_res;elseif typeof and typeof(_cur)=="Instance" and _cur.FindFirstChild then local _ok2,_fc=pcall(_cur.FindFirstChild,_cur,_pt);if _ok2 and _fc then _nxt=_fc;end;end;end;end;_cur=_nxt;end;end;if _cur==nil then _cur=${vEnv}[_pth] or (getgenv and getgenv()[_pth]) or (getrenv and getrenv()[_pth]) or (_G and _G[_pth]);end;_impCache[_pth]=(_cur~=nil and _cur) or false;(${vStk})[${colA}[${vPc}]]=_cur;end;else (${vStk})[${colA}[${vPc}]]=${vEnv}[${vConsts}[${colB}[${vPc}]+1]];end;end;${vPc}=${vPc}+1`
    },

    // Tables
    {
      id: OP_CODES.GETTABLE,
      body: `${vStk}[${colA}[${vPc}]]=${idGet}(${toLuraphNumber(getKinds.PLAIN)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETTABLE,
      body: `${idSet}(${toLuraphNumber(setKinds.PLAIN)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]],${vStk}[${colA}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.GETTABLEKS,
      body: `${vStk}[${colA}[${vPc}]]=${idGet}(${toLuraphNumber(getKinds.KEY)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETTABLEKS,
      body: `${idSet}(${toLuraphNumber(setKinds.KEY)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1],${vStk}[${colA}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.GETTABLEN,
      body: `${vStk}[${colA}[${vPc}]]=${idGet}(${toLuraphNumber(getKinds.NUM)},${vStk}[${colB}[${vPc}]],${colC}[${vPc}]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETTABLEN,
      body: `${idSet}(${toLuraphNumber(setKinds.NUM)},${vStk}[${colB}[${vPc}]],${colC}[${vPc}],${vStk}[${colA}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.NEWTABLE,
      body: `(${vStk})[${colA}[${vPc}]]={};${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.DUPTABLE,
      body: `do local _src=${vConsts}[${colB}[${vPc}]+1];local _dst;if table.clone and type(_src)=="table" then _dst=table.clone(_src);elseif type(_src)=="table" then _dst={};for _k,_v in pairs(_src) do _dst[_k]=_v;end;else _dst={};end;(${vStk})[${colA}[${vPc}]]=_dst;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETLIST,
      body: `do local _t=${vStk}[${colA}[${vPc}]];local _s=${colB}[${vPc}];local _c=${colC}[${vPc}];local _st=_tonumber(${colExtra}[${vPc}]) or 1;if _c==-1 or _c==0 or _c==4294967295 then for _j=_s,${vTop} do _t[_st+_j-_s]=${vStk}[_j];end elseif _c>0 and _c<256 then for _j=1,_c do _t[_st+_j-1]=${vStk}[_s+_j-1];end end;end;${vPc}=${vPc}+1`
    },

    // Arithmetic
    {
      id: OP_CODES.ADD,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.ADD)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SUB,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.SUB)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MUL,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.MUL)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.DIV,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.DIV)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MOD,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.MOD)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.POW,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.POW)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.IDIV,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.IDIV)},${vStk}[${colB}[${vPc}]],${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.ADDK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.ADD)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SUBK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.SUB)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MULK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.MUL)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.DIVK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.DIV)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MODK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.MOD)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.POWK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.POW)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.IDIVK,
      body: `(${vStk})[${colA}[${vPc}]]=${idBinOp}(${toLuraphNumber(binOpKinds.IDIV)},${vStk}[${colB}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SUBRK,
      body: `(${vStk})[${colA}[${vPc}]]=(${vConsts}[${colB}[${vPc}]+1]-${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.DIVRK,
      body: `(${vStk})[${colA}[${vPc}]]=(${vConsts}[${colB}[${vPc}]+1]/${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.UNM,
      body: `(${vStk})[${colA}[${vPc}]]=-(${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.MINUS,
      body: `(${vStk})[${colA}[${vPc}]]=${idUnOp}(${toLuraphNumber(unOpKinds.MINUS)},${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.NOT,
      body: `(${vStk})[${colA}[${vPc}]]=${idUnOp}(${toLuraphNumber(unOpKinds.NOT)},${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LEN,
      body: `(${vStk})[${colA}[${vPc}]]=(#${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.LENGTH,
      body: `(${vStk})[${colA}[${vPc}]]=${idUnOp}(${toLuraphNumber(unOpKinds.LENGTH)},${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.CONCAT,
      body: `do local _cb=${colB}[${vPc}];local _cc=${colC}[${vPc}];if _cc==_cb+1 then (${vStk})[${colA}[${vPc}]]=(${vStk})[_cb]..(${vStk})[_cc];else local _s=(${vStk})[_cb];for _r=_cb+1,_cc do _s=_s..(${vStk})[_r];end;(${vStk})[${colA}[${vPc}]]=_s;end;end;${vPc}=${vPc}+1`
    },

    // Bitwise / Logic
    {
      id: OP_CODES.AND,
      body: `(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]] and ${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.OR,
      body: `(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]] or ${vStk}[${colC}[${vPc}]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.ANDK,
      body: `(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]] and ${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.ORK,
      body: `(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]] or ${vConsts}[${colC}[${vPc}]+1]);${vPc}=${vPc}+1`
    },

    // Jumps & Branches
    {
      id: OP_CODES.JUMP,
      body: `${vPc}=${colB}[${vPc}]`
    },
    {
      id: OP_CODES.JUMPBACK,
      body: `${vPc}=${colB}[${vPc}]`
    },
    {
      id: OP_CODES.JUMPX,
      body: `${vPc}=${colB}[${vPc}]`
    },
    {
      id: OP_CODES.JUMPIF,
      body: `if ${vStk}[${colA}[${vPc}]] then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFNOT,
      body: `if not ${vStk}[${colA}[${vPc}]] then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFEQ,
      body: `if ${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFLE,
      body: `if ${idCmp}(${toLuraphNumber(cmpKinds.LE)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFLT,
      body: `if ${idCmp}(${toLuraphNumber(cmpKinds.LT)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFNOTEQ,
      body: `if not ${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFNOTLE,
      body: `if not ${idCmp}(${toLuraphNumber(cmpKinds.LE)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFNOTLT,
      body: `if not ${idCmp}(${toLuraphNumber(cmpKinds.LT)},${vStk}[${colA}[${vPc}]],${vStk}[${colC}[${vPc}]]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },

    // Constant Comparison Jumps (predicate indirected through idCmp; the "which direction" (==/~=)
    // flag from colExtra stays inline since it isn't an operator identity leak, just a boolean flag)
    {
      id: OP_CODES.JUMPXEQKN,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPXEQKB,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],(${colC}[${vPc}]~=0)) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPXEQKS,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPXEQK,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFEQK,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPIFNOTEQK,
      body: `if (${colExtra}[${vPc}]=="1")==${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],${vConsts}[${colC}[${vPc}]+1]) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },
    {
      id: OP_CODES.JUMPXEQKNIL,
      body: `if (${colExtra}[${vPc}]=="1")~=${idCmp}(${toLuraphNumber(cmpKinds.EQ)},${vStk}[${colA}[${vPc}]],nil) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`
    },

    // Numeric For Loops
    {
      id: OP_CODES.FORNPREP,
      body: `do local _a=${colA}[${vPc}];local _lim=(${vStk})[_a];local _stp=(${vStk})[_a+1];local _ini=(${vStk})[_a+2];if type(_lim)~="number" then _lim=_tonumber(_lim);if not _lim then _error("'for' limit must be a number");end;(${vStk})[_a]=_lim;end;if type(_stp)~="number" then _stp=_tonumber(_stp);if not _stp then _error("'for' step must be a number");end;(${vStk})[_a+1]=_stp;end;if type(_ini)~="number" then _ini=_tonumber(_ini);if not _ini then _error("'for' initial value must be a number");end;(${vStk})[_a+2]=_ini;end;if (_stp>0 and not (_ini<=_lim)) or (_stp<=0 and not (_ini>=_lim)) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`
    },
    {
      id: OP_CODES.FORNLOOP,
      body: `do local _a=${colA}[${vPc}];local _stp=(${vStk})[_a+1];local _cur=(${vStk})[_a+2]+_stp;(${vStk})[_a+2]=_cur;local _lim=(${vStk})[_a];if (_stp>0 and _cur<=_lim) or (_stp<=0 and _cur>=_lim) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`
    },

    // Generic For Loops
    {
      id: OP_CODES.FORGPREP,
      body: `do local _src=${vStk}[${colA}[${vPc}]];if type(_src)~="function" then local _f,_s,_v;local _mt=getmetatable(_src);if _mt and _mt.__iter then _f,_s,_v=_mt.__iter(_src);elseif type(_src)=="table" then _f=next;_s=_src;_v=nil;end;if _f then (${vStk})[${colA}[${vPc}]]=_f;(${vStk})[${colA}[${vPc}]+1]=_s;(${vStk})[${colA}[${vPc}]+2]=_v;end;end;${vPc}=${colB}[${vPc}];end`
    },
    {
      id: OP_CODES.FORGPREP_INEXT,
      body: `${vPc}=${colB}[${vPc}]`
    },
    {
      id: OP_CODES.FORGPREP_NEXT,
      body: `${vPc}=${colB}[${vPc}]`
    },
    {
      id: OP_CODES.FORGLOOP,
      body: `do local _a=${colA}[${vPc}];local _gen=(${vStk})[_a];local _st=(${vStk})[_a+1];local _v=(${vStk})[_a+2];local _cnt=${colC}[${vPc}];if not _cnt or _cnt<=0 then _cnt=2;end;if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then _ub[1]=(${vStk})[_ur];end;end;end;local _r1,_r2;if _cnt==2 then _r1,_r2=_gen(_st,_v);(${vStk})[_a+3]=_r1;(${vStk})[_a+4]=_r2;else local _nres,_res=_pack(_gen(_st,_v));for _i=1,_cnt do (${vStk})[_a+2+_i]=_res[_i];end;_r1=_res[1];end;if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then (${vStk})[_ur]=_ub[1];end;end;end;if _r1~=nil then (${vStk})[_a+2]=_r1;${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`
    },

    // Method Calls & Closures
    {
      id: OP_CODES.NAMECALL,
      body: `(${vStk})[${colA}[${vPc}]+1]=(${vStk}[${colB}[${vPc}]]);(${vStk})[${colA}[${vPc}]]=(${vStk}[${colB}[${vPc}]][${vConsts}[${colC}[${vPc}]+1]]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.NEWCLOSURE,
      body: `do local _t=${colB}[${vPc}];local _caps=${colExtra}[${vPc}];local _chUp={};local _fn;local _fnEnv=${vEnv};_fn=function(...) local _e=(_customFnEnvs and _customFnEnvs[_fn]) or _fnEnv;return ${ids.vm}(_t,_e,_chUp,...);end;(${vStk})[${colA}[${vPc}]]=_fn;if _openUp and _openUp[${colA}[${vPc}]] then _openUp[${colA}[${vPc}]][1]=_fn;end;if type(_caps)=="table" then for _i=1,#_caps do local _cp=_caps[_i];if _cp[1]==2 then _chUp[_i-1]={(${vStk})[_cp[2]]};elseif _cp[1]==0 then local _rg=_cp[2];if not _openUp then _openUp={};end;if not _openUp[_rg] then _openUp[_rg]={(${vStk})[_rg]};_openUpList[#_openUpList+1]=_rg;_hasOpen=true;end;_chUp[_i-1]=_openUp[_rg];else local _u=_cp[2];_chUp[_i-1]=_up[_u] or {};end;end;end;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.DUPCLOSURE,
      body: `do local _c=${vConsts}[${colB}[${vPc}]+1];local _t=(type(_c)=="table" and _c.__proto) or 1;local _caps=${colExtra}[${vPc}];local _chUp={};local _fn;local _fnEnv=${vEnv};_fn=function(...) local _e=(_customFnEnvs and _customFnEnvs[_fn]) or _fnEnv;return ${ids.vm}(_t,_e,_chUp,...);end;(${vStk})[${colA}[${vPc}]]=_fn;if _openUp and _openUp[${colA}[${vPc}]] then _openUp[${colA}[${vPc}]][1]=_fn;end;if type(_caps)=="table" then for _i=1,#_caps do local _cp=_caps[_i];if _cp[1]==2 then _chUp[_i-1]={(${vStk})[_cp[2]]};elseif _cp[1]==0 then local _rg=_cp[2];if not _openUp then _openUp={};end;if not _openUp[_rg] then _openUp[_rg]={(${vStk})[_rg]};_openUpList[#_openUpList+1]=_rg;_hasOpen=true;end;_chUp[_i-1]=_openUp[_rg];else local _u=_cp[2];_chUp[_i-1]=_up[_u] or {};end;end;end;end;${vPc}=${vPc}+1`
    },

    // Calls & Returns
    {
      id: OP_CODES.CALL,
      body: `do if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then _ub[1]=(${vStk})[_ur];end;end;end;local _ra=${colA}[${vPc}];local _fn=${vStk}[_ra];local _na=${colB}[${vPc}];local _nr=${colC}[${vPc}];if _nr==0 then if _na==0 then _fn();elseif _na==1 then _fn((${vStk})[_ra+1]);elseif _na==2 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);elseif _na==6 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6]);elseif _na==7 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7]);elseif _na==8 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7],(${vStk})[_ra+8]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_fn(_unpack(_args,1,_argc));end;end;elseif _nr==1 then if _na==0 then (${vStk})[_ra]=_fn();elseif _na==1 then (${vStk})[_ra]=_fn((${vStk})[_ra+1]);elseif _na==2 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);elseif _na==6 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6]);elseif _na==7 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7]);elseif _na==8 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7],(${vStk})[_ra+8]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then (${vStk})[_ra]=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;(${vStk})[_ra]=_fn(_unpack(_args,1,_argc));end;end;elseif _nr==2 then local _r1,_r2;if _na==0 then _r1,_r2=_fn();elseif _na==1 then _r1,_r2=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;elseif _nr==3 then local _r1,_r2,_r3;if _na==0 then _r1,_r2,_r3=_fn();elseif _na==1 then _r1,_r2,_r3=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2,_r3=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2,_r3=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;(${vStk})[_ra+2]=_r3;elseif _nr==4 then local _r1,_r2,_r3,_r4;if _na==0 then _r1,_r2,_r3,_r4=_fn();elseif _na==1 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2,_r3,_r4=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2,_r3,_r4=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;(${vStk})[_ra+2]=_r3;(${vStk})[_ra+3]=_r4;else local _nres,_res;local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _nres,_res=_pack(_fn());elseif _argc==1 then _nres,_res=_pack(_fn((${vStk})[_ra+1]));elseif _argc==2 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2]));elseif _argc==3 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]));elseif _argc==4 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]));elseif _argc==5 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]));else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_nres,_res=_pack(_fn(_unpack(_args,1,_argc)));end;if _nr>0 and _nr<256 then for _r=1,_nr do (${vStk})[_ra+_r-1]=_res[_r];end;elseif _nr==-1 or _nr==4294967295 then for _r=1,_nres do (${vStk})[_ra+_r-1]=_res[_r];end;${vTop}=_ra+_nres-1;end;end;if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then (${vStk})[_ur]=_ub[1];end;end;end;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.CALLFB,
      body: `do if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then _ub[1]=(${vStk})[_ur];end;end;end;local _ra=${colA}[${vPc}];local _fn=${vStk}[_ra];local _na=${colB}[${vPc}];local _nr=${colC}[${vPc}];if _nr==0 then if _na==0 then _fn();elseif _na==1 then _fn((${vStk})[_ra+1]);elseif _na==2 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);elseif _na==6 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6]);elseif _na==7 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7]);elseif _na==8 then _fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7],(${vStk})[_ra+8]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_fn(_unpack(_args,1,_argc));end;end;elseif _nr==1 then if _na==0 then (${vStk})[_ra]=_fn();elseif _na==1 then (${vStk})[_ra]=_fn((${vStk})[_ra+1]);elseif _na==2 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);elseif _na==6 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6]);elseif _na==7 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7]);elseif _na==8 then (${vStk})[_ra]=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5],(${vStk})[_ra+6],(${vStk})[_ra+7],(${vStk})[_ra+8]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then (${vStk})[_ra]=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;(${vStk})[_ra]=_fn(_unpack(_args,1,_argc));end;end;elseif _nr==2 then local _r1,_r2;if _na==0 then _r1,_r2=_fn();elseif _na==1 then _r1,_r2=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _r1,_r2=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;elseif _nr==3 then local _r1,_r2,_r3;if _na==0 then _r1,_r2,_r3=_fn();elseif _na==1 then _r1,_r2,_r3=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);elseif _na==5 then _r1,_r2,_r3=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2,_r3=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2,_r3=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;(${vStk})[_ra+2]=_r3;elseif _nr==4 then local _r1,_r2,_r3,_r4;if _na==0 then _r1,_r2,_r3,_r4=_fn();elseif _na==1 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1]);elseif _na==2 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2]);elseif _na==3 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]);elseif _na==4 then _r1,_r2,_r3,_r4=_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]);else local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _r1,_r2,_r3,_r4=_fn();else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_r1,_r2,_r3,_r4=_fn(_unpack(_args,1,_argc));end;end;(${vStk})[_ra]=_r1;(${vStk})[_ra+1]=_r2;(${vStk})[_ra+2]=_r3;(${vStk})[_ra+3]=_r4;else local _nres,_res;local _argc=(_na==-1 or _na==4294967295) and (${vTop}-_ra) or _na;if _argc<=0 then _nres,_res=_pack(_fn());elseif _argc==1 then _nres,_res=_pack(_fn((${vStk})[_ra+1]));elseif _argc==2 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2]));elseif _argc==3 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3]));elseif _argc==4 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4]));elseif _argc==5 then _nres,_res=_pack(_fn((${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4],(${vStk})[_ra+5]));else local _args={};for _a=1,_argc do _args[_a]=${vStk}[_ra+_a];end;_nres,_res=_pack(_fn(_unpack(_args,1,_argc)));end;if _nr>0 and _nr<256 then for _r=1,_nr do (${vStk})[_ra+_r-1]=_res[_r];end;elseif _nr==-1 or _nr==4294967295 then for _r=1,_nres do (${vStk})[_ra+_r-1]=_res[_r];end;${vTop}=_ra+_nres-1;end;end;if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then (${vStk})[_ur]=_ub[1];end;end;end;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.RETURN,
      body: `do if _hasOpen then for _ui=1,#_openUpList do local _ur=_openUpList[_ui];local _ub=_openUp[_ur];if _ub then _ub[1]=(${vStk})[_ur];end;end;end;local _cnt=${colB}[${vPc}];local _ra=${colA}[${vPc}];_envStack[_envDepth]=nil;_envDepth=_envDepth-1;_stkDepth=_stkDepth-1;if _cnt==0 then return;elseif _cnt==1 then return (${vStk})[_ra];elseif _cnt==2 then return (${vStk})[_ra],(${vStk})[_ra+1];elseif _cnt==3 then return (${vStk})[_ra],(${vStk})[_ra+1],(${vStk})[_ra+2];elseif _cnt==4 then return (${vStk})[_ra],(${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3];elseif _cnt==5 then return (${vStk})[_ra],(${vStk})[_ra+1],(${vStk})[_ra+2],(${vStk})[_ra+3],(${vStk})[_ra+4];elseif _cnt>0 and _cnt<256 then ${vRet}={n=_cnt};for _r=1,_cnt do ${vRet}[_r]=(${vStk})[_ra+_r-1];end;return _unpack(${vRet},1,_cnt);elseif _cnt==-1 or _cnt==4294967295 then local _rcnt=${vTop}-_ra+1;${vRet}={n=_rcnt};for _r=_ra,${vTop} do ${vRet}[_r-_ra+1]=(${vStk})[_r];end;return _unpack(${vRet},1,_rcnt);else return;end;end`
    },

    // Fastcalls & Upvalues
    {
      id: OP_CODES.FASTCALL,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTCALL1,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTCALL2,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTCALL2K,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTCALL3,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTPCALL,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTPCALL1,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.FASTPCALL2,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.GETUPVAL,
      body: `(${vStk})[${colA}[${vPc}]]=(_up[${colB}[${vPc}]] and _up[${colB}[${vPc}]][1]);${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.SETUPVAL,
      body: `if not _up[${colB}[${vPc}]] then _up[${colB}[${vPc}]]={};end;_up[${colB}[${vPc}]][1]=(${vStk})[${colA}[${vPc}]];${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.CLOSEUPVALS,
      body: `do if _hasOpen and _openUp then local _f=${colA}[${vPc}];local _w=1;for _r=1,#_openUpList do local _ur=_openUpList[_r];if _ur>=_f then local _ub=_openUp[_ur];if _ub then _ub[1]=(${vStk})[_ur];_openUp[_ur]=nil;end;else _openUpList[_w]=_ur;_w=_w+1;end;end;for _r=_w,#_openUpList do _openUpList[_r]=nil;end;if _w==1 then _hasOpen=false;end;end;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.CAPTURE,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.GETVARARGS,
      body: `do local _a=${colA}[${vPc}];local _b=${colB}[${vPc}];local _tot=(${vArgs} and (${vArgs}.n or #${vArgs}) or 0);if _b>0 then for _j=1,_b do (${vStk})[_a+_j-1]=(${vArgs} and ${vArgs}[_numParams+_j]);end;${vTop}=_a+_b-1;else local _num=_math.max(0,_tot-_numParams);for _j=1,_num do (${vStk})[_a+_j-1]=${vArgs}[_numParams+_j];end;${vTop}=_a+_num-1;end;end;${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.PREPVARARGS,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.NOP,
      body: `${vPc}=${vPc}+1`
    },
    {
      id: OP_CODES.COVERAGE,
      body: `${vPc}=${vPc}+1`
    }
  ];

  // Decoy opcode handlers — balanced for confusion without inflating BST dispatch depth
  let decoyCount = options.maxProtection ? 35 : (options.debug ? 10 : 20);
  if (options.hugeScript) decoyCount = Math.min(decoyCount, 6);
  else if (options.largeScript) decoyCount = Math.min(decoyCount, 12);
  const decoyOps = generateDecoyOpcodeHandlers(
    colA, colB, colC, colExtra, vStk, vPc, vConsts, vEnv, vTop,
    decoyIds.slice(0, Math.min(decoyCount, decoyIds.length))
  );
  handlers.push(...decoyOps);
  handlers.sort((a, b) => a.id - b.id);

  const decisionTreeCode = buildBinarySearchTree(handlers, vOp, {
    useOpaque: false, // High FPS: clean branch comparisons in VM hot path
    num: (n) => String(n | 0)
  });

  const parseReg = (r) => {
    if (!r || typeof r !== 'string' || !r.startsWith('R')) return 0;
    const n = parseInt(r.slice(1), 10);
    return isNaN(n) ? 0 : n;
  };
  const parseConst = (k) => {
    if (!k || typeof k !== 'string' || !k.startsWith('K')) return 0;
    const n = parseInt(k.slice(1), 10);
    return isNaN(n) ? 0 : n;
  };

  const slotPool = [1, 2, 3, 5, 6, 8, 10];
  const shuffledSlots = shuffle(slotPool);
  const slotOp = shuffledSlots[0];
  const slotA = shuffledSlots[1];
  const slotB = shuffledSlots[2];
  const slotC = shuffledSlots[3];
  const slotExtra = shuffledSlots[4];
  const slotConsts = shuffledSlots[5];
  const slotNumParams = shuffledSlots[6];

  // Serialize each proto into Luraph Columnar Arrays
  const mainProtoIndex = ir.mainProto !== undefined ? ir.mainProto : (ir.protos.length - 1);
  let mainOpHash = 0;
  const protosData = ir.protos.map((proto) => {
    const constsEntries = (proto.constants || []).map((c, i) => {
      if (!c) return `[${toLuraphNumber(i + 1)}]=nil`;
      if (c.type === 'string') return `[${toLuraphNumber(i + 1)}]=${JSON.stringify(c.value)}`;
      if (c.type === 'table_template') return `[${toLuraphNumber(i + 1)}]=` + c.lua;
      if (c.type === 'encrypted_string') return `[${toLuraphNumber(i + 1)}]=${strTableRef}[${toLuraphNumber(c.tableIndex + 1)}]`;
      if (c.type === 'number') {
        if (Object.is(c.value, -0) || c.raw === '-0') return `[${toLuraphNumber(i + 1)}]=(-0)`;
        if (c.lua) return `[${toLuraphNumber(i + 1)}]=` + c.lua;
        if (Number.isNaN(c.value)) return `[${toLuraphNumber(i + 1)}]=(0/0)`;
        if (c.value === Infinity) return `[${toLuraphNumber(i + 1)}]=math.huge`;
        if (c.value === -Infinity) return `[${toLuraphNumber(i + 1)}]=(-math.huge)`;
        const val = (typeof c.value === 'number') ? c.value : Number(c.value);
        if (Object.is(val, -0)) return `[${toLuraphNumber(i + 1)}]=(-0)`;
        return `[${toLuraphNumber(i + 1)}]=` + (Number.isInteger(val) && val >= 0 && val <= 0xFFFF ? toLuraphNumber(val) : String(val));
      }
      if (c.type === 'mutated_number') return `[${toLuraphNumber(i + 1)}]=${c.lua}`;
      // Booleans and explicit nil constants MUST be emitted as real Lua keywords, not strings — the
      // generic fallback below does `c.value || ''`, which silently turns boolean `false` into the
      // EMPTY STRING (a falsy-in-JS, truthy-in-Lua value — "" is truthy in Lua!) and even boolean
      // `true` into the unrelated STRING "true" (JS's `||` just returns `true` itself, then
      // `String(true)` stringifies it) rather than either real boolean. This silently broke every
      // `x or false`/`x or true` short-circuit pattern whose result flowed from one of these
      // constants — found via a live repro (SkinChangerBS.lua's weapon-preview 3D model silently
      // failing to build only in obfuscated output, traced to this exact corruption).
      if (c.type === 'boolean') return `[${toLuraphNumber(i + 1)}]=${c.value ? 'true' : 'false'}`;
      if (c.type === 'nil') return `[${toLuraphNumber(i + 1)}]=nil`;
      if (c.type === 'identifier') return `[${toLuraphNumber(i + 1)}]=${JSON.stringify(c.value)}`;
      if (c.type === 'proto_ref') {
        const targetId = c.targetProtoId !== undefined
          ? c.targetProtoId
          : (ir.protos.find(p => p.name === c.value)?.id || 0);
        return `[${toLuraphNumber(i + 1)}]={__proto=${toLuraphNumber(targetId + 1)}}`;
      }
      return `[${toLuraphNumber(i + 1)}]=${JSON.stringify(String(c.value || ''))}`;
    }).join(',');

    const arrOp = [];
    const arrA = [];
    const arrB = [];
    const arrC = [];
    const arrExtra = [];

    proto.instructions.forEach((ins, insIdx) => {
      const opNum = OP_CODES[ins.op] || OP_CODES.FASTCALL;
      const args = ins.args || [];
      const A = parseReg(args[0]);
      let B = 0;
      let C = 0;
      let extra = '""';

      if (ins.op === 'LOADNIL') {
        B = parseInt(args[1], 10) || 0;
      } else if (ins.op === 'LOADK' || ins.op === 'LOADKX') {
        B = parseConst(args[1]);
      } else if (ins.op === 'LOADN') {
        B = parseInt(args[1], 10) || 0;
      } else if (ins.op === 'LOADB') {
        B = parseInt(args[1], 10) || 0;
        C = parseInt(args[2], 10) || 0;
      } else if (ins.op === 'MOVE') {
        B = parseReg(args[1]);
      } else if (ins.op === 'GETIMPORT') {
        B = parseInt(args[1], 10) || 0;
        const impName = args.slice(2).join(' ').replace(/^\[|\]$/g, '');
        extra = JSON.stringify(impName);
      } else if (ins.op === 'GETTABLE' || ins.op === 'SETTABLE') {
        B = parseReg(args[1]);
        C = parseReg(args[2]);
      } else if (ins.op === 'GETTABLEKS' || ins.op === 'SETTABLEKS') {
        B = parseReg(args[1]);
        C = parseConst(args[2]);
      } else if (ins.op === 'GETTABLEN') {
        B = parseReg(args[1]);
        C = parseInt(args[2], 10) || 0;
      } else if (ins.op === 'SETTABLEN') {
        B = parseReg(args[1]);
        C = parseInt(args[2], 10) || 0;
      } else if (ins.op === 'SUBRK' || ins.op === 'DIVRK') {
        B = parseConst(args[1]);
        const regArg = args.slice(2).find(a => a.startsWith('R')) || args[2];
        C = parseReg(regArg);
      } else if (ins.op === 'ADD' || ins.op === 'SUB' || ins.op === 'MUL' || ins.op === 'DIV' || ins.op === 'MOD' || ins.op === 'POW' || ins.op === 'IDIV') {
        B = parseReg(args[1]);
        C = parseReg(args[2]);
      } else if (ins.op === 'IDIVK') {
        B = parseReg(args[1]);
        C = parseConst(args[2]);
      } else if (ins.op === 'CAPTURE') {
        B = 0;
        C = 0;
      } else if (ins.op === 'ADDK' || ins.op === 'SUBK' || ins.op === 'MULK' || ins.op === 'DIVK' || ins.op === 'MODK' || ins.op === 'POWK') {
        B = parseReg(args[1]);
        C = parseConst(args[2]);
      } else if (ins.op === 'CONCAT') {
        B = parseReg(args[1]);
        C = parseReg(args[2]);
      } else if (ins.op === 'UNM' || ins.op === 'MINUS' || ins.op === 'NOT' || ins.op === 'LEN' || ins.op === 'LENGTH') {
        B = parseReg(args[1]);
      } else if (ins.op === 'AND' || ins.op === 'OR') {
        B = parseReg(args[1]);
        C = parseReg(args[2]);
      } else if (ins.op === 'ANDK' || ins.op === 'ORK') {
        B = parseReg(args[1]);
        C = parseConst(args[2]);
      } else if (ins.op === 'CALL' || ins.op === 'CALLFB') {
        B = parseInt(args[1], 10) || 0;
        C = parseInt(args[2], 10) || 0;
      } else if (ins.op === 'RETURN') {
        B = parseInt(args[1], 10) || 0;
      } else if (ins.op === 'GETVARARGS') {
        B = parseInt(args[1], 10) || 0;
      } else if (ins.op === 'NAMECALL') {
        B = parseReg(args[1]);
        C = parseConst(args[2]);
      } else if (ins.op === 'NEWCLOSURE' || ins.op === 'DUPCLOSURE') {
        if (ins.op === 'NEWCLOSURE') {
          const protoRef = args[1] || '';
          const targetId = ins.targetProtoId !== undefined
            ? ins.targetProtoId
            : (parseInt(protoRef.replace(/^P/, ''), 10) || 0);
          B = targetId + 1;
        } else {
          B = parseConst(args[1]);
        }
        const caps = [];
        for (let k = insIdx + 1; k < proto.instructions.length; k++) {
          const nextIns = proto.instructions[k];
          if (nextIns.op === 'CAPTURE') {
            const cType = nextIns.args[0];
            const cSrc = nextIns.args[1] || '';
            if (cType === 'UPVAL') {
              const u = parseInt(cSrc.replace(/^U/, ''), 10) || 0;
              caps.push(`{1,${u}}`);
            } else if (cType === 'VAL') {
              const r = parseInt(cSrc.replace(/^R/, ''), 10) || 0;
              caps.push(`{2,${r}}`);
            } else {
              const r = parseInt(cSrc.replace(/^R/, ''), 10) || 0;
              caps.push(`{0,${r}}`);
            }
          } else {
            break;
          }
        }
        extra = caps.length > 0 ? `{${caps.join(',')}}` : '""';
      } else if (ins.op === 'GETUPVAL' || ins.op === 'SETUPVAL') {
        const u = (args[1] && args[1].startsWith('U')) ? parseInt(args[1].slice(1), 10) : 0;
        B = u;
      } else if (ins.op === 'CLOSEUPVALS') {
        // A is already parseReg(args[0])
      } else if (ins.op === 'GETGLOBAL' || ins.op === 'SETGLOBAL') {
        B = parseConst(args[1]);
      } else if (ins.op === 'SETLIST') {
        B = parseReg(args[1]);
        C = parseInt(args[2], 10) || 0;
        const st = args[3] ? (parseInt(args[3].replace(/[\[\]]/g, ''), 10) || 1) : 1;
        extra = JSON.stringify(String(st));
      } else if (ins.op === 'DUPTABLE') {
        B = parseConst(args[1]) || parseInt(args[1], 10) || 0;
      } else if (ins.op === 'FORNPREP' || ins.op === 'FORNLOOP') {
        const targetLabel = args[1];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
      } else if (ins.op.startsWith('FORGPREP') || ins.op.startsWith('FORGLOOP')) {
        const targetLabel = args[1];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
        C = parseInt(args[2], 10) || 2;
      } else if (ins.op === 'JUMP' || ins.op === 'JUMPBACK' || ins.op === 'JUMPX') {
        const targetLabel = args[0];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
      } else if (ins.op === 'JUMPIF' || ins.op === 'JUMPIFNOT') {
        const targetLabel = args[1];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
      } else if (ins.op === 'JUMPIFEQ' || ins.op === 'JUMPIFLE' || ins.op === 'JUMPIFLT' || ins.op === 'JUMPIFNOTEQ' || ins.op === 'JUMPIFNOTLE' || ins.op === 'JUMPIFNOTLT') {
        C = parseReg(args[1]);
        const targetLabel = args[2];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
      } else if (ins.op === 'JUMPXEQKB') {
        C = parseInt(args[1], 10) || 0;
        const targetLabel = args[2];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
        if (args.includes('NOT')) {
          extra = '"1"';
        }
      } else if (ins.op === 'JUMPXEQKNIL') {
        const targetLabel = args[1];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
        if (args.includes('NOT')) {
          extra = '"1"';
        }
      } else if (ins.op.startsWith('JUMPXEQ') || ins.op.startsWith('JUMPIFEQK') || ins.op.startsWith('JUMPIFNOTEQK')) {
        C = parseConst(args[1]);
        const targetLabel = args[2];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
        if (args.includes('NOT')) {
          extra = '"1"';
        }
      } else if (ins.op.startsWith('JUMP')) {
        const targetLabel = args[0] || args[1] || args[2];
        B = resolveJumpTarget(proto, targetLabel, insIdx, ins.op);
        if (args[1] && args[1].startsWith('R')) {
          C = parseReg(args[1]);
        }
      }

      arrOp.push(isNaN(opNum) ? 0 : (opNum | 0));
      arrA.push(isNaN(A) ? 0 : (A | 0));
      arrB.push(isNaN(B) ? 0 : (B | 0));
      arrC.push(isNaN(C) ? 0 : (C | 0));
      if (extra && extra !== '""' && extra !== '') {
        arrExtra.push(`[${insIdx + 1}]=${extra}`);
      }
    });

    if (proto.id === mainProtoIndex) {
      for (let i = 0; i < arrOp.length; i++) {
        const luaI = i + 1; // match Lua 1-based (i%7)+1 in runtime check
        mainOpHash = (mainOpHash + arrOp[i] * ((luaI % 7) + 1)) % 16777216;
      }
    }

    const d = (n) => String(n | 0);

    // XOR-mask columns for normal scripts. Huge scripts skip sync decode-at-load
    // (thousands of protos × XOR loops freeze mobile executors on first parse).
    if (options.hugeScript) {
      return `${ids.bc}[${proto.id + 1}]={
[${slotOp}]={${arrOp.map(d).join(',')}},
[${slotA}]={${arrA.map(d).join(',')}},
[${slotB}]={${arrB.map(d).join(',')}},
[${slotC}]={${arrC.map(d).join(',')}},
[${slotExtra}]={${arrExtra.join(',')}},
[${slotConsts}]={${constsEntries}},
[${slotNumParams}]=${proto.numParams || 0}
};`;
    }

    const colMask = 1 + Math.floor(Math.random() * 254);
    const encOp = arrOp.map(n => d(n ^ colMask));
    const encA = arrA.map(n => d(n ^ colMask));
    const encB = arrB.map(n => d(((n < 0 ? (n >>> 0) : n) ^ colMask) >>> 0));
    const encC = arrC.map(n => d(((n < 0 ? (n >>> 0) : n) ^ colMask) >>> 0));

    return `${ids.bc}[${toLuraphNumber(proto.id + 1)}]=(function()
local _m=${d(colMask)};local _bx=((bit32 and bit32.bxor)or(bit and bit.bxor));
local _o={${encOp.join(',')}};local _a={${encA.join(',')}};local _b={${encB.join(',')}};local _c={${encC.join(',')}};
for _i=1,#_o do _o[_i]=_bx(_o[_i],_m);_a[_i]=_bx(_a[_i],_m);local _vb=_bx(_b[_i],_m);if _vb>2147483647 then _vb=_vb-4294967296;end;_b[_i]=_vb;local _vc=_bx(_c[_i],_m);if _vc>2147483647 then _vc=_vc-4294967296;end;_c[_i]=_vc;end
_m=nil;_bx=nil;
return{
[${toLuraphNumber(slotOp)}]=_o,
[${toLuraphNumber(slotA)}]=_a,
[${toLuraphNumber(slotB)}]=_b,
[${toLuraphNumber(slotC)}]=_c,
[${toLuraphNumber(slotExtra)}]={${arrExtra.join(',')}},
[${toLuraphNumber(slotConsts)}]={${constsEntries}},
[${toLuraphNumber(slotNumParams)}]=${toLuraphNumber(proto.numParams || 0)}
};end)();`;
  }).join('\n');

  const mainProtoId = toLuraphNumber(mainProtoIndex + 1);
  const antiDump = generateAntiDumpPostamble(ids);
  const antiTamper = generateAntiTamperPreamble(options.antiTamperStrength);
  // Legacy outer junk only on maximum for small scripts — huge scripts skip it (was MB of dead weight)
  const outerJunk = (options.maxProtection && !options.hugeScript)
    ? generateOuterLayerJunkLegacy()
    : generateOuterLayerJunk();
  const integrity = generateIntegrityBinder();
  const bcCheck = `do local _p=${ids.bc}[${mainProtoId}];if not _p then error("VM Error") end;local _o=_p[${toLuraphNumber(slotOp)}];local _h=0;for _i=1,#_o do _h=(_h+_o[_i]*((_i%7)+1))%16777216;end;if _h~=${toLuraphNumber(mainOpHash)} then error("VM Error") end;end`;

  // No signature/attribution header: a comment naming the tool is a free fingerprint that lets an
  // analyst immediately identify the obfuscation scheme and go look up known weaknesses/public
  // deobfuscators for it, before reading a single byte of the real payload. options.customHeader is
  // still honored if the caller explicitly wants one (e.g. local debugging), but nothing is emitted by
  // default.
  const header = options.customHeader || '';

  // Per-build randomized decoy wrapper names (no fixed Ze/Xc fingerprint)
  const decoySeeds = Array.from({length: 8}, () => Math.floor(Math.random() * 0xFFFFFF));
  const decoyUsed = new Set(usedIds);
  const decoyNames = Array.from({ length: 12 }, () => randomIdent(2 + Math.floor(Math.random() * 2), decoyUsed));

  return `${header}
return({
${decoyNames[0]}=function(r,O,k,J,y)if not k[0X5D49]then y=${toLuraphNumber(decoySeeds[0])};k[${toLuraphNumber(decoySeeds[1])}]=(y);else y=(k[0X5D49]);end;return J,y;end,
${decoyNames[1]}=function(r,O)local k,J,y=15;repeat local J=0X382__7;if J==0X382__7 then break;end;until false;return nil;end,
${decoyNames[2]}=function(r,O,k,J)if not(k)then else local k=(0B1011);while true do if k>=0X06e then break;else k=k+1;continue;end;end;end;end,
${decoyNames[3]}=((bit32 and bit32.bxor) or (bit and bit.bxor)),
${decoyNames[4]}=function(r,O,k,J,y)local P;if O and O>${toLuraphNumber(Math.floor(Math.random()*200)+50)} then if P==${toLuraphNumber(decoySeeds[2])} then return y,0x3713,0;end;end;return y,nil,0;end,
${decoyNames[5]}=function(a,b,c)local d=${toLuraphNumber(decoySeeds[3])};local e=d;for f=1,${toLuraphNumber(Math.floor(Math.random()*5)+3)} do e=((bit32 and bit32.bxor(e,d)) or (e+d));end;if e==0 then return c;end;return a;end,
${decoyNames[6]}=function(a,b)local c={};for d=1,${toLuraphNumber(Math.floor(Math.random()*10)+5)} do c[d]=(b and b+d) or d;end;if #c>${toLuraphNumber(Math.floor(Math.random()*100)+200)} then return nil;end;return c;end,
${decoyNames[7]}=function(r,O,k)local _st=${toLuraphNumber(decoySeeds[4])};local _x={[_st]=true};if _x[_st] and not _x[_st+1] then return O;end;for _i=1,0 do k=k+1;end;return k;end,
${decoyNames[8]}=function(a,b,c,d)if type(a)~="number" then return 0 end;local e=a;for f=1,${toLuraphNumber(Math.floor(Math.random()*4)+2)} do e=e*${toLuraphNumber(Math.floor(Math.random()*3)+2)};if e>${toLuraphNumber(decoySeeds[5])} then e=0;break;end;end;return e;end,
${decoyNames[9]}=function(a)if not a then return end;local b=type(a);if b=="table" then local c=#a;if c>${toLuraphNumber(decoySeeds[6])} then for d=1,0 do a[d]=nil;end;end;end;end,
${decoyNames[10]}=setmetatable({},{__call=function(t,...)return select(1,...);end,__tostring=function()return"";end}),
${decoyNames[11]}=function(...)local a={...};local b=#a;if b==0 then return nil;end;local c=a[1];for d=2,b do if type(a[d])=="number" then c=(c or 0)+a[d];end;end;if c and c>${toLuraphNumber(decoySeeds[7])} then return nil;end;return c;end,
${jrName}=function(...)
local _select=select;
local _unpack=table.unpack or unpack;
local _pack=function(...) return _select('#',...),{...};end;
local _tonumber=tonumber;
local _error=error;
local _math=math;
local _pcall=pcall;
local _getfenv=getfenv;
local _setfenv=setfenv;
local _defEnv=(_getfenv and _getfenv()) or _ENV;
${antiTamper}
${integrity.preamble}
${integrity.check}
${outerJunk}
local ${vEnv}={};do local _fe=getfenv and getfenv() or _ENV or {};local _in_env=false;local function _safe_rawset(t,k,v) if t and type(t)=="table" then pcall(rawset,t,k,v); end; end;setmetatable(${vEnv},{__index=function(t,k)if _in_env then return rawget(_fe,k);end;_in_env=true;local _v=rawget(_fe,k);if _v==nil and getgenv then local _g=getgenv();if _g and _g~=_fe then _v=rawget(_g,k) or _g[k];end;end;if _v==nil and _G then _v=rawget(_G,k) or _G[k];end;if _v==nil then _v=_fe[k];end;if _v~=nil then rawset(t,k,_v);end;_in_env=false;return _v;end,__newindex=function(t,k,v)rawset(t,k,v);_safe_rawset(_fe,k,v);if getgenv then _safe_rawset(getgenv(),k,v);end;end});end;
local _envStack={};
local _envDepth=0;
local _customFnEnvs=setmetatable({},{__mode="k"});
local _vir_getfenv=function(tgt)
  if tgt==nil or tgt==1 then return _envStack[_envDepth] or ${vEnv};
  elseif type(tgt)=="number" then
    if tgt==0 then return (_getfenv and _getfenv(0)) or _defEnv;end;
    local _idx=_envDepth-tgt+1;
    if _idx>0 and _envStack[_idx] then return _envStack[_idx];end;
    return (_getfenv and _getfenv(tgt)) or _defEnv;
  elseif type(tgt)=="function" then
    return _customFnEnvs[tgt] or ${vEnv};
  elseif _getfenv then
    return _getfenv(tgt);
  end;
  return ${vEnv};
end;
local _vir_setfenv=function(tgt,env)
  if tgt==1 then _envStack[_envDepth]=env;return env;
  elseif type(tgt)=="number" and tgt>1 then
    local _idx=_envDepth-tgt+1;
    if _idx>0 then _envStack[_idx]=env;return env;end;
    return (_setfenv and _setfenv(tgt,env)) or env;
  elseif type(tgt)=="function" then
    _customFnEnvs[tgt]=env;
    return tgt;
  elseif _setfenv then
    return _setfenv(tgt,env);
  end;
  return env;
end;
rawset(${vEnv},"getfenv",_vir_getfenv);
rawset(${vEnv},"setfenv",_vir_setfenv);
local _vG;do local _gt=_G or {};_vG=setmetatable({},{__index=function(t,k)if k=="getfenv" then return _vir_getfenv;elseif k=="setfenv" then return _vir_setfenv;end;return rawget(t,k) or _gt[k];end,__newindex=function(t,k,v)rawset(t,k,v);pcall(function() _gt[k]=v;end);end});end;
rawset(${vEnv},"_G",_vG);
local _impCache={
  ["math.floor"]=math.floor,["math.ceil"]=math.ceil,["math.abs"]=math.abs,["math.max"]=math.max,["math.min"]=math.min,
  ["math.sin"]=math.sin,["math.cos"]=math.cos,["math.rad"]=math.rad,["math.deg"]=math.deg,["math.sqrt"]=math.sqrt,
  ["math.clamp"]=math.clamp,["math.random"]=math.random,["math.huge"]=math.huge,["math.pi"]=math.pi,
  ["table.insert"]=table.insert,["table.remove"]=table.remove,["table.find"]=table.find,["table.clear"]=table.clear,
  ["table.clone"]=table.clone,["table.sort"]=table.sort,["table.concat"]=table.concat,
  ["string.sub"]=string.sub,["string.byte"]=string.byte,["string.char"]=string.char,["string.format"]=string.format,
  ["string.find"]=string.find,["string.match"]=string.match,["string.gmatch"]=string.gmatch,["string.gsub"]=string.gsub,
  ["string.len"]=string.len,["string.lower"]=string.lower,["string.upper"]=string.upper,
  ["bit32.band"]=bit32.band,["bit32.bor"]=bit32.bor,["bit32.bxor"]=bit32.bxor,["bit32.bnot"]=bit32.bnot,
  ["bit32.lshift"]=bit32.lshift,["bit32.rshift"]=bit32.rshift,["bit32.arshift"]=bit32.arshift,
  ["os.clock"]=os.clock,["os.time"]=os.time,
  ["task.wait"]=task and task.wait,["task.spawn"]=task and task.spawn,["task.defer"]=task and task.defer,["task.delay"]=task and task.delay,
  ["Vector3.new"]=Vector3 and Vector3.new,["Vector3.zero"]=Vector3 and Vector3.zero,["Vector3.one"]=Vector3 and Vector3.one,
  ["Vector2.new"]=Vector2 and Vector2.new,["Vector2.zero"]=Vector2 and Vector2.zero,["Vector2.one"]=Vector2 and Vector2.one,
  ["CFrame.new"]=CFrame and CFrame.new,["CFrame.Angles"]=CFrame and CFrame.Angles,["CFrame.identity"]=CFrame and CFrame.identity,
  ["Color3.new"]=Color3 and Color3.new,["Color3.fromRGB"]=Color3 and Color3.fromRGB,["Color3.fromHSV"]=Color3 and Color3.fromHSV,
  ["Color3.fromHex"]=Color3 and Color3.fromHex,
  ["UDim2.new"]=UDim2 and UDim2.new,["UDim2.fromScale"]=UDim2 and UDim2.fromScale,["UDim2.fromOffset"]=UDim2 and UDim2.fromOffset,
  ["UDim.new"]=UDim and UDim.new,["RaycastParams.new"]=RaycastParams and RaycastParams.new,["Instance.new"]=Instance and Instance.new
};
local ${ids.strDecrypt};
${strInitCode}
local ${ids.bc}={};
${protosData}
${generateStringCacheScrub(strTableRef)}
${bcCheck}
${debugErrors ? `local _last_proto,_last_pc,_last_op, _last_A, _last_B, _last_C, _last_N, _last_p, _last_c = 0,0,0,0,0,0,nil,nil,nil;` : ''}
local function ${idBinOp}(_k,_b,_c)
${shuffle(Object.entries(binOpKinds)).map(([name, kind]) => {
  const exprs = { ADD: '_b+_c', SUB: '_b-_c', MUL: '_b*_c', DIV: '_b/_c', MOD: '_b%_c', POW: '_b^_c', IDIV: 'math.floor(_b/_c)' };
  return `if _k==${toLuraphNumber(kind)} then return ${exprs[name]};end;`;
}).join('')}
end;
local function ${idUnOp}(_k,_b)
${shuffle(Object.entries(unOpKinds)).map(([name, kind]) => {
  const exprs = { MINUS: '-(_b)', NOT: '(not _b)', LENGTH: '(#_b)' };
  return `if _k==${toLuraphNumber(kind)} then return ${exprs[name]};end;`;
}).join('')}
end;
local function ${idCmp}(_k,_a,_c)
${shuffle(Object.entries(cmpKinds)).map(([name, kind]) => {
  const exprs = { EQ: '_a==_c', LE: '_a<=_c', LT: '_a<_c' };
  return `if _k==${toLuraphNumber(kind)} then return ${exprs[name]};end;`;
}).join('')}
end;
local function ${idGet}(_k,_t,_key)
${shuffle(Object.entries(getKinds)).map(([, kind]) => `if _k==${toLuraphNumber(kind)} then return _t[_key];end;`).join('')}
return _t[_key];
end;
local function ${idSet}(_k,_t,_key,_v)
${shuffle(Object.entries(setKinds)).map(([, kind]) => `if _k==${toLuraphNumber(kind)} then _t[_key]=_v;return;end;`).join('')}
_t[_key]=_v;
end;
local _stkPool={};
local _stkDepth=0;
local function ${ids.vm}(_id,${vEnv},_up,...)
local ${vProto}=${ids.bc}[_id];if not ${vProto} then return end;
local ${colOp},${colA},${colB},${colC},${colExtra},${vConsts},_numParams=${vProto}[${toLuraphNumber(slotOp)}],${vProto}[${toLuraphNumber(slotA)}],${vProto}[${toLuraphNumber(slotB)}],${vProto}[${toLuraphNumber(slotC)}],${vProto}[${toLuraphNumber(slotExtra)}],${vProto}[${toLuraphNumber(slotConsts)}],${vProto}[${toLuraphNumber(slotNumParams)}] or 0;
_stkDepth=_stkDepth+1;
local ${vStk}=_stkPool[_stkDepth];
if not ${vStk} then ${vStk}={};_stkPool[_stkDepth]=${vStk};end;
if table.clear then table.clear(${vStk});else for _i=0,254 do ${vStk}[_i]=nil;end;end;
local ${vPc},${vRet},${vTop}=1,nil,0;
_up=_up or {};
local _openUp;
local _openUpList={};
local _hasOpen=false;
_envDepth=_envDepth+1;_envStack[_envDepth]=${vEnv};
local ${vArgs};
local _ac=_select('#',...);
if _ac>0 then
if _ac==1 then
${vStk}[0]=...;
elseif _ac==2 then
local _a0,_a1=...;${vStk}[0]=_a0;${vStk}[1]=_a1;
elseif _ac==3 then
local _a0,_a1,_a2=...;${vStk}[0]=_a0;${vStk}[1]=_a1;${vStk}[2]=_a2;
elseif _ac==4 then
local _a0,_a1,_a2,_a3=...;${vStk}[0]=_a0;${vStk}[1]=_a1;${vStk}[2]=_a2;${vStk}[3]=_a3;
else
${vArgs}={n=_ac,...};
for _i=1,_ac do ${vStk}[_i-1]=${vArgs}[_i];end;
end;
if not ${vArgs} and _ac>_numParams then
${vArgs}={n=_ac,...};
end;
end;
while true do
local ${vOp}=${colOp}[${vPc}];
if not ${vOp} then break;end;
${debugErrors ? `_last_proto=_id;_last_pc=${vPc};_last_op=${vOp};_last_A=${colA}[${vPc}];_last_B=${colB}[${vPc}];_last_C=${colC}[${vPc}];_last_N=${colExtra}[${vPc}];_last_p=${vConsts};_last_c=${vStk};` : ''}
${decisionTreeCode}
end;
_envStack[_envDepth]=nil;_envDepth=_envDepth-1;_stkDepth=_stkDepth-1;
if ${vRet} then return _unpack(${vRet},1,${vRet}.n or #${vRet});end;
end;
local _res={xpcall(function(...) return ${ids.vm}(${mainProtoId},${vEnv},{},...);end,function(e)${debugErrors
    ? ` local _msg=\"VM Error: \"..tostring(e);pcall(function() _msg=\"VM Error in Proto \"..tostring(_last_proto)..\" PC \"..tostring(_last_pc)..\" OP \"..tostring(_last_op)..\" (A=\"..tostring(_last_A)..\" B=\"..tostring(_last_B)..\" C=\"..tostring(_last_C)..\"): \"..tostring(e);end);return _msg..\"\\n\"..(debug and debug.traceback() or \"\");`
    : ` return \"VM Error\";`}end,...)};
${antiDump}
if not _res[1] then error(_res[2]);end;
return _unpack(_res,2);
end
}).${jrName}(...);
`;
}

module.exports = { generateLuraphVM };
