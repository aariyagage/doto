const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// We need the service role key to check auth.users if we are going to bypass RLS,
// but let's just use the URL and ANON key to test sign in 
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking auth schema...");
    // Let's try to query videos table to see if we can get anything
    const { data: videos, error: err2 } = await supabase.from('videos').select('id, user_id').limit(1);
    console.log("Videos query:", err2 || "OK");
}
check();
