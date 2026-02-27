const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// We need the SERVICE_ROLE key to bypass email rate limits or create users directly
// We will ask the user for it via the terminal, or fallback to standard trying
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

// Admin client to create users directly without rate limits
const adminSupabase = serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
}) : null;

async function runTests() {
  console.log("Starting Security Verification Tests...\n");

  const rand = Math.floor(Math.random() * 1000000);
  const emailA = `test${rand}a@example.com`;
  const emailB = `test${rand}b@example.com`;
  const password = "SecurePassword123!";

  console.log("1. Creating User A and User B...");
  
  let uidA, uidB;

  if (adminSupabase) {
      console.log("Using Service Role Key to bypass rate limits...");
      const { data: userAData, error: errA } = await adminSupabase.auth.admin.createUser({ email: emailA, password, email_confirm: true, user_metadata: { display_name: "Test A" } });
      if (errA) throw new Error("Admin Failed to create User A: " + errA.message);
      
      const { data: userBData, error: errB } = await adminSupabase.auth.admin.createUser({ email: emailB, password, email_confirm: true, user_metadata: { display_name: "Test B" } });
      if (errB) throw new Error("Admin Failed to create User B: " + errB.message);
      
      uidA = userAData.user.id;
      uidB = userBData.user.id;
  } else {
       console.log("No Service Role Key found. Attempting standard anonymous signup (may hit rate limits)...");
       const supabaseA = createClient(supabaseUrl, anonKey);
       const supabaseB = createClient(supabaseUrl, anonKey);
       
       const { data: userAData, error: errA } = await supabaseA.auth.signUp({ email: emailA, password, options: { data: { display_name: "Test A" } } });
       if (errA) throw new Error("Failed to create User A: " + errA.message);
       
       const { data: userBData, error: errB } = await supabaseB.auth.signUp({ email: emailB, password, options: { data: { display_name: "Test B" } } });
       if (errB) throw new Error("Failed to create User B: " + errB.message);
       
       uidA = userAData.user.id;
       uidB = userBData.user.id;
  }

  console.log(`User A UID: ${uidA}`);
  console.log(`User B UID: ${uidB}\n`);

  // Create authenticated clients for the rest of the test
  const supabaseA = createClient(supabaseUrl, anonKey);
  const supabaseB = createClient(supabaseUrl, anonKey);
  await supabaseA.auth.signInWithPassword({email: emailA, password});
  await supabaseB.auth.signInWithPassword({email: emailB, password});

  // Dummy file content
  const fileContent = "hello world";
  const fileName = "test.txt";
  const pathA = `${uidA}/${fileName}`;
  const pathBMalicious = `${uidA}/malicious.txt`; // User B trying to upload to User A's folder
  const pathRoot = `${fileName}`; // Uploading to root folder without UUID

  // --- TEST UPLOADS ---
  console.log("2. Testing Uploads (INSERT Policy)");
  
  // User A uploads to User A's folder -> SHOULD SUCCEED
  const { data: upA, error: errUpA } = await supabaseA.storage.from('videos').upload(pathA, fileContent, { contentType: 'text/plain' });
  if (errUpA) {
    console.error(`❌ User A failed to upload to their own folder: ${errUpA.message}`);
  } else {
    console.log(`✅ User A successfully uploaded to their own folder.`);
  }

  // User B uploads to User A's folder -> SHOULD FAIL
  const { data: upB, error: errUpB } = await supabaseB.storage.from('videos').upload(pathBMalicious, fileContent, { contentType: 'text/plain' });
  if (!errUpB) {
    console.error(`❌ SECURITY FLAW: User B uploaded to User A's folder!`);
  } else {
    console.log(`✅ User B correctly blocked from uploading to User A's folder. (Expected failure: ${errUpB.message})`);
  }

  // User A uploads to root folder -> SHOULD FAIL
  const { data: upRoot, error: errUpRoot } = await supabaseA.storage.from('videos').upload(pathRoot, fileContent, { contentType: 'text/plain' });
  if (!errUpRoot) {
    console.error(`❌ SECURITY FLAW: User A uploaded to root without a UUID folder!`);
  } else {
    console.log(`✅ User A correctly blocked from uploading to root. (Expected failure: ${errUpRoot.message})`);
  }

  // --- TEST READS ---
  console.log("\n3. Testing Reads (SELECT Policy)");

  // User A reads User A's file -> SHOULD SUCCEED
  const { data: readA, error: errReadA } = await supabaseA.storage.from('videos').download(pathA);
  if (errReadA) {
    console.error(`❌ User A failed to read their own file: ${errReadA.message}`);
  } else {
    console.log(`✅ User A successfully read their own file.`);
  }

  // User B reads User A's file -> SHOULD FAIL
  const { data: readB, error: errReadB } = await supabaseB.storage.from('videos').download(pathA);
  if (!errReadB) {
    console.error(`❌ SECURITY FLAW: User B read User A's file!`);
  } else {
    console.log(`✅ User B correctly blocked from reading User A's file. (Expected failure: ${errReadB.message})`);
  }

  // --- TEST DELETES ---
  console.log("\n4. Testing Deletes (DELETE Policy)");

  // User B deletes User A's file -> SHOULD FAIL
  const { data: delB, error: errDelB } = await supabaseB.storage.from('videos').remove([pathA]);
  if (delB && delB.length > 0) {
    console.error(`❌ SECURITY FLAW: User B deleted User A's file!`);
  } else {
    console.log(`✅ User B correctly blocked from deleting User A's file.`);
  }

  // User A deletes User A's file -> SHOULD SUCCEED
  const { data: delA, error: errDelA } = await supabaseA.storage.from('videos').remove([pathA]);
  if (errDelA || (delA && delA.length === 0)) {
    console.error(`❌ User A failed to delete their own file.`);
  } else {
    console.log(`✅ User A successfully deleted their own file.`);
  }

  console.log("\nTests Complete.");
}

runTests().catch(console.error);
