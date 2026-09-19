import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { plural } from '../lib/format';
import { api } from '../lib/api';
import { Button, Dialog } from './ui';

export function DeleteFeedDialog({ feed, onClose, onDeleted }: { feed: { id: string; name: string; itemCount: number } | null; onClose: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => api.deleteFeed(id),
    onSuccess: () => {
      toast.success('Flux supprimé');
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      onClose();
      onDeleted?.();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog
      open={!!feed}
      onClose={onClose}
      title="Supprimer ce flux ?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => feed && mutation.mutate(feed.id)}>
            Supprimer le flux
          </Button>
        </>
      }
    >
      <p>
        « {feed?.name} » et {plural(feed?.itemCount ?? 0, 'article enregistré', 'articles enregistrés')} seront effacés. Les lecteurs abonnés à ce flux
        recevront une erreur.
      </p>
    </Dialog>
  );
}
