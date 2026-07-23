import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import type { Portal } from '@/features/auth/portal';
import { Reveal } from '@/features/landing/Reveal';
import { AuroraBackdrop } from '@/features/landing/AuroraBackdrop';
import { cn } from '@/lib/cn';

/**
 * Public landing page — the front door to Paradox Connect. Keeps the reference
 * fest's playful, festival-sky energy and strong Register CTA, but elevates it
 * into a modern, accessible, high-performance experience that also sells the
 * actual product (one app, digital pass, offline-ready). All decoration is
 * self-contained CSS/SVG, motion respects prefers-reduced-motion, and the whole
 * page is keyboard- and screen-reader-friendly.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const go = (portal: Portal) => navigate(ROUTES.login, { state: { portal } });

  return (
    <div className="min-h-full bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <LandingNav onRegister={() => go('student')} onSignIn={() => go('student')} />
      <main id="main">
        <Hero onRegister={() => go('student')} onSignIn={() => go('student')} />
        <Marquee />
        <Highlights />
        <Experience />
        <HowItWorks />
        <Faq />
        <CtaBand onRegister={() => go('student')} />
      </main>
      <LandingFooter onStaff={() => go('organizer')} />
    </div>
  );
}

/* -------------------------------------------------------------- nav --- */

const NAV_LINKS = [
  { href: '#highlights', label: 'Highlights' },
  { href: '#experience', label: 'The app' },
  { href: '#how', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
];

function LandingNav({ onRegister, onSignIn }: { onRegister: () => void; onSignIn: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-all duration-300',
        scrolled ? 'glass border-b border-line/60' : 'border-b border-transparent',
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <a href="#main" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
            P
          </span>
          <span className="text-base font-black tracking-tight">Paradox Connect</span>
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="tap rounded-full px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSignIn}
            className="tap hidden rounded-full px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2 sm:block"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="tap rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-fab hover:bg-brand-dark active:scale-95"
          >
            Register
          </button>
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------- hero --- */

function Hero({ onRegister, onSignIn }: { onRegister: () => void; onSignIn: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <AuroraBackdrop />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pb-28 lg:pt-24">
        <div className="flex flex-col items-start gap-6">
          <span className="animate-fade inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface/70 px-3 py-1 text-xs font-semibold text-brand backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            IIT Madras · The fest of paradoxes
          </span>

          <h1 className="animate-rise text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Where curiosity
            <br />
            meets <span className="text-gradient">paradox</span>.
          </h1>

          <p className="animate-rise max-w-lg text-base text-muted sm:text-lg" style={{ animationDelay: '80ms' }}>
            Register once, then live the whole fest from one app — events and schedules, hostel and
            mess, payments, and a secure digital pass that works even offline.
          </p>

          <div className="animate-rise flex flex-wrap items-center gap-3" style={{ animationDelay: '160ms' }}>
            <button
              type="button"
              onClick={onRegister}
              className="tap rounded-full bg-brand px-6 py-3 text-sm font-bold text-white shadow-fab hover:bg-brand-dark active:scale-95"
            >
              Register with college email
            </button>
            <button
              type="button"
              onClick={onSignIn}
              className="tap rounded-full border border-line bg-surface px-6 py-3 text-sm font-bold text-ink shadow-card hover:-translate-y-0.5 hover:shadow-lift"
            >
              I already have an account
            </button>
          </div>

          <dl className="animate-fade mt-4 flex gap-8" style={{ animationDelay: '240ms' }}>
            <Stat value="60+" label="Events & workshops" />
            <Stat value="3 days" label="Non-stop fest" />
            <Stat value="1 app" label="For everything" />
          </dl>
        </div>

        {/* Floating app preview */}
        <div className="relative hidden lg:block">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-2xl font-black text-ink">{value}</dt>
      <dd className="text-xs text-muted">{label}</dd>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto h-[420px] w-full max-w-sm">
      {/* Digital pass card */}
      <div className="animate-float absolute left-2 top-4 w-64 rotate-[-6deg] rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-lift">
        <p className="text-xs text-white/70">Digital ID · Event</p>
        <p className="mt-1 font-bold">Aarav Sharma</p>
        <div className="mt-4 grid grid-cols-4 grid-rows-4 gap-1">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className={cn('aspect-square rounded-[3px]', (i * 7) % 3 === 0 ? 'bg-white' : 'bg-white/25')}
            />
          ))}
        </div>
        <p className="mt-3 font-mono text-lg font-bold tracking-[0.3em]">824 193</p>
      </div>

      {/* Event card */}
      <div
        className="animate-float-slow absolute right-0 top-28 w-60 rotate-[5deg] rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04]"
        style={{ animationDelay: '-2s' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl bg-brand-100 text-brand">
            <span className="text-lg font-black leading-none">14</span>
            <span className="text-[10px] font-semibold uppercase">Aug</span>
          </div>
          <div>
            <p className="text-sm font-bold text-ink">Opening Keynote</p>
            <p className="text-xs text-muted">CLT · 10:00</p>
          </div>
        </div>
        <span className="mt-3 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
          ✓ Registered
        </span>
      </div>

      {/* Notification chip */}
      <div
        className="animate-float absolute bottom-2 left-6 w-56 rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-black/[0.04]"
        style={{ animationDelay: '-4s' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📣</span>
          <div>
            <p className="text-xs font-bold text-ink">Pro Night lineup is live</p>
            <p className="text-[11px] text-muted">Tap to see who's performing</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- marquee --- */

const MARQUEE_ITEMS = [
  'Competitions',
  'Workshops',
  'Pro Nights',
  'Guest Talks',
  'Exhibitions',
  'Hackathons',
  'Cultural',
  'Sports',
];

function Marquee() {
  const row = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="border-y border-line/60 bg-surface/50 py-4" aria-hidden>
      <div className="relative overflow-hidden">
        <div className="animate-marquee flex w-max gap-3">
          {row.map((item, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap text-lg font-black tracking-tight text-muted/70"
            >
              {item}
              <span className="text-brand">✦</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ highlights --- */

const HIGHLIGHTS = [
  { icon: '🏆', title: 'Competitions', desc: 'Flagship contests across tech, data, and design with real prize pools.', tint: 'from-brand/15 to-brand/5' },
  { icon: '🛠️', title: 'Workshops', desc: 'Hands-on sessions led by industry mentors and researchers.', tint: 'from-accent/15 to-accent/5' },
  { icon: '🎤', title: 'Pro Nights', desc: 'Headline performances and shows to close out each day.', tint: 'from-violet-400/20 to-violet-400/5' },
  { icon: '💡', title: 'Guest Talks', desc: 'Ideas worth travelling for, from people who built them.', tint: 'from-sky-400/20 to-sky-400/5' },
];

function Highlights() {
  return (
    <section id="highlights" aria-labelledby="highlights-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <Reveal className="mb-10 max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">What’s on</p>
        <h2 id="highlights-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
          Three days, endless paradoxes
        </h2>
        <p className="mt-3 text-muted">
          A packed lineup across every interest — pick your track and build your own schedule.
        </p>
      </Reveal>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HIGHLIGHTS.map((h, i) => (
          <Reveal as="li" key={h.title} delay={i * 80}>
            <article
              className={cn(
                'group h-full rounded-3xl bg-gradient-to-br p-6 ring-1 ring-black/[0.04] transition-all duration-300 hover:-translate-y-1 hover:shadow-lift',
                h.tint,
              )}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-2xl shadow-card transition-transform duration-300 group-hover:scale-110">
                {h.icon}
              </span>
              <h3 className="mt-4 text-lg font-bold text-ink">{h.title}</h3>
              <p className="mt-1 text-sm text-muted">{h.desc}</p>
            </article>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------ experience --- */

const FEATURES = [
  { icon: '🎟️', title: 'One pass for everything', desc: 'A secure digital ID that works at every checkpoint — and offline when the network is busy.' },
  { icon: '📅', title: 'Your schedule, sorted', desc: 'Register for events, get reminders, and see venues and timings at a glance.' },
  { icon: '🏨', title: 'Stay & mess, booked', desc: 'Request accommodation and meal plans, and track payments in one place.' },
  { icon: '📣', title: 'Never miss an update', desc: 'Announcements and lineup changes reach you the moment they happen.' },
  { icon: '⚡', title: 'Fast & installable', desc: 'A progressive web app you can add to your home screen — no store, no bloat.' },
  { icon: '🔒', title: 'Private by design', desc: 'Rotating QR codes and verified college sign-in keep your identity safe.' },
];

function Experience() {
  return (
    <section id="experience" aria-labelledby="experience-title" className="relative overflow-hidden bg-surface/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-10 max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand">The app</p>
          <h2 id="experience-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            The whole fest, in your pocket
          </h2>
          <p className="mt-3 text-muted">
            Paradox Connect replaces the paper, queues, and group chats with one fast, focused app.
          </p>
        </Reveal>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 3) * 80}>
              <article className="flex h-full flex-col gap-3 rounded-3xl bg-surface p-6 shadow-card ring-1 ring-black/[0.04] transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-2xl">
                  {f.icon}
                </span>
                <h3 className="text-lg font-bold text-ink">{f.title}</h3>
                <p className="text-sm text-muted">{f.desc}</p>
              </article>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ how it works --- */

const STEPS = [
  { n: '01', title: 'Register', desc: 'Sign in with your IITM college email — verified and secure in seconds.' },
  { n: '02', title: 'Set up', desc: 'Complete your profile, then optionally book accommodation and a meal plan.' },
  { n: '03', title: 'Pick events', desc: 'Browse the lineup and register for everything you want to attend.' },
  { n: '04', title: 'Show your pass', desc: 'Flash your digital ID at entry — works offline, refreshes every 30 seconds.' },
];

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <Reveal className="mb-10 max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">How it works</p>
        <h2 id="how-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
          From sign-up to show floor in four steps
        </h2>
      </Reveal>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.n} delay={i * 90}>
            <div className="relative h-full rounded-3xl border border-line bg-surface p-6">
              <span className="text-4xl font-black text-brand/20">{s.n}</span>
              <h3 className="mt-2 text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------- faq --- */

const FAQS = [
  { q: 'Who can register?', a: 'Any IIT Madras student. Register with your email and a password, then complete your profile to get your pass.' },
  { q: 'Is accommodation or a meal plan required?', a: 'No. Both are optional. You can register for events without booking a stay or mess plan, and add them later during onboarding.' },
  { q: 'How does the digital pass work?', a: 'Your identity generates a rotating QR code on your device. It refreshes every 30 seconds and keeps working offline, so entry is fast even with a weak network.' },
  { q: 'Do I need to install anything?', a: 'No app store needed. Paradox Connect is a progressive web app — open it in your browser and optionally add it to your home screen for an app-like experience.' },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" aria-labelledby="faq-title" className="bg-surface/40 py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-brand">FAQ</p>
          <h2 id="faq-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Good questions, answered
          </h2>
        </Reveal>

        <div className="flex flex-col gap-3">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 60}>
                <div className="overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-black/[0.04]">
                  <h3>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`faq-panel-${i}`}
                      id={`faq-trigger-${i}`}
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="tap flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <span className="font-bold text-ink">{item.q}</span>
                      <span
                        aria-hidden
                        className={cn(
                          'shrink-0 text-xl text-brand transition-transform duration-300',
                          isOpen && 'rotate-45',
                        )}
                      >
                        +
                      </span>
                    </button>
                  </h3>
                  <div
                    id={`faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`faq-trigger-${i}`}
                    hidden={!isOpen}
                    className="px-5 pb-5 text-sm text-muted"
                  >
                    {item.a}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- cta band --- */

function CtaBand({ onRegister }: { onRegister: () => void }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand via-brand-dark to-[#2b258f] px-6 py-16 text-center text-white shadow-lift">
          <div aria-hidden className="animate-blob absolute -left-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div
            aria-hidden
            className="animate-blob absolute -bottom-12 -right-8 h-64 w-64 rounded-full bg-accent/30 blur-2xl"
            style={{ animationDelay: '-8s' }}
          />
          <div className="relative">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Ready for Paradox?</h2>
            <p className="mx-auto mt-3 max-w-md text-white/80">
              Register with your college email and get your digital pass in under a minute.
            </p>
            <button
              type="button"
              onClick={onRegister}
              className="tap mt-8 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-brand shadow-fab hover:-translate-y-0.5 active:scale-95"
            >
              Get started
            </button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------ footer --- */

function LandingFooter({ onStaff }: { onStaff: () => void }) {
  return (
    <footer className="border-t border-line/60 bg-surface/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-sm font-black text-white">
            P
          </span>
          <div className="leading-tight">
            <p className="text-sm font-black">Paradox Connect</p>
            <p className="text-xs text-muted">IIT Madras · {new Date().getFullYear()}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
          <a href="#highlights" className="hover:text-ink">Highlights</a>
          <a href="#experience" className="hover:text-ink">The app</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
          <button type="button" onClick={onStaff} className="font-medium text-brand hover:underline">
            Organizer / Admin sign-in
          </button>
        </div>
      </div>
    </footer>
  );
}
