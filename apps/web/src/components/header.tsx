import { ProjectSwitcher } from '@/components/project-switcher';
import type { DemoSummary } from '@/lib/api';
import { navigate } from '@/lib/router';
import type { ReactNode } from 'react';

export interface HeaderProps {
  demos: DemoSummary[];
  currentSlug?: string;
  trailing?: ReactNode;
}

export function Header({ demos, currentSlug, trailing }: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-semibold tracking-tight hover:text-foreground/80"
      >
        AnyDemo Studio
      </button>
      <div className="flex items-center gap-3">
        {trailing}
        {demos.length > 0 ? <ProjectSwitcher demos={demos} currentSlug={currentSlug} /> : null}
      </div>
    </header>
  );
}
