'use client';

import { useState } from 'react';
import { useChatStore } from '@/store/useChatStore';
import { AppDownload } from '@/components/AppDownload';
import { DOWNLOAD } from '@/config/download';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';

export function AuthScreen() {
  const { authenticate, error } = useChatStore();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    await authenticate(mode, email.trim(), password);
    setBusy(false);
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
  };

  return (
    <div className="w-full min-h-screen bg-white overflow-x-hidden">
      {/* HERO SECTION (90% screen height) */}
      <div 
        className="h-[90vh] w-full flex items-start justify-start bg-cover bg-center bg-no-repeat relative font-sans"
        style={{ backgroundImage: "url('/landing.jpeg')" }}
      >
        {/* Subtle overlay for contrast and depth */}
        <div className="absolute inset-0 bg-black/15" />

        {/* Responsive Container for logo + card to align them perfectly on the left */}
        <div className="relative z-10 flex flex-col items-start gap-6 sm:gap-8 w-full max-w-sm mx-auto sm:mx-0 sm:ml-12 md:ml-20 lg:ml-28 xl:ml-36 px-4 sm:px-0 pt-16 sm:pt-20 md:pt-24">
          {/* Branding Headline aligned to the form */}
          <div className="select-none w-full">
            <h1 className="font-title text-5xl md:text-7xl text-[#0c343d] tracking-tight leading-none">
              hiraia
            </h1>
            <p className="font-serif italic text-sm md:text-lg text-[#0c343d]/90 mt-2 md:mt-3">
              Decentralized AI tutoring for the global south
            </p>
          </div>

          {/* Floating glassmorphic card */}
          <div className="w-full bg-[#0c343d]/45 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </h2>
              <p className="text-sm text-slate-200/70">
                {mode === 'login' ? 'Enter your credentials to continue' : 'Join Hiraia - Your AI Science Tutor'}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/15 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 text-white placeholder-slate-400/60 rounded-xl transition-all outline-none"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/15 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 text-white placeholder-slate-400/60 rounded-xl transition-all outline-none"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-red-200 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-[#0c343d] hover:bg-[#124d5a] text-white py-3 rounded-xl transition-all font-semibold shadow-lg shadow-[#0c343d]/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                onClick={toggleMode}
                className="text-sm text-teal-300 hover:text-teal-200 font-semibold underline transition-colors"
              >
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-[#0c343d]/80 animate-bounce select-none pointer-events-none">
          <span className="text-[10px] font-bold uppercase tracking-widest font-sans">Learn More</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {/* SECTION 2: FEATURE SPECIFICATIONS */}
      <div className="w-full bg-[#fcfdfd] py-16 sm:py-24 px-6 md:px-12 lg:px-24 border-b border-gray-100">
        <div className="max-w-7xl mx-auto">
          {/* Main Section Header */}
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display text-[#0c343d] tracking-tight leading-tight max-w-4xl mb-8 md:mb-10">
            <span className="italic font-bold">hiraia</span> is a personal AI tutor in your pocket, built with QVAC
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-end">
            {/* Left Column: Feature Items */}
            <div className="lg:col-span-7 space-y-10 sm:space-y-12">
              
              {/* Item 1: Fine-tuned open-weights LLMs */}
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-[#f3a228] shadow-md shadow-[#f3a228]/10">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m11.177-12.138A25.907 25.907 0 0012 11.5" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-display text-[#0c343d] mb-2">
                    Fine-tuned open-weights LLMs
                  </h3>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1.5 text-sm sm:text-base leading-relaxed">
                    <li>Replies in <strong className="text-[#0c343d]">Tagalog</strong> and <strong className="text-[#0c343d]">English</strong> — Bisaya coming soon</li>
                    <li>Augments in-person classroom learning with review and reinforcement at home on-demand</li>
                  </ul>
                </div>
              </div>

              {/* Item 2: Offline mode */}
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-[#0f8c5c] shadow-md shadow-[#0f8c5c]/10">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-display text-[#0c343d] mb-2">
                    Offline mode
                  </h3>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1.5 text-sm sm:text-base leading-relaxed">
                    {/*
                      Two numbers, stated separately, because they are two different costs to
                      the user: APK bytes (art + adapters are bundled — the release APK measures
                      ~1.06 GB; DOWNLOAD.apk.fileSizeMB carries the exact figure once measured)
                      and the first-run download (base model + embedder). Their sum is ~4.7 GB
                      of storage, so the old "less than 4 GB" was a bound the build already
                      exceeded — and it fails as a stalled download, not a storage warning.
                    */}
                    <li>No internet required for chat — the app is <strong className="text-[#0c343d]">about 1 GB</strong>, and the AI model is a further <strong className="text-[#0c343d]">~{DOWNLOAD.modelDownloadGB} GB</strong> one-time download</li>
                    <li>Internet only needed for the <strong className="text-[#0c343d]">initial download and databank updates</strong></li>
                  </ul>
                </div>
              </div>

              {/* Item 3: Entry-level phone requirements */}
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-[#0f8c5c] shadow-md shadow-[#0f8c5c]/10">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-display text-[#0c343d] mb-2">
                    Entry-level phone requirements
                  </h3>
                  <p className="text-gray-600 text-sm sm:text-base leading-relaxed pl-1">
                    Runs on cheap phones from <strong className="text-[#0c343d]">five years ago</strong>; <strong className="text-[#0c343d]">no other costs</strong> or ongoing fees!
                  </p>
                </div>
              </div>

            </div>

            {/* Right Column: Hand and app image (bleeds to the section's bottom edge) */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end mt-8 lg:mt-0 lg:-mb-24">
              <img 
                src="/hand-and-app.png" 
                alt="Hiraia App Preview" 
                className="w-full max-w-[320px] sm:max-w-[400px] lg:max-w-none object-contain drop-shadow-[0_25px_25px_rgba(12,52,61,0.15)] hover:scale-[1.01] transition-transform duration-300"
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2.5: FREE TO DOWNLOAD (YELLOW — the one call to action) */}
      <div className="w-full bg-[#f3a228] py-16 sm:py-24 px-6 md:px-12 lg:px-24 border-b border-[#0c343d]/10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display text-[#0c343d] tracking-tight leading-tight mb-2">
            Free to download
          </h2>
          <p className="text-base sm:text-lg text-[#0c343d]/80 leading-relaxed max-w-2xl mb-8 md:mb-10">
            No account, no fees, no Play Store. Just download, install, and start learning.
          </p>
          <AppDownload />
        </div>
      </div>

      {/* SECTION 3: VIDEO OVERVIEW (DARK GREEN BACKGROUND) */}
      <div className="w-full bg-[#051f25] py-16 sm:py-24 px-6 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16 items-center">
            
            {/* Left Column: founder overview video (click-to-play, inline) */}
            <YouTubeEmbed id="nmoIvZcPmEE" title="Why we built Hiraia" poster="/landing.jpeg" />

            {/* Right Column: Descriptions */}
            <div className="space-y-4 sm:space-y-6">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-display text-teal-300 leading-tight">
                Why we built hiraia
              </h2>
              <p className="text-base sm:text-lg text-slate-200/90 leading-relaxed max-w-xl">
                Founder Luis Buenaventura talks about the declining aptitude of Filipino schoolchildren and what we believe AI can do to get us back on track.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
