import { useCallback, useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Runs `loader` when `deps` change and exposes the result plus a reload function.
 * Results from a superseded request are ignored, so a slow response cannot overwrite a newer one.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loader()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            data: null,
            error: err instanceof Error ? err.message : 'Something went wrong',
            loading: false,
          });
        }
      });
    return () => {
      active = false;
    };
    // The caller controls when the loader re-runs through `deps` and `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
