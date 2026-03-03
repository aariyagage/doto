const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('/Users/aariyagage/.gemini/antigravity/scratch/doto/.env', 'utf-8');
const envLines = envFile.split('\n');
let supabaseUrl = '';
let supabaseKey = '';

for (const line of envLines) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Fetching transcripts...");
    const { data, error } = await supabase
        .from('transcripts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) { console.error("Error:", error); return; }
    if (!data || data.length === 0) { console.log("No transcripts found"); return; }

    const row = data[0];
    const has_embedding = row.embedding !== null && row.embedding !== undefined;
    let dims = 0;
    if (has_embedding) {
        if (typeof row.embedding === 'string') {
            try { dims = JSON.parse(row.embedding).length; } catch (e) { }
        } else if (Array.isArray(row.embedding)) {
            dims = row.embedding.length;
        }
    }

    console.log("--- SQL OUTPUT FORMAT ---");
    console.log(`id | word_count | has_embedding | embedding_dims`);
    console.log(`${row.id} | ${row.word_count} | ${has_embedding ? 't' : 'f'} | ${dims}`);
}
run();
