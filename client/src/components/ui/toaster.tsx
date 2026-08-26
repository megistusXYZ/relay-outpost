import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertTriangle, Radio, Copy, Bookmark, Send, LogIn, LogOut, UserX, Zap, Info } from "lucide-react"

function getToastIcon(title: string | undefined, variant: string | undefined) {
  if (!title) return <Radio className="w-4 h-4 text-brand/80 shrink-0" />;
  const t = typeof title === "string" ? title.toLowerCase() : "";

  if (variant === "destructive") {
    return <AlertTriangle className="w-4 h-4 shrink-0" />;
  }

  if (t.includes("copied") || t.includes("copy")) return <Copy className="w-4 h-4 text-brand/80 shrink-0" />;
  if (t.includes("zap")) return <Zap className="w-4 h-4 text-amber-800/90 dark:text-amber-400/90 shrink-0" />;
  if (t.includes("bookmark") || t.includes("saved")) return <Bookmark className="w-4 h-4 text-brand/80 shrink-0" />;
  if (t.includes("signed in") || t.includes("connected")) return <LogIn className="w-4 h-4 text-green-800/80 dark:text-green-400/80 shrink-0" />;
  if (t.includes("signed out")) return <LogOut className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (t.includes("published") || t.includes("reply sent") || t.includes("repost") || t.includes("liked") || t.includes("quote")) return <Send className="w-4 h-4 text-brand/80 shrink-0" />;
  if (t.includes("muted") || t.includes("mute")) return <UserX className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (t.includes("already")) return <Info className="w-4 h-4 text-muted-foreground shrink-0" />;

  return <CheckCircle2 className="w-4 h-4 text-green-800/80 dark:text-green-400/80 shrink-0" />;
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, customIcon, ...props }) {
        const icon = customIcon || getToastIcon(
          typeof title === "string" ? title : undefined,
          variant ?? undefined
        );

        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex items-start gap-3">
              {icon}
              <div className="grid gap-1 flex-1 min-w-0">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
