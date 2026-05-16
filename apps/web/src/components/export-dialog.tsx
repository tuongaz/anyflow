import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useExportToCloud } from '@/hooks/use-export-to-cloud';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const EMAIL_STORAGE_KEY = 'seeflow.export.email';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; shareUrl: string }
  | { kind: 'error'; message: string };

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function ExportDialog({ open, onOpenChange, projectId }: ExportDialogProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const exportToCloud = useExportToCloud(projectId);

  useEffect(() => {
    if (open) {
      setEmail(localStorage.getItem(EMAIL_STORAGE_KEY) ?? '');
      setState({ kind: 'idle' });
      setCopied(false);
    }
  }, [open]);

  const handleExport = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const { shareUrl } = await exportToCloud(email.trim());
      localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      setState({ kind: 'done', shareUrl });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [exportToCloud, email]);

  const handleCopy = useCallback(() => {
    if (state.kind !== 'done') return;
    navigator.clipboard.writeText(state.shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [state]);

  const isLoading = state.kind === 'loading';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="export-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="export-email-input"]',
          );
          input?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export to seeflow.dev</DialogTitle>
          <DialogDescription>
            Upload this diagram to the cloud and get a shareable link.
          </DialogDescription>
        </DialogHeader>

        {state.kind !== 'done' ? (
          <>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  data-testid="export-email-input"
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>

              {state.kind === 'error' ? (
                <div
                  role="alert"
                  data-testid="export-error"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {state.message}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              {state.kind === 'error' ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    data-testid="export-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setState({ kind: 'idle' })}
                    data-testid="export-retry"
                  >
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={isLoading}
                    data-testid="export-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleExport}
                    disabled={isLoading || email.trim().length === 0}
                    data-testid="export-submit"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Uploading…</span>
                      </>
                    ) : (
                      'Export'
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Your diagram is live. Share this link:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={state.shareUrl}
                  data-testid="export-share-url"
                  className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-sm outline-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label="Copy link"
                  data-testid="export-copy"
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)} data-testid="export-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
