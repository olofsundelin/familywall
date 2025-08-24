// backend/supabaseAdmin.js
const { createClient } = require('@supabase/supabase-js');

// Viktigt: använd SERVICE_ROLE_KEY här (server side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = { supabase };
