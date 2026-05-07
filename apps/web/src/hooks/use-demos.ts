import { type DemoSummary, fetchDemos } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseDemosResult {
  demos: DemoSummary[] | null;
  error: string | null;
  refresh: () => void;
}

export const useDemos = (): UseDemosResult => {
  const [demos, setDemos] = useState<DemoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchDemos()
      .then((list) => {
        setDemos(list);
        setError(null);
      })
      .catch((err) => {
        console.error('[useDemos] failed', err);
        setDemos([]);
        setError(String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { demos, error, refresh };
};
