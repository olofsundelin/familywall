// exempel: /api/save-subscription.js (eller som edge function via vercel/netlify)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const subscription = req.body;
  const { endpoint, keys } = subscription;

  // undvik duplicat
  const existing = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (existing.data) {
    return res.status(200).json({ message: 'Redan sparad' });
  }

  await supabase.from('push_subscriptions').insert([{ endpoint, keys }]);

  res.status(201).json({ message: 'Prenumeration sparad' });
}
