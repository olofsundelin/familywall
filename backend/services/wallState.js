// backend/services/wallState.js
const { supabase } = require('../supabaseAdmin');

async function bumpWallState(note = null) {
  const { error } = await supabase.rpc('bump_wall_state', { _note: note });
  if (error) {
    console.error('[wall_state] bump error:', error);
  }
}

async function getWallState() {
  const { data, error } = await supabase
    .from('wall_state')
    .select('version, updated_at')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('[wall_state] get error:', error);
    return { version: null, updated_at: null };
  }
  return data;
}

module.exports = { bumpWallState, getWallState };