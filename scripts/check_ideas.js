const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join('/Users/aariyagage/.gemini/antigravity/scratch/doto/.env');
const envFile = fs.readFileSync(envPath, 'utf-8');
const envLines = envFile.split('\n');
let supabaseUrl = '';
let svcKey = '';
let anonKey = '';

for (const line of envLines) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) anonKey = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) svcKey = line.split('=')[1].trim();
}

// Ensure we bypass RLS for this specific debug script if we have the service role key, else use anon
const supabase = createClient(supabaseUrl, svcKey || anonKey);

async function run() {
    console.log("=== DB QUERY RESULTS ===");
    const { data: vData, error } = await supabase
        .from('content_ideas')
        .select('title, hook, pillar_id')
        .order('generated_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error fetching content ideas:", error.message || error);
    } else {
        console.log(JSON.stringify(vData, null, 2));

        if (vData && vData.length > 0) {
            console.log("\nReviewing titles/hooks for specific creator context:");
            vData.forEach((idea, i) => {
                console.log(`[Idea ${i + 1}] ${idea.title}`);
                console.log(`         Hook: "${idea.hook}"`);
            });
        }
    }
}
run();
