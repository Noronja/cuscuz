import React, { useRef } from 'react';
import { useRipple } from './useRipple';

export interface LiquidGlassToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LiquidGlassToggle: React.FC<LiquidGlassToggleProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className = '',
}) => {
  const { ripples, createRipple } = useRipple();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    createRipple(e);
    onChange(!checked);
  };

  // Dimensions based on size
  const dimensions = {
    sm: { track: 'w-12 h-6 p-0.5', thumb: 'w-5 h-5', translate: 'translate-x-6' },
    md: { track: 'w-16 h-8 p-1', thumb: 'w-6 h-6', translate: 'translate-x-8' },
    lg: { track: 'w-20 h-10 p-1.5', thumb: 'w-7 h-7', translate: 'translate-x-10' },
  }[size];

  return (
    <div
      className={`inline-flex items-center gap-3.5 select-none font-['Inter',sans-serif] tracking-[-0.06em] ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      onClick={(e) => {
        if (!disabled && e.target !== toggleRef.current) {
          onChange(!checked);
        }
      }}
    >
      {/* Switch Button */}
      <button
        ref={toggleRef}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={`
          relative flex items-center shrink-0 rounded-full transition-all duration-300 ease-out
          hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50
          backdrop-blur-md shadow-xl overflow-hidden group
          ${dimensions.track}
          ${
            checked
              ? 'bg-gradient-to-r from-cyan-500/30 via-sky-500/25 to-indigo-500/30 dark:from-cyan-400/25 dark:via-blue-500/20 dark:to-indigo-500/25 shadow-cyan-500/20'
              : 'bg-slate-900/10 dark:bg-white/10 hover:bg-slate-900/15 dark:hover:bg-white/15'
          }
        `}
      >
        {/* Iridescent Gradient Border */}
        <span
          className={`
            absolute inset-0 rounded-full p-[1px] pointer-events-none transition-opacity duration-300
            bg-gradient-to-r from-cyan-400/50 via-fuchsia-400/40 to-indigo-400/50
            ${checked ? 'opacity-100' : 'opacity-30 group-hover:opacity-70'}
          `}
          style={{
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />

        {/* Shimmer sweep effect */}
        <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

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

        {/* Sliding Liquid Glass Thumb */}
        <span
          className={`
            relative z-10 rounded-full shadow-lg transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)
            flex items-center justify-center
            ${dimensions.thumb}
            ${checked ? dimensions.translate : 'translate-x-0'}
            ${
              checked
                ? 'bg-white text-cyan-600 dark:bg-white dark:text-cyan-500 shadow-cyan-500/50'
                : 'bg-white/80 text-slate-500 dark:bg-white/90 dark:text-slate-700 shadow-slate-900/20'
            }
          `}
        >
          {/* Specular glass reflection dot inside thumb */}
          <span className="absolute top-1 left-1.5 w-1.5 h-1.5 rounded-full bg-white/90 blur-[0.4px]" />
          
          {/* Subtle micro icon */}
          <span
            className={`w-1.5 h-1.5 rounded-full transition-transform duration-300 ${
              checked ? 'bg-cyan-500 scale-100' : 'bg-slate-400 scale-75'
            }`}
          />
        </span>
      </button>

      {/* Optional Label and Description */}
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 tracking-[-0.06em]">
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-slate-500 dark:text-slate-400 tracking-[-0.06em]">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
