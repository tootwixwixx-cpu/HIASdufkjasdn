const fs = require('fs');
let code = fs.readFileSync('temp_mock_runner.lua', 'utf8');

// Replace:
// while true do
// ...
// end;
// if R then return _unpack(R,1,R.n or #R);end;

const target = 'while true do';
const replacement = `
local _loopOk, _loopErr = xpcall(function()
while true do`;

const targetEnd = 'if R then return _unpack(R,1,R.n or #R);end;\nend;';
const replacementEnd = `end;
end, function(e)
  print(string.format("[VM RUNTIME ERROR] in Proto %s PC %s OP %s: %s", tostring(_last_proto), tostring(_last_pc), tostring(_last_op), tostring(e)))
  print(debug.traceback())
  return e
end)
if not _loopOk then error(_loopErr); end;
if R then return _unpack(R,1,R.n or #R);end;
end;`;

code = code.replace(target, replacement);
code = code.replace(targetEnd, replacementEnd);
fs.writeFileSync('temp_mock_debug.lua', code, 'utf8');
console.log('Modified temp_mock_debug.lua');
