import {
  Activity,
  CheckCircle,
  Copy,
  CreditCard,
  Database,
  FileX,
  Github,
  MousePointer2,
  PlayCircle,
  RefreshCw,
  Server,
  Share2,
  Users,
  Wand2,
  Workflow,
} from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

function BgGrid({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={className}
      style={{
        backgroundSize: '32px 32px',
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
      }}
    >
      {children}
    </div>
  );
}

export function Home() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText('npx tuongaz/seeflow start');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="antialiased flex flex-col min-h-screen"
      style={{
        fontFamily: "'Inter', sans-serif",
        backgroundColor: '#09090b',
        color: '#e4e4e7',
        scrollBehavior: 'smooth',
      }}
    >
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold tracking-tight text-lg">
            <Workflow size={20} className="text-emerald-400" />
            SeeFlow
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a href="#problem" className="hover:text-zinc-100 transition-colors">
              Problem
            </a>
            <a href="#features" className="hover:text-zinc-100 transition-colors">
              Features
            </a>
            <a href="#ai" className="hover:text-zinc-100 transition-colors">
              Claude Plugin
            </a>
            <a href="#docs" className="hover:text-zinc-100 transition-colors">
              Docs
            </a>
          </nav>
          <a
            href="https://github.com/tuongaz/seeflow"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-100 transition-colors"
            aria-label="GitHub"
          >
            <Github size={20} />
          </a>
        </div>
      </header>

      <main className="flex-grow pt-24 pb-12 md:pb-20">
        {/* Hero */}
        <section className="relative max-w-6xl mx-auto px-6 pt-6 md:pt-24 pb-8 md:pb-16 text-center">
          <BgGrid className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]" />

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-zinc-100 mb-6 max-w-4xl mx-auto leading-tight">
            Architecture diagrams that{' '}
            <span
              className="bg-gradient-to-r from-emerald-400 to-emerald-200"
              style={{
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              actually run.
            </span>
          </h1>

          <p className="text-base md:text-xl text-zinc-400 max-w-2xl mx-auto mb-6 md:mb-10 leading-relaxed font-medium">
            Turn your static system architecture into a live control panel wired directly to your
            running application.
          </p>

          <div className="flex items-center justify-center">
            <div
              className="flex items-center justify-between w-full sm:w-auto bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-300"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span className="text-zinc-500 mr-4">$</span>
              npx tuongaz/seeflow start
              <button
                type="button"
                onClick={handleCopy}
                className="ml-4 text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Copy command"
              >
                {copied ? (
                  <CheckCircle size={14} className="text-emerald-400" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          </div>

          {/* Hero canvas mockup */}
          <div
            className="mt-8 md:mt-24 relative rounded-xl border border-zinc-800/60 bg-zinc-950/50 backdrop-blur-xl shadow-2xl overflow-hidden"
            style={{ boxShadow: '0 0 40px -10px rgba(16,185,129,0.15)' }}
          >
            {/* Mac window header */}
            <div className="flex items-center px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/50">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              </div>
              <div
                className="mx-auto text-xs text-zinc-500 flex items-center gap-2"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                checkout-flow.json
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] uppercase tracking-widest border border-emerald-500/20">
                  Live
                </span>
              </div>
            </div>

            {/* Canvas */}
            <BgGrid className="relative p-8 md:p-16 min-h-[300px] flex flex-col md:flex-row items-center justify-center gap-4 md:gap-12">
              {/* Node 1: Gateway */}
              <div className="relative w-48 bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-lg flex flex-col gap-3 group hover:border-zinc-700 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                    <div className="p-1 rounded bg-zinc-800 text-zinc-400">
                      <Server size={14} />
                    </div>
                    Gateway
                  </div>
                  <button
                    type="button"
                    className="text-emerald-400 hover:text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <PlayCircle size={18} />
                  </button>
                </div>
                <div
                  className="text-xs text-zinc-500"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  POST /checkout
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    200 OK
                  </span>
                  <span className="text-zinc-500">12ms</span>
                </div>
              </div>

              {/* Connector HTTP */}
              <div className="hidden md:flex flex-col items-center justify-center gap-1 text-zinc-600">
                <span
                  className="text-[10px] tracking-widest uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  HTTP
                </span>
                <div className="w-12 h-px bg-zinc-700 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t border-r border-zinc-700 rotate-45" />
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-0.5 bg-emerald-400/50 rounded-full animate-ping"
                    style={{ boxShadow: '0 0 8px rgba(52,211,153,0.8)' }}
                  />
                </div>
              </div>
              <div className="md:hidden w-px h-8 bg-zinc-800" />

              {/* Node 2: Payment */}
              <div className="relative w-48 bg-zinc-900 border border-amber-500/30 rounded-lg p-4 shadow-lg flex flex-col gap-3">
                <div className="absolute -top-px -left-px -right-px h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                    <div className="p-1 rounded bg-zinc-800 text-zinc-400">
                      <CreditCard size={14} />
                    </div>
                    Payment
                  </div>
                  <RefreshCw size={16} className="text-amber-400 animate-spin" />
                </div>
                <div
                  className="text-xs text-zinc-500"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Stripe API
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                    Processing...
                  </span>
                </div>
              </div>

              {/* Connector Event */}
              <div className="hidden md:flex flex-col items-center justify-center gap-1 text-zinc-600">
                <span
                  className="text-[10px] tracking-widest uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Event
                </span>
                <div className="w-12 h-px bg-zinc-700 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t border-r border-zinc-700 rotate-45" />
                </div>
              </div>
              <div className="md:hidden w-px h-8 bg-zinc-800" />

              {/* Node 3: Inventory DB */}
              <div className="relative w-48 bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-lg flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200 mb-1">
                  <div className="p-1 rounded bg-zinc-800 text-zinc-400">
                    <Database size={14} />
                  </div>
                  Inventory DB
                </div>
                <div
                  className="text-xs text-zinc-500"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  PostgreSQL
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between text-zinc-500">
                    <span>Pool size</span>
                    <span>12/50</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1 mt-1">
                    <div className="bg-zinc-400 h-1 rounded-full" style={{ width: '24%' }} />
                  </div>
                </div>
              </div>
            </BgGrid>
          </div>
        </section>

        {/* AI Integration */}
        <section id="ai" className="py-8 md:py-20 border-t border-zinc-800/50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex flex-col lg:flex-row items-center gap-6 md:gap-12">
              <div className="lg:w-1/2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/20 bg-purple-500/10 text-xs font-medium text-purple-400 mb-4 md:mb-6">
                  <Wand2 size={12} />
                  Claude Code Plugin
                </div>
                <h2 className="text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
                  Zero to running demo in one prompt.
                </h2>
                <p className="text-zinc-400 text-base leading-relaxed mb-4 md:mb-6">
                  Don't want to write JSON? The SeeFlow Claude Code plugin reads your codebase,
                  understands your architecture, and generates the full diagram and request scripts
                  automatically.
                </p>
                <ul className="space-y-3 mb-5 md:mb-8 text-sm text-zinc-300">
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>Scans routes and database connections</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      Generates{' '}
                      <code className="bg-zinc-800 px-1 rounded text-xs text-zinc-400">
                        seeflow.json
                      </code>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      Works with Claude Code, Codex, Cursor, and Windsurf
                    </span>
                  </li>
                </ul>
              </div>

              <div className="lg:w-1/2 w-full">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
                  <div
                    className="flex items-center px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Terminal
                  </div>
                  <div
                    className="p-4 text-sm leading-relaxed"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <div className="text-zinc-300 mb-2">
                      <span className="text-emerald-400">❯</span> /create-seeflow show me the
                      shopping cart feature
                    </div>
                    <div className="text-zinc-500 pl-4 mb-2">
                      Analyzing codebase...
                      <br />
                      Found 3 services: API Gateway, Payment Worker, Inventory DB.
                      <br />
                      Generating seeflow.json...
                      <br />
                      Wiring up demo scripts...
                    </div>
                    <div className="text-zinc-300 pl-4 flex items-center gap-2">
                      <CheckCircle size={14} className="text-emerald-400" />
                      Success! Diagram running on localhost:4321
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section id="problem" className="max-w-6xl mx-auto px-6 py-8 md:py-20 border-t border-zinc-800/50">
          <div className="text-center mb-8 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
              Static diagrams are dead on arrival.
            </h2>
            <p className="text-zinc-400 text-base font-medium max-w-2xl mx-auto">
              We build dynamic systems and document them with static pictures. It's time for tooling
              that matches reality.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <FileX size={20} />,
                title: 'Diagram Drift',
                body: 'Confluence pages go stale six months later. SeeFlow breaks loudly when your actual system changes.',
              },
              {
                icon: <Users size={20} />,
                title: 'Onboarding Friction',
                body: 'Stop making new hires read walls of text. Let them click through a live flow and understand the system in 30 minutes.',
              },
              {
                icon: <Activity size={20} />,
                title: 'Demo Tedium',
                body: 'Manually clicking through microservices to show stakeholders is painful. Script it once, replay it flawlessly forever.',
              },
            ].map(({ icon, title, body }) => (
              <div key={title} className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 mb-4 border border-zinc-700">
                  {icon}
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">{title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="py-8 md:py-20 bg-zinc-900/20 border-y border-zinc-800/50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 relative">
              <div className="hidden md:block absolute top-6 left-1/6 right-1/6 h-px bg-zinc-800 -z-10" />

              <div className="text-center">
                <div
                  className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto mb-6 text-xl"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  1
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Ask your favourite vibe code editor
                </h3>
                <p className="text-sm text-zinc-400">
                  Use the SeeFlow plugin in Claude Code, Cursor, Windsurf, or Codex to generate your
                  diagram from your codebase in seconds.
                </p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-6">
                  <PlayCircle size={22} />
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Play the Flow
                </h3>
                <p className="text-sm text-zinc-400">
                  Click a node. SeeFlow fires real HTTP requests or events and animates the diagram
                  based on real responses.
                </p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto mb-6">
                  <Share2 size={20} />
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Share the Truth
                </h3>
                <p className="text-sm text-zinc-400">
                  Export to a shareable cloud link. Product, Sales, and QA can view the live
                  system—no setup required.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Bento */}
        <section id="features" className="max-w-6xl mx-auto px-6 py-8 md:py-20">
          <div className="mb-6 md:mb-12">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
              Everything you need to document reality.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Interactive Canvas */}
            <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 md:p-8 flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-zinc-800/20 to-transparent pointer-events-none" />
              <div className="z-10 max-w-sm">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 mb-4 border border-zinc-700">
                  <MousePointer2 size={20} />
                </div>
                <h3 className="text-xl font-medium text-zinc-100 mb-2 tracking-tight">
                  Interactive Canvas
                </h3>
                <p className="text-sm text-zinc-400">
                  A visual drag-and-drop editor built for engineers. Nodes map to real endpoints,
                  connectors map to real network requests.
                </p>
              </div>
              <div className="absolute -right-8 -bottom-8 opacity-40 group-hover:opacity-100 transition-opacity duration-500">
                <div className="w-48 h-48 border border-zinc-700 rounded-lg bg-zinc-950/80 p-4 transform rotate-12 flex gap-2 shadow-2xl">
                  <div className="w-1/2 h-8 bg-zinc-800 rounded" />
                  <div className="w-1/2 h-8 bg-emerald-500/20 border border-emerald-500/30 rounded" />
                </div>
              </div>
            </div>

            {/* Live Status */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 md:p-8 flex flex-col justify-between relative overflow-hidden">
              <div className="z-10">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 mb-4 border border-zinc-700">
                  <Activity size={20} />
                </div>
                <h3 className="text-xl font-medium text-zinc-100 mb-2 tracking-tight">
                  Live Status
                </h3>
                <p className="text-sm text-zinc-400">
                  Nodes stream real-time tickers directly from your app.
                </p>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  { label: 'SQS Depth', value: '1,204 msgs', color: 'text-amber-400' },
                  { label: 'DB Health', value: 'Connected', color: 'text-emerald-400' },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between text-xs bg-zinc-950 border border-zinc-800 p-2 rounded"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <span className="text-zinc-500">{label}</span>
                    <span className={color}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 bg-zinc-950 py-8 md:py-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold tracking-tight text-lg">
            <Workflow size={18} className="text-emerald-400" />
            SeeFlow
          </div>
          <div className="flex gap-6 text-sm text-zinc-400 font-medium">
            {[
              { label: 'npm', href: '#' },
              { label: 'GitHub', href: 'https://github.com/tuongaz/seeflow' },
              { label: 'Docs', href: '#' },
              { label: 'Twitter', href: '#' },
            ].map(({ label, href }) => (
              <a key={label} href={href} className="hover:text-zinc-100 transition-colors">
                {label}
              </a>
            ))}
          </div>
          <div className="text-sm text-zinc-500">© 2024 SeeFlow. The living truth.</div>
        </div>
      </footer>
    </div>
  );
}
