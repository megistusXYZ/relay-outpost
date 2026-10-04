import * as React from "react"

const MOBILE_BREAKPOINT = 768

const readIsMobile = () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT

export function useIsMobile() {
  // Known from the first render. Starting at "not a phone" and correcting in an
  // effect drew the desktop version for a frame, then replaced it — the phone
  // reply box was built twice, and what you typed in between was lost or landed
  // at the start ("e, latert"; owner, 2026-10-04).
  const [isMobile, setIsMobile] = React.useState<boolean>(readIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(readIsMobile())
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
