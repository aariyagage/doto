const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('content_ideas').select('title, hook, generated_at').order('generated_at', { ascending: false }).limit(5);
  console.log("DB response:");
  console.log(error || data);
}
run();
