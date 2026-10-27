// Roster fetch hook: profiles.list include_sessions:true, 5s poll only
// while the screen is mounted and the socket is up, plus pull-to-refresh.
// Roster authority is profiles.list — never the sessions projection.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from './connection-store';
import { buildRosterEntries } from './roster';
import type { RosterEntry, RosterProfile } from './types';

export function useRoster(polling: boolean) {
  const { gateway, status } = useConnection();
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [profiles, setProfiles] = useState<RosterProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!gateway) return;
    try {
      const res = (await gateway.request('profiles.list', { include_sessions: true })) as { profiles?: RosterProfile[] };
      const list = res.profiles ?? [];
      if (!mounted.current) return;
      setProfiles(list);
      setEntries(buildRosterEntries(list));
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not load bots.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    if (!polling) return () => { mounted.current = false; };
    const timer = setInterval(() => {
      if (status === 'online') void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, polling, status]);

  return { entries, profiles, loading, error, refresh };
}
