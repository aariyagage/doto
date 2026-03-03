const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('content_ideas').select('title, hook, created_at, pillar_id').order('created_at', { ascending: false }).limit(10);
  console.log("With created_at:", error ? error.message : data);
  const { data: d2, error: e2 } = await supabase.from('content_ideas').select('title, hook, generated_at, pillar_id').order('generated_at', { ascending: false }).limit(10);
  console.log("With generated_at:", e2 ? e2.message : d2);
}
run();
