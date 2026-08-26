import { useEffect, useRef, useState, useCallback } from "react";
import { Rocket, Radio, ShieldCheck, Lock, ArrowLeft, Eye, EyeOff, UserPlus, ChevronDown, HelpCircle } from "lucide-react";
import { LoginOptions } from "@/components/LoginOptions";
import { LandingMarketing } from "@/components/landing/LandingMarketing";
import { RotatingTagline } from "@/components/landing/RotatingTagline";
import { PublicBetaBadge } from "@/components/PublicBetaBadge";
import { AmbientVideo } from "@/components/landing/HeroAmbientVideo";
import { loadSignupDraft } from "@/lib/account-draft";
import { trackSignupEvent } from "@/lib/signup-telemetry";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface ClassicStar {
  x: number;
  y: number;
  z: number;
  pz: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface Nebula {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  driftX: number;
  driftY: number;
  phase: number;
}

interface Dust {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  speed: number;
}

const CLASSIC_STAR_COLORS = [
  "rgba(180,180,255,",
  "rgba(200,200,255,",
  "rgba(160,140,255,",
  "rgba(220,200,255,",
  "rgba(140,160,255,",
  "rgba(255,220,240,",
];

const NEBULA_PALETTES = [
  { r: 30, g: 15, b: 60 },
  { r: 20, g: 10, b: 50 },
  { r: 15, g: 20, b: 45 },
  { r: 40, g: 15, b: 50 },
  { r: 10, g: 15, b: 40 },
  { r: 25, g: 10, b: 35 },
  { r: 12, g: 18, b: 35 },
  { r: 35, g: 12, b: 45 },
];

function createClassicStar(w: number, h: number, maxZ: number): ClassicStar {
  return {
    x: (Math.random() - 0.5) * w * 2,
    y: (Math.random() - 0.5) * h * 2,
    z: Math.random() * maxZ,
    pz: 0,
    color: CLASSIC_STAR_COLORS[Math.floor(Math.random() * CLASSIC_STAR_COLORS.length)] };
}

function createStar(w: number, h: number): Star {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    z: Math.random(),
    size: Math.random() * 1.5 + 0.3,
    brightness: Math.random() * 0.6 + 0.2,
    twinkleSpeed: Math.random() * 0.003 + 0.001,
    twinkleOffset: Math.random() * Math.PI * 2 };
}

function createNebula(w: number, h: number): Nebula {
  const palette = NEBULA_PALETTES[Math.floor(Math.random() * NEBULA_PALETTES.length)];
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    radius: Math.random() * 300 + 150,
    r: palette.r + Math.floor(Math.random() * 15 - 7),
    g: palette.g + Math.floor(Math.random() * 10 - 5),
    b: palette.b + Math.floor(Math.random() * 15 - 7),
    alpha: Math.random() * 0.06 + 0.02,
    driftX: (Math.random() - 0.5) * 0.15,
    driftY: (Math.random() - 0.5) * 0.1,
    phase: Math.random() * Math.PI * 2 };
}

function createDust(w: number, h: number): Dust {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    z: Math.random(),
    size: Math.random() * 2 + 0.5,
    alpha: Math.random() * 0.08 + 0.02,
    speed: Math.random() * 0.2 + 0.05 };
}

interface GalaxyWarpOverlayProps {
  mode: "full" | "cockpit" | "dimmed" | "hidden" | "warping_to_cockpit";
  onLaunch: () => void;
  onWarpStarted?: () => void;
  onWarpComplete: () => void;
  onDimmedSignIn: () => void;
  onCockpitBack?: () => void;
  onWarpToCockpitComplete?: () => void;
}

// Closed-beta gate. Off by default (public). Re-enable a private beta with VITE_BETA_GATE=1
// at build time; the modal UI and the /api/beta/verify route stay intact behind this flag.
const BETA_GATE_ENABLED = import.meta.env.VITE_BETA_GATE === "1";

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function GalaxyWarpOverlay({ mode, onLaunch, onWarpStarted, onWarpComplete, onDimmedSignIn, onCockpitBack, onWarpToCockpitComplete }: GalaxyWarpOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const classicStarsRef = useRef<ClassicStar[]>([]);
  const starsRef = useRef<Star[]>([]);
  const nebulaeRef = useRef<Nebula[]>([]);
  const dustRef = useRef<Dust[]>([]);
  const speedRef = useRef(0);
  const classicSpeedRef = useRef(0.3);
  const warpingRef = useRef(false);
  const modeRef = useRef(mode);
  const frameRef = useRef(0);
  const crossfadeRef = useRef(0);
  const [warping, setWarping] = useState(false);
  const [collapsePhase, setCollapsePhase] = useState<"idle" | "in" | "out">("idle");
  const collapsedInRef = useRef(false);
  const [charging, setCharging] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(mode !== "hidden");
  const [showBetaGate, setShowBetaGate] = useState(false);
  const [betaCode, setBetaCode] = useState("");
  const [betaError, setBetaError] = useState("");
  const [betaVerifying, setBetaVerifying] = useState(false);
  const [betaCodeVisible, setBetaCodeVisible] = useState(false);
  const { pubkey } = useNostrAuth();
  const prevPubkeyRef = useRef(pubkey);
  const warpToCockpitFiredRef = useRef(false);
  const starfieldPausedRef = useRef(false);
  const starfieldKickRef = useRef<() => void>(() => {});
  const pastHeroRef = useRef(false);

  modeRef.current = mode;

  // Pause the starfield canvas when the tab is hidden or the landing is
  // scrolled past the hero — no point spending rAF/GPU on an off-screen
  // backdrop. Reads modeRef so the callback stays stable (no effect churn).
  const recomputeStarfieldPaused = useCallback(() => {
    const next = (typeof document !== "undefined" && document.hidden) || (modeRef.current === "full" && pastHeroRef.current);
    if (next === starfieldPausedRef.current) return;
    starfieldPausedRef.current = next;
    if (!next) starfieldKickRef.current();
  }, []);

  // Re-evaluate when the overlay mode changes — e.g. launching from the footer
  // CTA (scrolled past the hero) must un-pause so the warp actually animates.
  useEffect(() => { recomputeStarfieldPaused(); }, [mode, recomputeStarfieldPaused]);

  // Funnel telemetry: the marketing landing was shown (deduped per page load).
  useEffect(() => { if (mode === "full") trackSignupEvent("landing_viewed"); }, [mode]);

  useEffect(() => {
    if (mode !== "warping_to_cockpit") {
      warpToCockpitFiredRef.current = false;
      return;
    }
    if (warpToCockpitFiredRef.current) return;
    warpToCockpitFiredRef.current = true;

    // Standard, enterprise-calm transition into the sign-in screen: a quick
    // crossfade to the cockpit — no warp ramp, no violet black-hole/ring
    // collapse (that read as too much). Reduced motion uses the same path.
    const t = setTimeout(() => {
      warpToCockpitFiredRef.current = false;
      if (modeRef.current === "warping_to_cockpit") onWarpToCockpitComplete?.();
    }, 250);
    return () => { clearTimeout(t); warpToCockpitFiredRef.current = false; };
  }, [mode, onWarpToCockpitComplete]);

  useEffect(() => {
    if (prevPubkeyRef.current === null && pubkey && mode === "cockpit") {
      onWarpStarted?.();
      // Always a quick, calm fade into the app on sign-in — no wormhole / ring
      // collapse anywhere, including a brand-new account's first sign-in.
      try { sessionStorage.removeItem("ro_new_account_warp"); } catch {}
      setFadeOut(true);
      setTimeout(() => onWarpComplete(), 250);
    }
    prevPubkeyRef.current = pubkey;
  }, [pubkey, mode, onWarpStarted, onWarpComplete]);

  useEffect(() => {
    if (mode === "hidden") {
      setFadeOut(false);
      setWarping(false);
      warpingRef.current = false;
      const t = setTimeout(() => setVisible(false), 600);
      return () => clearTimeout(t);
    } else if (mode === "warping_to_cockpit") {
      setVisible(true);
      setFadeOut(false);
    } else {
      setVisible(true);
      setFadeOut(false);
      setWarping(false);
      warpingRef.current = false;
      speedRef.current = 0;
      if (mode === "cockpit" && collapsedInRef.current) {
        // We arrived here through the black-hole collapse — open it back out so
        // the create-account screen emerges from the singularity, then unmount.
        collapsedInRef.current = false;
        setCollapsePhase("out");
        const t = setTimeout(() => setCollapsePhase("idle"), 520);
        return () => clearTimeout(t);
      }
      collapsedInRef.current = false;
      setCollapsePhase("idle");
    }
  }, [mode]);

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CLASSIC_MAX_Z = 1000;

    const isMobile = window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
    const classicStarCount = isMobile ? 150 : 500;
    const nebulaStarCount = isMobile ? 100 : 350;
    const nebulaCount = isMobile ? 3 : 8;
    const dustCount = isMobile ? 20 : 80;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const w = canvas.width;
      const h = canvas.height;
      if (classicStarsRef.current.length === 0) {
        classicStarsRef.current = Array.from({ length: classicStarCount }, () => createClassicStar(w, h, CLASSIC_MAX_Z));
      }
      if (starsRef.current.length === 0) {
        starsRef.current = Array.from({ length: nebulaStarCount }, () => createStar(w, h));
        nebulaeRef.current = Array.from({ length: nebulaCount }, () => createNebula(w, h));
        dustRef.current = Array.from({ length: dustCount }, () => createDust(w, h));
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const drawClassicStarfield = (w: number, h: number, cx: number, cy: number) => {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);

      const speed = classicSpeedRef.current;
      const isWarp = warpingRef.current;

      for (let i = 0; i < classicStarsRef.current.length; i++) {
        const star = classicStarsRef.current[i];
        star.pz = star.z;
        star.z -= speed * (isWarp ? 40 : 1);

        if (star.z <= 0) {
          star.x = (Math.random() - 0.5) * w * 2;
          star.y = (Math.random() - 0.5) * h * 2;
          star.z = CLASSIC_MAX_Z;
          star.pz = CLASSIC_MAX_Z;
        }

        const sx = (star.x / star.z) * (w * 0.5) + cx;
        const sy = (star.y / star.z) * (h * 0.5) + cy;
        const px = (star.x / star.pz) * (w * 0.5) + cx;
        const py = (star.y / star.pz) * (h * 0.5) + cy;

        const depth = 1 - star.z / CLASSIC_MAX_Z;
        const alpha = isWarp
          ? Math.min(1, depth * 1.5 + 0.3)
          : depth * 0.9 + 0.1;
        const lineWidth = isWarp ? depth * 3 + 0.5 : depth * 1.8 + 0.3;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.strokeStyle = star.color + alpha.toFixed(3) + ")";
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        if (!isWarp && depth > 0.7) {
          const dotSize = depth * 2;
          ctx.beginPath();
          ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
          ctx.fillStyle = star.color + (alpha * 0.6).toFixed(3) + ")";
          ctx.fill();
        }
      }

      if (isWarp) {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
        gradient.addColorStop(0, "rgba(80,40,160,0.04)");
        gradient.addColorStop(0.5, "rgba(40,20,120,0.02)");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const drawNebulaStarfield = (w: number, h: number, cx: number, cy: number, frame: number) => {
      const currentMode = modeRef.current;
      const isDimmed = currentMode === "dimmed";
      const isCockpit = currentMode === "cockpit";
      const isWarp = warpingRef.current;
      const speed = speedRef.current;

      ctx.fillStyle = "rgba(3, 3, 12, 0.15)";
      ctx.fillRect(0, 0, w, h);

      const dimFactor = isDimmed ? 0.25 : (isCockpit ? 0.5 : 1);

      for (let i = 0; i < nebulaeRef.current.length; i++) {
        const neb = nebulaeRef.current[i];
        const breathe = Math.sin(frame * 0.002 + neb.phase) * 0.3 + 0.7;
        const currentAlpha = neb.alpha * breathe * dimFactor;

        if (isWarp) {
          neb.x += neb.driftX * speed * 3;
          neb.y += neb.driftY * speed * 3;
        } else {
          neb.x += neb.driftX;
          neb.y += neb.driftY;
        }

        if (neb.x < -neb.radius) neb.x = w + neb.radius;
        if (neb.x > w + neb.radius) neb.x = -neb.radius;
        if (neb.y < -neb.radius) neb.y = h + neb.radius;
        if (neb.y > h + neb.radius) neb.y = -neb.radius;

        const warpStretch = isWarp ? 1 + speed * 0.15 : 1;
        const rX = neb.radius * warpStretch;
        const rY = neb.radius / warpStretch;

        const grad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, Math.max(rX, rY));
        grad.addColorStop(0, `rgba(${neb.r}, ${neb.g}, ${neb.b}, ${(currentAlpha * 1.5).toFixed(4)})`);
        grad.addColorStop(0.4, `rgba(${neb.r}, ${neb.g}, ${neb.b}, ${(currentAlpha * 0.8).toFixed(4)})`);
        grad.addColorStop(0.7, `rgba(${neb.r}, ${neb.g}, ${neb.b}, ${(currentAlpha * 0.3).toFixed(4)})`);
        grad.addColorStop(1, "transparent");

        ctx.save();
        if (isWarp) {
          const angle = Math.atan2(neb.y - cy, neb.x - cx);
          ctx.translate(neb.x, neb.y);
          ctx.rotate(angle);
          ctx.scale(warpStretch, 1 / warpStretch);
          ctx.translate(-neb.x, -neb.y);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(neb.x - Math.max(rX, rY), neb.y - Math.max(rX, rY), Math.max(rX, rY) * 2, Math.max(rX, rY) * 2);
        ctx.restore();
      }

      for (let i = 0; i < dustRef.current.length; i++) {
        const d = dustRef.current[i];
        const dustAlpha = d.alpha * dimFactor;

        if (isWarp) {
          const dx = d.x - cx;
          const dy = d.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          d.x += (dx / dist) * speed * 2;
          d.y += (dy / dist) * speed * 2;
        } else {
          d.x += d.speed * 0.3;
          d.y += Math.sin(frame * 0.005 + d.z * 10) * 0.1;
        }

        if (d.x > w + 10) d.x = -10;
        if (d.x < -10) d.x = w + 10;
        if (d.y > h + 10) d.y = -10;
        if (d.y < -10) d.y = h + 10;

        const warpDustSize = isWarp ? d.size * (1 + speed * 0.3) : d.size;
        ctx.beginPath();
        ctx.arc(d.x, d.y, warpDustSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120, 100, 160, ${dustAlpha.toFixed(4)})`;
        ctx.fill();
      }

      for (let i = 0; i < starsRef.current.length; i++) {
        const star = starsRef.current[i];
        const twinkle = Math.sin(frame * star.twinkleSpeed + star.twinkleOffset);
        const alpha = (star.brightness + twinkle * 0.15) * dimFactor;

        if (isWarp) {
          const dx = star.x - cx;
          const dy = star.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const moveSpeed = speed * (0.5 + star.z * 2);
          star.x += (dx / dist) * moveSpeed;
          star.y += (dy / dist) * moveSpeed;

          if (star.x < -20 || star.x > w + 20 || star.y < -20 || star.y > h + 20) {
            star.x = cx + (Math.random() - 0.5) * w * 0.5;
            star.y = cy + (Math.random() - 0.5) * h * 0.5;
          }

          const trailLen = Math.min(speed * 1.5, 8);
          const trailEndX = star.x - (dx / dist) * trailLen;
          const trailEndY = star.y - (dy / dist) * trailLen;

          ctx.beginPath();
          ctx.moveTo(trailEndX, trailEndY);
          ctx.lineTo(star.x, star.y);
          ctx.strokeStyle = `rgba(180, 175, 200, ${(alpha * 0.4).toFixed(4)})`;
          ctx.lineWidth = star.size * 0.6;
          ctx.stroke();
        }

        const currentSize = isWarp ? star.size * (1 + speed * 0.08) : star.size;
        ctx.beginPath();
        ctx.arc(star.x, star.y, currentSize, 0, Math.PI * 2);
        const starAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = `rgba(200, 195, 220, ${starAlpha.toFixed(4)})`;
        ctx.fill();

        if (!isWarp && star.brightness > 0.6 && !isDimmed) {
          ctx.beginPath();
          ctx.arc(star.x, star.y, currentSize * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(160, 150, 200, ${(starAlpha * 0.08).toFixed(4)})`;
          ctx.fill();
        }
      }

      if (isWarp) {
        const mistGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.5);
        mistGrad.addColorStop(0, `rgba(20, 12, 40, ${(0.03 + speed * 0.01).toFixed(4)})`);
        mistGrad.addColorStop(0.6, `rgba(15, 10, 35, ${(0.02 + speed * 0.005).toFixed(4)})`);
        mistGrad.addColorStop(1, "transparent");
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, 0, w, h);
      }

      const vignetteGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75);
      vignetteGrad.addColorStop(0, "transparent");
      vignetteGrad.addColorStop(1, "rgba(0, 0, 5, 0.4)");
      ctx.fillStyle = vignetteGrad;
      ctx.fillRect(0, 0, w, h);
    };

    const animate = () => {
      if (!ctx || !canvas) return;
      if (starfieldPausedRef.current) { animRef.current = 0; return; }
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const currentMode = modeRef.current;
      frameRef.current++;
      const frame = frameRef.current;

      const useClassic = currentMode === "full";
      const isTransitioning = currentMode === "warping_to_cockpit";

      if (useClassic && !isTransitioning) {
        crossfadeRef.current = Math.max(0, crossfadeRef.current - 0.02);
        drawClassicStarfield(w, h, cx, cy);
      } else if (isTransitioning) {
        crossfadeRef.current = Math.min(1, crossfadeRef.current + 0.025);
        const cf = crossfadeRef.current;

        if (cf < 1) {
          drawClassicStarfield(w, h, cx, cy);
        }

        if (cf > 0) {
          ctx.save();
          ctx.globalAlpha = cf;
          drawNebulaStarfield(w, h, cx, cy, frame);
          ctx.restore();
        }
      } else {
        crossfadeRef.current = 1;
        drawNebulaStarfield(w, h, cx, cy, frame);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    // Restart the loop after an idle pause (tab re-shown / scrolled back up).
    const kick = () => {
      if (!starfieldPausedRef.current && !animRef.current) {
        animRef.current = requestAnimationFrame(animate);
      }
    };
    starfieldKickRef.current = kick;

    const onVisibility = () => recomputeStarfieldPaused();
    document.addEventListener("visibilitychange", onVisibility);

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
    };
  }, [visible, recomputeStarfieldPaused]);

  const hasBetaAccess = useCallback(() => {
    try {
      return localStorage.getItem("relay_outpost_beta") === "granted";
    } catch { return false; }
  }, []);

  const handleLaunch = useCallback(() => {
    if (warping) return;
    trackSignupEvent("launch_clicked");
    if (BETA_GATE_ENABLED && !hasBetaAccess()) {
      setShowBetaGate(true);
      setBetaError("");
      setBetaCode("");
      return;
    }
    // Reduced motion: no tactile charge, just go.
    if (prefersReducedMotion()) { onLaunch(); return; }
    // Tactile launch: a light haptic on mobile + a brief "charge" burst on the
    // button, then the warp kicks in ~160ms later so the press is felt.
    try { navigator.vibrate?.(15); } catch {}
    setCharging(true);
    window.setTimeout(() => { setCharging(false); onLaunch(); }, 160);
  }, [warping, onLaunch, hasBetaAccess]);

  const handleBetaSubmit = useCallback(async () => {
    if (!betaCode.trim() || betaVerifying) return;
    setBetaVerifying(true);
    setBetaError("");
    try {
      const res = await fetch("/api/beta/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: betaCode.trim() }) });
      let data: { valid?: boolean; error?: string };
      try {
        data = await res.json();
      } catch {
        setBetaError("Unexpected server response. Try again.");
        setBetaVerifying(false);
        return;
      }
      if (data.valid) {
        try { localStorage.setItem("relay_outpost_beta", "granted"); } catch {}
        setShowBetaGate(false);
        onLaunch();
      } else {
        setBetaError(data.error || "Invalid access code");
      }
    } catch {
      setBetaError("Connection failed. Try again.");
    } finally {
      setBetaVerifying(false);
    }
  }, [betaCode, betaVerifying, onLaunch]);

  const landingSectionsRef = useRef<HTMLDivElement>(null);
  const scrollToSections = useCallback(() => {
    landingSectionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!visible && mode === "hidden") return null;

  const isFull = mode === "full";
  const isDimmed = mode === "dimmed";
  const isCockpit = mode === "cockpit";
  const isHiding = mode === "hidden";
  const isWarpingToCockpit = mode === "warping_to_cockpit";

  return (
    <div
      className={`fixed inset-0 z-[100] transition-opacity ${isHiding ? "duration-600" : "duration-500"} ${fadeOut || isHiding ? "opacity-0" : "opacity-100"}`}
      style={{ pointerEvents: (isFull || isDimmed || isCockpit || isWarpingToCockpit) ? "auto" : "none" }}
      data-testid="galaxy-warp-overlay"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: "black" }}
      />
      {/* Black-hole transition at the warp apex — a violet event horizon closes
          inward to black (no harsh flash), then opens back out to reveal the
          create-account screen from the singularity. pointer-events-none. */}
      {collapsePhase !== "idle" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[120] overflow-hidden">
          <div className={`blackhole-layer ${collapsePhase === "in" ? "is-closing" : "is-opening"}`} />
        </div>
      )}
      {isFull && !warping && (
        <div className="hero-intro-glow absolute inset-0 z-0 pointer-events-none" aria-hidden />
      )}
      {isDimmed && (
        <div className="absolute inset-0 bg-black/60" />
      )}
      {isCockpit && (
        <div className="absolute inset-0 bg-black/50" />
      )}
      {isCockpit && (
        <div
          aria-hidden
          className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center"
          style={{
            backgroundImage: "url(/images/landing/cockpit-bg.webp)",
            opacity: 0.1,
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 24%, #000 50%, transparent 82%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, #000 24%, #000 50%, transparent 82%)",
          }}
        />
      )}
      {isFull && !warping && (
        <div
          className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden"
          data-testid="landing-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            pastHeroRef.current = el.scrollTop > el.clientHeight * 0.85;
            recomputeStarfieldPaused();
          }}
        >
        <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 py-16">
          <AmbientVideo side="right" src="/videos/hero-ambient.mp4" mobileSrc="/videos/hero-ambient-mobile.mp4" poster="/images/landing/hero-ambient-poster.webp" mobilePoster="/images/landing/hero-ambient-mobile-poster.webp" />
          {/* Public-beta stamp — small badge in the top-left, clickable to the brief. */}
          <div className="absolute left-3 top-3 z-20 w-[64px] sm:left-6 sm:top-6 sm:w-[92px]">
            <PublicBetaBadge variant="landing-stamp" />
          </div>
          <div className="relative z-10 flex flex-col items-center gap-5 sm:gap-7 md:gap-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <div className="flex items-center rounded-md overflow-hidden brand-flicker">
              <div className="flex items-center bg-black/80 pl-3 pr-1.5 sm:pl-4 sm:pr-2 h-10 sm:h-12 border-2 border-r-0 border-white/60 rounded-l-md">
                <span className="font-brand font-bold text-base sm:text-lg tracking-[0.2em] text-white uppercase leading-none">Relay</span>
              </div>
              <div className="flex items-center justify-center h-10 sm:h-12 bg-black/80 border-y-2 border-white/60">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 sm:w-9 sm:h-9">
                  <g clipPath="url(#clip0_warp)">
                    <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="white" />
                    <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="white" />
                  </g>
                  <defs><clipPath id="clip0_warp"><rect width="24" height="24" /></clipPath></defs>
                </svg>
              </div>
              <div className="flex items-center bg-black/80 pl-1.5 pr-3 sm:pl-2 sm:pr-4 h-10 sm:h-12 border-2 border-l-0 border-white/60 rounded-r-md">
                <span className="font-brand font-bold text-base sm:text-lg tracking-[0.2em] text-white uppercase leading-none">Outpost</span>
              </div>
            </div>

            {/* Hero statement group: a de-emphasized rotating eyebrow, the
                primary tagline (the focal line), and one concise subline.
                Grouped tightly so the parent gap separates it cleanly from the
                logo above and the CTAs below. */}
            <div className="flex flex-col items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2.5">
                <div className="h-px w-5 sm:w-8 bg-gradient-to-r from-transparent to-white/15" />
                <p className="text-[9px] sm:text-[10px] font-brand uppercase tracking-[0.3em] text-white/40">
                  <RotatingTagline />
                </p>
                <div className="h-px w-5 sm:w-8 bg-gradient-to-l from-transparent to-white/15" />
              </div>

              <h1 className="max-w-xl text-balance text-center font-brand text-2xl sm:text-3xl md:text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-white">
                One outpost for everything you{" "}
                <span className="text-brand drop-shadow-[0_0_18px_rgba(139,92,246,0.5)]">say.</span>
              </h1>

              <p className="max-w-md text-center text-sm sm:text-base leading-relaxed text-white/70">
                Post, chat, connect — one account.
              </p>
            </div>

            <div className="mt-1 flex flex-col items-center gap-3 sm:mt-2 sm:flex-row sm:gap-3">
              <button
                onClick={handleLaunch}
                className={`group relative flex items-center gap-2.5 sm:gap-3 px-7 sm:px-9 py-3 sm:py-3.5 rounded-md bg-brand hover:bg-brand active:scale-[0.97] transition-all duration-300 cursor-pointer ${charging ? "scale-[1.05] shadow-[0_0_0_2px_rgba(196,181,253,0.95),0_0_44px_4px_rgba(124,58,237,1)]" : "shadow-[0_0_0_1px_rgba(167,139,250,0.45),0_10px_34px_-8px_rgba(124,58,237,0.7)] hover:shadow-[0_0_0_1px_rgba(196,181,253,0.65),0_12px_42px_-8px_rgba(124,58,237,0.9)]"}`}
                data-testid="button-engage-warp"
              >
                <Rocket className="w-4 h-4 sm:w-5 sm:h-5 text-white -rotate-45 relative z-10" />
                <span className="font-brand font-semibold text-sm sm:text-base tracking-[0.25em] sm:tracking-[0.3em] uppercase text-white relative z-10">
                  Get Started
                </span>
              </button>

              <button
                onClick={scrollToSections}
                className="group flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-md border border-white/15 bg-white/[0.02] text-white/70 hover:border-white/30 hover:bg-white/[0.06] hover:text-white transition-all duration-300 cursor-pointer"
                data-testid="button-what-is-this"
              >
                <HelpCircle className="w-4 h-4" />
                <span className="font-brand text-sm sm:text-base tracking-[0.2em] uppercase">What is this?</span>
              </button>
            </div>

            <p className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.25em] sm:tracking-[0.3em] text-white/45">
              No email or phone number required
            </p>

            {/* Resume signup chip — surfaces only if the user previously
                started creating an account and the page got reset (mobile
                eviction, accidental reload, etc.). Tapping it warps into
                the cockpit so CreateAccountFlow can hydrate the draft. */}
            {(() => {
              const draft = loadSignupDraft();
              if (!draft) return null;
              const draftName = draft.displayName?.trim();
              const hasResumableContent = Boolean(
                draftName || draft.username?.trim() || draft.bio?.trim() ||
                draft.picture || draft.banner || draft.nip05?.trim() ||
                draft.website?.trim() || draft.rss?.trim() ||
                draft.lud16?.trim() || draft.account?.secretKeyHex,
              );
              if (!hasResumableContent) return null;
              // Fire `resume_chip_shown` exactly once per page load. The
              // helper itself dedups, but render functions can run many
              // times — keeping the call here (instead of useEffect) is
              // the simplest way to capture "the chip was eligible to be
              // seen at all this session".
              trackSignupEvent("resume_chip_shown");
              return (
                <button
                  onClick={() => {
                    trackSignupEvent("resume_chip_tapped");
                    handleLaunch();
                  }}
                  data-testid="button-resume-signup"
                  className="group mt-3 flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-brand/30 bg-brand/[0.08] hover:border-brand/50 hover:bg-brand/[0.14] active:scale-[0.97] transition-all"
                >
                  <UserPlus className="w-3 h-3 text-brand/80 group-hover:text-brand-strong transition-colors" />
                  <span className="font-brand text-[10px] sm:text-[11px] tracking-[0.2em] uppercase text-brand/80 group-hover:text-brand-strong transition-colors">
                    Resume signup{draftName ? ` as ${draftName}` : ""}
                  </span>
                </button>
              );
            })()}
          </div>

          <button
            onClick={scrollToSections}
            className="absolute bottom-6 flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors cursor-pointer"
            data-testid="button-scroll-cue"
            aria-label="See what Relay Outpost unlocks"
          >
            <span className="text-[10px] font-mono uppercase tracking-[0.3em]">Discover</span>
            <ChevronDown className="w-4 h-4 animate-bounce" />
          </button>
        </div>

        <div ref={landingSectionsRef}>
          <LandingMarketing onLaunch={handleLaunch} />
        </div>
        </div>
      )}
      {isFull && BETA_GATE_ENABLED && showBetaGate && !warping && (
        <div className="absolute inset-0 flex items-center justify-center z-20 px-5">
          <div className="animate-in fade-in-0 zoom-in-95 duration-300 w-full max-w-[340px] sm:max-w-sm">
            <div
              className="relative rounded-lg border border-brand/30 overflow-hidden"
              style={{
                background: "linear-gradient(135deg, hsl(260 30% 6% / 0.95) 0%, hsl(270 25% 10% / 0.95) 50%, hsl(240 20% 6% / 0.95) 100%)",
                backdropFilter: "blur(20px)" }}
            >
              <div className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                  background: "radial-gradient(ellipse at 50% 0%, hsl(270 60% 30% / 0.5) 0%, transparent 60%), radial-gradient(ellipse at 50% 100%, hsl(220 50% 20% / 0.3) 0%, transparent 50%)" }}
              />
              <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
                style={{
                  backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.1) 1px, rgba(255,255,255,0.1) 2px)",
                  backgroundSize: "100% 2px" }}
              />

              <div className="relative p-5 sm:p-6 flex flex-col items-center gap-4 sm:gap-5">
                <button
                  onClick={() => setShowBetaGate(false)}
                  className="absolute top-3 left-3 p-1 text-white/60 hover:text-white transition-colors"
                  data-testid="button-beta-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-brand/30 bg-brand/10">
                  <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-brand/80" />
                </div>

                <div className="text-center">
                  <h2 className="font-brand font-bold text-sm sm:text-base tracking-[0.15em] uppercase text-white/90">
                    Beta Access
                  </h2>
                  <p className="text-[11px] sm:text-xs text-white/70 mt-1.5 leading-relaxed max-w-[260px] mx-auto">
                    This station is in closed beta. Enter your access code to proceed.
                  </p>
                </div>

                <div className="w-full space-y-3">
                  <div className="relative">
                    <input
                      type={betaCodeVisible ? "text" : "password"}
                      value={betaCode}
                      onChange={(e) => {
                        setBetaCode(e.target.value);
                        if (betaError) setBetaError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleBetaSubmit();
                      }}
                      placeholder="Enter access code"
                      autoFocus
                      className="w-full px-4 py-3 pr-10 rounded-md bg-white/[0.05] border border-white/15 text-white/90 text-sm font-mono tracking-wider placeholder:text-white/20 focus:outline-none focus:border-brand/50 focus:bg-white/[0.08] transition-all"
                      data-testid="input-beta-code"
                    />
                    <button
                      type="button"
                      onClick={() => setBetaCodeVisible(!betaCodeVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/60 transition-colors"
                      data-testid="button-beta-reveal"
                      tabIndex={-1}
                    >
                      {betaCodeVisible ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {betaError && (
                    <p className="text-xs text-red-700/90 dark:text-red-400/90 text-center animate-in fade-in-0 slide-in-from-top-1 duration-200" data-testid="text-beta-error">
                      {betaError}
                    </p>
                  )}

                  <button
                    onClick={handleBetaSubmit}
                    disabled={!betaCode.trim() || betaVerifying}
                    className="group relative w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-md border border-brand/30 bg-brand/10 hover:bg-brand/20 hover:border-brand/50 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all duration-300 cursor-pointer"
                    data-testid="button-beta-submit"
                  >
                    <div className="absolute inset-0 rounded-md bg-gradient-to-r from-brand/0 via-brand/5 to-brand/0 group-hover:via-brand/10 transition-all duration-500" />
                    {betaVerifying ? (
                      <RelayOutpostInlineLoader className="w-4 h-4 text-brand relative z-10" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-brand/70 group-hover:text-brand-strong transition-colors relative z-10" />
                    )}
                    <span className="font-brand font-semibold text-xs sm:text-sm tracking-[0.2em] uppercase text-brand/80 group-hover:text-brand-strong transition-colors relative z-10">
                      {betaVerifying ? "Verifying" : "Authenticate"}
                    </span>
                  </button>
                </div>

                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/15 text-center">
                  Closed beta v1.0
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {warping && !isCockpit && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="animate-pulse">
            <p className="font-brand text-sm tracking-[0.5em] uppercase text-white/60">
              Engaging...
            </p>
          </div>
        </div>
      )}
      {isCockpit && !warping && (
        <div className="absolute inset-0 z-10 flex flex-col items-center overflow-y-auto" data-testid="cockpit-login-panel">
          <div className="w-full max-w-md md:max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-5 sm:space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center space-y-2.5 sm:space-y-3">
              <div className="flex items-center rounded-md overflow-hidden brand-flicker">
                <div className="flex items-center bg-black/80 pl-2.5 pr-1 sm:pl-3 sm:pr-1.5 h-9 sm:h-10 border-2 border-r-0 border-white/50 rounded-l-md">
                  <span className="font-brand font-bold text-xs sm:text-sm tracking-[0.2em] text-white uppercase leading-none">Relay</span>
                </div>
                <div className="flex items-center justify-center h-9 sm:h-10 bg-black/80 border-y-2 border-white/50">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 sm:w-7 sm:h-7">
                    <g clipPath="url(#clip0_cockpit)">
                      <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="white" />
                      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="white" />
                    </g>
                    <defs><clipPath id="clip0_cockpit"><rect width="24" height="24" /></clipPath></defs>
                  </svg>
                </div>
                <div className="flex items-center bg-black/80 pl-1 pr-2.5 sm:pl-1.5 sm:pr-3 h-9 sm:h-10 border-2 border-l-0 border-white/50 rounded-r-md">
                  <span className="font-brand font-bold text-xs sm:text-sm tracking-[0.2em] text-white uppercase leading-none">Outpost</span>
                </div>
              </div>

              <p className="text-[11px] sm:text-xs font-brand uppercase tracking-[0.25em] sm:tracking-[0.3em] text-white/70">
                Sign in
              </p>
              <div className="flex items-center justify-center gap-2">
                <div className="h-px w-6 sm:w-8 bg-white/10" />
                <Radio className="w-3 h-3 text-white/20" />
                <div className="h-px w-6 sm:w-8 bg-white/10" />
              </div>
            </div>

            <LoginOptions
              variant="overlay"
              onBack={onCockpitBack}
            />
          </div>
        </div>
      )}
      {isCockpit && warping && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="animate-pulse">
            <p className="font-brand text-sm tracking-[0.5em] uppercase text-white/60">
              Engaging...
            </p>
          </div>
        </div>
      )}
      {isDimmed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-6">
          <div className="flex flex-col items-center gap-4 sm:gap-5 animate-in fade-in-0 duration-500">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/45 sm:w-6 sm:h-6">
                <g clipPath="url(#clip0_dim)">
                  <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="currentColor" />
                  <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="currentColor" />
                </g>
                <defs><clipPath id="clip0_dim"><rect width="24" height="24" /></clipPath></defs>
              </svg>
              <span className="font-brand text-[11px] sm:text-xs tracking-[0.25em] sm:tracking-[0.3em] uppercase text-white/55">
                Station Offline
              </span>
            </div>
            <p className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em] text-white/55 max-w-[220px] sm:max-w-[240px] text-center leading-relaxed">
              Sign in to continue
            </p>
            <button
              onClick={onDimmedSignIn}
              className="mt-1 sm:mt-2 flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-md border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.08] active:scale-[0.97] transition-all duration-300 cursor-pointer"
              data-testid="button-dimmed-sign-in"
            >
              <Rocket className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/70 -rotate-45" />
              <span className="font-brand text-[11px] sm:text-xs tracking-[0.2em] uppercase text-white/70">
                Sign In
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
