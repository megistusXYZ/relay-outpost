import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import TurndownService from "turndown";

const lowlight = createLowlight(common);

const IframeEmbed = Node.create({
  name: "iframeEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: "560" },
      height: { default: "315" },
      frameborder: { default: "0" },
      allowfullscreen: { default: true } };
  },
  parseHTML() {
    return [{ tag: "iframe[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["iframe", mergeAttributes(HTMLAttributes)];
  } });

const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      style: { default: "max-width:100%;border-radius:8px;" } };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes)];
  } });

const AudioEmbed = Node.create({
  name: "audioEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      style: { default: "width:100%;" } };
  },
  parseHTML() {
    return [{ tag: "audio[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["audio", mergeAttributes(HTMLAttributes)];
  } });

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function getRelayModeStyle(preset: string): { text: string; dot: string } {
  switch (preset) {
    case "private": return { text: "text-amber-600 dark:text-amber-400/80", dot: "bg-amber-400" };
    case "public": return { text: "text-green-600 dark:text-green-400/80", dot: "bg-green-400" };
    case "all": return { text: "text-brand dark:text-brand/80", dot: "bg-brand" };
    default: return { text: "text-muted-foreground/70", dot: "bg-muted-foreground/40" };
  }
}

import type { Event } from "nostr-tools";
import { publishEvent, pool } from "@/lib/nostr";
import { buildArticleEvent, estimateReadingTime, KIND_LONG_FORM, HORIZON_SECTION_NAMESPACE, DEFAULT_HORIZON_SECTIONS } from "@/lib/nip23";
import { RelayPublishPicker, usePublishRelayPreference } from "@/components/RelayPublishPicker";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { createScheduledPost } from "@/lib/schedule";
import { uploadToNostrBuild, uploadMediaForOutpost, UploadError, validateFile } from "@/lib/media-upload";
import { fetchNip11 } from "@/lib/nip11";
import { classifyUrl, extractYouTubeId, getRumbleEmbedUrl } from "@/lib/media-utils";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parseFrontmatter, markdownToHtml, type FrontmatterMeta } from "@/lib/markdown-import";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { formatDistanceToNow } from "date-fns";
import {
  Bold,
  Italic,
  UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  ImageIcon,
  LinkIcon,
  Minus,
  Undo,
  Redo,
  Send,
  X,
  Hash,
  BookOpen,
  Upload,
  Eye,
  EyeOff,
  Save,
  Radio,
  FileText,
  Trash2,
  Clock,
  ShieldCheck,
  FilePlus,
  Video,
  Music,
  FileDown,
  Bookmark,
  FolderOpen,
  ChevronDown,
  Plus,
  Calendar,
  MessageSquareOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ComposeEmojiPicker } from "@/components/ComposeEmojiPicker";
import type { CustomEmoji } from "@/hooks/use-custom-emojis";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const SAFE_CSS_PROPS = new Set([
  "text-align", "font-style", "font-weight", "text-decoration",
  "color", "margin", "margin-top", "margin-bottom", "padding", "padding-top", "padding-bottom",
]);

function cleanStyle(raw: string): string {
  return raw.split(";").map((d) => d.trim()).filter(Boolean).filter((d) => {
    const i = d.indexOf(":");
    return i > 0 && SAFE_CSS_PROPS.has(d.slice(0, i).trim().toLowerCase());
  }).join("; ");
}

function rehypeCleanStyles() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (node.type === "element" && node.properties?.style) {
        const cleaned = cleanStyle(String(node.properties.style));
        if (cleaned) { node.properties.style = cleaned; } else { delete node.properties.style; }
      }
      if (node.children) node.children.forEach(walk);
    };
    walk(tree);
  };
}

const previewSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "center", "mark", "sub", "sup", "u"],
  attributes: {
    ...defaultSchema.attributes,
    ...Object.fromEntries(
      ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div", "span"].map(
        (t) => [t, [...(defaultSchema.attributes?.[t] || []), "style"]]
      )
    ) } };

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-" });

function buildSafeHtml(el: HTMLElement, content: string): string {
  const tag = el.tagName.toLowerCase();
  const style = el.getAttribute("style");
  const styleAttr = style ? ` style="${style.replace(/"/g, "&quot;")}"` : "";
  return `<${tag}${styleAttr}>${content}</${tag}>`;
}

turndownService.addRule("styledBlock", {
  filter: (node) => {
    const tag = node.nodeName;
    return (
      (tag === "P" || tag === "DIV" || /^H[1-6]$/.test(tag) || tag === "BLOCKQUOTE") &&
      !!(node as HTMLElement).getAttribute("style")
    );
  },
  replacement: (content, node) =>
    `\n\n${buildSafeHtml(node as HTMLElement, content.trim())}\n\n` });

turndownService.addRule("centerTag", {
  filter: "center",
  replacement: (content) => `\n\n<center>${content.trim()}</center>\n\n` });

turndownService.addRule("styledInline", {
  filter: (node) =>
    node.nodeName === "SPAN" && !!(node as HTMLElement).getAttribute("style"),
  replacement: (content, node) =>
    buildSafeHtml(node as HTMLElement, content) });

turndownService.addRule("iframeEmbed", {
  filter: "iframe",
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute("src") || "";
    return `\n\n${src}\n\n`;
  } });

turndownService.addRule("videoEmbed", {
  filter: "video",
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute("src") || "";
    return `\n\n${src}\n\n`;
  } });

turndownService.addRule("audioEmbed", {
  filter: "audio",
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute("src") || "";
    return `\n\n${src}\n\n`;
  } });

turndownService.addRule("richMediaBlock", {
  filter: (node) => {
    const el = node as HTMLElement;
    if (el.nodeName !== "DIV") return false;
    const dtype = el.getAttribute("data-type");
    return dtype === "video-embed" || dtype === "audio-embed" || dtype === "file-attachment" || dtype === "bookmark-card";
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const dtype = el.getAttribute("data-type");
    if (dtype === "file-attachment" || dtype === "bookmark-card") {
      const anchor = el.querySelector("a");
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        const text = anchor.textContent || href;
        return `\n\n[${text}](${href})\n\n`;
      }
    }
    return `\n\n${content.trim()}\n\n`;
  } });

const DRAFTS_KEY = "relay_outpost_article_drafts";
const AUTOSAVE_INTERVAL = 30000;

interface ArticleDraft {
  id: string;
  title: string;
  summary: string;
  bannerUrl: string;
  hashtags: string[];
  htmlContent: string;
  section?: string;
  savedAt: number;
}

function generateDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadDrafts(): ArticleDraft[] {
  try {
    const stored = localStorage.getItem(DRAFTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: ArticleDraft[]) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 20)));
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  testId,
  shortcut }: {
  icon: typeof Bold;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          className={`h-8 w-8 shrink-0 toggle-elevate ${active ? "toggle-elevated" : ""}`}
          data-testid={testId}
        >
          <Icon className="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}{shortcut ? ` (${shortcut})` : ""}</p>
      </TooltipContent>
    </Tooltip>
  );
}



function ImageInsertPopover({
  isUploading,
  onUpload }: {
  isUploading: boolean;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          data-testid="button-insert-image"
        >
          <ImageIcon className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="start">
        <p className="text-xs font-medium text-foreground/80 mb-2">Insert Image</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
          data-testid="input-image-file"
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 h-10"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          data-testid="button-upload-image"
        >
          {isUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          {isUploading ? "Uploading..." : "Upload from device"}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-[10px] text-green-500/40 hover:text-green-500/70 flex items-center gap-1 pt-1 transition-colors cursor-pointer" data-testid="button-inline-image-privacy">
              <ShieldCheck className="w-2.5 h-2.5" />
              Signal protected
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3 text-xs space-y-2" align="start" side="top">
            <div className="flex items-center gap-1.5 font-medium text-foreground/90">
              <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
              Signal Protection Active
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Images are scrubbed of GPS, device, and camera data before leaving your device.
            </p>
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}

function SectionPicker({
  value,
  onChange,
  relayUrl }: {
  value: string;
  onChange: (v: string) => void;
  relayUrl: string;
}) {
  const [existingSections, setExistingSections] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
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
        } },
    );

    const timeout = setTimeout(() => {
      if (!unmounted) {
        setExistingSections(Array.from(sectionSet).sort());
        sub.close();
      }
    }, 8000);

    return () => {
      unmounted = true;
      sub.close();
      clearTimeout(timeout);
    };
  }, [relayUrl]);

  const allSections = useMemo(() => {
    const combined = new Set(existingSections);
    for (const d of DEFAULT_HORIZON_SECTIONS) combined.add(d);
    return Array.from(combined).sort();
  }, [existingSections]);

  const filteredSections = useMemo(() => {
    if (!customInput.trim()) return allSections;
    const q = customInput.toLowerCase();
    return allSections.filter((s) => s.toLowerCase().includes(q));
  }, [allSections, customInput]);

  return (
    <div className="rounded-xl bg-card/40 dark:bg-card/20 backdrop-blur-sm border border-border/30 dark:border-primary/10 px-3 py-2 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300 hover:shadow-md hover:shadow-primary/8 dark:hover:shadow-primary/15 hover:border-border/50 dark:hover:border-primary/20">
      <div className="flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-brand/50 shrink-0" />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1.5 text-sm text-left flex-1 min-w-0 cursor-pointer hover:text-foreground/80 transition-colors"
              data-testid="button-section-picker"
            >
              <span className={`truncate ${value ? "text-foreground/80" : "text-muted-foreground/50"}`}>
                {value || "Select section (optional)"}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2 space-y-1" align="start">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Search or type new section..."
              className="h-7 text-base sm:text-xs mb-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInput.trim()) {
                  onChange(customInput.trim());
                  setCustomInput("");
                  setOpen(false);
                }
              }}
              autoFocus
              data-testid="input-section-search"
            />
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {filteredSections.map((s) => (
                <button
                  key={s}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer ${
                    value === s
                      ? "bg-brand/15 text-brand"
                      : "text-muted-foreground/70 hover:bg-muted/20 hover:text-foreground/80"
                  }`}
                  onClick={() => {
                    onChange(value === s ? "" : s);
                    setCustomInput("");
                    setOpen(false);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <FolderOpen className="w-3 h-3 shrink-0" />
                    {s}
                    {existingSections.includes(s) && (
                      <span className="text-[9px] text-muted-foreground/30 ml-auto">existing</span>
                    )}
                  </span>
                </button>
              ))}
              {customInput.trim() && !filteredSections.some((s) => s.toLowerCase() === customInput.trim().toLowerCase()) && (
                <button
                  className="w-full text-left text-xs px-2 py-1.5 rounded-md text-brand/70 hover:bg-brand/10 transition-colors cursor-pointer"
                  onClick={() => {
                    onChange(customInput.trim());
                    setCustomInput("");
                    setOpen(false);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="w-3 h-3 shrink-0" />
                    Create "{customInput.trim()}"
                  </span>
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function BannerUploadZone({
  bannerUrl,
  onUpload,
  onRemove,
  isUploading }: {
  bannerUrl: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
  isUploading: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onUpload(file);
  }, [onUpload]);

  if (bannerUrl) {
    return (
      <div className="relative aspect-[21/9] rounded-xl overflow-hidden bg-muted/30 group ring-1 ring-border/30 dark:ring-primary/10 shadow-lg shadow-primary/5 dark:shadow-primary/10 transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 dark:hover:shadow-primary/20 hover:ring-primary/20 dark:hover:ring-primary/25" data-testid="banner-preview">
        <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" loading="lazy" decoding="async" data-testid="img-banner-preview" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent sm:from-transparent sm:via-transparent sm:group-hover:from-black/40 sm:group-hover:via-black/10 transition-all duration-300 flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="reveal-on-hover duration-200 bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm rounded-full shadow-lg"
            onClick={onRemove}
            data-testid="button-remove-banner"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
        data-testid="input-banner-file"
      />
      <button
        type="button"
        className={`w-full h-24 sm:h-28 rounded-xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-1.5 cursor-pointer group/upload ${
          isDragging
            ? "border-primary bg-primary/10 shadow-lg shadow-primary/20 dark:shadow-primary/30 scale-[1.01]"
            : "border-border/40 hover:border-primary/40 hover:bg-primary/[0.03] dark:hover:bg-primary/[0.06] hover:shadow-md hover:shadow-primary/10 dark:hover:shadow-primary/15"
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        disabled={isUploading}
        data-testid="banner-upload-zone"
      >
        {isUploading ? (
          <>
            <RelayOutpostInlineLoader className="w-7 h-7 text-brand" />
            <span className="text-xs text-muted-foreground font-medium">Uploading banner...</span>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-primary/8 dark:bg-primary/12 flex items-center justify-center group-hover/upload:bg-primary/15 dark:group-hover/upload:bg-primary/20 transition-colors duration-300">
              <Upload className="w-5 h-5 text-brand/50 group-hover/upload:text-brand/80 transition-colors duration-300" />
            </div>
            <span className="text-xs text-muted-foreground/70 font-medium">Tap to upload banner image</span>
            <span className="text-[10px] text-muted-foreground/40 hidden sm:block">or drag and drop</span>
          </>
        )}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button className="text-[10px] text-green-500/40 hover:text-green-500/70 flex items-center gap-1 justify-center w-full transition-colors cursor-pointer py-0.5" data-testid="button-banner-privacy">
            <ShieldCheck className="w-2.5 h-2.5" />
            Signal protected
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 text-xs space-y-2" align="center">
          <div className="flex items-center gap-1.5 font-medium text-foreground/90">
            <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
            Signal Protection Active
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Your images are scrubbed before they leave your device. GPS coordinates, device info, timestamps, and camera data are stripped automatically — keeping your location and identity private on the network.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DraftsDropdown({
  drafts,
  onLoad,
  onDelete }: {
  drafts: ArticleDraft[];
  onLoad: (draft: ArticleDraft) => void;
  onDelete: (id: string) => void;
}) {
  if (drafts.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" data-testid="button-drafts-menu">
          <FileText className="w-3.5 h-3.5" />
          Drafts
          <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">{drafts.length}</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-[300px] overflow-y-auto">
        <p className="text-[10px] text-muted-foreground/60 px-2 py-1 font-mono uppercase tracking-wider">Saved Drafts</p>
        <DropdownMenuSeparator />
        {drafts.map((draft) => (
          <DropdownMenuItem
            key={draft.id}
            className="flex items-start gap-2 py-2 cursor-pointer"
            onClick={() => onLoad(draft)}
            data-testid={`draft-item-${draft.id}`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{draft.title || "Untitled"}</p>
              <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                <Clock className="w-2.5 h-2.5" />
                {formatDistanceToNow(draft.savedAt, { addSuffix: true })}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(draft.id); }}
              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-700 dark:hover:text-red-400 transition-colors shrink-0 cursor-pointer"
              data-testid={`button-delete-draft-${draft.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArticlePreview({
  title,
  summary,
  bannerUrl,
  hashtags,
  htmlContent }: {
  title: string;
  summary: string;
  bannerUrl: string;
  hashtags: string[];
  htmlContent: string;
}) {
  const markdown = useMemo(() => {
    if (!htmlContent || htmlContent === "<p></p>") return "";
    try {
      return turndownService.turndown(htmlContent);
    } catch {
      return "";
    }
  }, [htmlContent]);

  const readTime = estimateReadingTime(markdown);
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return (
    <div className="rounded-xl border border-border/30 dark:border-primary/10 bg-card/40 dark:bg-card/20 backdrop-blur-sm overflow-hidden shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300" data-testid="article-preview-panel">
      <div className="px-3 py-2 border-b border-border/20 dark:border-primary/8 flex items-center gap-2 bg-muted/10 dark:bg-muted/5">
        <Eye className="w-3.5 h-3.5 text-brand/60" />
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60">Preview</span>
      </div>

      <div className="p-4 sm:p-6 max-h-[70vh] overflow-y-auto">
        {bannerUrl && (
          <div className="aspect-[21/9] rounded-xl overflow-hidden mb-4 bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10 shadow-md shadow-primary/5 dark:shadow-primary/10">
            <img src={bannerUrl} alt="Article banner" className="w-full h-full object-cover" />
          </div>
        )}

        <h1 className="text-xl sm:text-2xl font-bold mb-2" data-testid="preview-title">
          {title || "Untitled Article"}
        </h1>

        {summary && (
          <p className="text-sm text-muted-foreground mb-3" data-testid="preview-summary">{summary}</p>
        )}

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mb-4 flex-wrap">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {readTime} min read</span>
          <span>{wordCount} words</span>
          <span>Just now</span>
        </div>

        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {hashtags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">#{tag}</Badge>
            ))}
          </div>
        )}

        <div className="article-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, previewSanitizeSchema], rehypeCleanStyles]}
          >
            {markdown || "*Start writing to see your preview...*"}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default function ArticleEditor() {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  useDocumentTitle("Write Article");

  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const outpostRelay = useMemo(() => urlParams.get("relay") || null, [urlParams]);

  const [relayBlossomServers, setRelayBlossomServers] = useState<string[]>([]);

  useEffect(() => {
    if (!outpostRelay) return;
    let cancelled = false;
    fetchNip11(outpostRelay).then((doc) => {
      if (cancelled) return;
      if (doc?.blossom_servers && doc.blossom_servers.length > 0) {
        setRelayBlossomServers(doc.blossom_servers);
      }
    });
    return () => { cancelled = true; };
  }, [outpostRelay]);

  const uploadForArticle = useCallback(async (
    file: File,
    onStatus?: (status: string) => void,
    imageOptions?: { maxDimension?: number },
  ) => {
    if (outpostRelay) {
      return uploadMediaForOutpost(file, relayBlossomServers, onStatus, signer, imageOptions);
    }
    return uploadToNostrBuild(file, onStatus, signer, imageOptions);
  }, [outpostRelay, relayBlossomServers, signer]);

  const [title, setTitle] = useState(() => urlParams.get("title") || "");
  const [summary, setSummary] = useState(() => urlParams.get("summary") || "");
  const [bannerUrl, setBannerUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [section, setSection] = useState(() => urlParams.get("section") || "");
  const [commentsDisabled] = useState(() => urlParams.get("comments") === "off");
  const [isPublishing, setIsPublishing] = useState(false);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [showRelayPicker, setShowRelayPicker] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const { pref: relayPref, relays: selectedRelays, label: relayLabel, updatePref: setRelayPref } = usePublishRelayPreference();
  const [isBannerUploading, setIsBannerUploading] = useState(false);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [drafts, setDrafts] = useState<ArticleDraft[]>(loadDrafts);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [draftBanner, setDraftBanner] = useState<ArticleDraft | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAutoSaveRef = useRef<string>("");
  const uploadImageRef = useRef<(file: File) => void>(() => {});
  const pasteHtmlRef = useRef<(html: string) => void>(() => {});
  const pasteMediaUrlRef = useRef<(url: string, mediaType: string) => void>(() => {});
  const importMdRef = useRef<(file: File) => void>(() => {});
  const mdInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{ html: string; meta: FrontmatterMeta } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: "hljs rounded-md text-sm",
          spellcheck: "false" } }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" } }),
      ImageExtension.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: "rounded-md max-w-full" } }),
      Placeholder.configure({
        placeholder: "Start writing your article..." }),
      Underline,
      IframeEmbed,
      VideoEmbed,
      AudioEmbed,
    ],
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[300px] sm:min-h-[400px] focus:outline-none px-4 py-3 prose-headings:font-bold prose-headings:tracking-tight prose-p:leading-relaxed prose-a:text-primary prose-img:rounded-md prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-primary/80 prose-blockquote:border-l-primary/50",
        "data-testid": "editor-content" },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0];
        if (file && file.type.startsWith("image/")) {
          event.preventDefault();
          uploadImageRef.current(file);
          return true;
        }
        if (file && (/\.(md|markdown|mdown|mkd)$/i.test(file.name) || file.type === "text/markdown")) {
          event.preventDefault();
          importMdRef.current(file);
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) uploadImageRef.current(file);
              return true;
            }
          }
        }

        if (event.clipboardData?.getData("text/html")) return false;

        const text = event.clipboardData?.getData("text/plain")?.trim() || "";

        if (text && /^https?:\/\//i.test(text)) {
          const mediaType = classifyUrl(text);
          if (mediaType === "youtube" || mediaType === "video" || mediaType === "rumble" || mediaType === "audio") {
            event.preventDefault();
            pasteMediaUrlRef.current(text, mediaType);
            return true;
          }
        }

        if (text && /<[a-z][a-z0-9]*[\s>]/i.test(text) && /<\/[a-z][a-z0-9]*>/i.test(text)) {
          event.preventDefault();
          pasteHtmlRef.current(text);
          return true;
        }

        return false;
      } },
    onUpdate: () => {
      setHasUnsavedChanges(true);
    } });

  const addHashtag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase().replace(/^#/, "");
    if (tag && !hashtags.includes(tag)) {
      setHashtags((prev) => [...prev, tag]);
      setHasUnsavedChanges(true);
    }
    setTagInput("");
  }, [tagInput, hashtags]);

  const removeHashtag = useCallback((tag: string) => {
    setHashtags((prev) => prev.filter((t) => t !== tag));
    setHasUnsavedChanges(true);
  }, []);

  const isValidUrl = useCallback((url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, []);

  const insertLink = useCallback(() => {
    if (!editor) return;
    const url = prompt("Enter URL:");
    if (url) {
      if (!isValidUrl(url)) {
        toast({ title: "Invalid URL", description: "Please enter a valid http or https URL.", variant: "destructive" });
        return;
      }
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor, isValidUrl, toast]);

  const insertVideoEmbed = useCallback(() => {
    if (!editor) return;
    const url = prompt("Enter video URL (YouTube, Rumble, or direct video link):");
    if (url) {
      if (!isValidUrl(url)) {
        toast({ title: "Invalid URL", description: "Please enter a valid video URL.", variant: "destructive" });
        return;
      }
      const ytId = extractYouTubeId(url);
      if (ytId) {
        editor.chain().focus().insertContent(
          `<div data-type="video-embed"><iframe src="https://www.youtube.com/embed/${ytId}" width="560" height="315" frameborder="0" allowfullscreen></iframe></div><p></p>`
        ).run();
      } else if (/rumble\.com\//i.test(url)) {
        const rumbleEmbedUrl = getRumbleEmbedUrl(url);
        if (rumbleEmbedUrl) {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><iframe src="${rumbleEmbedUrl}" width="560" height="315" frameborder="0" allowfullscreen></iframe></div><p></p>`
          ).run();
        } else {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">▶ ${escapeHtml(url)}</a></div><p></p>`
          ).run();
        }
      } else {
        const mediaType = classifyUrl(url);
        if (mediaType === "video") {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><video controls src="${url}" style="max-width:100%;border-radius:8px;"></video></div><p></p>`
          ).run();
        } else {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><a href="${url}" target="_blank" rel="noopener noreferrer">▶ ${url}</a></div><p></p>`
          ).run();
        }
      }
      setHasUnsavedChanges(true);
    }
  }, [editor, isValidUrl, toast]);

  const insertAudioEmbed = useCallback(() => {
    if (!editor) return;
    const url = prompt("Enter audio URL (mp3, wav, ogg, etc.):");
    if (url) {
      if (!isValidUrl(url)) {
        toast({ title: "Invalid URL", description: "Please enter a valid audio URL.", variant: "destructive" });
        return;
      }
      editor.chain().focus().insertContent(
        `<div data-type="audio-embed"><audio controls src="${url}" style="width:100%;"></audio></div><p></p>`
      ).run();
      setHasUnsavedChanges(true);
    }
  }, [editor, isValidUrl, toast]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!editor) return;
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum file size is 100 MB.", variant: "destructive" });
      return;
    }
    setIsFileUploading(true);
    try {
      const result = await uploadForArticle(file);
      const fileName = file.name || "file";
      const fileSize = file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
      const ext = fileName.split(".").pop()?.toUpperCase() || "FILE";
      editor.chain().focus().insertContent(
        `<div data-type="file-attachment" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.03);margin:8px 0;">` +
        `<span style="font-size:20px;">📎</span>` +
        `<span><a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer" style="font-weight:500;">${escapeHtml(fileName)}</a>` +
        `<br/><span style="font-size:12px;opacity:0.5;">${escapeHtml(ext)} · ${fileSize}</span></span></div><p></p>`
      ).run();
      setHasUnsavedChanges(true);
      toast({ title: "File uploaded", description: `${fileName} attached to your article.` });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload file.", variant: "destructive" });
    } finally {
      setIsFileUploading(false);
    }
  }, [editor, uploadForArticle, toast]);

  const insertBookmarkLink = useCallback(async () => {
    if (!editor) return;
    const url = prompt("Enter URL to bookmark:");
    if (url) {
      if (!isValidUrl(url)) {
        toast({ title: "Invalid URL", description: "Please enter a valid URL.", variant: "destructive" });
        return;
      }
      const displayUrl = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      let domain = "";
      try { domain = new URL(url).hostname; } catch { domain = displayUrl; }
      let linkTitle = displayUrl;
      let linkDescription = "";
      let faviconUrl = "";
      try {
        const resp = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) linkTitle = titleMatch[1].trim();
          const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                           html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
          if (descMatch) linkDescription = descMatch[1].trim().slice(0, 150);
          faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        }
      } catch {}
      const faviconHtml = faviconUrl
        ? `<img src="${escapeHtml(faviconUrl)}" width="16" height="16" style="vertical-align:middle;margin-right:4px;border-radius:2px;" />`
        : `<span style="font-size:18px;">🔗</span>`;
      const descHtml = linkDescription
        ? `<br/><span style="font-size:11px;opacity:0.5;">${escapeHtml(linkDescription)}</span>`
        : "";
      editor.chain().focus().insertContent(
        `<div data-type="bookmark-card" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.03);margin:8px 0;">` +
        `${faviconHtml}` +
        `<span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="font-weight:500;">${escapeHtml(linkTitle)}</a>` +
        `<br/><span style="font-size:12px;opacity:0.5;">${escapeHtml(domain)}</span>${descHtml}</span></div><p></p>`
      ).run();
      setHasUnsavedChanges(true);
    }
  }, [editor, isValidUrl, toast]);

  const fileUploadRef = useRef<HTMLInputElement>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const audioUploadRef = useRef<HTMLInputElement>(null);

  const handleVideoUpload = useCallback(async (file: File) => {
    if (!editor) return;
    const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_VIDEO_SIZE) {
      toast({ title: "Video too large", description: "Maximum video size is 100 MB.", variant: "destructive" });
      return;
    }
    setIsFileUploading(true);
    try {
      const result = await uploadForArticle(file);
      editor.chain().focus().insertContent(
        `<div data-type="video-embed"><video controls src="${result.url}" style="max-width:100%;border-radius:8px;"></video></div><p></p>`
      ).run();
      setHasUnsavedChanges(true);
      toast({ title: "Video uploaded", description: `${file.name} embedded in your article.` });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload video.", variant: "destructive" });
    } finally {
      setIsFileUploading(false);
    }
  }, [editor, uploadForArticle, toast]);

  const handleAudioUpload = useCallback(async (file: File) => {
    if (!editor) return;
    const MAX_AUDIO_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_AUDIO_SIZE) {
      toast({ title: "Audio too large", description: "Maximum audio size is 50 MB.", variant: "destructive" });
      return;
    }
    setIsFileUploading(true);
    try {
      const result = await uploadForArticle(file);
      editor.chain().focus().insertContent(
        `<div data-type="audio-embed"><audio controls src="${result.url}" style="width:100%;"></audio></div><p></p>`
      ).run();
      setHasUnsavedChanges(true);
      toast({ title: "Audio uploaded", description: `${file.name} embedded in your article.` });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload audio.", variant: "destructive" });
    } finally {
      setIsFileUploading(false);
    }
  }, [editor, uploadForArticle, toast]);

  const handleEmojiInsert = useCallback((text: string, emoji?: CustomEmoji) => {
    if (!editor) return;
    if (emoji) {
      editor.chain().focus().setImage({
        src: emoji.url,
        alt: `:${emoji.shortcode}:`,
        title: `:${emoji.shortcode}:` }).run();
    } else {
      editor.chain().focus().insertContent(text).run();
    }
    setHasUnsavedChanges(true);
  }, [editor]);

  const handleGifInsert = useCallback((url: string) => {
    if (!editor) return;
    editor.chain().focus().setImage({ src: url }).run();
    setHasUnsavedChanges(true);
  }, [editor]);

  const handleInlineImageUpload = useCallback(async (file: File) => {
    if (!editor) return;
    try {
      validateFile(file, true);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }
    setIsImageUploading(true);
    try {
      const result = await uploadForArticle(file);
      editor.chain().focus().setImage({ src: result.url }).run();
      toast({ title: "Image uploaded", description: "Image inserted into your article." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload image.", variant: "destructive" });
    } finally {
      setIsImageUploading(false);
    }
  }, [editor, uploadForArticle, toast]);

  useEffect(() => {
    uploadImageRef.current = handleInlineImageUpload;
  }, [handleInlineImageUpload]);

  useEffect(() => {
    pasteHtmlRef.current = (html: string) => {
      if (editor) {
        editor.commands.insertContent(html);
      }
    };
  }, [editor]);

  useEffect(() => {
    pasteMediaUrlRef.current = (url: string, mediaType: string) => {
      if (!editor) return;
      if (mediaType === "youtube") {
        const ytId = extractYouTubeId(url);
        if (ytId) {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><iframe src="https://www.youtube.com/embed/${ytId}" width="560" height="315" frameborder="0" allowfullscreen></iframe></div><p></p>`
          ).run();
          setHasUnsavedChanges(true);
          return;
        }
      }
      if (mediaType === "rumble") {
        const rumbleEmbedUrl = getRumbleEmbedUrl(url);
        if (rumbleEmbedUrl) {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><iframe src="${rumbleEmbedUrl}" width="560" height="315" frameborder="0" allowfullscreen></iframe></div><p></p>`
          ).run();
        } else {
          editor.chain().focus().insertContent(
            `<div data-type="video-embed"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">▶ ${escapeHtml(url)}</a></div><p></p>`
          ).run();
        }
        setHasUnsavedChanges(true);
        return;
      }
      if (mediaType === "video") {
        editor.chain().focus().insertContent(
          `<div data-type="video-embed"><video controls src="${url}" style="max-width:100%;border-radius:8px;"></video></div><p></p>`
        ).run();
        setHasUnsavedChanges(true);
        return;
      }
      if (mediaType === "audio") {
        editor.chain().focus().insertContent(
          `<div data-type="audio-embed"><audio controls src="${url}" style="width:100%;"></audio></div><p></p>`
        ).run();
        setHasUnsavedChanges(true);
        return;
      }
    };
  }, [editor]);

  // Apply a parsed .md import: fill empty metadata fields from frontmatter
  // (never clobber what the user already typed) and load the body into the editor.
  const applyImport = useCallback((html: string, meta: FrontmatterMeta) => {
    if (!editor) return;
    if (meta.title && !title.trim()) setTitle(meta.title);
    if (meta.summary && !summary.trim()) setSummary(meta.summary);
    if (meta.image && !bannerUrl.trim()) setBannerUrl(meta.image);
    if (meta.tags?.length) {
      setHashtags((prev) => {
        const seen = new Set(prev.map((t) => t.toLowerCase()));
        const add = meta.tags!
          .map((t) => t.replace(/^#/, "").trim())
          .filter((t) => t && !seen.has(t.toLowerCase()));
        return [...prev, ...add];
      });
    }
    editor.commands.setContent(html);
    editor.commands.focus();
    setHasUnsavedChanges(true);
    toast({ title: "Markdown imported", description: "Review and edit before publishing." });
  }, [editor, title, summary, bannerUrl, toast]);

  const handleMdFile = useCallback((file: File) => {
    if (!editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const { meta, body } = parseFrontmatter(raw);
      let html: string;
      try {
        html = markdownToHtml(body);
      } catch {
        toast({ title: "Couldn't read that file", description: "It doesn't look like valid Markdown.", variant: "destructive" });
        return;
      }
      if (editor.isEmpty) applyImport(html, meta);
      else setPendingImport({ html, meta });
    };
    reader.onerror = () => toast({ title: "Couldn't read that file", variant: "destructive" });
    reader.readAsText(file);
  }, [editor, applyImport, toast]);

  useEffect(() => { importMdRef.current = handleMdFile; }, [handleMdFile]);

  const onMdInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleMdFile(file);
  }, [handleMdFile]);

  const handleBannerUpload = useCallback(async (file: File) => {
    try {
      validateFile(file, true);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }
    setIsBannerUploading(true);
    try {
      const result = await uploadForArticle(file, undefined, { maxDimension: 1920 });
      setBannerUrl(result.url);
      setHasUnsavedChanges(true);
      toast({ title: "Banner uploaded", description: "Banner image set." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload banner.", variant: "destructive" });
    } finally {
      setIsBannerUploading(false);
    }
  }, [uploadForArticle, toast]);

  const getCurrentState = useCallback((): Omit<ArticleDraft, "id" | "savedAt"> => ({
    title,
    summary,
    bannerUrl,
    hashtags,
    htmlContent: editor?.getHTML() || "",
    section: section || undefined }), [title, summary, bannerUrl, hashtags, editor, section]);

  const saveDraft = useCallback((silent = false) => {
    const state = getCurrentState();
    if (!state.title.trim() && (!state.htmlContent || state.htmlContent === "<p></p>")) {
      if (!silent) toast({ title: "Nothing to save", description: "Add a title or content first." });
      return;
    }

    const stateKey = JSON.stringify(state);
    if (stateKey === lastAutoSaveRef.current && silent) return;
    lastAutoSaveRef.current = stateKey;

    const existing = loadDrafts();
    const draft: ArticleDraft = {
      id: currentDraftId || generateDraftId(),
      ...state,
      savedAt: Date.now() };

    const filtered = existing.filter((d) => d.id !== draft.id);
    const updated = [draft, ...filtered].slice(0, 20);
    saveDrafts(updated);
    setDrafts(updated);
    setCurrentDraftId(draft.id);
    setHasUnsavedChanges(false);

    if (!silent) {
      toast({ title: "Draft saved", description: "Your article draft has been saved." });
    }
  }, [getCurrentState, currentDraftId, toast]);

  const loadDraft = useCallback((draft: ArticleDraft) => {
    setTitle(draft.title);
    setSummary(draft.summary);
    setBannerUrl(draft.bannerUrl);
    setHashtags(draft.hashtags);
    setSection(draft.section || "");
    setCurrentDraftId(draft.id);
    if (editor) {
      editor.commands.setContent(draft.htmlContent);
    }
    setHasUnsavedChanges(false);
    setDraftBanner(null);
    toast({ title: "Draft loaded", description: `"${draft.title || "Untitled"}" restored.` });
  }, [editor, toast]);

  const deleteDraft = useCallback((id: string) => {
    const updated = loadDrafts().filter((d) => d.id !== id);
    saveDrafts(updated);
    setDrafts(updated);
    if (currentDraftId === id) setCurrentDraftId(null);
    toast({ title: "Draft deleted" });
  }, [currentDraftId, toast]);

  const startNewArticle = useCallback(() => {
    setTitle("");
    setSummary("");
    setBannerUrl("");
    setHashtags([]);
    setTagInput("");
    setSection("");
    setCurrentDraftId(null);
    setHasUnsavedChanges(false);
    setShowPreview(false);
    setDraftBanner(null);
    lastAutoSaveRef.current = "";
    if (editor) {
      editor.commands.clearContent();
    }
  }, [editor]);

  useEffect(() => {
    const existing = loadDrafts();
    if (existing.length > 0 && !title && (!editor || editor.getHTML() === "<p></p>")) {
      const latest = existing[0];
      const age = Date.now() - latest.savedAt;
      if (age < 7 * 24 * 60 * 60 * 1000) {
        setDraftBanner(latest);
      }
    }
  }, [editor]);

  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      if (hasUnsavedChanges) saveDraft(true);
    }, AUTOSAVE_INTERVAL);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [hasUnsavedChanges, saveDraft]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const htmlContent = editor?.getHTML() || "";
  const markdown = useMemo(() => {
    if (!htmlContent || htmlContent === "<p></p>") return "";
    try { return turndownService.turndown(htmlContent); } catch { return ""; }
  }, [htmlContent]);
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  const readTime = estimateReadingTime(markdown);

  const handlePublish = async () => {
    if (!editor || !signer || !pubkey) return;
    if (!title.trim()) {
      toast({ title: "Missing title", description: "Please add a title for your article.", variant: "destructive" });
      return;
    }

    const html = editor.getHTML();
    if (!html || html === "<p></p>") {
      toast({ title: "Empty content", description: "Please write some content first.", variant: "destructive" });
      return;
    }

    setIsPublishing(true);
    try {
      const md = turndownService.turndown(html);
      const eventTemplate = buildArticleEvent({
        title: title.trim(),
        summary: summary.trim(),
        content: md,
        image: bannerUrl.trim(),
        hashtags,
        section: section.trim() || undefined,
        commentsDisabled: commentsDisabled || undefined });

      const publishRelays = outpostRelay ? [outpostRelay] : selectedRelays;
      if (publishRelays.length === 0) {
        toast({
          title: "No relays selected",
          description: relayPref.preset === "private"
            ? "You don't have any private relays configured. Add a private relay in the Relays page first."
            : "No relays available for publishing. Check your relay settings.",
          variant: "destructive" });
        setIsPublishing(false);
        return;
      }

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const isUserSelected = !!outpostRelay || relayPref.preset !== "all";
      const isPrivateOnly = !outpostRelay && relayPref.preset === "private";
      const success = await publishEvent(signedEvent, publishRelays, undefined, isUserSelected, isPrivateOnly);

      if (success) {
        if (currentDraftId) {
          const updated = loadDrafts().filter((d) => d.id !== currentDraftId);
          saveDrafts(updated);
          setDrafts(updated);
        }
        setHasUnsavedChanges(false);
        if (outpostRelay) {
          setLocation(`/outposts/${encodeURIComponent(outpostRelay)}`);
        } else {
          setLocation("/articles");
        }
      } else {
        toast({ title: "Failed", description: "Could not publish to any relay.", variant: "destructive" });
      }
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error(err);
        const msg = err instanceof Error && err.message.includes("No relays")
          ? "No relays available. If using Private Only mode, make sure you have a private relay configured."
          : "Failed to publish article.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleScheduleArticle = async () => {
    if (!scheduleDateTime) {
      toast({ title: "Select a date & time", description: "Pick when you'd like this article published.", variant: "destructive" });
      return;
    }
    const scheduledDate = new Date(scheduleDateTime);
    if (scheduledDate.getTime() <= Date.now()) {
      toast({ title: "Invalid time", description: "Scheduled time must be in the future.", variant: "destructive" });
      return;
    }
    if (!editor || !signer || !pubkey) return;
    if (!title.trim()) {
      toast({ title: "Missing title", description: "Please add a title for your article.", variant: "destructive" });
      return;
    }
    const html = editor.getHTML();
    if (!html || html === "<p></p>") {
      toast({ title: "Empty content", description: "Please write some content first.", variant: "destructive" });
      return;
    }

    const scheduledCreatedAt = Math.floor(scheduledDate.getTime() / 1000);
    setIsPublishing(true);
    try {
      const md = turndownService.turndown(html);
      const eventTemplate = buildArticleEvent({
        title: title.trim(),
        summary: summary.trim(),
        content: md,
        image: bannerUrl.trim(),
        hashtags,
        section: section.trim() || undefined,
        commentsDisabled: commentsDisabled || undefined });
      eventTemplate.created_at = scheduledCreatedAt;

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const publishRelays = outpostRelay ? [outpostRelay] : selectedRelays;
      await createScheduledPost(signedEvent, publishRelays, scheduledDate, pubkey, title.trim());

      if (currentDraftId) {
        const updated = loadDrafts().filter((d) => d.id !== currentDraftId);
        saveDrafts(updated);
        setDrafts(updated);
      }
      setHasUnsavedChanges(false);
      setShowSchedule(false);
      setScheduleDateTime("");
      const timeLabel = scheduledDate.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      toast({ title: "Scheduled", description: `Your article will be published ${timeLabel}.` });

      if (outpostRelay) {
        setLocation(`/outposts/${encodeURIComponent(outpostRelay)}`);
      } else {
        setLocation("/articles");
      }
    } catch (err: any) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error(err);
        toast({ title: "Schedule failed", description: err.message || "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  if (!pubkey) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground mb-4" data-testid="text-sign-in-required">Sign in to write articles</p>
        <Button variant="outline" onClick={() => setLocation("/login")} data-testid="button-go-to-login">
          Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4" data-testid="page-article-editor">
      {draftBanner && (
        <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2 flex-wrap" data-testid="draft-restore-banner">
          <FileText className="w-3.5 h-3.5 text-brand/60 shrink-0" />
          <span className="text-xs text-foreground/80 flex-1">
            Draft from {formatDistanceToNow(draftBanner.savedAt, { addSuffix: true })}
            {draftBanner.title && <> — "{draftBanner.title}"</>}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-brand"
            onClick={() => loadDraft(draftBanner)}
            data-testid="button-restore-draft"
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setDraftBanner(null)}
            data-testid="button-dismiss-draft"
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/15 flex items-center justify-center shadow-sm">
            <BookOpen className="w-4 h-4 text-brand/70" />
          </div>
          <h1 className="text-lg font-bold" data-testid="heading-write-article">Write Article</h1>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 sm:gap-1 mr-1 sm:mr-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs px-2"
              onClick={() => saveDraft(false)}
              data-testid="button-save-draft"
            >
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save</span>
            </Button>

            <DraftsDropdown drafts={drafts} onLoad={loadDraft} onDelete={deleteDraft} />

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground px-2"
              onClick={startNewArticle}
              disabled={!title && (!editor || editor.getHTML() === "<p></p>")}
              data-testid="button-new-article"
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New</span>
            </Button>
          </div>

          <div className="flex items-center rounded-lg border border-border/30 dark:border-primary/15 overflow-hidden bg-muted/10 dark:bg-muted/5 shadow-sm">
            <button
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer ${
                !showPreview ? "bg-brand/15 dark:bg-brand/20 text-brand shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setShowPreview(false)}
              data-testid="button-edit-mode"
            >
              Edit
            </button>
            <button
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer ${
                showPreview ? "bg-brand/15 dark:bg-brand/20 text-brand shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setShowPreview(true)}
              data-testid="button-preview-mode"
            >
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                <span className="hidden sm:inline">Preview</span>
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {outpostRelay ? (
              <span className="shrink-0 flex items-center gap-1.5 text-xs px-2 text-brand dark:text-brand/80">
                <span className="w-2 h-2 rounded-full bg-brand shrink-0" />
                <span className="max-w-[120px] truncate hidden sm:inline font-medium">{outpostRelay.replace(/^wss?:\/\//, "")}</span>
              </span>
            ) : getOutpostRelays().length === 0 ? (
              <button
                onClick={() => setLocation("/outposts")}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground/55 hover:text-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                data-testid="button-article-relay-manage-link"
                title="Manage Communities"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                <span className="hidden sm:inline truncate">Posting to defaults</span>
                <span className="opacity-40 hidden sm:inline">·</span>
                <span className="text-brand/80">Manage</span>
              </button>
            ) : (() => {
              const ms = getRelayModeStyle(relayPref.preset);
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className={`shrink-0 gap-1.5 text-xs px-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] ${ms.text}`}
                  onClick={() => setShowRelayPicker(true)}
                  data-testid="button-article-relay-selector"
                >
                  <span className={`w-2 h-2 rounded-full ${ms.dot} shrink-0`} />
                  <span className="max-w-[100px] truncate hidden sm:inline font-medium">{relayLabel}</span>
                </Button>
              );
            })()}
            <input
              ref={mdInputRef}
              type="file"
              accept=".md,.markdown,.mdown,.mkd,text/markdown,text/plain"
              className="hidden"
              onChange={onMdInputChange}
              data-testid="input-import-md"
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 h-9 w-9 p-0 text-muted-foreground/40 hover:text-foreground"
              onClick={() => mdInputRef.current?.click()}
              title="Import a Markdown (.md) file"
              data-testid="button-import-md"
            >
              <Upload className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`shrink-0 h-9 w-9 p-0 ${showSchedule ? "text-brand" : "text-muted-foreground/40 hover:text-foreground"}`}
              onClick={() => setShowSchedule(!showSchedule)}
              title="Schedule for later"
              data-testid="button-toggle-schedule-article"
            >
              <Calendar className="w-4 h-4" />
            </Button>

            {showSchedule ? (
              <Button
                onClick={handleScheduleArticle}
                disabled={isPublishing || !title.trim() || !scheduleDateTime}
                className="bg-brand hover:bg-brand"
                data-testid="button-schedule-article"
              >
                {isPublishing ? (
                  <RelayOutpostInlineLoader className="w-4 h-4 mr-1.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5 mr-1.5" />
                )}
                Schedule
              </Button>
            ) : (
              <Button
                onClick={handlePublish}
                disabled={isPublishing || !title.trim()}
                data-testid="button-publish-article"
              >
                {isPublishing ? (
                  <RelayOutpostInlineLoader className="w-4 h-4 mr-1.5" />
                ) : (
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isPublishing ? "Publishing..." : "Publish"}
              </Button>
            )}
          </div>

          {showSchedule && (
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-brand/5 border border-brand/15">
                <Clock className="w-3.5 h-3.5 text-brand shrink-0" />
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                  min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
                  className="flex-1 text-xs bg-transparent border-none outline-none text-foreground [color-scheme:dark]"
                  data-testid="input-schedule-datetime-article"
                />
                <button
                  className="text-muted-foreground/40 hover:text-foreground"
                  onClick={() => { setShowSchedule(false); setScheduleDateTime(""); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <RelayPublishPicker
            open={showRelayPicker}
            onOpenChange={setShowRelayPicker}
            onPreferenceChange={setRelayPref}
          />

          <AlertDialog open={!!pendingImport} onOpenChange={(o) => { if (!o) setPendingImport(null); }}>
            <AlertDialogContent className="glass-dialog-card max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-sm font-brand tracking-wide">Replace current content?</AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-muted-foreground/70">
                  Importing this Markdown file will replace what's in the editor. Empty title, summary, banner, and tags will be filled in from the file.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="h-8 text-xs"
                  onClick={() => { if (pendingImport) applyImport(pendingImport.html, pendingImport.meta); setPendingImport(null); }}
                  data-testid="button-confirm-import-md"
                >
                  Replace
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className={`${showPreview ? "hidden md:grid md:grid-cols-2 md:gap-4" : "block"}`}>
        <div className="space-y-3">
          <BannerUploadZone
            bannerUrl={bannerUrl}
            onUpload={handleBannerUpload}
            onRemove={() => { setBannerUrl(""); setHasUnsavedChanges(true); }}
            isUploading={isBannerUploading}
          />

          <div className="space-y-3 mb-4">
            <div className="rounded-xl border border-border/30 dark:border-primary/10 bg-card/40 dark:bg-card/20 backdrop-blur-sm p-3 sm:p-4 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300 hover:shadow-md hover:shadow-primary/8 dark:hover:shadow-primary/15 hover:border-border/50 dark:hover:border-primary/20">
              <Input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setHasUnsavedChanges(true); }}
                placeholder="Article title"
                className="text-xl font-bold border-0 border-b border-border/20 dark:border-primary/10 rounded-none px-0 bg-transparent focus-visible:ring-0 focus-visible:border-primary/50 dark:focus-visible:border-primary/40 transition-colors"
                style={{ fontSize: 20 }}
                enterKeyHint="next"
                autoCorrect="off"
                data-testid="input-article-title"
              />

              <Textarea
                value={summary}
                onChange={(e) => { setSummary(e.target.value); setHasUnsavedChanges(true); }}
                placeholder="Brief summary (optional, shown in article cards)"
                className="resize-none border-0 border-b border-border/20 dark:border-primary/10 rounded-none px-0 bg-transparent focus-visible:ring-0 focus-visible:border-primary/50 dark:focus-visible:border-primary/40 text-sm mt-3 transition-colors"
                style={{ fontSize: 16 }}
                rows={2}
                autoComplete="off"
                data-testid="input-article-summary"
              />
            </div>

            <div className="rounded-xl bg-card/40 dark:bg-card/20 backdrop-blur-sm border border-border/30 dark:border-primary/10 px-3 py-1 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300 hover:shadow-md hover:shadow-primary/8 dark:hover:shadow-primary/15 hover:border-border/50 dark:hover:border-primary/20">
              {hashtags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-2.5 pb-1" data-testid="container-hashtag-bubbles">
                  {hashtags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1 px-2.5 py-1 text-xs bg-brand/10 text-brand border border-brand/20 dark:border-brand/25 hover:bg-brand/15 dark:hover:bg-brand/20 transition-all duration-200 shadow-sm shadow-primary/5 dark:shadow-primary/15 animate-in fade-in slide-in-from-bottom-1 duration-200"
                    >
                      #{tag}
                      <button onClick={() => removeHashtag(tag)} className="ml-0.5 rounded-full hover:bg-primary/20 dark:hover:bg-primary/30 p-0.5 transition-colors cursor-pointer" data-testid={`button-remove-tag-${tag}`}>
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-brand/40 shrink-0" />
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addHashtag();
                    }
                  }}
                  placeholder={hashtags.length > 0 ? "Add more tags..." : "Add hashtags (press Enter)"}
                  className="flex-1 min-w-[120px] border-0 bg-transparent px-0 focus-visible:ring-0"
                  style={{ fontSize: 16 }}
                  enterKeyHint="done"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  data-testid="input-hashtag"
                />
              </div>
            </div>

            {outpostRelay && (
              <SectionPicker
                value={section}
                onChange={(v) => { setSection(v); setHasUnsavedChanges(true); }}
                relayUrl={outpostRelay}
              />
            )}

            {commentsDisabled && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-500/60 mt-1">
                <MessageSquareOff className="w-3 h-3" />
                <span>Comments disabled on this entry</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/30 dark:border-primary/10 bg-card/40 dark:bg-card/20 backdrop-blur-sm shadow-sm shadow-primary/5 dark:shadow-primary/10 mb-4 transition-all duration-300 hover:shadow-md hover:shadow-primary/8 dark:hover:shadow-primary/15 hover:border-border/50 dark:hover:border-primary/20 focus-within:shadow-lg focus-within:shadow-primary/10 dark:focus-within:shadow-primary/20 focus-within:border-primary/30 dark:focus-within:border-primary/25 focus-within:ring-1 focus-within:ring-primary/10">
            <div className="flex items-center gap-0.5 p-1.5 border-b border-border/20 dark:border-primary/8 overflow-x-auto bg-muted/10 dark:bg-muted/5 rounded-t-xl" data-testid="container-toolbar">
              <ToolbarButton icon={Bold} label="Bold" shortcut="Ctrl+B" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} testId="button-bold" />
              <ToolbarButton icon={Italic} label="Italic" shortcut="Ctrl+I" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} testId="button-italic" />
              <ToolbarButton icon={UnderlineIcon} label="Underline" shortcut="Ctrl+U" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} testId="button-underline" />
              <ToolbarButton icon={Strikethrough} label="Strikethrough" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} testId="button-strikethrough" />

              <div className="w-px h-5 bg-border/40 mx-1 shrink-0" />

              <ToolbarButton icon={Heading1} label="Heading 1" active={editor?.isActive("heading", { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} testId="button-h1" />
              <ToolbarButton icon={Heading2} label="Heading 2" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} testId="button-h2" />
              <ToolbarButton icon={Heading3} label="Heading 3" active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} testId="button-h3" />

              <div className="w-px h-5 bg-border/40 mx-1 shrink-0" />

              <ToolbarButton icon={List} label="Bullet List" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} testId="button-bullet-list" />
              <ToolbarButton icon={ListOrdered} label="Ordered List" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} testId="button-ordered-list" />
              <ToolbarButton icon={Quote} label="Blockquote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} testId="button-blockquote" />
              <ToolbarButton icon={Code} label="Code Block" active={editor?.isActive("codeBlock")} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} testId="button-code-block" />

              <div className="w-px h-5 bg-border/40 mx-1 shrink-0" />

              <ToolbarButton icon={LinkIcon} label="Insert Link" onClick={insertLink} testId="button-insert-link" />
              <ImageInsertPopover
                isUploading={isImageUploading}
                onUpload={handleInlineImageUpload}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="button-insert-video" disabled={isFileUploading}>
                    {isFileUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1 glass-dialog-card" side="bottom" align="start">
                  <button className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted/30 transition-colors" onClick={insertVideoEmbed}>
                    From URL
                  </button>
                  <button className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted/30 transition-colors" onClick={() => videoUploadRef.current?.click()}>
                    Upload Video
                  </button>
                </PopoverContent>
              </Popover>
              <input
                ref={videoUploadRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleVideoUpload(f);
                  e.target.value = "";
                }}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="button-insert-audio" disabled={isFileUploading}>
                    {isFileUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1 glass-dialog-card" side="bottom" align="start">
                  <button className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted/30 transition-colors" onClick={insertAudioEmbed}>
                    From URL
                  </button>
                  <button className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted/30 transition-colors" onClick={() => audioUploadRef.current?.click()}>
                    Upload Audio
                  </button>
                </PopoverContent>
              </Popover>
              <input
                ref={audioUploadRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAudioUpload(f);
                  e.target.value = "";
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => fileUploadRef.current?.click()}
                    disabled={isFileUploading}
                    data-testid="button-insert-file"
                  >
                    {isFileUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Attach File</p></TooltipContent>
              </Tooltip>
              <input
                ref={fileUploadRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = "";
                }}
                data-testid="input-file-upload"
              />
              <ToolbarButton icon={Bookmark} label="Insert Bookmark Link" onClick={insertBookmarkLink} testId="button-insert-bookmark" />
              <ToolbarButton icon={Minus} label="Horizontal Rule" onClick={() => editor?.chain().focus().setHorizontalRule().run()} testId="button-hr" />

              <div className="w-px h-5 bg-border/40 mx-1 shrink-0" />

              <ComposeEmojiPicker
                onInsert={handleEmojiInsert}
                onGifSelect={handleGifInsert}
              />

              <div className="flex-1" />

              <ToolbarButton icon={Undo} label="Undo" shortcut="Ctrl+Z" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} testId="button-undo" />
              <ToolbarButton icon={Redo} label="Redo" shortcut="Ctrl+Shift+Z" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} testId="button-redo" />
            </div>

            <div className="relative min-h-[200px] sm:min-h-[300px]">
              <EditorContent editor={editor} />
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground/50 rounded-lg bg-card/30 dark:bg-card/10 border border-border/20 dark:border-primary/8" data-testid="editor-stats">
            <span className="font-mono tracking-wide">{wordCount} words · {readTime} min read</span>
            {hasUnsavedChanges && <span className="text-amber-500/70 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500/70 animate-pulse" />Unsaved changes</span>}
            {currentDraftId && !hasUnsavedChanges && <span className="text-green-500/70 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500/70" />Draft saved</span>}
          </div>
        </div>

        {showPreview && (
          <div className="hidden md:block">
            <ArticlePreview
              title={title}
              summary={summary}
              bannerUrl={bannerUrl}
              hashtags={hashtags}
              htmlContent={htmlContent}
            />
          </div>
        )}
      </div>

      {showPreview && (
        <div className="md:hidden">
          <ArticlePreview
            title={title}
            summary={summary}
            bannerUrl={bannerUrl}
            hashtags={hashtags}
            htmlContent={htmlContent}
          />
        </div>
      )}
    </div>
  );
}
