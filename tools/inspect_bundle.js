const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // never hardcode keys
const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase.from('scripts').select('*').eq('slug', 'atomware-hub');
  if (error || !data.length) {
    console.error('Fetch error:', error);
    return;
  }
  const s = data[0];
  console.log('Script name:', s.name);
  console.log('use_auth:', s.use_auth);
  console.log('entry_file:', s.entry_file);
  console.log('Modules:');
  for (const [k, v] of Object.entries(s.modules || {})) {
    console.log(` - ${k}: ${v.length} bytes, ${v.split('\n').length} lines`);
  }
}
main();
