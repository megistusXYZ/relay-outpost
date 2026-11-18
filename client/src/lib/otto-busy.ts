/**
 * "Something is loading": the count of loaders on screen (RelayOutpostLoader
 * and its inline twin mount and unmount here). Otto in the chrome reads it,
 * so the mark works while a page works, and relay reads that never touch
 * react-query still show.
 */
let loaders = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => fn());

export function loaderMounted(): () => void {
  loaders++;
  if (loaders === 1) notify();
  return () => {
    loaders = Math.max(0, loaders - 1);
    if (loaders === 0) notify();
  };
}

export function subscribeBusy(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export const isBusy = () => loaders > 0;
