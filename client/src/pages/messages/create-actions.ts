import { Compass, Link2, MessageSquarePlus, ScanLine, Users, type LucideIcon } from "lucide-react";

/**
 * The "start something new" actions, in one place.
 *
 * ChatList had already folded its own three surfaces (desktop dropdown, mobile
 * sheet, empty state) into a single array — but the Messages page's right-hand
 * "Your messages" card was a FOURTH, hand-written copy that the fold missed,
 * down to a comment describing "the four actions". So when Find-a-community was
 * added it landed in three surfaces out of four, and the widest screen — the one
 * with the most room for it — was the one that didn't offer it.
 *
 * Hence a module rather than a local const: a surface has to import the list to
 * render it, which is a much harder thing to forget than keeping two JSX blocks
 * in sync.
 */
export interface CreateAction {
  key: string;
  /** Suffix for the surface's own data-testid (`menu-`, `button-…-empty`, …). */
  testId: string;
  Icon: LucideIcon;
  label: string;
  desc: string;
  run: () => void;
}

export interface CreateActionHandlers {
  /** Group chat is the ONLY conditional action — everything else always shows. */
  canCreateGroup: boolean;
  onNewChat: () => void;
  onNewGroup: () => void;
  onJoinLink: () => void;
  onScanQr: () => void;
  onFindCommunity: () => void;
}

export function buildCreateActions(h: CreateActionHandlers): CreateAction[] {
  return [
    {
      key: "new-chat",
      testId: "new-chat",
      Icon: MessageSquarePlus,
      label: "New chat",
      desc: "Message someone directly",
      run: h.onNewChat,
    },
    // Only THIS one depends on group chats being available. Join-via-link and
    // Scan-QR must survive the gate: they were once nested inside it, which
    // silently removed the only doors to either in the whole app.
    ...(h.canCreateGroup
      ? [{
          key: "new-group-chat",
          testId: "new-group-chat",
          Icon: Users,
          label: "New group chat",
          desc: "Start a private group and invite by link",
          run: h.onNewGroup,
        }]
      : []),
    {
      key: "join-via-link",
      testId: "join-link",
      Icon: Link2,
      label: "Join via link",
      desc: "Paste an invite from any app",
      run: h.onJoinLink,
    },
    {
      key: "scan-qr",
      testId: "scan-qr",
      Icon: ScanLine,
      label: "Scan QR code",
      desc: "Join a group or open a profile",
      run: h.onScanQr,
    },
    // Sits beside Join-via-link and Scan-QR because those are the other two
    // "arrive somewhere new" actions; browsing is their missing sibling. Under
    // the collapsed IA this is the only link to the communities hub from Chats —
    // footer-nav already hands Chats the whole /outposts namespace, but nothing
    // here pointed at it.
    {
      key: "find-community",
      testId: "find-community",
      Icon: Compass,
      label: "Find a community",
      desc: "Browse or paste a relay link",
      run: h.onFindCommunity,
    },
  ];
}
