"use client";

import React from "react";
import HelpTip from "@/components/ui/HelpTip";

interface HeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Emoji/símbolo que identifica a tela (ex.: "📊"). */
  icon?: string;
  /** Texto de ajuda: abre um balão explicando como a tela funciona. */
  help?: React.ReactNode;
}

export default function Header({ title, subtitle, actions, icon, help }: HeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between mb-5 sm:mb-6 animate-fade-up">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="hidden sm:flex w-11 h-11 rounded-xl bg-primary/15 border border-primary/25 items-center justify-center text-xl flex-shrink-0" aria-hidden>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            {icon && <span className="sm:hidden text-lg flex-shrink-0" aria-hidden>{icon}</span>}
            <span className="min-w-0">{title}</span>
            {help && <span className="flex-shrink-0 inline-flex"><HelpTip title={title} text={help} wide align="left" /></span>}
          </h1>
          {subtitle && <p className="text-muted text-xs sm:text-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 sm:gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}
