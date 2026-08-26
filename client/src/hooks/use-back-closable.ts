/**
 * React binding for the modal-back contract (lib/modal-history.ts): while
 * `open` is true this overlay owns one history entry, and Back closes the
 * overlay instead of navigating the page underneath it.
 *
 * `withBackClose` wraps a Radix-style root (Sheet/Dialog/AlertDialog/vaul
 * Drawer all share the {open, defaultOpen, onOpenChange} shape) so every
 * shadcn surface inherits the contract from ONE implementation. The wrapper
 * runs the root as controlled internally — that is the only way Back can
 * close an overlay whose caller used it uncontrolled (trigger-managed) — and
 * forwards state changes to the caller's own onOpenChange unchanged.
 */
import { useCallback, useEffect, useRef, useState, createElement, type ComponentType } from "react";
import { openModalLayer, closeModalLayer } from "@/lib/modal-history";

export function useBackClosable(open: boolean, onClose: () => void): void {
  const idRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The CURRENT open value, readable from the Back-path callback without a
  // re-render. This is what makes the veto case work: a controlled dialog that
  // refuses its close does not re-render (its `open` prop stays true), so a
  // reconcile that waits for a render would never re-arm. `openRef` still
  // reflects true, and the microtask below re-arms off it.
  const openRef = useRef(open);
  openRef.current = open;

  const arm = () => {
    idRef.current = openModalLayer(() => {
      // Consumed by Back: history has moved, the layer is gone. Ask the caller
      // to close; then, on a microtask (after any React flush the close
      // triggered), re-arm IFF the overlay is still open — the veto case,
      // where onClose was refused and no render happened.
      idRef.current = null;
      onCloseRef.current();
      queueMicrotask(() => {
        if (openRef.current && idRef.current === null) arm();
      });
    });
  };

  // Reconcile the layer with `open` on EVERY commit. The body no-ops whenever
  // idRef already matches `open`, so this is cheap.
  useEffect(() => {
    if (open && idRef.current === null) {
      arm();
    } else if (!open && idRef.current !== null) {
      // Closed by its own means (X, tap-outside, drag, Escape, or the parent
      // unmounting it) — deregister; the guard entry is chained through on the
      // next Back (lib/modal-history.ts), history is not touched here.
      const id = idRef.current;
      idRef.current = null;
      closeModalLayer(id);
    }
  });

  // Unmount while open (route change under a modal): same cleanup.
  useEffect(() => () => {
    if (idRef.current !== null) {
      const id = idRef.current;
      idRef.current = null;
      closeModalLayer(id);
    }
  }, []);
}

interface OpenableProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function withBackClose<P extends OpenableProps>(
  Root: ComponentType<P>,
  displayName: string,
): ComponentType<P> {
  function BackClosableRoot(props: P) {
    const { open, defaultOpen, onOpenChange } = props;
    // Track openness even for uncontrolled callers: Radix reports every
    // change through onOpenChange whether or not the caller listens.
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
    const isOpen = open ?? uncontrolledOpen;

    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const handleChange = useCallback((v: boolean) => {
      setUncontrolledOpen(v);
      onOpenChangeRef.current?.(v);
    }, []);

    useBackClosable(isOpen, () => handleChange(false));

    return createElement(Root, { ...props, open: isOpen, onOpenChange: handleChange });
  }
  BackClosableRoot.displayName = displayName;
  return BackClosableRoot;
}
