import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.5.0'

// 🔐 Ersätt med dina egna nycklar
const VAPID_PUBLIC_KEY = 'BBT1fP0kY2Da6sU7vnQrTu4v5zOrDs9ndCcSABhEhIY1y_ljGW-4B6tGfrCHO4OZa_-btSQ5EumJLB-cENHA8QY'
const VAPID_PRIVATE_KEY = 'm7ouETaIHGdJModk2qr5n5UeiV5poiUQ8STxQcEBWzM'

webpush.setVapidDetails(
  'mailto:you@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
)

serve(async (req) => {
  const { record: newItem } = await req.json()
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: subs, error } = await client
    .from('push_subscriptions')
    .select('endpoint, keys')

  if (error) {
    console.error('Kunde inte hämta subscriptions:', error)
    return new Response('Fail', { status: 500 })
  }

  const payload = JSON.stringify({
    title: 'Ny vara i inköpslistan',
    body: `${newItem.name} har lagts till.`,
  })

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            auth: sub.keys.auth,
            p256dh: sub.keys.p256dh,
          },
        },
        payload
      )
    } catch (err) {
      console.warn('Push error för en användare:', err)
    }
  }

  return new Response('OK', { status: 200 })
})

