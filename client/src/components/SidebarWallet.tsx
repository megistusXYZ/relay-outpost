import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { SidebarMenuSubButton } from "@/components/ui/sidebar";
import { useNWC } from "@/contexts/NWCContext";

// When a Lightning wallet (NWC) is connected, surface the balance as a regular
// Command Post sub-item (matching Messages/Calendar/Create) so it reads as part
// of the nav rather than a loose pill — just tinted amber like Create is tinted
// violet. Taps through to the wallet. Honors the app-wide "hide balance" setting
// (localStorage `walletBalanceHidden` + the `balance-visibility-changed` event)
// with a quick reveal/conceal toggle that propagates everywhere the balance
// shows. Renders nothing when no wallet is connected.
export function SidebarWallet({ closeMobileNav }: { closeMobileNav: () => void }) {
  const { isConnected, balance, balanceLoading } = useNWC();

  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem("walletBalanceHidden") === "true"; } catch { return false; }
  });
  useEffect(() => {
    const sync = () => { try { setHidden(localStorage.getItem("walletBalanceHidden") === "true"); } catch {} };
    window.addEventListener("balance-visibility-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("balance-visibility-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleVisibility = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHidden((prev) => {
      const next = !prev;
      try { localStorage.setItem("walletBalanceHidden", String(next)); } catch {}
      window.dispatchEvent(new Event("balance-visibility-changed"));
      return next;
    });
  }, []);

  if (!isConnected) return null;

  const sats = balance != null ? balance.toLocaleString() : null;

  return (
    <>
      <SidebarMenuSubButton asChild className="text-xs [&>svg]:!text-amber-500/90">
        <Link
          href="/account?tab=wallet"
          onClick={closeMobileNav}
          data-testid="link-sidebar-wallet"
          className="pr-7"
        >
          <BtcZapIcon className="w-3.5 h-3.5" />
          <span className="flex-1 min-w-0 flex items-baseline gap-1">
            {balanceLoading && sats === null ? (
              <span className="text-muted-foreground/60">···</span>
            ) : sats !== null ? (
              <span className={`tabular-nums ${hidden ? "blur-[5px] select-none" : ""}`}>{sats}</span>
            ) : (
              <span className="text-muted-foreground/70">Wallet</span>
            )}
          </span>
        </Link>
      </SidebarMenuSubButton>
      <button
        type="button"
        onClick={toggleVisibility}
        title={hidden ? "Show balance" : "Hide balance"}
        aria-label={hidden ? "Show balance" : "Hide balance"}
        className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-amber-500"
        data-testid="button-sidebar-wallet-visibility"
      >
        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
    </>
  );
}
