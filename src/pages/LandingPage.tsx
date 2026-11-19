import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Database,
  FileSearch,
  FileText,
  GitFork,
  LogIn,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValueEvent,
  type MotionValue,
} from 'motion/react';
import { DEMO_DOCUMENT_ID } from '../data/demoData';

declare global {
  interface Window {
    __render?: (timeSec: number) => void;
  }
}

const SHEET_URL =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261030_025250_100df7b8-31fd-4614-aa4a-c1b7d5b6b273.png&w=1600&q=85';

const SRC: Record<'LA' | 'RA' | 'LB' | 'RB', [number, number, number, number]> = {
  LA: [0, 0.06, 0.47, 0.40],
  RA: [0.53, 0.06, 0.47, 0.40],
  LB: [0, 0.55, 0.47, 0.40],
  RB: [0.53, 0.55, 0.47, 0.40],
};

const LOOP = 20;
const TAU = Math.PI * 2;
const LEVELS = [0, 0.26, 0.52, 0.78, 1];
const RADII_MULT = [0, 0.38, 0.52, 0.78, 1];

const LOGOS = [
  { name: 'Lumenix', path: 'M3 15c0-7 5-12 14-12-1 9-6 14-13 13l-1 2-2-1z' },
  { name: 'Velora', path: 'M10 1l8 4.5v9L10 19l-8-4.5v-9zM10 6l-4 2.3v4.4L10 15l4-2.3V8.3z' },
  { name: 'Nimbus', path: 'M1 5q4.5-3 9 0t9 0v3q-4.5 3-9 0t-9 0zm0 7q4.5-3 9 0t9 0v3q-4.5 3-9 0t-9 0z' },
  { name: 'Quanta', path: 'M10 1a9 9 0 110 18 9 9 0 010-18zm0 3a6 6 0 100 12 6 6 0 000-12zm0 3a3 3 0 110 6 3 3 0 010-6z' },
  { name: 'Solstice', path: 'M1 17L7 6l3 5 3-7 6 13z' },
  { name: 'Parallax', path: 'M10 1l9 4-9 4-9-4zm-9 8l9 4 9-4v3l-9 4-9-4zm0 5l9 4 9-4v2l-9 4-9-4z' },
];

interface NavSlotSpec {
  label: string;
  href: string;
  className: string;
  isLink?: boolean;
  delay: number;
  xStops: [number, number, number, number];
  yStops: [number, number, number, number];
}

const ARCH_STOPS: [number, number, number, number] = [0, 0.35, 0.72, 1];

const NAV_SLOTS: NavSlotSpec[] = [
  {
    label: 'Features',
    href: '#features',
    className: 'nav-item nav-link',
    isLink: true,
    delay: 0.14,
    xStops: [33.5, 29, 31, 31.5],
    yStops: [11.6, 25.0, 17.5, 13.5],
  },
  {
    label: 'Overview',
    href: '#how-it-works',
    className: 'nav-item nav-link',
    isLink: true,
    delay: 0.24,
    xStops: [23.5, 17.5, 16, 15.5],
    yStops: [17.6, 36.0, 21.5, 13.5],
  },
  {
    label: 'Research Sources',
    href: '#sources',
    className: 'nav-item nav-link',
    isLink: true,
    delay: 0.14,
    xStops: [66.5, 71, 69, 68.5],
    yStops: [11.6, 25.0, 17.5, 13.5],
  },
  {
    label: 'About',
    href: '#about',
    className: 'nav-item nav-link',
    isLink: true,
    delay: 0.24,
    xStops: [76.5, 82.5, 84, 84.5],
    yStops: [17.6, 36.0, 21.5, 13.5],
  },
];

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const LOGOS_CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.55,
      staggerChildren: 0.085,
    },
  },
};

const LOGO_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: EASE_OUT,
    },
  },
};

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Upload Research PDF',
    desc: 'Submit any peer-reviewed paper, preprint, or manuscript PDF with automatic format and structure validation.',
    icon: Upload,
  },
  {
    step: '02',
    title: 'Extract Scientific Claims',
    desc: 'Segment empirical statements, quantitative findings, and surrounding page context with exact traceability.',
    icon: Sparkles,
  },
  {
    step: '03',
    title: 'Identify Citations',
    desc: 'Link in-text citations directly to bibliography entries, authors, publication years, and DOIs.',
    icon: GitFork,
  },
  {
    step: '04',
    title: 'Retrieve Research Sources',
    desc: 'Resolve referenced literature through Crossref and OpenAlex while explicitly tracking evidence availability.',
    icon: Database,
  },
  {
    step: '05',
    title: 'Analyze Supporting Evidence',
    desc: 'Compare every extracted claim side-by-side against retrieved passages to identify alignment or contradiction.',
    icon: FileSearch,
  },
  {
    step: '06',
    title: 'Generate Verification Report',
    desc: 'Export structured, transparent academic reports documenting verdicts, citations, and evidence limitations.',
    icon: FileText,
  },
];

const FEATURES = [
  {
    title: 'AI Claim Extraction',
    desc: 'Isolates verifiable empirical assertions from background prose while preserving page numbers and paragraph context.',
  },
  {
    title: 'Citation Verification',
    desc: 'Maps every claim to its exact cited source and flags unresolved, broken, or unindexed references.',
  },
  {
    title: 'Evidence Analysis',
    desc: 'Separates verification verdicts from evidence availability (FULL_TEXT, ABSTRACT, NONE) so limitations stay transparent.',
  },
  {
    title: 'Research Source Discovery',
    desc: 'Queries open scholarly metadata across Crossref and OpenAlex to locate original publications and DOIs.',
  },
  {
    title: 'Verification Scoring',
    desc: 'Applies a six-tier scientific verdict rubric: Supported, Partially Supported, Unsupported, Contradictory, Outdated, or Insufficient.',
  },
  {
    title: 'Detailed Reports',
    desc: 'Compiles presentation-ready verification dossiers with traceable DOI links, supporting excerpts, and conflicting findings.',
  },
];

interface SearchResultItem {
  id: string;
  label: string;
  category: string;
  keywords: string;
  hash?: string;
  to?: string;
}

const SEARCH_ITEMS: SearchResultItem[] = [
  ...WORKFLOW_STEPS.map((s) => ({
    id: `step-${s.step}`,
    label: `${s.step} — ${s.title}`,
    category: 'How It Works',
    keywords: `${s.step} ${s.title} ${s.desc}`,
    hash: '#how-it-works',
  })),
  ...FEATURES.map((f) => ({
    id: `feat-${f.title}`,
    label: f.title,
    category: 'Platform Capabilities',
    keywords: `${f.title} ${f.desc}`,
    hash: '#features',
  })),
  {
    id: 'source-crossref',
    label: 'Crossref Metadata API',
    category: 'Research Sources',
    keywords: 'crossref doi publisher metadata records citations',
    hash: '#sources',
  },
  {
    id: 'source-openalex',
    label: 'OpenAlex Scholarly Graph',
    category: 'Research Sources',
    keywords: 'openalex open access abstracts citation graph full text',
    hash: '#sources',
  },
  {
    id: 'about-mission',
    label: 'Mission · Transparent Science',
    category: 'About',
    keywords: 'about mission transparent science verify research',
    hash: '#about',
  },
  {
    id: 'route-upload',
    label: 'Upload Research PDF',
    category: 'Workspace',
    keywords: 'upload pdf manuscript verify start verification',
    to: '/upload',
  },
  {
    id: 'route-dashboard',
    label: 'Demo Verification Dashboard',
    category: 'Workspace',
    keywords: 'dashboard results claims verdicts overview demo',
    to: `/results/${DEMO_DOCUMENT_ID}`,
  },
  {
    id: 'route-citations',
    label: 'Citation Explorer',
    category: 'Workspace',
    keywords: 'citation explorer graph references doi',
    to: `/citations/${DEMO_DOCUMENT_ID}`,
  },
  {
    id: 'route-reports',
    label: 'Verification Reports',
    category: 'Workspace',
    keywords: 'reports export pdf json dossier',
    to: '/reports',
  },
  {
    id: 'route-settings',
    label: 'Settings & Methodology',
    category: 'Workspace',
    keywords: 'settings support methodology api backend',
    to: '/settings',
  },
];

function smoothstep01(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

function interpStops(p: number, values: [number, number, number, number]): number {
  if (p <= ARCH_STOPS[0]) return values[0];
  if (p >= ARCH_STOPS[3]) return values[3];
  for (let i = 0; i < 3; i++) {
    const s0 = ARCH_STOPS[i];
    const s1 = ARCH_STOPS[i + 1];
    if (p >= s0 && p <= s1) {
      const t = smoothstep01((p - s0) / (s1 - s0));
      return values[i] + (values[i + 1] - values[i]) * t;
    }
  }
  return values[3];
}

interface ArchGeometry {
  outerPoints: Array<[number, number]>;
  outer: string;
  inner: string;
}

function buildArchPaths(p: number): ArchGeometry {
  const topY = interpStops(p, [18, 64, 12, 0]);
  const topLeftX = interpStops(p, [368, 250, 55, 0]);
  const topRightX = 1000 - topLeftX;

  const outerLeftX = interpStops(p, [100, 20, 0, 0]);
  const outerRightX = 1000 - outerLeftX;
  const outerBotY = interpStops(p, [212, 420, 840, 1000]);

  const innerFootLeftX = interpStops(p, [270, 185, 60, 0]);
  const innerFootRightX = 1000 - innerFootLeftX;

  const innerTopLeftX = interpStops(p, [452, 435, 475, 500]);
  const innerTopRightX = 1000 - innerTopLeftX;
  const innerTopY = interpStops(p, [92, 215, 620, 1000]);

  const outerPoints: Array<[number, number]> = [
    [topLeftX, topY],
    [topRightX, topY],
    [outerRightX, outerBotY],
    [innerFootRightX, outerBotY],
    [innerTopRightX, innerTopY],
    [innerTopLeftX, innerTopY],
    [innerFootLeftX, outerBotY],
    [outerLeftX, outerBotY],
  ];

  const outer =
    outerPoints
      .map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ') + ' Z';

  const inTopY = topY + 10;
  const inTopLeftX = topLeftX + 7;
  const inTopRightX = 1000 - inTopLeftX;

  const inOuterLeftX = outerLeftX + 12;
  const inOuterRightX = 1000 - inOuterLeftX;
  const inOuterBotY = outerBotY - 10;

  const flattenT = smoothstep01((p - 0.72) / 0.28);
  const inFootLeftX = Math.max(inOuterLeftX, innerFootLeftX + 6 * (1 - flattenT));
  const inFootRightX = 1000 - inFootLeftX;

  const inTopCutLeftX = innerTopLeftX - 4 * (1 - flattenT);
  const inTopCutRightX = 1000 - inTopCutLeftX;
  const inInnerTopY = Math.min(inOuterBotY, innerTopY - 10 * (1 - flattenT));

  const inner = [
    `M ${inTopLeftX.toFixed(1)} ${inTopY.toFixed(1)}`,
    `L ${inTopRightX.toFixed(1)} ${inTopY.toFixed(1)}`,
    `L ${inOuterRightX.toFixed(1)} ${inOuterBotY.toFixed(1)}`,
    `L ${inFootRightX.toFixed(1)} ${inOuterBotY.toFixed(1)}`,
    `L ${inTopCutRightX.toFixed(1)} ${inInnerTopY.toFixed(1)}`,
    `L ${inTopCutLeftX.toFixed(1)} ${inInnerTopY.toFixed(1)}`,
    `L ${inFootLeftX.toFixed(1)} ${inOuterBotY.toFixed(1)}`,
    `L ${inOuterLeftX.toFixed(1)} ${inOuterBotY.toFixed(1)}`,
    'Z',
  ].join(' ');

  return { outerPoints, outer, inner };
}

function ArchNavPill({
  slot,
  progress,
  onNavigate,
}: {
  slot: NavSlotSpec;
  progress: MotionValue<number>;
  onNavigate: (hash: string) => void;
}) {
  const x = useTransform(progress, (p) => `${interpStops(p, slot.xStops).toFixed(3)}vw`);
  const y = useTransform(progress, (p) => `${interpStops(p, slot.yStops).toFixed(3)}vh`);

  return (
    <motion.div
      className={`nav-slot ${slot.isLink ? 'slot-link' : ''}`}
      style={{ x, y }}
    >
      <div className="nav-slot-inner">
        <motion.a
          className={slot.className}
          href={slot.href}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(slot.href);
          }}
          initial={{ opacity: 0, y: -6, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, delay: slot.delay, ease: EASE_OUT }}
          whileHover={{ y: -2, scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
        >
          {slot.label}
        </motion.a>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outerPathRef = useRef<SVGPathElement | null>(null);
  const innerPathRef = useRef<SVGPathElement | null>(null);
  const floatingNavRef = useRef<HTMLElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const heroBridgeRef = useRef<HTMLDivElement | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const scrollTweenRef = useRef<gsap.core.Tween | null>(null);
  const archProgressRef = useRef<number>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('');
  const [pastHero, setPastHero] = useState<boolean>(false);
  const [navSearchQuery, setNavSearchQuery] = useState<string>('');
  const [navSearchOpen, setNavSearchOpen] = useState<boolean>(false);

  const searchResults = useMemo(() => {
    const q = navSearchQuery.trim().toLowerCase();
    if (!q) return SEARCH_ITEMS.slice(0, 5);
    return SEARCH_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q),
    ).slice(0, 6);
  }, [navSearchQuery]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setNavSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // GSAP-powered smooth scroll-to-section navigation synchronized with Lenis
  const scrollToSection = useCallback((hash: string) => {
    if (!hash || hash === '#') return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTop = hash === '#top';
    const targetEl = isTop ? null : (document.querySelector(hash) as HTMLElement | null);
    if (!isTop && !targetEl) return;

    const targetY = isTop
      ? 0
      : Math.max(0, targetEl!.getBoundingClientRect().top + window.scrollY - 76);

    if (prefersReduced) {
      window.scrollTo({ top: targetY, behavior: 'auto' });
      return;
    }

    // Cancel any in-flight scroll tween so repeated clicks feel immediately responsive
    if (scrollTweenRef.current) {
      scrollTweenRef.current.kill();
      scrollTweenRef.current = null;
    }

    const distance = Math.abs(targetY - window.scrollY);
    const duration = Math.min(1.55, Math.max(0.85, 0.72 + distance / 3400));

    const lenis = lenisRef.current;

    scrollTweenRef.current = gsap.to(window, {
      scrollTo: {
        y: targetY,
        autoKill: true,
      },
      duration,
      ease: 'power3.inOut',
      overwrite: 'auto',
      onStart: () => {
        lenis?.stop();
      },
      onComplete: () => {
        lenis?.start();
        ScrollTrigger.update();
        scrollTweenRef.current = null;
      },
      onInterrupt: () => {
        lenis?.start();
        scrollTweenRef.current = null;
      },
    });
  }, []);

  // Synchronized Lenis smooth scroll + GSAP Ticker & ScrollTrigger choreography
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let lenis: Lenis | null = null;
    let tickLenis: ((time: number) => void) | null = null;

    if (!prefersReduced) {
      lenis = new Lenis({
        lerp: 0.085,
        smoothWheel: true,
        wheelMultiplier: 0.95,
        touchMultiplier: 1.35,
      });
      lenisRef.current = lenis;

      lenis.on('scroll', ScrollTrigger.update);

      tickLenis = (time: number) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(tickLenis);
      gsap.ticker.lagSmoothing(0);
    }

    const ctx = gsap.context(() => {
      // Seamless hero-to-sections curtain transition scrubbed by ScrollTrigger
      if (heroBridgeRef.current && stageRef.current) {
        gsap.fromTo(
          heroBridgeRef.current,
          { scaleY: 1, opacity: 1 },
          {
            scaleY: 0,
            opacity: 0.2,
            transformOrigin: 'top center',
            ease: 'none',
            scrollTrigger: {
              trigger: heroBridgeRef.current,
              start: 'top bottom',
              end: 'bottom top+=140',
              scrub: 0.6,
            },
          },
        );
      }

      // Show post-hero floating section pill navigation once user leaves the hero stage
      if (stageRef.current) {
        ScrollTrigger.create({
          trigger: stageRef.current,
          start: 'bottom top+=120',
          onEnter: () => setPastHero(true),
          onLeaveBack: () => {
            setPastHero(false);
            setActiveSection('');
          },
        });
      }

      // Track active editorial section for pill highlight
      const sectionIds = ['#how-it-works', '#features', '#sources', '#about'];
      sectionIds.forEach((id) => {
        const el = document.querySelector(id);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: 'top center',
          end: 'bottom center',
          onEnter: () => setActiveSection(id),
          onEnterBack: () => setActiveSection(id),
        });
      });

      if (!prefersReduced) {
        // Editorial section header reveals
        gsap.utils.toArray<HTMLElement>('[data-gsap-reveal]').forEach((el) => {
          gsap.fromTo(
            el,
            { y: 28, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.85,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                start: 'top 86%',
                once: true,
              },
            },
          );
        });

        // Staggered card / grid item reveals
        gsap.utils.toArray<HTMLElement>('[data-gsap-stagger-group]').forEach((group) => {
          const items = group.querySelectorAll<HTMLElement>('[data-gsap-stagger-item]');
          if (!items.length) return;
          gsap.fromTo(
            items,
            { y: 26, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.72,
              stagger: 0.08,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: group,
                start: 'top 84%',
                once: true,
              },
            },
          );
        });
      }
    }, mainRef);

    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const hash = anchor.getAttribute('href');
      if (!hash || hash === '#') return;
      e.preventDefault();
      scrollToSection(hash);
    };

    document.addEventListener('click', handleAnchorClick);

    return () => {
      document.removeEventListener('click', handleAnchorClick);
      if (scrollTweenRef.current) {
        scrollTweenRef.current.kill();
        scrollTweenRef.current = null;
      }
      ctx.revert();
      if (tickLenis) {
        gsap.ticker.remove(tickLenis);
      }
      if (lenis) {
        lenis.destroy();
        lenisRef.current = null;
      }
    };
  }, [scrollToSection]);

  // Animate floating post-hero pill bar in/out with GSAP
  useEffect(() => {
    const navEl = floatingNavRef.current;
    if (!navEl) return;
    gsap.to(navEl, {
      y: pastHero ? 0 : -24,
      opacity: pastHero ? 1 : 0,
      pointerEvents: pastHero ? 'auto' : 'none',
      duration: 0.45,
      ease: 'power3.out',
      overwrite: 'auto',
    });
  }, [pastHero]);

  const { scrollYProgress: pageScrollProgress } = useScroll();
  const pageScaleX = useSpring(pageScrollProgress, {
    stiffness: 140,
    damping: 26,
    restDelta: 0.0005,
  });

  const { scrollYProgress: stageProgress } = useScroll({
    target: stageRef,
    offset: ['start start', 'end end'],
  });
  const archProgress = useSpring(stageProgress, {
    stiffness: 95,
    damping: 24,
    mass: 0.45,
    restDelta: 0.0002,
  });

  useMotionValueEvent(archProgress, 'change', (p) => {
    archProgressRef.current = p;
    const { outer, inner } = buildArchPaths(p);
    if (outerPathRef.current) outerPathRef.current.setAttribute('d', outer);
    if (innerPathRef.current) innerPathRef.current.setAttribute('d', inner);
  });

  const ctaY = useTransform(archProgress, (p) => `${interpStops(p, [5.5, 16.0, 14.5, 13.5]).toFixed(3)}vh`);
  const mobileMenuX = useTransform(archProgress, (p) => `${interpStops(p, [19, 14, 13, 13]).toFixed(3)}vw`);
  const mobileMenuY = useTransform(archProgress, (p) => `${interpStops(p, [17.6, 36.0, 21.5, 13.5]).toFixed(3)}vh`);

  const heroContentOpacity = useTransform(archProgress, [0.06, 0.48], [1, 0]);
  const heroContentY = useTransform(archProgress, [0.06, 0.48], [0, 34]);
  const scrollCueOpacity = useTransform(archProgress, [0, 0.12], [1, 0]);

  const chamberOpacity = useTransform(archProgress, [0.58, 0.92], [0, 1]);
  const chamberY = useTransform(archProgress, [0.58, 0.92], [28, 0]);

  const initialPaths = buildArchPaths(0);

  useEffect(() => {
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    const lightCanvas = lightCanvasRef.current;
    if (!hero || !canvas || !lightCanvas) return;
    const ctx = canvas.getContext('2d');
    const ctxLight = lightCanvas.getContext('2d');
    if (!ctx || !ctxLight) return;

    const fA = document.createElement('canvas');
    const fB = document.createElement('canvas');
    const ctxA = fA.getContext('2d', { willReadFrequently: true });
    const ctxB = fB.getContext('2d', { willReadFrequently: true });
    if (!ctxA || !ctxB) return;

    const tiles: Record<'LA' | 'RA' | 'LB' | 'RB', HTMLCanvasElement | null> = {
      LA: null,
      RA: null,
      LB: null,
      RB: null,
    };

    let ready = false;
    let rafId = 0;
    let disposed = false;

    let W = 0;
    let H = 0;
    let DPR = 1;
    let step = 7;
    let rowStep = 14.35;
    let cols = 0;
    let rows = 0;
    let R = 3.22;
    let seeds = new Float32Array(0);
    let rowShift = new Int16Array(0);

    const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

    const hash = (a: number, b: number) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    const smooth = (a: number, b: number, x: number) => {
      const u = clamp((x - a) / (b - a), 0, 1);
      return u * u * (3 - 2 * u);
    };

    const mixAt = (t: number, on: number, off: number, dur: number) =>
      smooth(on, on + dur, t) * (1 - smooth(off, off + dur, t));

    const resize = () => {
      W = hero.clientWidth || window.innerWidth;
      H = hero.clientHeight || window.innerHeight;
      DPR = Math.min(2, window.devicePixelRatio || 1);

      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      lightCanvas.width = canvas.width;
      lightCanvas.height = canvas.height;

      step = Math.max(5, W / 205);
      rowStep = step * 2.05;
      cols = Math.ceil(W / step);
      rows = Math.ceil(H / rowStep);
      R = step * 0.46;

      fA.width = fB.width = cols;
      fA.height = fB.height = rows;

      seeds = new Float32Array(cols * rows);
      rowShift = new Int16Array(rows);
      for (let j = 0; j < rows; j++) {
        const rowBias = 0.45 * hash(j * 3.1, 7.7);
        const base = j * cols;
        for (let i = 0; i < cols; i++) {
          seeds[base + i] = 0.55 * hash(i, j) + rowBias;
        }
      }
    };

    const sliceTiles = (img: HTMLImageElement) => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      (Object.keys(SRC) as Array<keyof typeof SRC>).forEach((key) => {
        const [sx, sy, sw, sh] = SRC[key];
        const srcX = sx * iw;
        const srcY = sy * ih;
        const srcW = sw * iw;
        const srcH = sh * ih;

        const tile = document.createElement('canvas');
        tile.width = 420;
        tile.height = Math.max(1, Math.round(420 * (srcH / srcW)));
        const tctx = tile.getContext('2d');
        if (tctx) {
          tctx.imageSmoothingEnabled = true;
          tctx.imageSmoothingQuality = 'high';
          tctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tile.width, tile.height);
        }
        tiles[key] = tile;
      });
      ready = true;
    };

    const drawHandToField = (
      fctx: CanvasRenderingContext2D,
      tile: HTMLCanvasElement,
      isLeft: boolean,
      a: number,
      cy: number,
      hw: number,
      hh: number,
    ) => {
      const ph = isLeft ? 0 : Math.PI;
      const reach = (0.035 * Math.sin(a + ph) + 0.012 * Math.sin(2 * a + 1.3 + ph)) * W;
      const scale = 1 + 0.07 * Math.sin(a + 0.9 + ph);
      const rot = (isLeft ? 1 : -1) * 0.045 * Math.sin(a + 2.1 + ph);
      const x = isLeft ? reach - W * 0.045 : W - hw + W * 0.045 - reach;
      const px = isLeft ? 0 : W;

      fctx.save();
      fctx.scale(cols / W, rows / H);
      fctx.translate(px, cy);
      fctx.rotate(rot);
      fctx.scale(scale, scale);
      fctx.translate(-px, -cy);
      fctx.drawImage(tile, x, cy - hh / 2, hw, hh);
      fctx.restore();
    };

    const render = (timeSec: number) => {
      const t = ((timeSec % LOOP) + LOOP) % LOOP;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctxLight.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctxLight.clearRect(0, 0, W, H);

      if (!ready || !tiles.LA || !tiles.RA || !tiles.LB || !tiles.RB || cols <= 0 || rows <= 0) {
        return;
      }

      const p = archProgressRef.current;
      const portrait = H > W;
      const hw = W * (portrait ? 0.66 : 0.53);
      const hh = hw * ((0.40 * 1520) / (0.47 * 2688));
      const cy = H * (portrait ? 0.66 : 0.54);
      const a = (TAU * t) / LOOP;

      ctxA.fillStyle = '#ffffff';
      ctxA.fillRect(0, 0, cols, rows);
      ctxB.fillStyle = '#ffffff';
      ctxB.fillRect(0, 0, cols, rows);

      drawHandToField(ctxA, tiles.LA, true, a, cy, hw, hh);
      drawHandToField(ctxA, tiles.RA, false, a, cy, hw, hh);
      drawHandToField(ctxB, tiles.LB, true, a, cy, hw, hh);
      drawHandToField(ctxB, tiles.RB, false, a, cy, hw, hh);

      const dA = ctxA.getImageData(0, 0, cols, rows).data;
      const dB = ctxB.getImageData(0, 0, cols, rows).data;

      const mL = mixAt(t, 6.2, 14.6, 1.6);
      const mR = mixAt(t, 2.4, 10.4, 1.6);
      const activeL = mL > 0.001 && mL < 0.999;
      const activeR = mR > 0.001 && mR < 0.999;

      const tick = Math.floor(t * 7);
      for (let j = 0; j < rows; j++) {
        rowShift[j] = hash(j, tick) > 0.965 ? Math.round((hash(tick, j) - 0.5) * 8) : 0;
      }

      const qxScale = portrait ? 0.44 : 0.2;
      const qyCenter = portrait ? 0.33 : 0.385;
      const halfCols = cols * 0.5;

      const darkReveal = smooth(0.18, 0.84, p);
      const darkActive = darkReveal > 0.001 && darkReveal < 0.999;
      const darkYOffset = (1 - darkReveal) * 20;
      const drawDarkHands = p > 0.08;

      const bx: number[][] = [[], [], [], [], []];
      const by: number[][] = [[], [], [], [], []];
      const lx: number[][] = [[], [], [], [], []];
      const ly: number[][] = [[], [], [], [], []];

      for (let j = 0; j < rows; j++) {
        const y = (j + 0.5) * rowStep;
        const ey = (y / H - qyCenter) / 0.085;
        const eyDark = (y / H - 0.5) / 0.145;
        const shift = rowShift[j];
        const rowBase = j * cols;

        for (let i = 0; i < cols; i++) {
          const left = i < halfCols;
          const m = left ? mL : mR;
          const active = left ? activeL : activeR;
          const seed = seeds[rowBase + i];
          const useB = seed < m;

          let si = i - shift;
          if (si < 0) si = 0;
          else if (si >= cols) si = cols - 1;

          const idx = (rowBase + si) * 4;
          const lum = (useB ? dB[idx] : dA[idx]) / 255;

          let baseV = clamp((1 - lum - 0.16) / 0.42, 0, 1);
          if (baseV <= 0) continue;

          if (active) {
            const dist = Math.abs(seed - m);
            if (dist < 0.12) {
              baseV *= dist / 0.12;
              if (hash(i + tick, j) <= 0.4) {
                baseV *= 0.3;
              }
            }
          }

          baseV *= 0.86 + 0.14 * Math.sin(t * 3.2 + seed * 40);

          const cx = Math.abs((i + 0.5) / cols - 0.5);
          baseV *= smooth(0.035, 0.11, cx);

          const ex = cx / qxScale;
          const vHero = baseV * smooth(0.85, 1.25, Math.hypot(ex, ey));

          let lvlIdx = 0;
          if (vHero >= LEVELS[4] - 0.13) lvlIdx = 4;
          else if (vHero >= LEVELS[3] - 0.13) lvlIdx = 3;
          else if (vHero >= LEVELS[2] - 0.13) lvlIdx = 2;
          else if (vHero >= LEVELS[1] - 0.13) lvlIdx = 1;

          const px = (i + 0.5) * step;
          if (lvlIdx > 0) {
            bx[lvlIdx].push(px);
            by[lvlIdx].push(y);
          }

          if (drawDarkHands && seed < darkReveal) {
            const exDark = cx / (portrait ? 0.42 : 0.25);
            let vDark = baseV * smooth(0.75, 1.25, Math.hypot(exDark, eyDark));
            if (darkActive) {
              const frontDist = Math.abs(seed - darkReveal);
              if (frontDist < 0.14) {
                vDark *= frontDist / 0.14;
                if (hash(i + tick, j + 19) <= 0.35) {
                  vDark *= 0.35;
                }
              }
            }

            let dLvl = 0;
            if (vDark >= LEVELS[4] - 0.13) dLvl = 4;
            else if (vDark >= LEVELS[3] - 0.13) dLvl = 3;
            else if (vDark >= LEVELS[2] - 0.13) dLvl = 2;
            else if (vDark >= LEVELS[1] - 0.13) dLvl = 1;

            if (dLvl > 0) {
              const reachIn = (left ? 1 : -1) * (darkReveal * W * 0.018);
              lx[dLvl].push(px + reachIn);
              ly[dLvl].push(y + darkYOffset);
            }
          }
        }
      }

      ctx.fillStyle = '#0d0d0d';
      for (let l = 1; l <= 4; l++) {
        const xs = bx[l];
        const ys = by[l];
        const n = xs.length;
        if (n === 0) continue;
        const r = R * RADII_MULT[l];
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const x = xs[k];
          const y = ys[k];
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      }

      if (drawDarkHands) {
        const { outerPoints } = buildArchPaths(p);
        ctxLight.save();
        ctxLight.beginPath();
        for (let k = 0; k < outerPoints.length; k++) {
          const [ox, oy] = outerPoints[k];
          const sx = (ox / 1000) * W;
          const sy = (oy / 1000) * H;
          if (k === 0) ctxLight.moveTo(sx, sy);
          else ctxLight.lineTo(sx, sy);
        }
        ctxLight.closePath();
        ctxLight.clip();

        ctxLight.fillStyle = 'rgba(244, 244, 240, 0.92)';
        for (let l = 1; l <= 4; l++) {
          const xs = lx[l];
          const ys = ly[l];
          const n = xs.length;
          if (n === 0) continue;
          const r = R * RADII_MULT[l];
          ctxLight.beginPath();
          for (let k = 0; k < n; k++) {
            const x = xs[k];
            const y = ys[k];
            ctxLight.moveTo(x + r, y);
            ctxLight.arc(x, y, r, 0, TAU);
          }
          ctxLight.fill();
        }
        ctxLight.restore();
      }
    };

    window.__render = render;
    resize();
    window.addEventListener('resize', resize);

    let t0: number | null = null;
    const frame = (now: number) => {
      if (disposed) return;
      if (t0 === null) t0 = now;
      render((now - t0) / 1000);
      rafId = requestAnimationFrame(frame);
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (disposed) return;
      sliceTiles(img);
      rafId = requestAnimationFrame(frame);
    };
    img.src = SHEET_URL;

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <main id="top" ref={mainRef}>
      <div className="scroll-progress-track" aria-hidden="true">
        <motion.div className="scroll-progress-bar" style={{ scaleX: pageScaleX }} />
      </div>

      {/* Floating Post-Hero Section Pill Bar (GSAP-animated reveal below hero stage) */}
      <nav
        ref={floatingNavRef}
        aria-label="Section navigation"
        className="pointer-events-none fixed top-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-fit -translate-x-1/2 opacity-0"
      >
        <div className="flex items-center justify-between gap-1.5 rounded-full border border-[#101B2D]/15 bg-transparent px-2.5 py-1.5 shadow-[0_8px_24px_rgba(16,27,45,0.08)] backdrop-blur-md">
          <button
            type="button"
            onClick={() => scrollToSection('#top')}
            className="shrink-0 cursor-pointer rounded-full px-3.5 py-2 text-[11px] font-semibold tracking-[0.14em] whitespace-nowrap text-[#101B2D] uppercase transition hover:bg-[#101B2D]/8"
          >
            EDUFIND
          </button>

          {/* Compact Transparent Search Bar beside EDUFIND */}
          <div ref={searchBoxRef} className="relative flex items-center">
            <Search
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 text-[#4B586E]"
            />
            <input
              type="text"
              value={navSearchQuery}
              onFocus={() => setNavSearchOpen(true)}
              onChange={(e) => {
                setNavSearchQuery(e.target.value);
                setNavSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNavSearchOpen(false);
                } else if (e.key === 'Enter' && searchResults.length > 0) {
                  e.preventDefault();
                  const top = searchResults[0];
                  setNavSearchOpen(false);
                  setNavSearchQuery('');
                  if (top.to) navigate(top.to);
                  else if (top.hash) scrollToSection(top.hash);
                }
              }}
              placeholder="Search..."
              aria-label="Search sections and tools"
              className="h-8 w-28 rounded-full border border-[#101B2D]/18 bg-transparent pr-7 pl-8 text-[12px] text-[#101B2D] placeholder:text-[#4B586E]/75 transition-all focus:w-40 focus:border-[#101B2D]/45 focus:bg-[#F5F3ED]/30 focus:outline-none sm:w-36 sm:focus:w-48"
            />
            {navSearchQuery && (
              <button
                type="button"
                onClick={() => {
                  setNavSearchQuery('');
                  setNavSearchOpen(false);
                }}
                aria-label="Clear search"
                className="absolute right-2 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[#71839D] transition hover:text-[#101B2D]"
              >
                <X size={11} />
              </button>
            )}

            {navSearchOpen && (
              <div className="absolute top-[calc(100%+10px)] left-0 z-50 w-72 overflow-hidden rounded-2xl border border-[#D9DDE3] bg-white p-1.5 shadow-[0_14px_34px_rgba(16,27,45,0.14)]">
                {searchResults.length === 0 ? (
                  <div className="px-3 py-2.5 text-xs text-[#71839D]">
                    No matching sections or tools.
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {searchResults.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setNavSearchOpen(false);
                            setNavSearchQuery('');
                            if (item.to) navigate(item.to);
                            else if (item.hash) scrollToSection(item.hash);
                          }}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#F5F3ED]"
                        >
                          <span className="truncate text-[12.5px] font-medium text-[#101B2D]">
                            {item.label}
                          </span>
                          <span className="shrink-0 text-[10.5px] font-medium text-[#71839D]">
                            {item.category}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <span className="hidden h-4 w-px bg-[#101B2D]/15 lg:block" aria-hidden="true" />
          <div className="hidden items-center gap-1 lg:flex">
            {[
              { label: 'Overview', hash: '#how-it-works' },
              { label: 'Features', hash: '#features' },
              { label: 'Research Sources', hash: '#sources' },
              { label: 'About', hash: '#about' },
            ].map((item) => {
              const isActive = activeSection === item.hash;
              return (
                <button
                  key={item.hash}
                  type="button"
                  onClick={() => scrollToSection(item.hash)}
                  className={`shrink-0 cursor-pointer rounded-full px-3.5 py-2 text-[12px] font-medium whitespace-nowrap transition ${
                    isActive
                      ? 'bg-[#101B2D] text-[#F5F3ED]'
                      : 'text-[#101B2D]/75 hover:bg-[#101B2D]/8 hover:text-[#101B2D]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <Link
            to="/upload"
            className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-[12px] font-semibold whitespace-nowrap text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
          >
            <span>Verify</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* Preserved Motion-Graphics Hero & Scroll-Morphing Deep-Navy Arch */}
      <div className="hero-scroll-stage" ref={stageRef}>
        <section className="hero" ref={heroRef}>
          <canvas id="dots" ref={canvasRef} />

          <motion.div
            className="arch-nav"
            aria-hidden="true"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE_OUT }}
          >
            <svg
              className="nav-arch-bg"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                ref={outerPathRef}
                d={initialPaths.outer}
                fill="#101B2D"
                stroke="#F5F3ED"
                strokeWidth="2.5"
                strokeLinejoin="miter"
                vectorEffect="non-scaling-stroke"
              />
              <path
                ref={innerPathRef}
                d={initialPaths.inner}
                fill="none"
                stroke="#F5F3ED"
                strokeWidth="1.5"
                strokeLinejoin="miter"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </motion.div>

          <canvas id="dots-light" ref={lightCanvasRef} aria-hidden="true" />

          <motion.nav
            className="arch-pills-layer"
            aria-label="Primary"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE_OUT }}
          >
            <motion.div className="nav-slot" style={{ x: '50vw', y: ctaY }}>
              <div className="nav-slot-inner">
                <Link
                  to="/upload"
                  className="nav-item nav-cta"
                >
                  <span>EDUFIND</span>
                </Link>
              </div>
            </motion.div>

            <motion.div
              className="nav-slot mobile-menu-slot"
              style={{ x: mobileMenuX, y: mobileMenuY }}
            >
              <div className="nav-slot-inner">
                <motion.button
                  type="button"
                  className="nav-item mobile-menu-btn"
                  aria-expanded={mobileMenuOpen}
                  aria-label="Toggle navigation menu"
                  onClick={() => setMobileMenuOpen((prev) => !prev)}
                  whileTap={{ scale: 0.96 }}
                >
                  {mobileMenuOpen ? 'Close' : 'Menu'}
                </motion.button>
              </div>
            </motion.div>

            {NAV_SLOTS.map((slot) => (
              <ArchNavPill
                key={slot.label}
                slot={slot}
                progress={archProgress}
                onNavigate={scrollToSection}
              />
            ))}

            {mobileMenuOpen && (
              <motion.div
                className="mobile-nav-drawer"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
              >
                <a
                  href="#how-it-works"
                  onClick={(e) => {
                    e.preventDefault();
                    setMobileMenuOpen(false);
                    scrollToSection('#how-it-works');
                  }}
                >
                  Overview
                </a>
                <a
                  href="#features"
                  onClick={(e) => {
                    e.preventDefault();
                    setMobileMenuOpen(false);
                    scrollToSection('#features');
                  }}
                >
                  Features
                </a>
                <a
                  href="#sources"
                  onClick={(e) => {
                    e.preventDefault();
                    setMobileMenuOpen(false);
                    scrollToSection('#sources');
                  }}
                >
                  Research Sources
                </a>
                <a
                  href="#about"
                  onClick={(e) => {
                    e.preventDefault();
                    setMobileMenuOpen(false);
                    scrollToSection('#about');
                  }}
                >
                  About
                </a>
                <Link to="/upload" onClick={() => setMobileMenuOpen(false)}>Start Verification →</Link>
              </motion.div>
            )}
          </motion.nav>

          {/* Expanded Deep-Navy Chamber Statement */}
          <motion.div
            className="expanded-chamber-copy"
            style={{ opacity: chamberOpacity, y: chamberY }}
          >
            <div className="expanded-chamber-kicker">EDUFIND AI · Truth Deserves Evidence</div>
            <h2 className="expanded-chamber-title">
              <span className="mute-light">Verify scientific claims.</span> Trace every citation.
            </h2>
            <p className="expanded-chamber-sub">
              Discover whether academic research genuinely supports what it says through explainable, source-traceable verification.
            </p>
          </motion.div>

          {/* Preserved Floating Hero Copy */}
          <motion.div
            className="copy"
            style={{
              x: '-50%',
              opacity: heroContentOpacity,
              y: heroContentY,
            }}
          >
            <motion.div
              animate={{ y: [0, -7, 0] }}
              transition={{
                duration: 6.67,
                ease: 'easeInOut',
                repeat: Infinity,
              }}
            >
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, delay: 0.24, ease: EASE_OUT }}
              >
                EDUFIND
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.38, ease: EASE_OUT }}
              >
                Truth Deserves Evidence. Verify scientific claims and trace every citation.
              </motion.p>
              <motion.div
                className="cta"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.48, ease: EASE_OUT }}
              >
                <Link to="/upload">
                  <LogIn size={15} strokeWidth={2} aria-hidden="true" />
                  <span>Sign In</span>
                </Link>
              </motion.div>
            </motion.div>
          </motion.div>

          {/* Preserved Staggered Partner Logos */}
          <motion.div
            className="logos"
            aria-label="Partner research organizations"
            variants={LOGOS_CONTAINER_VARIANTS}
            initial="hidden"
            animate="visible"
            style={{ opacity: heroContentOpacity, y: heroContentY }}
          >
            {LOGOS.map((logo) => (
              <motion.div
                key={logo.name}
                className="logo"
                variants={LOGO_ITEM_VARIANTS}
                whileHover={{ y: -2, color: '#111111' }}
                transition={{ duration: 0.2 }}
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d={logo.path} />
                </svg>
                <span>{logo.name}</span>
              </motion.div>
            ))}
          </motion.div>

          <motion.button
            type="button"
            className="scroll-cue pointer-events-auto cursor-pointer border-0 bg-transparent"
            style={{ x: '-50%', opacity: scrollCueOpacity }}
            onClick={() => scrollToSection('#how-it-works')}
            aria-label="Scroll to How It Works"
          >
            <span className="scroll-cue-line" />
            <span>Scroll</span>
            <span className="scroll-cue-line" />
          </motion.button>
        </section>
      </div>

      {/* Seamless Deep-Navy to Warm Off-White Hero Transition Bridge */}
      <div className="relative h-20 overflow-hidden bg-[#F5F3ED] sm:h-24" aria-hidden="true">
        <div
          ref={heroBridgeRef}
          className="absolute inset-0 bg-gradient-to-b from-[#101B2D] via-[#101B2D]/70 to-transparent"
        />
      </div>

      {/* Editorial Content Surface — Unified Max-Width & Swiss Grid Rhythm */}
      <div className="bg-[#F5F3ED] text-[#101B2D]">
        {/* Section 1: How It Works */}
        <section
          id="how-it-works"
          className="mx-auto w-full max-w-[1160px] px-6 pt-16 pb-20 sm:px-8 sm:pt-20 sm:pb-24 lg:px-10 lg:pt-24 lg:pb-28"
        >
          <div data-gsap-reveal>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#71839D] uppercase">
              How It Works
            </p>
            <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="max-w-[660px] text-[28px] leading-[1.16] font-medium tracking-[-0.025em] text-[#101B2D] [text-wrap:balance] sm:text-[36px] lg:text-[40px]">
                A six-stage scientific verification pipeline built for{' '}
                <span className="text-[#71839D]">traceable evidence.</span>
              </h2>
              <Link
                to={`/results/${DEMO_DOCUMENT_ID}`}
                className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 self-start rounded-full border border-[#D9DDE3] bg-white px-5 py-2.5 text-[13px] font-medium whitespace-nowrap text-[#101B2D] no-underline transition hover:border-[#101B2D] sm:self-end"
              >
                <span>Inspect Demo Dashboard</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          <div
            data-gsap-stagger-group
            className="mt-12 grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3"
          >
            {WORKFLOW_STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  data-gsap-stagger-item
                  className="flex h-full flex-col rounded-2xl border border-[#D9DDE3] bg-white p-7 shadow-[0_1px_2px_rgba(16,27,45,0.03)] transition-colors duration-200 hover:border-[#101B2D]/35"
                >
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <span className="font-mono text-xs font-semibold tracking-wider text-[#71839D] tabular-nums">
                      {item.step}
                    </span>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5F3ED] text-[#101B2D]">
                      <Icon size={18} strokeWidth={1.85} />
                    </span>
                  </div>
                  <h3 className="text-[17px] leading-[1.35] font-semibold tracking-[-0.015em] text-[#101B2D]">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-[14.5px] leading-[1.65] text-[#4B586E]">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Platform Capabilities */}
        <section
          id="features"
          className="mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10"
        >
          <div className="border-t border-[#D9DDE3] py-20 sm:py-24 lg:py-28">
            <div data-gsap-reveal>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[#71839D] uppercase">
                Platform Capabilities
              </p>
              <h2 className="mt-4 max-w-[660px] text-[28px] leading-[1.16] font-medium tracking-[-0.025em] text-[#101B2D] [text-wrap:balance] sm:text-[36px] lg:text-[40px]">
                Explainable verification,{' '}
                <span className="text-[#71839D]">not black-box summaries.</span>
              </h2>
            </div>

            <div
              data-gsap-stagger-group
              className="mt-12 grid grid-cols-1 items-stretch gap-x-8 gap-y-10 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3"
            >
              {FEATURES.map((feat) => (
                <div
                  key={feat.title}
                  data-gsap-stagger-item
                  className="flex h-full flex-col border-t border-[#101B2D]/18 pt-6"
                >
                  <h3 className="text-[17px] leading-[1.35] font-semibold tracking-[-0.015em] text-[#101B2D]">
                    {feat.title}
                  </h3>
                  <p className="mt-2.5 text-[14.5px] leading-[1.65] text-[#4B586E]">
                    {feat.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3: Research Sources */}
        <section
          id="sources"
          className="mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10"
        >
          <div className="border-t border-[#D9DDE3] py-20 sm:py-24 lg:py-28">
            <div data-gsap-reveal>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[#71839D] uppercase">
                Research Sources
              </p>
              <h2 className="mt-4 max-w-[660px] text-[28px] leading-[1.16] font-medium tracking-[-0.025em] text-[#101B2D] [text-wrap:balance] sm:text-[36px] lg:text-[40px]">
                Grounded in open scholarly infrastructure.
              </h2>
            </div>

            <div
              data-gsap-stagger-group
              className="mt-12 grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:mt-14"
            >
              <div
                data-gsap-stagger-item
                className="flex h-full flex-col rounded-2xl border border-[#D9DDE3] bg-white p-7 shadow-[0_1px_2px_rgba(16,27,45,0.03)] transition-colors duration-200 hover:border-[#101B2D]/35 sm:p-8"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#101B2D] text-[#F5F3ED]">
                    <BookOpen size={19} strokeWidth={1.85} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[17px] leading-[1.35] font-semibold tracking-[-0.015em] text-[#101B2D]">
                      Crossref Metadata API
                    </h3>
                    <p className="mt-0.5 text-[13px] font-medium text-[#71839D]">
                      DOI resolution &amp; publisher records
                    </p>
                  </div>
                </div>
                <p className="mt-5 text-[14.5px] leading-[1.65] text-[#4B586E]">
                  Resolves DOIs, canonical publication titles, journal metadata, author rosters, and bibliographic dates across scholarly publishers.
                </p>
              </div>

              <div
                data-gsap-stagger-item
                className="flex h-full flex-col rounded-2xl border border-[#D9DDE3] bg-white p-7 shadow-[0_1px_2px_rgba(16,27,45,0.03)] transition-colors duration-200 hover:border-[#101B2D]/35 sm:p-8"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#101B2D] text-[#F5F3ED]">
                    <ShieldCheck size={19} strokeWidth={1.85} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[17px] leading-[1.35] font-semibold tracking-[-0.015em] text-[#101B2D]">
                      OpenAlex Scholarly Graph
                    </h3>
                    <p className="mt-0.5 text-[13px] font-medium text-[#71839D]">
                      Open-access abstracts &amp; citation graph
                    </p>
                  </div>
                </div>
                <p className="mt-5 text-[14.5px] leading-[1.65] text-[#4B586E]">
                  Retrieves open-access full-text locations, inverted abstracts, and citation linkage metadata while transparently recording when only an abstract is accessible.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: About & Final CTA */}
        <section
          id="about"
          className="mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10"
        >
          <div className="border-t border-[#D9DDE3] pt-20 pb-14 sm:pt-24 sm:pb-16 lg:pt-28">
            <div
              data-gsap-reveal
              className="rounded-3xl bg-[#101B2D] px-6 py-14 text-center text-[#F5F3ED] sm:px-12 sm:py-16 lg:px-16 lg:py-20"
            >
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
                <CheckCircle2 size={13} />
                <span>Mission · Transparent Science</span>
              </div>
              <h2 className="mx-auto max-w-[660px] text-[30px] leading-[1.12] font-medium tracking-[-0.025em] text-[#F5F3ED] [text-wrap:balance] sm:text-[40px] lg:text-[46px]">
                Don&apos;t Just Read Research. Verify It.
              </h2>
              <p className="mx-auto mt-5 max-w-[540px] text-[15px] leading-[1.65] text-[#C8D2E1] [text-wrap:balance] sm:text-base">
                EDUFIND AI makes scientific literature transparent, traceable, and trustworthy by pairing every extracted claim with the exact primary evidence behind its citations.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                <Link
                  to="/upload"
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#F5F3ED] px-7 py-3 text-sm font-semibold whitespace-nowrap text-[#101B2D] no-underline transition hover:bg-white sm:w-auto"
                >
                  <span>Start Your First Verification</span>
                  <ArrowRight size={16} />
                </Link>
                <Link
                  to={`/results/${DEMO_DOCUMENT_ID}`}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full border border-white/25 px-7 py-3 text-sm font-medium whitespace-nowrap text-[#F5F3ED] no-underline transition hover:border-white sm:w-auto"
                >
                  <span>Open Verification Workspace</span>
                </Link>
              </div>
            </div>

            <footer className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-[#D9DDE3] pt-8 text-[13px] text-[#71839D] sm:flex-row sm:items-center">
              <span>EDUFIND AI — Scientific Claim &amp; Citation Verification</span>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Link to="/upload" className="text-[#4B586E] no-underline transition hover:text-[#101B2D]">Upload</Link>
                <Link to={`/results/${DEMO_DOCUMENT_ID}`} className="text-[#4B586E] no-underline transition hover:text-[#101B2D]">Dashboard</Link>
                <Link to={`/citations/${DEMO_DOCUMENT_ID}`} className="text-[#4B586E] no-underline transition hover:text-[#101B2D]">Citations</Link>
                <Link to="/reports" className="text-[#4B586E] no-underline transition hover:text-[#101B2D]">Reports</Link>
                <Link to="/settings" className="text-[#4B586E] no-underline transition hover:text-[#101B2D]">Settings</Link>
              </div>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
