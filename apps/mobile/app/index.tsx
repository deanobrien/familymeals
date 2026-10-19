import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { Loading } from '@/screens/ui';

/** Signed in (persisted Supabase session) -> household picker, otherwise sign in. */
export default function Index() {
  const { ds } = useApp();
  const [target, setTarget] = useState<'/households' | '/sign-in' | null>(null);

  useEffect(() => {
    ds.getSession().then(
      (s) => setTarget(s ? '/households' : '/sign-in'),
      () => setTarget('/sign-in'),
    );
  }, [ds]);

  if (!target) return <Loading label="Starting" />;
  return <Redirect href={target} />;
}
