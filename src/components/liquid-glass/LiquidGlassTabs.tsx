import React from 'react';
import { useRipple } from './useRipple';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
}

export interface LiquidGlassTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LiquidGlassTabs: React.FC<LiquidGlassTabsProps> = ({
  tabs,
  activeTab,
  onChange,
  size = 'md',
  className = '',
}) => {
  const { ripples, createRipple } = useRipple();

  const sizeClasses = {
    sm: 'p-1 gap-1 text-xs',
    md: 'p-1.5 gap-1.5 text-sm',
    lg: 'p-2 gap-2 text-base',
  }[size];

  const buttonPadding = {
    sm: 'px-3 py-1.5',
    md: 'px-4 py-2',
    lg: 'px-5 py-2.5',
  }[size];

  return (
    <div
      className={`
        relative inline-flex items-center rounded-2xl
        font-['Inter',sans-serif] tracking-[-0.06em]
        backdrop-blur-md shadow-xl
        bg-white/15 dark:bg-white/10 border border-white/25 dark:border-white/15
        overflow-x-auto max-w-full scrollbar-none
        ${sizeClasses}
        ${className}
      `}
    >
      {/* Iridescent outer edge highlight */}
      <div
        className="absolute inset-0 rounded-2xl p-[1px] pointer-events-none opacity-40 bg-gradient-to-r from-cyan-400/40 via-fuchsia-400/30 to-indigo-400/40"
        style={{
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      {/* Tab Buttons */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            onClick={(e) => {
              if (tab.disabled) return;
              createRipple(e);
              onChange(tab.id);
            }}
            className={`
              relative z-10 flex items-center gap-2 rounded-xl font-semibold select-none
              transition-all duration-300 ease-out overflow-hidden
              hover:scale-105 active:scale-95
              ${buttonPadding}
              ${
                tab.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer'
              }
              ${
                isActive
                  ? 'text-cyan-900 dark:text-cyan-100 bg-white/40 dark:bg-white/20 shadow-lg shadow-cyan-500/10 border border-white/40 dark:border-cyan-400/30'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/15 dark:hover:bg-white/10'
              }
            `}
          >
            {/* Shimmer sweep on active or hover */}
            <span className="absolute inset-0 -translate-x-full hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            {/* Icon */}
            {tab.icon && (
              <span className={`transition-transform duration-200 ${isActive ? 'scale-110 text-cyan-600 dark:text-cyan-300' : 'opacity-70'}`}>
                {tab.icon}
              </span>
            )}

            {/* Label */}
            <span>{tab.label}</span>

            {/* Badge Indicator */}
            {tab.badge !== undefined && (
              <span
                className={`
                  ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full
                  ${
                    isActive
                      ? 'bg-cyan-500 text-white dark:bg-cyan-400 dark:text-slate-900'
                      : 'bg-white/30 dark:bg-white/15 text-slate-700 dark:text-slate-300'
                  }
                `}
              >
                {tab.badge}
              </span>
            )}

            {/* Ripples inside tab */}
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
  );
};
