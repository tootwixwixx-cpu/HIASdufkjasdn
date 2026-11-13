// core/transforms/junkEngine.js
// AtomProtect Industrial Junk Code & Decoy Engine
// Generates multi-tiered junk code, 100+ decoy opcode handlers, 15+ fake modules,
// and realistic-looking system code to confuse decompilers and pattern analyzers.

'use strict';

const { toLuraphNumber } = require('./numberFormat');

function randomVarName(prefix = '') {
  const styles = [
    () => `__AP_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    () => `_${['l','I','o','O','v','x','z'][Math.floor(Math.random()*7)]}_${Math.floor(Math.random()*9999).toString(16)}`,
    () => `_0x${Math.floor(Math.random()*0xFFFFFF).toString(16)}`,
    () => `__state_${Math.floor(Math.random()*899+100)}`,
  ];
  return (prefix ? prefix + '_' : '') + styles[Math.floor(Math.random()*styles.length)]();
}

/**
 * 100+ unique decoy opcode handler templates for the VM BST dispatcher
 */
function generateDecoyOpcodeHandlers(colA, colB, colC, colExtra, vStk, vPc, vConsts, vEnv, vTop, idsOrStartId) {
  const templates = [
    // === Category A: Bitwise/Math (25 templates) ===
    (id) => ({id, body:`do local _v=(${colB}[${vPc}]);(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.bxor(_v,0x5F)) or (_v+95));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${colC}[${vPc}]);(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.band(_v,0xFF)) or (_v%256));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${colB}[${vPc}]);(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.rrotate(_v,3)) or (_v));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${colC}[${vPc}]);(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.bnot(_v)) or (-_v-1));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${colB}[${vPc}]);(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.lshift(_v,2)) or (_v*4));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 1;(${vStk})[${colA}[${vPc}]]=math.sqrt(_v*_v);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=math.floor(_v+0.5);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _a=${colB}[${vPc}] or 0;local _b=${colC}[${vPc}] or 1;(${vStk})[${colA}[${vPc}]]=math.max(_a,_b);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=_v*_v+_v+1;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colC}[${vPc}] or 1;(${vStk})[${colA}[${vPc}]]=math.abs(_v)*2;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _a=${colB}[${vPc}] or 0;local _b=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=(_a*_b+_a-_b);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 1;(${vStk})[${colA}[${vPc}]]=math.ceil(math.log(_v+1));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.rshift(_v,1)) or math.floor(_v/2));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 0;local _w=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.bor(_v,_w)) or (_v+_w));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _f=math.ldexp or math.floor;(${vStk})[${colA}[${vPc}]]=_f((${colB}[${vPc}] or 1),2);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=_v%256;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colC}[${vPc}] or 1;(${vStk})[${colA}[${vPc}]]=(_v*3+7)%256;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _x=${colB}[${vPc}] or 0;local _y=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=math.min(_x,_y);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _s=math.sin(0)+math.cos(0);if _s~=1 then end;(${vStk})[${colA}[${vPc}]]=_s;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _d=math.deg(0);(${vStk})[${colA}[${vPc}]]=_d;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _r=math.rad(180);(${vStk})[${colA}[${vPc}]]=_r;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${colB}[${vPc}] or 0);(${vStk})[${colA}[${vPc}]]=math.clamp and math.clamp(_v,0,255) or math.max(0,math.min(_v,255));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _x=math.fmod(${colB}[${vPc}] or 1,256);(${vStk})[${colA}[${vPc}]]=_x;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=((bit32 and bit32.bxor(bit32.lshift(_v,4),bit32.rshift(_v,4))) or _v);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=(_v*_v)%65536;${vPc}=${vPc}+1;end`}),

    // === Category B: Table Operations (15 templates) ===
    (id) => ({id, body:`do local _t={__mode="k",__metatable=false};(${vStk})[${colA}[${vPc}]]=setmetatable({},_t);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _r=rawget((${vStk}),${colB}[${vPc}]);if _r then (${vStk})[${colA}[${vPc}]]=_r;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do rawset((${vStk}),${colA}[${vPc}],rawget((${vStk}),${colB}[${vPc}]));${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _sz=#(${vStk});if _sz>10000 then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _k=(${colC}[${vPc}]);if not(${vConsts}[_k]) then (${vStk})[${colA}[${vPc}]]=nil;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _t={};for _j=1,${colB}[${vPc}] or 3 do _t[_j]=_j;end;(${vStk})[${colA}[${vPc}]]=_t;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _t=(${vStk})[${colB}[${vPc}]];if type(_t)=="table" then (${vStk})[${colA}[${vPc}]]=#_t;else (${vStk})[${colA}[${vPc}]]=0;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _t={};_t[1]=${colB}[${vPc}] or 0;_t[2]=${colC}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=_t;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if table.create then (${vStk})[${colA}[${vPc}]]=table.create(${colB}[${vPc}] or 4,0);else (${vStk})[${colA}[${vPc}]]={};end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if table.freeze and type((${vStk})[${colA}[${vPc}]])=="table" then pcall(table.freeze,(${vStk})[${colA}[${vPc}]]);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _arr={${colA}[${vPc}],${colB}[${vPc}],${colC}[${vPc}]};${vTop}=#_arr;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _g=(${colB}[${vPc}]);(${vStk})[_g]=rawset;end;${vPc}=${vPc}+1`}),
    (id) => ({id, body:`do local _t={};_t.__index=_t;(${vStk})[${colA}[${vPc}]]=setmetatable({},_t);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if table.find and type((${vStk})[${colB}[${vPc}]])=="table" then (${vStk})[${colA}[${vPc}]]=table.find((${vStk})[${colB}[${vPc}]],${colC}[${vPc}]);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do (${vStk})[${colA}[${vPc}]]=type((${vStk})[${colB}[${vPc}]]);${vPc}=${vPc}+1;end`}),

    // === Category C: String Operations (15 templates) ===
    (id) => ({id, body:`do local _s=tostring(${colB}[${vPc}]);(${vStk})[${colA}[${vPc}]]=string.byte(_s,1) or 0;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _n=tonumber(${colC}[${vPc}]) or 1;(${vStk})[${colA}[${vPc}]]=math.abs(_n)*2;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _p=(${colExtra}[${vPc}]);if _p and type(_p)=="string" and #_p>0 then (${vStk})[${colA}[${vPc}]]=string.reverse(_p);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=(${vStk}[${colB}[${vPc}]]);(${vStk})[${colA}[${vPc}]]=(type(_v)=="string" and #_v) or 0;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _s=tostring(${colB}[${vPc}] or 0);(${vStk})[${colA}[${vPc}]]=string.rep(_s,1);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 65;if _v>=0 and _v<=127 then (${vStk})[${colA}[${vPc}]]=string.char(_v);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _s=tostring(${colC}[${vPc}] or "");(${vStk})[${colA}[${vPc}]]=string.format("%s",_s);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _h=0x811c9dc5;local _s=tostring(${colB}[${vPc}] or "");for _i=1,#_s do _h=((bit32 and bit32.bxor(_h,string.byte(_s,_i))) or (_h+string.byte(_s,_i)));end;(${vStk})[${colA}[${vPc}]]=_h;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _h=5381;local _s=tostring(${colC}[${vPc}] or "");for _i=1,math.min(#_s,64) do _h=_h*33+string.byte(_s,_i);end;(${vStk})[${colA}[${vPc}]]=_h%65536;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${vStk}[${colB}[${vPc}]];if type(_v)=="string" then (${vStk})[${colA}[${vPc}]]=string.upper(_v);else (${vStk})[${colA}[${vPc}]]=tostring(_v or "");end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=${vStk}[${colB}[${vPc}]];if type(_v)=="string" and #_v>0 then (${vStk})[${colA}[${vPc}]]=string.sub(_v,1,1);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _n=${colB}[${vPc}] or 0;(${vStk})[${colA}[${vPc}]]=string.format("0x%X",_n);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=tostring(${colB}[${vPc}] or 0);local _r="";for _i=#_v,1,-1 do _r=_r..string.sub(_v,_i,_i);end;(${vStk})[${colA}[${vPc}]]=_r;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _a=tostring(${colB}[${vPc}] or "");local _b=tostring(${colC}[${vPc}] or "");(${vStk})[${colA}[${vPc}]]=_a.._b;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do (${vStk})[${colA}[${vPc}]]=tostring(${colB}[${vPc}] or 0)..tostring(${colC}[${vPc}] or 0);${vPc}=${vPc}+1;end`}),

    // === Category D: Opaque Predicates (15 templates) ===
    (id) => ({id, body:`if not(${colB}[${vPc}]==${colB}[${vPc}]) then ${vPc}=${colC}[${vPc}];else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`if (math.huge~=math.huge) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`if (0==1 and type(${vEnv})~="table") then ${vPc}=999999;else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _q=(${colA}[${vPc}]);if _q and _q<0 then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`if false then ${vTop}=${colA}[${vPc}];${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _x=${colB}[${vPc}] or 1;if _x*0~=0 then ${vPc}=${colC}[${vPc}] or ${vPc}+1;else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`do local _v=${colB}[${vPc}] or 0;if _v~=_v then ${vPc}=${colC}[${vPc}] or 1;else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`if type(nil)~="nil" then ${vPc}=${colB}[${vPc}] or 1;else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if type(${vEnv})~="table" and type(${vEnv})~="userdata" then ${vPc}=999;else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`do local _t=type(true);if _t~="boolean" then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`do if not(not true) then ${vPc}=${vPc}+1;else ${vPc}=${colB}[${vPc}];end;end`}),
    (id) => ({id, body:`do local _n=0/0;if _n==_n then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`do if 1>2 then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`}),
    (id) => ({id, body:`do local _v=${colA}[${vPc}];if _v and _v==_v then ${vPc}=${vPc}+1;else ${vPc}=${colB}[${vPc}] or 1;end;end`}),
    (id) => ({id, body:`do if not pcall(function()end) then ${vPc}=${colB}[${vPc}];else ${vPc}=${vPc}+1;end;end`}),

    // === Category E: Control Flow / Coroutine Decoys (15 templates) ===
    (id) => ({id, body:`do local _co=coroutine.running();if _co and not coroutine.isyieldable() then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _st=coroutine.status;if _st and false then _st(coroutine.create(function()end));end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _c=gcinfo and gcinfo() or 0;if _c<0 then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do for _i=1,0 do (${vStk})[${colA}[${vPc}]]=_i;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _ok=pcall(function() return true end);if not _ok then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _co=coroutine.create(function() return 1 end);if false then coroutine.resume(_co);end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do while false do (${vStk})[${colA}[${vPc}]]=nil;break;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do repeat break until true;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _s=0;for _i=1,0 do _s=_s+_i;end;(${vStk})[${colA}[${vPc}]]=_s;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if false then local _t=coroutine.wrap(function() return nil end);_t();end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _ok,_err=pcall(tostring,${colB}[${vPc}] or 0);if _ok then (${vStk})[${colA}[${vPc}]]=_err;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if false then error("unreachable");end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _x=${colA}[${vPc}];if type(_x)=="number" and _x<-999 then return;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _ok=xpcall(function()return true end,function(e)return e end);${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _sel=select(1,${colA}[${vPc}],${colB}[${vPc}],${colC}[${vPc}]);(${vStk})[${colA}[${vPc}]]=_sel;${vPc}=${vPc}+1;end`}),

    // === Category F: Environment/Global Decoys (10 templates) ===
    (id) => ({id, body:`do local _e=rawget(${vEnv},"__AP_GUARD") or false;if _e then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if rawget(${vEnv},"__INTEGRITY_FLAG")==nil then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _g=rawget(${vEnv},"game");if _g and false then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if debug and debug.info then local _f,_l=debug.info(1,"fl");end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _t=type(${vEnv});if _t~="table" then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if rawget(${vEnv},"hookmetamethod") then end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _v=rawget(${vEnv},"warn");if _v and false then _v("noop");end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _n=rawget(${vEnv},"newproxy");if _n then (${vStk})[${colA}[${vPc}]]=nil;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if rawget(${vEnv},"typeof") then (${vStk})[${colA}[${vPc}]]="Instance";else (${vStk})[${colA}[${vPc}]]="nil";end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do if rawget(${vEnv},"identifyexecutor") then end;${vPc}=${vPc}+1;end`}),

    // === Category G: Structural Luraph-style (10 templates) ===
    (id) => ({id, body:`local _g=(${colC}[${vPc}]);(${vStk})[_g]=(${vStk}[_g] and (${vStk}[_g+1]));${vTop}=_g;${vPc}=${vPc}+1`}),
    (id) => ({id, body:`(${vStk})[${colC}[${vPc}]]=(not ${vStk}[${colB}[${vPc}]]);${vPc}=${vPc}+1`}),
    (id) => ({id, body:`if not(not(${vStk}[${colA}[${vPc}]]<${vStk}[${colB}[${vPc}]])) then ${vPc}=(${colC}[${vPc}]);else ${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`local _X={[4]=${colB},[2]=${colC},[3]=${colExtra},[1]=${colA}};${vTop}=${colA}[${vPc}];${vPc}=${vPc}+1`}),
    (id) => ({id, body:`do local _a=${colA}[${vPc}];local _b=${colB}[${vPc}];(${vStk})[_a]=(${vStk})[_b];(${vStk})[_a+1]=(${vStk})[_b+1];${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _r=${colA}[${vPc}];for _j=_r,_r+${colB}[${vPc}] or 0 do (${vStk})[_j]=nil;end;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _r=${colA}[${vPc}];(${vStk})[_r]=(${vStk}[_r] or false) and true or false;${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do (${vStk})[${colA}[${vPc}]]=tonumber(${colB}[${vPc}]) or ${colB}[${vPc}];${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do (${vStk})[${colA}[${vPc}]]=tostring(${vStk}[${colB}[${vPc}]] or "nil");${vPc}=${vPc}+1;end`}),
    (id) => ({id, body:`do local _r=${colA}[${vPc}];if (${vStk})[_r]==nil then (${vStk})[_r]=false;end;${vPc}=${vPc}+1;end`}),
  ];

  const count = Array.isArray(idsOrStartId) ? idsOrStartId.length : 50;
  const decoys = [];
  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    const opId = Array.isArray(idsOrStartId) ? idsOrStartId[i] : (idsOrStartId + i);
    decoys.push(template(opId));
  }
  return decoys;
}

/**
 * Integrity-tied binder: small locals that MUST remain for the VM check to pass.
 * (Replaces prior unused fake modules that were trivially DCE'd and bloated init.)
 */
function generateIntegrityBinder() {
  const a = 1000 + Math.floor(Math.random() * 50000);
  const b = 1000 + Math.floor(Math.random() * 50000);
  const mask = 1 + Math.floor(Math.random() * 200);
  const expected = (((a ^ mask) + b) % 16777216);
  return {
    preamble: `local __ap_i=${toLuraphNumber(a)};local __ap_m=${toLuraphNumber(mask)};local __ap_b=${toLuraphNumber(b)};`,
    check: `do local _bx=((bit32 and bit32.bxor)or(bit and bit.bxor));local _t=_bx(__ap_i,__ap_m);_t=(_t+__ap_b)%16777216;if _t~=${toLuraphNumber(expected)} then error("VM Error") end;__ap_i=nil;__ap_m=nil;__ap_b=nil;end`,
  };
}

/**
 * Optional decorative fake modules (0–1). Prefer integrity binder for real protection.
 * Kept for size/noise when explicitly requested.
 */
function generateOuterLayerJunk() {
  // Default: no unused fake modules (they were dead weight + easy to strip).
  return '';
}

function generateOuterLayerJunkLegacy() {
  const seed = Math.floor(Math.random() * 999999);
  const fakeModules = [
    // 1. Fake Network Security Controller
    `local function __init_security_pipeline()
  local _sec = {_nonce = ${toLuraphNumber(seed)}, _ver = "4.19.8-LUA_U", _hooks = {}, _cache = setmetatable({}, {__mode = "v"})}
  function _sec:VerifyStack(depth) local d = depth or 3; if debug and debug.info then local fn, l = debug.info(d, "fl"); if fn and l and l < 0 then return false end end; return true end
  function _sec:DispatchSignature(payload) if type(payload) ~= "string" then return 0xDEAD end; local h = 0x811c9dc5; for i = 1, #payload do h = ((bit32 and bit32.bxor(h, string.byte(payload, i))) or (h + i)) end; return h end
  function _sec:BindSentinel(instance, eventName, handler) if not instance or not eventName then return end; self._hooks[eventName] = handler end
  return _sec
end`,

    // 2. Fake Memory Allocator
    `local function __init_buffer_allocator()
  local _alloc = {_blocks = {}, _ptr = 0x1000, _pageSize = 0x400}
  function _alloc:Alloc(bytes) local id = self._ptr; self._ptr = self._ptr + bytes; self._blocks[id] = table.create and table.create(bytes, 0) or {}; return id end
  function _alloc:Free(id) if self._blocks[id] then if table.clear then table.clear(self._blocks[id]) end; self._blocks[id] = nil end end
  function _alloc:WriteU32(id, offset, val) local blk = self._blocks[id]; if blk then blk[offset + 1] = val % 256 end end
  return _alloc
end`,

    // 3. Fake Coroutine Task Scheduler
    `local function __init_task_scheduler()
  local _sched = {_queue = {}, _active = 0, _maxThreads = 16}
  function _sched:Spawn(fn, ...) local co = coroutine.create(fn); table.insert(self._queue, {co = co, args = {...}}); return co end
  function _sched:Step() if #self._queue == 0 then return end; local item = table.remove(self._queue, 1); if item and coroutine.status(item.co) == "suspended" then local ok, err = coroutine.resume(item.co, table.unpack(item.args)) end end
  return _sched
end`,

    // 4. Fake Telemetry Beacon
    `local function __init_telemetry_beacon()
  local _beacon = {_seq = 0, _origin = os and os.clock and os.clock() or 0, _flags = 0xB3}
  function _beacon:Ping() self._seq = self._seq + 1; local t = (os and os.clock and os.clock() or 1) - self._origin; return (self._seq * 31 + math.floor(t)) % 65536 end
  function _beacon:CheckIntegrity() local p1 = self:Ping(); local p2 = self:Ping(); return p2 >= p1 end
  return _beacon
end`,

    // 5. Fake OOP Class System
    `local function __init_class_system()
  local _ClassRegistry = {}
  local function _createClass(name, parent)
    local cls = setmetatable({}, {__index = parent, __tostring = function() return name end})
    cls.__index = cls; cls.__name = name
    function cls.new(...) local inst = setmetatable({}, cls); if inst.init then inst:init(...) end; return inst end
    _ClassRegistry[name] = cls; return cls
  end
  local _Base = _createClass("Base", nil)
  function _Base:init() self._id = math.random(1, 999999); self._alive = true end
  function _Base:destroy() self._alive = false; self._id = nil end
  local _Entity = _createClass("Entity", _Base)
  function _Entity:init(name) _Base.init(self); self.name = name or "Unknown"; self.components = {} end
  return {createClass = _createClass, registry = _ClassRegistry}
end`,

    // 6. Fake Signal/Event System
    `local function __init_signal_system()
  local _Signal = {}; _Signal.__index = _Signal
  function _Signal.new() return setmetatable({_listeners = {}, _once = {}}, _Signal) end
  function _Signal:Connect(fn) local id = #self._listeners + 1; self._listeners[id] = fn; return {Disconnect = function() self._listeners[id] = nil end} end
  function _Signal:Once(fn) local id = #self._once + 1; self._once[id] = fn end
  function _Signal:Fire(...) for _, fn in pairs(self._listeners) do pcall(fn, ...) end; for _, fn in pairs(self._once) do pcall(fn, ...) end; self._once = {} end
  function _Signal:Wait() local _co = coroutine.running(); self:Once(function(...) if _co then coroutine.resume(_co, ...) end end) end
  return _Signal
end`,

    // 7. Fake DataStore Wrapper
    `local function __init_datastore_cache()
  local _DSCache = {_store = {}, _dirty = {}, _ttl = 300}
  function _DSCache:Get(key) if self._store[key] and os.clock() - (self._store[key].t or 0) < self._ttl then return self._store[key].v end; return nil end
  function _DSCache:Set(key, value) self._store[key] = {v = value, t = os.clock()}; self._dirty[key] = true end
  function _DSCache:Flush() for k, _ in pairs(self._dirty) do self._dirty[k] = nil end end
  function _DSCache:Clear() self._store = {}; self._dirty = {} end
  return _DSCache
end`,

    // 8. Fake Encryption Utility
    `local function __init_crypto_utils()
  local _crypto = {}
  function _crypto.xorCipher(data, key)
    local out = {}; local kl = #key
    for i = 1, #data do out[i] = string.char(((bit32 and bit32.bxor(string.byte(data, i), string.byte(key, ((i-1)%kl)+1))) or (string.byte(data,i)))) end
    return table.concat(out)
  end
  function _crypto.hash32(data)
    local h = 0x12345678
    for i = 1, #data do h = ((bit32 and bit32.bxor(h * 31, string.byte(data, i))) or (h + string.byte(data, i))) % 0x100000000 end
    return h
  end
  function _crypto.verify(data, expected) return _crypto.hash32(data) == expected end
  return _crypto
end`,

    // 9. Fake State Machine
    `local function __init_state_machine()
  local _SM = {_state = "IDLE", _transitions = {}, _handlers = {}}
  function _SM:AddTransition(from, event, to) self._transitions[from .. ":" .. event] = to end
  function _SM:On(state, handler) self._handlers[state] = handler end
  function _SM:Dispatch(event)
    local key = self._state .. ":" .. event; local next_state = self._transitions[key]
    if next_state then self._state = next_state; local h = self._handlers[next_state]; if h then h(self) end end
  end
  _SM:AddTransition("IDLE", "start", "RUNNING"); _SM:AddTransition("RUNNING", "pause", "PAUSED"); _SM:AddTransition("PAUSED", "resume", "RUNNING")
  return _SM
end`,

    // 10. Fake Debug Profiler
    `local function __init_profiler()
  local _prof = {_marks = {}, _times = {}, _enabled = false}
  function _prof:Mark(label) if not self._enabled then return end; self._marks[label] = os and os.clock and os.clock() or 0 end
  function _prof:Measure(label)
    if not self._enabled or not self._marks[label] then return 0 end
    local elapsed = (os and os.clock and os.clock() or 0) - self._marks[label]; self._times[label] = elapsed; return elapsed
  end
  function _prof:Report() local r = {}; for k, v in pairs(self._times) do r[#r+1] = k .. ": " .. string.format("%.4f", v) .. "s" end; return table.concat(r, "\\n") end
  return _prof
end`,

    // 11. Fake Input Handler
    `local function __init_input_handler()
  local _input = {_binds = {}, _held = {}, _lastInput = 0}
  function _input:Bind(key, action) self._binds[key] = action end
  function _input:Process(key, state)
    self._held[key] = state == "press"; self._lastInput = os and os.clock and os.clock() or 0
    if self._binds[key] then pcall(self._binds[key], state) end
  end
  function _input:IsHeld(key) return self._held[key] == true end
  function _input:TimeSinceInput() return (os and os.clock and os.clock() or 0) - self._lastInput end
  return _input
end`,

    // 12. Fake GUI Framework
    `local function __init_gui_framework()
  local _UI = {_elements = {}, _root = nil, _theme = {bg = "0,0,0", fg = "255,255,255"}}
  function _UI:Create(class, props)
    local elem = {class = class, props = props or {}, children = {}, visible = true}
    self._elements[#self._elements + 1] = elem; return elem
  end
  function _UI:SetTheme(t) for k, v in pairs(t) do self._theme[k] = v end end
  function _UI:Render(elem) if not elem or not elem.visible then return end; for _, child in ipairs(elem.children) do self:Render(child) end end
  function _UI:Destroy() for i = #self._elements, 1, -1 do self._elements[i] = nil end end
  return _UI
end`,

    // 13. Fake Anti-Cheat Module
    `local function __init_anticheat()
  local _ac = {_checks = {}, _violations = 0, _threshold = 3}
  function _ac:Register(name, fn) self._checks[name] = fn end
  function _ac:RunAll()
    for name, fn in pairs(self._checks) do
      local ok, result = pcall(fn)
      if not ok or result == false then self._violations = self._violations + 1 end
    end
    return self._violations < self._threshold
  end
  _ac:Register("stack", function() return debug == nil or debug.info ~= nil end)
  _ac:Register("env", function() return type(_G) == "table" end)
  _ac:Register("time", function() local t = os and os.clock and os.clock() or 0; return t >= 0 end)
  return _ac
end`,

    // 14. Fake Tween System
    `local function __init_tween_system()
  local _tw = {_active = {}, _pool = {}}
  function _tw:Create(obj, props, duration)
    local tween = {obj = obj, props = props, duration = duration or 1, elapsed = 0, playing = false}
    self._active[#self._active + 1] = tween; return tween
  end
  function _tw:Update(dt)
    for i = #self._active, 1, -1 do
      local t = self._active[i]; if t.playing then t.elapsed = t.elapsed + dt; if t.elapsed >= t.duration then table.remove(self._active, i) end end
    end
  end
  function _tw:CancelAll() self._active = {} end
  return _tw
end`,

    // 15. Fake Network Protocol
    `local function __init_net_protocol()
  local _net = {_seq = 0, _ack = 0, _pending = {}, _handlers = {}}
  function _net:Send(opcode, data)
    self._seq = self._seq + 1
    self._pending[self._seq] = {op = opcode, data = data, time = os and os.clock and os.clock() or 0}
    return self._seq
  end
  function _net:OnReceive(opcode, handler) self._handlers[opcode] = handler end
  function _net:Process(packet)
    if packet and packet.ack then self._ack = packet.ack; self._pending[packet.ack] = nil end
    if packet and packet.op and self._handlers[packet.op] then pcall(self._handlers[packet.op], packet.data) end
  end
  return _net
end`,
  ];

  // Pick 4-6 random fake modules
  const count = 4 + Math.floor(Math.random() * 3);
  const indices = [];
  while (indices.length < count) {
    const idx = Math.floor(Math.random() * fakeModules.length);
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices.map(i => fakeModules[i]).join('\n\n') + '\n';
}

/**
 * 60+ realistic decoy string constants
 */
function generateDecoyStringConstants(count = 40) {
  const decoys = [
    "HttpGet", "HttpPost", "GetAsync", "PostAsync",
    "RobloxReplicatedStorage", "Players", "LocalPlayer",
    "HumanoidRootPart", "CharacterAdded", "UserInputService",
    "TweenService", "RunService", "Heartbeat", "RenderStepped",
    "Stepped", "VirtualInputManager", "FireServer", "InvokeServer",
    "OnClientEvent", "OnClientInvoke", "Workspace", "CoreGui",
    "TeleportService", "MarketplaceService", "HttpService",
    "JSONDecode", "JSONEncode", "GenerateGUID",
    "anti_tamper_violation_flag", "integrity_digest_mismatch",
    "unauthorized_executor_detected", "luau_vm_corrupted",
    "GetChildren", "FindFirstChild", "WaitForChild", "Clone",
    "Destroy", "SetPrimaryPartCFrame", "GetPrimaryPartCFrame",
    "BodyVelocity", "BodyForce", "BodyPosition",
    "RemoteEvent", "RemoteFunction", "BindableEvent",
    "CollectionService", "PhysicsService", "PathfindingService",
    "ReplicatedFirst", "ServerScriptService", "ServerStorage",
    "StarterGui", "StarterPack", "StarterPlayer",
    "SoundService", "Chat", "Teams",
    "DataStoreService", "GetDataStore", "SetAsync", "GetAsync",
    "MemoryStoreService", "MessagingService", "PolicyService",
    "TextService", "LocalizationService", "GroupService",
    "__integrity_check_v4", "__vm_dispatch_table",
    "__bytecode_header_sig", "__opcode_remap_key"
  ];
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(decoys[i % decoys.length] + `_${Math.random().toString(36).slice(2, 6)}`);
  }
  return result;
}

/**
 * 8+ diverse bytecode-level junk instruction patterns
 */
function generateHarmlessBytecodeInstructions(count = 3) {
  const instructions = [];
  for (let i = 0; i < count; i++) {
    const type = Math.floor(Math.random() * 8);
    const r = 240 + Math.floor(Math.random() * 5);
    const r2 = r + 1;
    const r3 = r + 2;
    switch (type) {
      case 0: // Dead math chain
        instructions.push(
          { op: 'LOADN', args: [`R${r}`, String(Math.floor(Math.random()*50)+1)] },
          { op: 'LOADN', args: [`R${r2}`, String(Math.floor(Math.random()*50)+1)] },
          { op: 'ADD', args: [`R${r}`, `R${r}`, `R${r2}`] }
        ); break;
      case 1: // Dead table ops
        instructions.push(
          { op: 'NEWTABLE', args: [`R${r}`, '0'] },
          { op: 'LOADNIL', args: [`R${r}`, '0'] }
        ); break;
      case 2: // Dead move chain
        instructions.push(
          { op: 'LOADN', args: [`R${r}`, '42'] },
          { op: 'MOVE', args: [`R${r2}`, `R${r}`] },
          { op: 'LOADNIL', args: [`R${r}`, '1'] }
        ); break;
      case 3: // Dead boolean
        instructions.push(
          { op: 'LOADB', args: [`R${r}`, String(Math.floor(Math.random()*2)), '0'] }
        ); break;
      case 4: // Dead SUB
        instructions.push(
          { op: 'LOADN', args: [`R${r}`, String(Math.floor(Math.random()*100)+50)] },
          { op: 'LOADN', args: [`R${r2}`, String(Math.floor(Math.random()*20)+1)] },
          { op: 'SUB', args: [`R${r3}`, `R${r}`, `R${r2}`] },
          { op: 'LOADNIL', args: [`R${r}`, '2'] }
        ); break;
      case 5: // Dead MUL
        instructions.push(
          { op: 'LOADN', args: [`R${r}`, String(Math.floor(Math.random()*10)+2)] },
          { op: 'LOADN', args: [`R${r2}`, String(Math.floor(Math.random()*10)+2)] },
          { op: 'MUL', args: [`R${r3}`, `R${r}`, `R${r2}`] },
          { op: 'LOADNIL', args: [`R${r}`, '2'] }
        ); break;
      case 6: // Dead NOT chain
        instructions.push(
          { op: 'LOADB', args: [`R${r}`, '1', '0'] },
          { op: 'NOT', args: [`R${r2}`, `R${r}`] },
          { op: 'LOADNIL', args: [`R${r}`, '1'] }
        ); break;
      case 7: // Triple NOP
      default:
        instructions.push(
          { op: 'NOP', args: [] },
          { op: 'NOP', args: [] }
        ); break;
    }
  }
  return instructions;
}

module.exports = {
  randomVarName,
  generateDecoyOpcodeHandlers,
  generateOuterLayerJunk,
  generateOuterLayerJunkLegacy,
  generateIntegrityBinder,
  generateDecoyStringConstants,
  generateHarmlessBytecodeInstructions
};
