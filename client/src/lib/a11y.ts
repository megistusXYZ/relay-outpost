// Shared keyboard-focus ring for raw <button>/<a> elements that don't inherit
// one. Mirrors shadcn's Button focus styling (ui/button.tsx) so focus looks
// consistent app-wide. Append to a className when an interactive element isn't a
// shadcn <Button>. Per the visual-design skill: every interactive element needs
// a visible focus state for keyboard navigation.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
