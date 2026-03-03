const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking DB...");
    const { data: transcripts, error: err1 } = await supabase.from('transcripts').select('id, user_id').limit(1);
    console.log("Transcripts query:", err1 || "OK");

    const { data: videos, error: err2 } = await supabase.from('videos').select('id, user_id').limit(1);
    console.log("Videos query:", err2 || "OK");

    // We try to authenticate to get the exact ID
    const { data: sessionData, error: authError } = await supabase.auth.signInWithPassword({
        // we can't do this without credentials, let's just use the server-side client approach
    });
}
check();
