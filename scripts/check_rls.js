const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf-8');
const envLines = envFile.split('\n');
let supabaseUrl = '';
let supabaseKey = '';

for (const line of envLines) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Testing RLS...");
    const { data: vp, error } = await supabase.from('voice_profile').select('*');
    if (error) console.error("Error:", error);
    console.log("Anon select voice_profile:", vp?.length || 0, "rows");
}
run();
