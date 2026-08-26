import { useState, useEffect, useRef } from "react";
import { EventStore } from "applesauce-core";

/**
 * A hook to query the event store and update when the store changes.
 * This is a simplified implementation since useStoreQuery is missing in applesauce-react v5.
 */
export function useStoreQuery<T>(
  store: EventStore,
  queryFn: (store: EventStore) => T,
  deps: any[] = []
): T {
  const [result, setResult] = useState(() => queryFn(store));
  
  // Keep track of the latest query function
  const queryFnRef = useRef(queryFn);
  useEffect(() => {
    queryFnRef.current = queryFn;
  }, [queryFn]);

  useEffect(() => {
    const update = () => {
      setResult(queryFnRef.current(store));
    };

    // Initial run
    update();

    // Subscribe to store changes
    // Debounce updates to avoid excessive re-renders during bulk inserts
    let timeout: NodeJS.Timeout;
    const debouncedUpdate = () => {
      clearTimeout(timeout);
      timeout = setTimeout(update, 50);
    };

    const sub1 = store.insert$.subscribe(debouncedUpdate);
    const sub2 = store.update$.subscribe(debouncedUpdate);
    const sub3 = store.remove$.subscribe(debouncedUpdate);

    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      clearTimeout(timeout);
    };
  }, [store, ...deps]);

  return result;
}
