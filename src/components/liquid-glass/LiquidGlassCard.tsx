import React, { useState, useRef } from 'react';
import { useRipple } from './useRipple';

export interface LiquidGlassCardProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  tag?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  children?: React.ReactNode;
  featured?: boolean;
}

export const LiquidGlassCard: React.FC<LiquidGlassCardProps> = ({
  title,
  description,
  icon,
  tag,
  actionLabel,
  onAction,
  className = '',
  children,
  featured = false,
}) => {
  const { ripples, createRipple } = useRipple();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Mouse move handler for visionOS interactive specular spotlight / shimmer
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setCursorPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => {
    setIsHovered(false);
    setCursorPos(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    createRipple(e);
    if (onAction) onAction();
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={`
        group relative overflow-hidden rounded-2xl p-6 sm:p-7
        font-['Inter',sans-serif] tracking-[-0.06em]
        transition-all duration-300 ease-out cursor-pointer
        hover:scale-105 active:scale-[0.98]
        backdrop-blur-md shadow-xl
        ${
          featured
            ? 'bg-gradient-to-br from-white/20 via-white/10 to-cyan-500/10 dark:from-white/15 dark:via-white/10 dark:to-cyan-400/15 shadow-cyan-500/20'
            : 'bg-white/15 dark:bg-white/10 hover:bg-white/20 dark:hover:bg-white/15 shadow-slate-900/10 dark:shadow-black/40'
        }
        ${className}
      `}
    >
      {/* Iridescent Gradient Border */}
      <div
        className={`
          absolute inset-0 rounded-2xl p-[1px] pointer-events-none transition-opacity duration-300
          bg-gradient-to-br from-cyan-400/60 via-fuchsia-400/40 to-indigo-400/60
          ${isHovered ? 'opacity-100' : 'opacity-30'}
        `}
        style={{
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      {/* Dynamic Cursor Spotlight / Shimmer (visionOS specular eye-tracking effect) */}
      {cursorPos && (
        <div
          className="absolute pointer-events-none transition-opacity duration-200"
          style={{
            left: `${cursorPos.x}px`,
            top: `${cursorPos.y}px`,
            width: '260px',
            height: '260px',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(56,189,248,0.12) 35%, transparent 70%)',
            opacity: isHovered ? 1 : 0,
          }}
        />
      )}

      {/* Global sweep shimmer */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />

      {/* Click Ripples */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute rounded-full bg-cyan-300/30 pointer-events-none animate-ping"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: ripple.size,
            height: ripple.size,
          }}
        />
      ))}

      {/* Top Header Row (Icon + Badge) */}
      <div className="relative z-10 flex items-start justify-between gap-4 mb-4">
        {icon && (
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 dark:bg-white/15 border border-white/30 dark:border-white/20 shadow-md text-cyan-600 dark:text-cyan-300 backdrop-blur-sm transition-transform duration-300 group-hover:scale-110">
            {icon}
          </div>
        )}

        {tag && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 dark:bg-cyan-400/20 text-cyan-700 dark:text-cyan-300 border border-cyan-400/30 backdrop-blur-sm">
            {tag}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10">
        <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-2 tracking-[-0.06em] group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors">
          {title}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed tracking-[-0.06em] mb-4">
          {description}
        </p>

        {children && <div className="mb-4">{children}</div>}

        {/* Action Button */}
        {actionLabel && (
          <div className="pt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                createRipple(e);
                if (onAction) onAction();
              }}
              className="
                inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold
                bg-white/20 dark:bg-white/10 hover:bg-cyan-500/20 dark:hover:bg-cyan-400/25
                text-slate-800 dark:text-white hover:text-cyan-700 dark:hover:text-cyan-300
                border border-white/30 dark:border-white/20 hover:border-cyan-400/40
                shadow-sm hover:shadow-cyan-500/20
                transition-all duration-200 tracking-[-0.06em]
              "
            >
              <span>{actionLabel}</span>
              <svg
                className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
