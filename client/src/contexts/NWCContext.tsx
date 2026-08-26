import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { finalizeEvent } from "nostr-tools";
import { SimplePool } from "nostr-tools";
import { encrypt, decrypt } from "nostr-tools/nip04";
import { useToast } from "@/hooks/use-toast";

interface NWCConnection {
  pubkey: string;
  relay: string;
  secret: string;
}

export interface NWCTransaction {
  type: "incoming" | "outgoing";
  invoice: string;
  description: string;
  description_hash: string;
  preimage: string;
  payment_hash: string;
  amount: number;
  fees_paid: number;
  created_at: number;
  settled_at: number;
}

type NewTransactionCallback = (tx: NWCTransaction) => void;

interface NWCState {
  isConnected: boolean;
  walletPubkey: string | null;
  relay: string | null;
  connectWallet: (connectionString: string) => void;
  disconnectWallet: () => void;
  payInvoice: (invoice: string, amountMsat?: number) => Promise<boolean>;
  getBalance: () => Promise<number | null>;
  listTransactions: (limit?: number) => Promise<NWCTransaction[]>;
  makeInvoice: (amountMsat: number, description?: string) => Promise<string | null>;
  payAddress: (address: string, amountSats: number, comment?: string) => Promise<boolean>;
  balance: number | null;
  balanceLoading: boolean;
  isProcessing: boolean;
  refreshBalance: () => void;
  subscribeToNewTransactions: (cb: NewTransactionCallback) => void;
  unsubscribeFromNewTransactions: (cb: NewTransactionCallback) => void;
  triggerPoll: () => void;
}

const NWCContext = createContext<NWCState>({
  isConnected: false,
  walletPubkey: null,
  relay: null,
  connectWallet: () => {},
  disconnectWallet: () => {},
  payInvoice: async () => false,
  getBalance: async () => null,
  listTransactions: async () => [],
  makeInvoice: async () => null,
  payAddress: async () => false,
  balance: null,
  balanceLoading: false,
  isProcessing: false,
  refreshBalance: () => {},
  subscribeToNewTransactions: () => {},
  unsubscribeFromNewTransactions: () => {},
  triggerPoll: () => {},
});

export function useNWC() {
  return useContext(NWCContext);
}

const NWC_STORAGE_KEY = "relay-outpost-nwc-uri";

function parseNWCConnectionString(cs: string): NWCConnection {
  const uri = cs.replace("nostr+walletconnect://", "").replace("nostr+walletconnect:", "");
  const [pubkey, qs] = uri.split("?");
  if (!pubkey || !qs) throw new Error("Invalid NWC connection string");

  const params = new URLSearchParams(qs);
  const relay = params.get("relay");
  const secret = params.get("secret");

  if (!relay) throw new Error("Missing relay in NWC connection string");
  if (!secret) throw new Error("Missing secret in NWC connection string");

  return { pubkey, relay, secret };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function NWCProvider({ children }: { children: ReactNode }) {
  const [walletPubkey, setWalletPubkey] = useState<string | null>(null);
  const [relay, setRelay] = useState<string | null>(null);
  const [secretBytes, setSecretBytes] = useState<Uint8Array | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const { toast } = useToast();
  const poolRef = useRef<SimplePool | null>(null);

  const getPool = useCallback(() => {
    if (!poolRef.current) {
      poolRef.current = new SimplePool();
    }
    return poolRef.current;
  }, []);

  const sendNWCRequest = useCallback(async (
    method: string,
    params: Record<string, any>
  ): Promise<any> => {
    if (!walletPubkey || !relay || !secretBytes) {
      throw new Error("No wallet connected");
    }

    const content = JSON.stringify({ method, params });
    const encrypted = await encrypt(secretBytes, walletPubkey, content);

    const event = finalizeEvent({
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", walletPubkey]],
      content: encrypted,
    }, secretBytes);

    const nwcPool = getPool();
    await Promise.any(nwcPool.publish([relay], event));

    return await new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const sub = nwcPool.subscribeMany([relay!], {
        kinds: [23195],
        "#e": [event.id],
        authors: [walletPubkey!],
      }, {
        async onevent(responseEvent) {
          if (timeoutId) clearTimeout(timeoutId);
          sub.close();
          try {
            const decrypted = await decrypt(secretBytes!, walletPubkey!, responseEvent.content);
            const response = JSON.parse(decrypted);
            if (response.error) {
              reject(new Error(response.error.message || "Wallet returned an error"));
            } else {
              resolve(response.result);
            }
          } catch (err) {
            reject(err);
          }
        },
        oneose() {},
      });

      timeoutId = setTimeout(() => {
        sub.close();
        reject(new Error("Request timed out - no response from wallet"));
      }, 30000);
    });
  }, [walletPubkey, relay, secretBytes, getPool]);

  const connectWallet = useCallback((connectionString: string) => {
    try {
      const parsed = parseNWCConnectionString(connectionString);
      setWalletPubkey(parsed.pubkey);
      setRelay(parsed.relay);
      const secretBuf = hexToBytes(parsed.secret);
      setSecretBytes(secretBuf);
      setIsConnected(true);
      localStorage.setItem(NWC_STORAGE_KEY, connectionString);
    } catch (err) {
      console.error("NWC parse failed:", err);
      toast({
        title: "Invalid connection string",
        description: "Check your wallet connection string and try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const disconnectWallet = useCallback(() => {
    setWalletPubkey(null);
    setRelay(null);
    setSecretBytes(null);
    setIsConnected(false);
    setBalance(null);
    localStorage.removeItem(NWC_STORAGE_KEY);
  }, [toast]);

  const payInvoice = useCallback(async (invoice: string, amountMsat?: number): Promise<boolean> => {
    if (!walletPubkey || !relay || !secretBytes) {
      toast({
        title: "No wallet connected",
        description: "Connect a Lightning wallet first.",
        variant: "destructive",
      });
      return false;
    }

    setIsProcessing(true);
    try {
      // amount (msat) is only sent for amountless invoices; NIP-47 ignores it otherwise.
      const params: { invoice: string; amount?: number } = { invoice };
      if (typeof amountMsat === "number" && amountMsat > 0) params.amount = amountMsat;
      await sendNWCRequest("pay_invoice", params);
      return true;
    } catch (err) {
      console.error("NWC pay failed:", err);
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : "Could not send payment through wallet.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [walletPubkey, relay, secretBytes, sendNWCRequest, toast]);

  const getBalance = useCallback(async (): Promise<number | null> => {
    try {
      const result = await sendNWCRequest("get_balance", {});
      const balanceMsat = result?.balance ?? null;
      if (balanceMsat !== null) {
        const balanceSats = Math.floor(balanceMsat / 1000);
        setBalance(balanceSats);
        return balanceSats;
      }
      return null;
    } catch (err) {
      console.error("NWC get_balance failed:", err);
      return null;
    }
  }, [sendNWCRequest]);

  const listTransactions = useCallback(async (limit = 20): Promise<NWCTransaction[]> => {
    try {
      const result = await sendNWCRequest("list_transactions", {
        limit,
        unpaid: false,
      });
      return (result?.transactions || []) as NWCTransaction[];
    } catch (err) {
      console.error("NWC list_transactions failed:", err);
      return [];
    }
  }, [sendNWCRequest]);

  const makeInvoice = useCallback(async (amountMsat: number, description?: string): Promise<string | null> => {
    try {
      const result = await sendNWCRequest("make_invoice", {
        amount: amountMsat,
        description: description || "Relay Outpost receive",
      });
      return result?.invoice || null;
    } catch (err) {
      console.error("NWC make_invoice failed:", err);
      toast({
        title: "Invoice creation failed",
        description: err instanceof Error ? err.message : "Could not create invoice.",
        variant: "destructive",
      });
      return null;
    }
  }, [sendNWCRequest, toast]);

  const payAddress = useCallback(async (address: string, amountSats: number, comment?: string): Promise<boolean> => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/lnurl/pay?address=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error("Could not resolve lightning address");
      const lnurlInfo = await res.json();
      if (lnurlInfo.status === "ERROR") throw new Error(lnurlInfo.reason || "LNURL error");

      const amountMsat = amountSats * 1000;
      if (amountMsat < lnurlInfo.minSendable) throw new Error(`Minimum ${Math.ceil(lnurlInfo.minSendable / 1000)} sats`);
      if (amountMsat > lnurlInfo.maxSendable) throw new Error(`Maximum ${Math.floor(lnurlInfo.maxSendable / 1000)} sats`);

      const invoiceParams = new URLSearchParams({ callback: lnurlInfo.callback, amount: amountMsat.toString() });
      if (comment && lnurlInfo.commentAllowed > 0) {
        invoiceParams.set("comment", comment.slice(0, lnurlInfo.commentAllowed));
      }
      const invoiceRes = await fetch(`/api/lnurl/invoice?${invoiceParams.toString()}`);
      if (!invoiceRes.ok) throw new Error("Could not get invoice");
      const invoiceData = await invoiceRes.json();
      if (!invoiceData.pr) throw new Error("No invoice returned");

      const paid = await payInvoice(invoiceData.pr);
      return paid;
    } catch (err) {
      console.error("Pay address failed:", err);
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : "Could not send payment.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [payInvoice, toast]);

  const refreshBalance = useCallback(() => {
    if (!isConnected || !walletPubkey || !relay || !secretBytes) return;
    setBalanceLoading(true);
    getBalance().finally(() => setBalanceLoading(false));
  }, [isConnected, walletPubkey, relay, secretBytes, getBalance]);

  const seenTxHashesRef = useRef<Set<string>>(new Set());
  const txSubscribersRef = useRef<Set<NewTransactionCallback>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  const subscribeToNewTransactions = useCallback((cb: NewTransactionCallback) => {
    txSubscribersRef.current.add(cb);
  }, []);

  const unsubscribeFromNewTransactions = useCallback((cb: NewTransactionCallback) => {
    txSubscribersRef.current.delete(cb);
  }, []);

  const triggerPoll = useCallback(() => {
    if (pollRef.current) pollRef.current();
  }, []);

  useEffect(() => {
    if (!isConnected) {
      seenTxHashesRef.current.clear();
      initialLoadDoneRef.current = false;
      pollRef.current = null;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const txs = await listTransactions(20);
        if (cancelled) return;

        if (!initialLoadDoneRef.current) {
          for (const tx of txs) {
            if (tx.payment_hash) seenTxHashesRef.current.add(tx.payment_hash);
          }
          initialLoadDoneRef.current = true;
        } else {
          for (const tx of txs) {
            if (tx.payment_hash && !seenTxHashesRef.current.has(tx.payment_hash)) {
              seenTxHashesRef.current.add(tx.payment_hash);
              txSubscribersRef.current.forEach(cb => {
                try { cb(tx); } catch {}
              });
            }
          }
        }

        if (seenTxHashesRef.current.size > 500) {
          const entries = Array.from(seenTxHashesRef.current);
          seenTxHashesRef.current = new Set(entries.slice(-200));
        }

        if (!cancelled) getBalance();
      } catch {}
    };

    pollRef.current = poll;
    poll();
    const intervalId = setInterval(poll, 30000);

    return () => {
      cancelled = true;
      pollRef.current = null;
      clearInterval(intervalId);
    };
  }, [isConnected, listTransactions, getBalance]);

  useEffect(() => {
    const saved = localStorage.getItem(NWC_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = parseNWCConnectionString(saved);
        setWalletPubkey(parsed.pubkey);
        setRelay(parsed.relay);
        setSecretBytes(hexToBytes(parsed.secret));
        setIsConnected(true);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (isConnected && walletPubkey && relay && secretBytes) {
      setBalanceLoading(true);
      getBalance().finally(() => setBalanceLoading(false));
    }
  }, [isConnected, walletPubkey, relay, secretBytes]);

  return (
    <NWCContext.Provider value={{
      isConnected, walletPubkey, relay, balance, balanceLoading,
      connectWallet, disconnectWallet, payInvoice, getBalance,
      listTransactions, makeInvoice, payAddress, isProcessing, refreshBalance,
      subscribeToNewTransactions, unsubscribeFromNewTransactions, triggerPoll,
    }}>
      {children}
    </NWCContext.Provider>
  );
}
