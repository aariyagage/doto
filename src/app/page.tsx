import Link from 'next/link'
import { Sparkles, Video, Fingerprint, Lightbulb, Library, ArrowUpRight } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FDFCFB] text-black overflow-hidden relative selection:bg-pink-200">
      {/* Custom Font Definition */}
      <style dangerouslySetInnerHTML={{
        __html: `
                @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap');
                .font-caslon {
                    font-family: 'Adobe Caslon Pro', 'Cormorant Garamond', serif;
                }
            `}} />

      {/* Navigation Header */}
      <nav className="w-full p-6 flex justify-between items-center relative z-50">
        <div className="font-caslon italic font-bold text-4xl tracking-tighter">doto</div>
        <div className="flex gap-4 items-center">
          <Link href="/login" className="px-5 py-2 rounded-full border border-gray-200 font-medium text-sm hover:bg-gray-50 transition-colors">
            Log In
          </Link>
          <Link href="/signup" className="px-5 py-2 rounded-full bg-black text-white font-medium text-sm hover:bg-gray-800 transition-colors shadow-xl">
            Sign Up ✨
          </Link>
        </div>
      </nav>

      {/* Hero Section - Scattered Anti-Design */}
      <main className="relative w-full h-[calc(100vh-100px)] flex items-center justify-center p-8 max-w-[1400px] mx-auto">
        <div className="w-full max-w-5xl relative h-[600px] flex items-center justify-center">

          {/* Background floating elements */}
          <div className="absolute top-[10%] left-[5%] rotate-[-12deg] opacity-60">
            <Sparkles className="w-12 h-12 text-pink-400" />
          </div>
          <div className="absolute bottom-[20%] right-[10%] rotate-[15deg] opacity-70">
            <Video className="w-16 h-16 text-blue-400" />
          </div>
          <div className="absolute top-[30%] right-[5%] rotate-[-5deg] opacity-50">
            <Fingerprint className="w-20 h-20 text-indigo-300" />
          </div>

          {/* Central Chaotic Typography Cluster */}
          <div className="relative w-full h-full flex flex-col items-center justify-center text-center">

            <div className="relative z-10 w-full">
              <h1 className="text-6xl md:text-8xl lg:text-[110px] leading-[0.9] tracking-tight">
                <span className="font-caslon italic block mb-[-20px] pr-20 md:pr-40">Your brain,</span>
                <span className="font-sans font-black flex flex-wrap justify-center items-center gap-4 mt-2">
                  quantified <span className="inline-flex items-center justify-center h-12 md:h-20 px-6 rounded-full border-2 border-black bg-[#E8F0FE] text-base md:text-2xl font-medium tracking-normal rotate-[-3deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">via AI ✨</span>
                </span>
                <span className="font-caslon italic block mt-2 pl-10 md:pl-32">into pure</span>
                <span className="font-sans font-black flex flex-wrap justify-center items-center gap-4 mt-4">
                  <span className="inline-flex items-center justify-center h-12 md:h-16 px-6 rounded-[2rem] border-2 border-black bg-[#FCE8F0] text-xl font-bold tracking-normal rotate-[4deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"><Lightbulb className="w-6 h-6 mr-2" /> Ideas</span>
                  CONTENT
                </span>
              </h1>
            </div>

            {/* Inline Pill Tags scattered around */}
            <div className="absolute top-[60%] left-[10%] hidden md:flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-gray-200 shadow-lg rotate-[-8deg] z-20 hover:scale-105 transition-transform cursor-default">
              <span className="w-3 h-3 rounded-full bg-green-400"></span>
              <span className="font-sans text-xs font-semibold uppercase tracking-wider">Voice Profile</span>
            </div>

            <div className="absolute top-[20%] right-[20%] hidden md:flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full shadow-xl rotate-[6deg] z-20 hover:scale-105 transition-transform cursor-default">
              <Library className="w-4 h-4" />
              <span className="font-sans text-xs font-semibold uppercase tracking-wider">Smart Library</span>
            </div>

            {/* Subtitle / Description */}
            <p className="mt-16 md:mt-24 max-w-xl font-caslon text-xl md:text-3xl leading-snug text-gray-700 z-10">
              Upload your videos. We clone your voice, extract your pillars, and generate <span className="font-sans font-bold italic">real, actionable ideas</span> tailored to your exact creator DNA.
            </p>

            {/* Center CTA */}
            <div className="mt-12 z-20 group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 to-indigo-500 rounded-full blur opacity-40 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
              <Link href="/signup" className="relative px-10 py-5 bg-black text-white rounded-full font-sans font-bold text-xl md:text-2xl hover:scale-105 transition-all shadow-2xl flex items-center gap-3">
                Get Started <ArrowUpRight className="w-6 h-6" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}


