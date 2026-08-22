import { useMemo } from 'react';
import { CheckCircle2, Clock, MessagesSquare, RefreshCw, Wrench } from 'lucide-react';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  StatCard,
  StatGrid,
  TabPanel,
  Tabs,
  useTabParam,
  type TabSpec,
} from '@/components/ui';
import { currentStaff, isSuperAdmin } from '@/stores/authStore';
import { useQueryQueue } from '@/features/queries/useQueryQueue';
import { useDutyIssues } from '@/features/issues/useDutyIssues';
import { supportCounts } from '@/features/support/supportCounts';
import { QuestionsPanel } from '@/features/support/QuestionsPanel';
import { FaultsPanel } from '@/features/support/FaultsPanel';
import type { StaffSupportTab } from '@/config/routes';

/**
 * Support — the duty desk for everything a participant has asked somebody to
 * deal with.
 *
 * This replaces two separate sections. `/staff/queries` answered questions
 * (Stories 6.3/6.4) and `/staff/issues` worked reported hostel and mess faults
 * (Story 5.4). They sat next to each other in the rail with a comment saying they
 * were "the same shift — one queue of faults, one of questions", and a volunteer
 * on a block team still had to open both to find out whether anything was waiting
 * on them. That is the participant side's problem read from the other end, and
 * `SupportPage` already solved it there; the admin overview's `SupportPanel`
 * already counts the two together for the same reason. This is the missing third.
 *
 * A move, not a rewrite. `useQueryQueue`, `useDutyIssues`, `QueryThread`,
 * `IssueTimeline`, `features/queries/queries.ts` and `features/issues/issues.ts`
 * are all untouched; the two screens became `QuestionsPanel` and `FaultsPanel`,
 * and the old routes redirect here with the matching `?tab=`. **No endpoint
 * changed and none was added** — this is composition over the same two calls the
 * two consoles already made.
 *
 * What the merge buys, and what it deliberately does not:
 *
 * **One set of figures.** `supportCounts` is the participant section's own
 * helper, reused rather than reimplemented, so "is anybody waiting on me" is
 * answerable in one place. Neither console could say it: each held half.
 *
 * **A half-typed note survives a tab switch.** Both panels hold local draft text —
 * a reply in a `QueryThread`, a note on a `DutyIssueCard` — and both stay mounted,
 * because tabs are a change of view where two routes were a remount.
 *
 * **Both tabs are always offered.** An event-team volunteer has queries and can
 * never have faults, so their Faults tab is empty; it still appears, because
 * hiding it would mean deriving team membership in the browser from the catalogue
 * team arrays, which is a second implementation of a rule only the server can
 * mean. `GET /issues` answers an empty list rather than a 403 for exactly this
 * case, and the panel's empty state says so plainly.
 *
 * **The two rows stay different.** A fault carries the reporter's phone and a Call
 * link; a query carries no number, by an explicit backend decision. The lifecycles
 * differ too — `in_progress` against `assigned`, and only a query has an owner. So
 * the section is shared and the row components are not.
 */

const ID_PREFIX = 'staff-support';

export default function StaffSupportPage() {
  const staff = currentStaff();

  // Both queues load at section level: the figures below count them together, and
  // a second copy of either hook would mean a second fetch and a second answer.
  const questions = useQueryQueue();
  const faults = useDutyIssues();

  const counts = useMemo(
    () => supportCounts(questions.queries, faults.issues),
    [questions.queries, faults.issues],
  );

  const tabs = useMemo<TabSpec<StaffSupportTab>[]>(
    () => [
      {
        value: 'questions',
        label: 'Questions',
        shortLabel: 'Ask',
        icon: MessagesSquare,
        badge: counts.openQuestions,
      },
      {
        value: 'faults',
        label: 'Reported faults',
        shortLabel: 'Faults',
        icon: Wrench,
        badge: counts.openReports,
      },
    ],
    [counts.openQuestions, counts.openReports],
  );

  const { tab, setTab } = useTabParam(tabs, 'questions');

  const reloading = questions.loading || faults.status === 'loading';

  return (
    <FestivalScreen
      title="Support"
      eyebrow={staff?.designation ?? 'Fest team'}
      subtitle={
        isSuperAdmin()
          ? 'Every question raised and every fault reported across the fest.'
          : 'Questions and faults from the blocks, halls, events, and workshops you are on.'
      }
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            questions.reload();
            void faults.reload();
          }}
          loading={reloading}
        >
          <RefreshCw size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Refresh
        </Button>
      }
    >
      {/* One row over both queues, above the tabs rather than inside one of them:
          "is anybody waiting on me" is a question about the shift, not about
          whichever tab happens to be open. Zeroes included — on a duty desk,
          "nothing is outstanding" is an answer, not an empty shelf. */}
      <StatGrid>
        <StatCard
          icon={MessagesSquare}
          label="Open questions"
          value={counts.openQuestions}
          tone="brand"
          footnote={
            counts.totalQuestions === 0
              ? 'Nothing in your queue'
              : `of ${counts.totalQuestions} in your queue`
          }
        />
        <StatCard
          icon={Wrench}
          label="Open faults"
          value={counts.openReports}
          tone="accent"
          footnote={
            counts.totalReports === 0
              ? 'Nothing reported yet'
              : `of ${counts.totalReports} reported to you`
          }
        />
        <StatCard
          icon={Clock}
          label="No reply yet"
          value={counts.awaitingReply}
          tone="warning"
          footnote={
            counts.total === 0
              ? 'Nothing outstanding'
              : counts.awaitingReply === 0
                ? 'Everything has had a reply'
                : 'Nobody has written back yet'
          }
        />
        <StatCard
          icon={CheckCircle2}
          label="Closed out"
          value={counts.resolved}
          tone="success"
          footnote="Questions answered and faults resolved"
        />
      </StatGrid>

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        label="Support desk sections"
        idPrefix={ID_PREFIX}
      />

      {/* Both mounted from the start, with no `mounted` deferral: the section has
          already loaded both queues for the figures above, so there is nothing
          left to defer — and staying mounted is what keeps a half-typed reply or
          note alive across a tab switch. */}
      <TabPanel idPrefix={ID_PREFIX} value="questions" active={tab === 'questions'}>
        <QuestionsPanel state={questions} />
      </TabPanel>

      <TabPanel idPrefix={ID_PREFIX} value="faults" active={tab === 'faults'}>
        <FaultsPanel state={faults} />
      </TabPanel>
    </FestivalScreen>
  );
}
