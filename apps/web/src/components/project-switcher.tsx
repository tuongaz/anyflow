import { CreateProjectDialog } from '@/components/create-project-dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CreateProjectResult, DemoSummary } from '@/lib/api';
import { navigate } from '@/lib/router';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ProjectSwitcherProps {
  demos: DemoSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
}

export function ProjectSwitcher({ demos, currentSlug, onProjectCreated }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const current = demos.find((d) => d.slug === currentSlug);

  const handleCreated = (result: CreateProjectResult) => {
    onProjectCreated?.(result);
    navigate(`/d/${result.slug}`);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Switch demo"
            aria-expanded={open}
            className="gap-2"
            data-testid="project-switcher-trigger"
          >
            <span className="max-w-[180px] truncate text-sm">{current?.name ?? 'Select demo'}</span>
            <CommandShortcut>⌘K</CommandShortcut>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[320px] p-0"
          data-testid="project-switcher-popover"
        >
          <Command>
            <CommandInput placeholder="Search demos..." />
            <CommandList>
              <CommandEmpty>No demos.</CommandEmpty>
              {demos.length > 0 ? (
                <CommandGroup heading="Demos">
                  {demos.map((demo) => (
                    <CommandItem
                      key={demo.id}
                      value={`${demo.name} ${demo.slug}`}
                      onSelect={() => {
                        setOpen(false);
                        navigate(`/d/${demo.slug}`);
                      }}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium">{demo.name}</span>
                      <span className="text-xs text-muted-foreground truncate w-full">
                        {demo.repoPath}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {demos.length > 0 ? <CommandSeparator /> : null}
              <CommandGroup>
                <CommandItem
                  value="+ create new project"
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  data-testid="project-switcher-create"
                  className="flex items-center gap-2 text-sm"
                >
                  <Plus className="h-4 w-4 opacity-70" />
                  <span className="font-medium">Create new project</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </>
  );
}
