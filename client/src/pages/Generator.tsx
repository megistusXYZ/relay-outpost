import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Copy, Check, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { decodeNpubToHex } from "@/helpers/nostr-helpers";

export default function Generator() {
  const [npub, setNpub] = useState("");
  const [relay, setRelay] = useState("");
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const baseUrl = window.location.origin;

  const handleForge = useCallback(() => {
    if (!npub.trim()) {
      toast({ title: "Enter an npub to continue", variant: "destructive" });
      return;
    }

    const hex = decodeNpubToHex(npub.trim());
    if (!hex) {
      toast({ title: "Invalid npub format", variant: "destructive" });
      return;
    }

    const params = new URLSearchParams({ npub: npub.trim() });
    if (relay.trim()) {
      params.set("relay", relay.trim());
    }

    const widgetUrl = `${baseUrl}/widget?${params.toString()}`;
    const code = `<iframe src="${widgetUrl}" width="100%" height="600px" style="border:none; border-radius: 12px;"></iframe>`;
    setEmbedCode(code);
    setCopied(false);
  }, [npub, relay, baseUrl, toast]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [embedCode, toast]);

  const previewUrl = embedCode
    ? `${baseUrl}/widget?${new URLSearchParams({ npub: npub.trim(), ...(relay.trim() ? { relay: relay.trim() } : {}) }).toString()}`
    : null;

  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6" data-testid="page-generator">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 sm:mb-8">
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight leading-tight"
            data-testid="text-headline"
          >
            Inscribe the Signal.
            <br />
            <span className="text-muted-foreground">Syndicate your reality.</span>
          </h1>
          <p
            className="mt-3 text-muted-foreground text-base max-w-md"
            data-testid="text-subtitle"
          >
            Generate an embeddable Nostr feed for any website.
          </p>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-1/2 flex flex-col gap-4">
            <Card
              className="p-6 flex flex-col gap-4"
              data-testid="card-generator"
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="npub-input"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Enter Npub
                </label>
                <Input
                  id="npub-input"
                  placeholder="npub1..."
                  value={npub}
                  onChange={(e) => setNpub(e.target.value)}
                  data-testid="input-npub"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="relay-input"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Custom Relay (Optional)
                </label>
                <Input
                  id="relay-input"
                  placeholder="wss://relay.damus.io"
                  value={relay}
                  onChange={(e) => setRelay(e.target.value)}
                  data-testid="input-relay"
                />
              </div>

              <Button
                onClick={handleForge}
                className="mt-2"
                data-testid="button-forge"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Forge Glyph
              </Button>
            </Card>

            <AnimatePresence>
              {embedCode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                >
                  <Card
                    className="p-4 flex flex-col gap-3"
                    data-testid="card-embed-code"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Embed Code
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopy}
                        data-testid="button-copy"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 mr-1.5 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 mr-1.5" />
                        )}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <pre
                      className="bg-muted border border-border rounded-md p-3 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all select-all"
                      data-testid="text-embed-code"
                    >
                      {embedCode}
                    </pre>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="w-full lg:w-1/2">
            {previewUrl ? (
              <div
                className="rounded-md border border-border overflow-hidden bg-muted"
                data-testid="container-preview"
              >
                <div className="px-3 py-2 bg-muted border-b border-border">
                  <span
                    className="text-xs text-muted-foreground font-mono truncate block"
                    data-testid="text-preview-url"
                  >
                    {previewUrl}
                  </span>
                </div>
                <iframe
                  src={previewUrl}
                  width="100%"
                  height="550"
                  style={{ border: "none" }}
                  title="Widget Preview"
                  data-testid="iframe-preview"
                />
              </div>
            ) : (
              <div
                className="flex items-center justify-center h-96 rounded-md border border-dashed border-border bg-muted/50"
                data-testid="container-preview-empty"
              >
                <p
                  className="text-muted-foreground text-sm"
                  data-testid="text-preview-empty"
                >
                  Your live preview will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
