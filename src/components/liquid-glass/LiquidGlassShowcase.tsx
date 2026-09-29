import React, { useState } from 'react';
import { LiquidGlassNav } from './LiquidGlassNav';
import { LiquidGlassToggle } from './LiquidGlassToggle';
import { LiquidGlassCard } from './LiquidGlassCard';
import { LiquidGlassTabs } from './LiquidGlassTabs';

export const LiquidGlassShowcase: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeNav, setActiveNav] = useState('features');
  const [activeTab, setActiveTab] = useState('spatial');
  const [spatialAudio, setSpatialAudio] = useState(true);
  const [eyeTracking, setEyeTracking] = useState(true);
  const [passThrough, setPassThrough] = useState(false);

  const navLinks = [
    { id: 'overview', label: 'Visão Geral' },
    { id: 'features', label: 'Componentes', badge: 'vOS' },
    { id: 'specs', label: 'Especificações' },
  ];

  const categoryTabs = [
    {
      id: 'spatial',
      label: 'Computação Espacial',
      badge: '3',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
        </svg>
      ),
    },
    {
      id: 'immersion',
      label: 'Imersão & Vidro',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
    },
    {
      id: 'controls',
      label: 'Controladores',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
    },
  ];

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-100 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 font-['Inter',sans-serif] tracking-[-0.06em] relative overflow-hidden transition-colors duration-500 pb-20">
        {/* visionOS Aurora Ambience / Glow Balls */}
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-cyan-500/20 dark:bg-cyan-600/15 blur-[120px] pointer-events-none" />
        <div className="absolute top-[20%] right-[-10%] w-[45vw] h-[45vw] rounded-full bg-fuchsia-500/15 dark:bg-fuchsia-600/10 blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[20%] w-[55vw] h-[55vw] rounded-full bg-indigo-500/20 dark:bg-indigo-600/15 blur-[140px] pointer-events-none" />

        {/* 1. Liquid Glass Navigation Bar */}
        <LiquidGlassNav
          brandName="Liquid Glass"
          brandIcon={
            <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          }
          links={navLinks}
          activeId={activeNav}
          onSelectLink={setActiveNav}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                  bg-white/20 dark:bg-white/10 hover:bg-white/30 dark:hover:bg-white/20
                  border border-white/30 dark:border-white/20 text-slate-800 dark:text-white
                  shadow-md hover:scale-105 active:scale-95 transition-all duration-200
                "
              >
                <span>{isDarkMode ? '🌙 Escuro' : '☀️ Claro'}</span>
              </button>
            </div>
          }
        />

        {/* Hero Title Section */}
        <div className="relative z-10 max-w-4xl mx-auto text-center px-4 pt-16 pb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold bg-white/20 dark:bg-white/10 border border-cyan-400/40 text-cyan-700 dark:text-cyan-300 backdrop-blur-md mb-6 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Inspirado no Apple visionOS
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-[-0.06em] text-slate-900 dark:text-white mb-4">
            Liquid Glass UI
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Componentes em React/TypeScript com transparência vítrea, bordas iridescentes, reflexo dinâmico de cursor e microinterações de escala 105.
          </p>
        </div>

        {/* 2. Liquid Glass Tab Menu */}
        <div className="relative z-10 flex justify-center px-4 mb-12">
          <LiquidGlassTabs
            tabs={categoryTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />
        </div>

        {/* 3. Liquid Glass Feature Cards Grid */}
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <LiquidGlassCard
            title="Janelas Espaciais"
            description="Superfícies translucentes adaptáveis que reagem à iluminação do ambiente e profundidade do campo de visão."
            tag="visionOS 2"
            actionLabel="Explorar janela"
            featured={true}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="4" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M3 9h18M9 21V9" />
              </svg>
            }
          />

          <LiquidGlassCard
            title="Reflexos Iridescentes"
            description="Bordas com dispersão cromática e degradê sutil simulando refração de luz prismática em vidro orgânico."
            tag="Shimmer"
            actionLabel="Ver detalhes"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />

          <LiquidGlassCard
            title="Microinterações Táteis"
            description="Escala com mola 105, efeito ripple concêntrico com coordenada de clique e cursor spotlight inteligente."
            tag="Interativo"
            actionLabel="Testar clique"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            }
          />
        </div>

        {/* 4. Liquid Glass Toggle Switches Panel */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">
          <div className="p-6 sm:p-8 rounded-2xl backdrop-blur-md shadow-xl bg-white/15 dark:bg-white/10 border border-white/25 dark:border-white/15">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Interruptores de Vidro Líquido
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              Controles com trilha translúcida, iluminação ciano iridescente e feedback de clique em múltiplos tamanhos.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
              <LiquidGlassToggle
                checked={spatialAudio}
                onChange={setSpatialAudio}
                size="lg"
                label="Áudio Espacial"
                description="Rastreamento de cabeça 3D"
              />

              <LiquidGlassToggle
                checked={eyeTracking}
                onChange={setEyeTracking}
                size="md"
                label="Seguir Olhar"
                description="Seleção por olhar fixo"
              />

              <LiquidGlassToggle
                checked={passThrough}
                onChange={setPassThrough}
                size="sm"
                label="Pass-through"
                description="Modo realidade mista"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
