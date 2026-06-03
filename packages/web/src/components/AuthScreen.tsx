'use client';

import { useState } from 'react';
import { useChatStore } from '@/store/useChatStore';

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
            <h1 className="font-serif italic font-semibold text-5xl md:text-7xl text-[#0c343d] tracking-tight leading-none">
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
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-serif text-[#0c343d] font-semibold tracking-tight leading-tight max-w-4xl mb-16 md:mb-20">
            <span className="italic font-bold">hiraia</span> is a personal AI tutor in your pocket, built with QVAC
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
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
                  <h3 className="text-lg sm:text-xl font-sans font-bold text-[#0c343d] mb-2">
                    Fine-tuned open-weights LLMs
                  </h3>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1.5 text-sm sm:text-base leading-relaxed">
                    <li>Replies in <strong className="text-[#0c343d]">Tagalog, Bisaya</strong>, and English</li>
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
                  <h3 className="text-lg sm:text-xl font-sans font-bold text-[#0c343d] mb-2">
                    Offline mode
                  </h3>
                  <ul className="list-disc pl-5 text-gray-600 space-y-1.5 text-sm sm:text-base leading-relaxed">
                    <li>No internet required for chat, entire package is <strong className="text-[#0c343d]">less than 2Gb</strong></li>
                    <li>Internet only required for <strong className="text-[#0c343d]">student evaluation and sync</strong></li>
                  </ul>
                </div>
              </div>

              {/* Item 3: Hybrid model */}
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-[#f3a228] shadow-md shadow-[#f3a228]/10">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-sans font-bold text-[#0c343d] mb-2">
                    Hybrid model
                  </h3>
                  <p className="text-gray-600 text-sm sm:text-base leading-relaxed pl-1">
                    Can use FB Messenger for higher-quality cloud-based replies and <strong className="text-[#0c343d]">fine-tuned image generation</strong>
                  </p>
                </div>
              </div>

              {/* Item 4: Entry-level phone requirements */}
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-[#0f8c5c] shadow-md shadow-[#0f8c5c]/10">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-sans font-bold text-[#0c343d] mb-2">
                    Entry-level phone requirements
                  </h3>
                  <p className="text-gray-600 text-sm sm:text-base leading-relaxed pl-1">
                    Runs on cheap phones from <strong className="text-[#0c343d]">five years ago</strong>; <strong className="text-[#0c343d]">no other costs</strong> or ongoing fees!
                  </p>
                </div>
              </div>

            </div>

            {/* Right Column: Hand and app image */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end mt-8 lg:mt-0">
              <img 
                src="/hand-and-app.png" 
                alt="Hiraia App Preview" 
                className="w-full max-w-[320px] sm:max-w-[400px] lg:max-w-none object-contain drop-shadow-[0_25px_25px_rgba(12,52,61,0.15)] hover:scale-[1.01] transition-transform duration-300"
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: VIDEO OVERVIEW (DARK GREEN BACKGROUND) */}
      <div className="w-full bg-[#051f25] py-16 sm:py-24 px-6 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16 items-center">
            
            {/* Left Column: YouTube Placeholder Video Card */}
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl flex items-center justify-center group cursor-pointer">
              {/* Fake Video Cover Image (Simulating YouTube Thumbnail blur) */}
              <div 
                className="absolute inset-0 bg-cover bg-center filter brightness-[0.4] group-hover:scale-105 transition-transform duration-500"
                style={{ backgroundImage: "url('/landing.jpeg')" }}
              />
              
              {/* Play Button Icon */}
              <div className="relative z-10 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/30 group-hover:bg-red-700 group-hover:scale-110 transition-all duration-300">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 fill-current ml-1" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>

              {/* Overlay Vignette */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
              <div className="absolute bottom-4 left-4 text-white/60 text-xs sm:text-sm font-sans tracking-wide">
                YouTube Video Placeholder
              </div>
            </div>

            {/* Right Column: Descriptions */}
            <div className="space-y-4 sm:space-y-6">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-serif italic text-teal-300 font-semibold leading-tight">
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
