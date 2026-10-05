/**
 * Dialogs a post can open, loaded the first time one opens rather than with
 * every feed (guest-first-load.test.ts). Same props as the real ones. A dialog
 * that has opened stays mounted, so it still animates closed.
 */
import { lazy, Suspense, useState, type ComponentProps } from "react";
import { lazyNamed } from "@/lib/lazy-retry";

const ZapDialogLazy = lazy(() => lazyNamed(() => import("@/components/ZapDialog"), "ZapDialog"));
const ReportDialogLazy = lazy(() => lazyNamed(() => import("@/components/ReportDialog"), "ReportDialog"));
const PrivateReplyDialogLazy = lazy(() => lazyNamed(() => import("@/components/PrivateReplyDialog"), "PrivateReplyDialog"));
const AddToFeaturedDialogLazy = lazy(() => lazyNamed(() => import("@/components/AddToFeaturedDialog"), "AddToFeaturedDialog"));

function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function ZapDialog(p: ComponentProps<typeof ZapDialogLazy>) {
  const on = useOpenedOnce(p.open);
  return on ? <Suspense fallback={null}><ZapDialogLazy {...p} /></Suspense> : null;
}
export function ReportDialog(p: ComponentProps<typeof ReportDialogLazy>) {
  const on = useOpenedOnce(p.open);
  return on ? <Suspense fallback={null}><ReportDialogLazy {...p} /></Suspense> : null;
}
export function PrivateReplyDialog(p: ComponentProps<typeof PrivateReplyDialogLazy>) {
  const on = useOpenedOnce(p.open);
  return on ? <Suspense fallback={null}><PrivateReplyDialogLazy {...p} /></Suspense> : null;
}
export function AddToFeaturedDialog(p: ComponentProps<typeof AddToFeaturedDialogLazy>) {
  const on = useOpenedOnce(p.open);
  return on ? <Suspense fallback={null}><AddToFeaturedDialogLazy {...p} /></Suspense> : null;
}
