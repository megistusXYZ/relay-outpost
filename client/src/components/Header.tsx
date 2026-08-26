import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { LogIn, Rss, Code, LogOut, User, Users, Bookmark, Search } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { pubkey, profile, follows, isLoggingIn, login, logout } = useNostrAuth();
  const [location, setLocation] = useLocation();

  const displayName = profile?.display_name || profile?.name || null;
  const npub = pubkey ? shortenNpub(formatNpub(pubkey)) : null;
  const avatarUrl = profile?.picture;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-to-tr from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-bold text-sm">
              N
            </div>
            <span className="font-display font-bold text-lg tracking-tight hidden sm:block" data-testid="text-brand">
              Nostr
            </span>
          </Link>

          <nav className="flex items-center gap-1 flex-wrap" data-testid="nav-tabs">
            <Button
              variant={location === "/" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              asChild
              data-testid="button-tab-feed"
            >
              <Link href="/" data-testid="link-feed">
                <Rss className="w-4 h-4" />
                <span className="hidden sm:inline">Feed</span>
              </Link>
            </Button>
            <Button
              variant={location === "/generator" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              asChild
              data-testid="button-tab-generator"
            >
              <Link href="/generator" data-testid="link-generator">
                <Code className="w-4 h-4" />
                <span className="hidden sm:inline">Widget</span>
              </Link>
            </Button>
            <Button
              variant={location.startsWith("/search") ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              asChild
              data-testid="button-tab-search"
            >
              <Link href="/search" data-testid="link-search">
                <Search className="w-4 h-4" />
                <span className="hidden sm:inline">Search</span>
              </Link>
            </Button>
          </nav>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {pubkey ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="gap-2 px-2"
                  data-testid="button-user-menu"
                >
                  <Avatar className="w-7 h-7 border border-border">
                    <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
                    <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                      {displayName
                        ? displayName.slice(0, 2).toUpperCase()
                        : npub
                          ? npub.slice(0, 2).toUpperCase()
                          : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className="text-sm font-medium hidden sm:block max-w-[140px] truncate"
                    data-testid="text-user-name"
                  >
                    {displayName || npub}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                      <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
                      <AvatarFallback className="text-sm bg-muted text-muted-foreground">
                        <User className="w-4 h-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      {displayName && (
                        <span className="text-sm font-semibold truncate" data-testid="text-dropdown-name">
                          {displayName}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground truncate" data-testid="text-dropdown-npub">
                        {npub}
                      </span>
                    </div>
                  </div>
                </div>
                {follows.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={() => setLocation("/following")}
                      data-testid="container-follow-count"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span className="text-xs">
                        Following <span className="font-medium">{follows.length}</span>
                      </span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 cursor-pointer"
                  onClick={() => setLocation("/bookmarks")}
                  data-testid="button-bookmarks-nav"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span className="text-xs">Bookmarks</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="gap-2 cursor-pointer"
                  data-testid="button-logout"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={login}
              size="sm"
              disabled={isLoggingIn}
              data-testid="button-login"
            >
              {isLoggingIn ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-1.5" />
              ) : (
                <LogIn className="w-4 h-4 mr-1.5" />
              )}
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
