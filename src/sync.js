import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabase = Boolean(url && key && !String(url).includes('YOUR-PROJECT'));

export const clientId = Math.random().toString(36).slice(2, 10);
export const syncMode = hasSupabase ? 'supabase' : 'local';

let client = null;
function getClient() {
  if (!client) {
    client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

/**
 * createSync(room, { onState, onStatus, onPeers })
 *  - onState(payload)  : remote user sent camera/config
 *  - onStatus(status)  : 'connecting' | 'online' | 'local' | 'error' | 'offline'
 *  - onPeers(count)    : number of users in the room (incl. me)
 * Returns { send(payload), close() }
 */
export function createSync(room, { onState, onStatus, onPeers }) {
  onStatus('connecting');

  // ---- Fallback: no Supabase keys -> same-device tabs only (good for testing)
  if (!hasSupabase) {
    const bc = new BroadcastChannel(`solar3d:${room}`);
    bc.onmessage = (e) => {
      if (e.data && e.data.id !== clientId) onState(e.data);
    };
    setTimeout(() => {
      onStatus('local');
      onPeers(1);
    }, 0);
    return {
      send: (p) => bc.postMessage(p),
      close: () => bc.close(),
    };
  }

  // ---- Supabase Realtime (Broadcast + Presence). No database tables needed.
  const sb = getClient();
  const channel = sb.channel(`solar3d:${room}`, {
    config: { broadcast: { self: false }, presence: { key: clientId } },
  });

  channel
    .on('broadcast', { event: 'state' }, ({ payload }) => {
      if (payload && payload.id !== clientId) onState(payload);
    })
    .on('presence', { event: 'sync' }, () => {
      onPeers(Object.keys(channel.presenceState()).length);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ at: Date.now() });
        onStatus('online');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onStatus('error');
      } else if (status === 'CLOSED') {
        onStatus('offline');
      }
    });

  return {
    send: (payload) => channel.send({ type: 'broadcast', event: 'state', payload }),
    close: () => sb.removeChannel(channel),
  };
}
