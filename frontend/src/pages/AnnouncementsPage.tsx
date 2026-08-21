import { Megaphone, RefreshCw } from 'lucide-react';
import { FestivalScreen, ScreenNote } from '@/components/layout/FestivalScreen';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  EmptyState,
  ErrorState,
  Spinner,
} from '@/components/ui';
import { currentParticipant } from '@/stores/authStore';
import { AnnouncementFeed } from '@/features/announcements/AnnouncementFeed';
import { useAnnouncementInbox } from '@/features/announcements/useAnnouncementInbox';

/**
 * Everything a participant has been told — the inbox half of Stories 8.1 and 8.2.
 *
 * Only notices addressed to this participant reach the screen: fest-wide ones,
 * ones for their house, ones for the block or hall they were allotted, and ones
 * for the events they actually registered for. That last case is Story 8.2 —
 * "notify affected participants only" — and it is why a notice about a round
 * change does not reach five thousand people who were never going.
 *
 * The dashboard shows the first few of these above the fold; this is where the
 * rest live, and where a dismissed notice can be brought back by reloading the
 * page on a device that has not dismissed it.
 */
export default function AnnouncementsPage() {
  const participant = currentParticipant();
  const inbox = useAnnouncementInbox();
  const dismissed = inbox.addressed - inbox.announcements.length;

  return (
    <FestivalScreen
      title="Announcements"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle="Official announcements from the core team, filtered to the ones that concern you."
      actions={
        <Button variant="secondary" onClick={inbox.reload} loading={inbox.loading}>
          <RefreshCw size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Refresh
        </Button>
      }
    >
      {inbox.error ? (
        <ErrorState title="Could not load announcements" description={inbox.error} />
      ) : inbox.loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading announcements" />
        </div>
      ) : inbox.announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={dismissed > 0 ? 'Nothing new' : 'No announcements yet'}
          description={
            dismissed > 0
              ? `You have dismissed ${dismissed} ${dismissed === 1 ? 'announcement' : 'announcements'} on this device. Anything new appears here.`
              : 'When the core team sends an announcement that concerns you, it appears here.'
          }
        />
      ) : (
        <AnnouncementFeed
          announcements={inbox.announcements}
          names={inbox.names}
          onDismiss={inbox.dismiss}
          onDismissAll={inbox.dismissAll}
          heading={
            inbox.announcements.length === 1
              ? 'One announcement for you'
              : `${inbox.announcements.length} announcements for you`
          }
        />
      )}

      <ScreenNote icon={Megaphone}>
        Announcements arrive the next time you open the app rather than as a push notification, and
        dismissing one only dismisses it on this device.
      </ScreenNote>
    </FestivalScreen>
  );
}
