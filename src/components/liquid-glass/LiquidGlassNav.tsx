import React, { useState } from 'react';
import { useRipple } from './useRipple';

export interface NavLinkItem {
  id: string;
  label: string;
  href?: string;
  icon?: React.ReactNode;
  badge?: string;
}

export interface LiquidGlassNavProps {
  brandName?: string;
  brandIcon?: React.ReactNode;
  links: NavLinkItem[];
  activeId?: string;
  onSelectLink?: (id: string) => void;
  actions?: React.ReactNode;
  className?: string;
}

export const LiquidGlassNav: React.FC<LiquidGlassNavProps> = ({
  brandName = 'visionOS',
  brandIcon,
  links,
  activeId,
  onSelectLink,
  actions,
  className = '',
}) => {
  const { ripples, createRipple } = useRipple();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav
      className={`
        sticky top-4 z-50 mx-auto w-full max-w-6xl px-4 sm:px-6
        font-['Inter',sans-serif] tracking-[-0.06em]
        ${className}
      `}
    >
      {/* Floating Glass Pill Container */}
      <div
        className="
          relative flex items-center justify-between px-4 sm:px-6 py-3 rounded-2xl
          backdrop-blur-md shadow-xl
          bg-white/15 dark:bg-white/10 border border-white/25 dark:border-white/15
          transition-all duration-300
        "
      >
        {/* Iridescent Gradient Edge */}
        <div
          className="absolute inset-0 rounded-2xl p-[1px] pointer-events-none opacity-40 hover:opacity-75 transition-opacity duration-300 bg-gradient-to-r from-cyan-400/50 via-fuchsia-400/40 to-indigo-400/50"
          style={{
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />

        {/* Ambient Chromatic Shimmer line */}
        <div className="absolute top-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent pointer-events-none" />

        {/* Brand / Logo */}
        <div className="relative z-10 flex items-center gap-3 select-none">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500/30 to-indigo-500/30 border border-white/30 text-cyan-600 dark:text-cyan-300 shadow-sm backdrop-blur-md transition-transform duration-300 hover:scale-105">
            {brandIcon || (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 1 9 9" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </div>

          <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-[-0.06em]">
            {brandName}
          </span>
        </div>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-1.5 relative z-10">
          {links.map((link) => {
            const isActive = link.id === activeId;

            return (
              <button
                key={link.id}
                type="button"
                onClick={(e) => {
                  createRipple(e);
                  if (onSelectLink) onSelectLink(link.id);
                }}
                className={`
                  relative flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-semibold
                  transition-all duration-300 ease-out overflow-hidden
                  hover:scale-105 active:scale-95
                  ${
                    isActive
                      ? 'text-cyan-900 dark:text-cyan-100 bg-white/30 dark:bg-white/20 shadow-md border border-white/40 dark:border-cyan-400/30'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/15 dark:hover:bg-white/10'
                  }
                `}
              >
                {/* Shimmer sweep */}
                <span className="absolute inset-0 -translate-x-full hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

                {link.icon && <span className="opacity-80">{link.icon}</span>}
                <span>{link.label}</span>

                {link.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-400/30">
                    {link.badge}
                  </span>
                )}

                {/* Click Ripples */}
                {ripples.map((ripple) => (
                  <span
                    key={ripple.id}
                    className="absolute rounded-full bg-cyan-400/30 pointer-events-none animate-ping"
                    style={{
                      left: ripple.x,
                      top: ripple.y,
                      width: ripple.size,
                      height: ripple.size,
                    }}
                  />
                ))}
              </button>
            );
          })}
        </div>

        {/* Right Actions & Mobile Hamburger */}
        <div className="relative z-10 flex items-center gap-2 sm:gap-3">
          {actions}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={(e) => {
              createRipple(e);
              setMobileMenuOpen(!mobileMenuOpen);
            }}
            className="
              md:hidden flex items-center justify-center w-9 h-9 rounded-xl
              bg-white/20 dark:bg-white/10 border border-white/25
              text-slate-700 dark:text-slate-200 hover:scale-105 active:scale-95
              transition-all duration-200
            "
            aria-label="Abrir menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Panel */}
      {mobileMenuOpen && (
        <div
          className="
            md:hidden mt-2 p-3 rounded-2xl
            backdrop-blur-md shadow-xl
            bg-white/20 dark:bg-slate-900/80 border border-white/25 dark:border-white/15
            flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2 duration-200
          "
        >
          {links.map((link) => {
            const isActive = link.id === activeId;

            return (
              <button
                key={link.id}
                type="button"
                onClick={() => {
                  if (onSelectLink) onSelectLink(link.id);
                  setMobileMenuOpen(false);
                }}
                className={`
                  flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold
                  transition-all duration-200
                  ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 border border-cyan-400/30'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/15 dark:hover:bg-white/10'
                  }
                `}
              >
                <div className="flex items-center gap-2.5">
                  {link.icon && <span>{link.icon}</span>}
                  <span>{link.label}</span>
                </div>
                {link.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                    {link.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
};
