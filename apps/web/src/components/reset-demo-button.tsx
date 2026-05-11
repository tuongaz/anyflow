import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

export interface ResetDemoButtonProps {
  onResetDemo: () => Promise<unknown>;
}

export function ResetDemoButton({ onResetDemo }: ResetDemoButtonProps) {
  const [resetting, setResetting] = useState(false);

  const handleClick = useCallback(() => {
    if (resetting) return;
    setResetting(true);
    Promise.resolve(onResetDemo()).finally(() => {
      setResetting(false);
    });
  }, [onResetDemo, resetting]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid="header-reset-demo"
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Reset demo"
          title="Reset demo"
          disabled={resetting}
          onClick={handleClick}
          className="h-8 w-8"
        >
          {resetting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Reset demo</TooltipContent>
    </Tooltip>
  );
}
