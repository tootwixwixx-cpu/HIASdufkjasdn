const { createClient } = require('@supabase/supabase-js');
const fengari = require('fengari');
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // never hardcode keys
const supabase = createClient(url, key);

const { bundleModularScript } = require('../lib/module-bundler');

async function main() {
  const { data } = await supabase.from('scripts').select('*').eq('slug', 'atomware-hub');
  const s = data[0];
  const bundle = bundleModularScript({
    entryFile: s.entry_file || "init.lua",
    files: s.modules || {},
    obfuscate: false
  });

  const lines = bundle.split('\n');
  console.log('Bundle lines count:', lines.length);

  // Check line 1562
  console.log('--- Lines 1555 - 1570 of bundle ---');
  for (let i = 1555; i <= 1570; i++) {
    console.log(i + ': ' + lines[i - 1]);
  }
}
main().catch(console.error);
