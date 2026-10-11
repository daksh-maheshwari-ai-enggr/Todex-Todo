import { useCallback, useEffect, useRef, useState } from "react";

// Minimal data-fetching hook: loading / error / data, plus a refetch that can
// run silently (used by polling so refreshes do not flash a spinner).
//
// `deps` must keep a stable length between renders, exactly like useEffect.
// `enabled` lets a caller skip the request until it has what it needs.
export function useAsync(fetcher, deps = [], { enabled = true, initialData = null } = {}) {
  const [state, setState] = useState({
    data: initialData,
    loading: enabled,
    error: null,
  });

  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async ({ silent = false } = {}) => {
    const id = requestId.current + 1;
    requestId.current = id;

    if (!silent) {
      setState((previous) => ({ ...previous, loading: true, error: null }));
    }

    try {
      const data = await fetcherRef.current();
      if (id !== requestId.current) return;
      setState({ data, loading: false, error: null });
    } catch (error) {
      if (id !== requestId.current) return;
      if (error?.name === "AbortError") return;
      setState((previous) => ({ data: previous.data, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: initialData, loading: false, error: null });
      return undefined;
    }

    run();
    return () => {
      // Invalidate in-flight responses when the deps change or on unmount.
      requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return {
    ...state,
    refetch: run,
    setData: (data) => setState({ data, loading: false, error: null }),
  };
}
