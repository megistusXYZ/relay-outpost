import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { KIND_LONG_FORM, HORIZON_SECTION_NAMESPACE, DEFAULT_HORIZON_SECTIONS } from "@/lib/nip23";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { HorizonIcon } from "@/components/icons/HorizonIcon";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FolderOpen,
  Plus,
  ChevronDown,
  X,
  Search,
  ArrowRight,
  Check,
  MessageSquareOff,
} from "lucide-react";

interface HorizonNewEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relayUrl: string;
}

export function HorizonNewEntryDialog({ open, onOpenChange, relayUrl }: HorizonNewEntryDialogProps) {
  const [, setLocation] = useLocation();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [section, setSection] = useState("");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sectionSearch, setSectionSearch] = useState("");
  const [existingSections, setExistingSections] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !relayUrl) return;
    let unmounted = false;
    const sectionSet = new Set<string>();

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_LONG_FORM], limit: 200 },
      {
        onevent(e: Event) {
          if (unmounted) return;
          const sTag = e.tags.find(
            (t: string[]) => t[0] === "l" && t[2] === HORIZON_SECTION_NAMESPACE
          );
          if (sTag?.[1]) sectionSet.add(sTag[1]);
        },
        oneose() {
          if (unmounted) return;
          setExistingSections(Array.from(sectionSet).sort());
          sub.close();
        },
      },
    );

    const timeout = setTimeout(() => {
      if (!unmounted) {
        setExistingSections(Array.from(sectionSet).sort());
        sub.close();
      }
    }, 6000);

    return () => {
      unmounted = true;
      sub.close();
      clearTimeout(timeout);
    };
  }, [open, relayUrl]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSummary("");
      setSection("");
      setCommentsEnabled(true);
      setSectionSearch("");
      setSectionOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (sectionOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSectionSearch("");
    }
  }, [sectionOpen]);

  const allSections = useMemo(() => {
    const combined = new Set(existingSections);
    for (const d of DEFAULT_HORIZON_SECTIONS) combined.add(d);
    return Array.from(combined).sort();
  }, [existingSections]);

  const filteredSections = useMemo(() => {
    if (!sectionSearch.trim()) return allSections;
    const q = sectionSearch.toLowerCase();
    return allSections.filter((s) => s.toLowerCase().includes(q));
  }, [allSections, sectionSearch]);

  const canCreateSection = sectionSearch.trim() &&
    !allSections.some((s) => s.toLowerCase() === sectionSearch.trim().toLowerCase());

  const handleCreate = () => {
    if (!title.trim()) return;
    const params = new URLSearchParams();
    params.set("relay", relayUrl);
    if (title.trim()) params.set("title", title.trim());
    if (summary.trim()) params.set("summary", summary.trim());
    if (section.trim()) params.set("section", section.trim());
    if (!commentsEnabled) params.set("comments", "off");
    onOpenChange(false);
    setLocation(`/articles/write?${params.toString()}`);
  };

  const selectSection = (s: string) => {
    setSection(s);
    setSectionOpen(false);
    setSectionSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog-card sm:max-w-md p-0 gap-0">
        <div className="px-5 pt-5 pb-3 space-y-1">
          <div className="flex items-center gap-2">
            <HorizonIcon className="w-4 h-4 text-brand" />
            <DialogTitle className="text-sm font-brand tracking-wider uppercase text-brand">
              New Article
            </DialogTitle>
          </div>
          <p className="text-[11px] text-muted-foreground/50">
            Set up your entry before opening the editor.
          </p>
        </div>

        <div className="px-5 pb-4 space-y-4 max-h-[60vh] overflow-y-auto overscroll-contain">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/70">
              Title <span className="text-red-700/70 dark:text-red-400/70">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a title for your entry..."
              className="text-base sm:text-sm h-10 sm:h-9 bg-muted/10 border-border/30 focus-visible:ring-brand/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) handleCreate();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/70">
              Summary <span className="text-muted-foreground/40">(optional)</span>
            </label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief description of this entry..."
              className="text-base sm:text-sm min-h-[60px] max-h-[100px] bg-muted/10 border-border/30 focus-visible:ring-brand/20 resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/70">
              Section <span className="text-muted-foreground/40">(optional)</span>
            </label>
            <button
              type="button"
              onClick={() => setSectionOpen(!sectionOpen)}
              className="flex items-center justify-between w-full h-10 sm:h-9 px-3 rounded-md border border-border/30 bg-muted/10 text-base sm:text-sm hover:bg-muted/20 transition-colors"
            >
              <span className={section ? "text-foreground" : "text-muted-foreground/50"}>
                {section ? (
                  <span className="flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-brand/70" />
                    {section}
                  </span>
                ) : (
                  "Choose a section..."
                )}
              </span>
              <ChevronDown className={`w-4 h-4 sm:w-3.5 sm:h-3.5 text-muted-foreground/40 transition-transform duration-200 ${sectionOpen ? "rotate-180" : ""}`} />
            </button>

            {sectionOpen && (
              <div className="rounded-md border border-border/30 bg-muted/5 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="p-2 border-b border-border/20">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-3 sm:h-3 text-muted-foreground/40" />
                    <Input
                      ref={searchInputRef}
                      value={sectionSearch}
                      onChange={(e) => setSectionSearch(e.target.value)}
                      placeholder="Search or create..."
                      className="h-8 sm:h-7 pl-8 sm:pl-7 text-base sm:text-xs bg-transparent border-none focus-visible:ring-0 shadow-none"
                    />
                  </div>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-1 overscroll-contain">
                  {section && (
                    <button
                      type="button"
                      onClick={() => selectSection("")}
                      className="flex items-center gap-2 w-full px-2.5 sm:px-2 py-2.5 sm:py-1.5 rounded text-xs sm:text-[11px] text-muted-foreground/50 hover:bg-muted/20 active:bg-muted/30 transition-colors"
                    >
                      <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                      Clear section
                    </button>
                  )}
                  {filteredSections.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => selectSection(s)}
                      className={`flex items-center gap-2 w-full px-2.5 sm:px-2 py-2.5 sm:py-1.5 rounded text-sm sm:text-xs transition-colors ${
                        section === s
                          ? "bg-brand/15 text-brand"
                          : "text-foreground/80 hover:bg-muted/20 active:bg-muted/30"
                      }`}
                    >
                      {section === s ? (
                        <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-brand shrink-0" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-brand/50 shrink-0" />
                      )}
                      <span className="truncate">{s}</span>
                      {existingSections.includes(s) && (
                        <span className="ml-auto text-[9px] text-muted-foreground/30 shrink-0">in use</span>
                      )}
                    </button>
                  ))}
                  {canCreateSection && (
                    <button
                      type="button"
                      onClick={() => selectSection(sectionSearch.trim())}
                      className="flex items-center gap-2 w-full px-2.5 sm:px-2 py-2.5 sm:py-1.5 rounded text-sm sm:text-xs text-brand hover:bg-brand/10 active:bg-brand/20 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                      Create "{sectionSearch.trim()}"
                    </button>
                  )}
                  {filteredSections.length === 0 && !canCreateSection && (
                    <p className="text-xs sm:text-[11px] text-muted-foreground/40 text-center py-4 sm:py-3">
                      No sections found
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-2.5 py-2 px-1 cursor-pointer select-none"
            onClick={() => setCommentsEnabled(!commentsEnabled)}
          >
            <Checkbox
              checked={commentsEnabled}
              onCheckedChange={(v) => setCommentsEnabled(!!v)}
              className="shrink-0 border-border/40 data-[state=checked]:bg-brand data-[state=checked]:border-brand"
            />
            <div className="flex items-center gap-1.5 min-w-0">
              <MessageSquareOff className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              <span className="text-[11px] text-foreground/70">Allow comments on this entry</span>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 flex items-center gap-2 border-t border-border/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground/60 h-9 sm:h-8"
          >
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!title.trim()}
            className="bg-brand hover:bg-brand text-white text-xs gap-1.5 h-9 sm:h-8 px-4 sm:px-3"
          >
            Create Entry
            <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
