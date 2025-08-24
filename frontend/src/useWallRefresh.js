// useWallRefresh.js
import { useEffect } from 'react';
import { supabase } from './supabaseClient';
import { triggerRefresh } from './refreshBus';

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() || 7); 
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yst = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yst) / 86400000) + 1) / 7);
}

export function useWallRefresh() {
  useEffect(() => {
    // Realtime: bump -> refresh
    const ch = supabase
      .channel('wall_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wall_state', filter: 'id=eq.1' },
        (payload) => {
           console.log('🔔 wall_state bump', payload?.new?.version, payload);
        triggerRefresh();
       }
    )

    // Sentinel: ny dag/ny vecka + visibilitychange
    let lastDay = new Date().getDate();
    let lastWeek = isoWeek(new Date());

    const tick = () => {
      const now = new Date();
      const day = now.getDate();
      const wk = isoWeek(now);
      if (day !== lastDay || wk !== lastWeek) {
        lastDay = day; lastWeek = wk;
        triggerRefresh();
      }
    };

    const id = setInterval(tick, 60 * 1000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(ch);
    };
  }, []);
}
