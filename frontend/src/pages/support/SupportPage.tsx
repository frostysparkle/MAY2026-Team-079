import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, MessagesSquare, Phone, RefreshCw, Send, Wrench } from 'lucide-react';
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
import { currentParticipant } from '@/stores/authStore';
import { useMyQueries } from '@/features/queries/useMyQueries';
import { useMyIssues } from '@/features/issues/useMyIssues';
import { supportCounts } from '@/features/support/supportCounts';
import { AskPanel } from '@/features/support/AskPanel';
import { ReportPanel } from '@/features/support/ReportPanel';
import { ContactsPanel } from '@/features/support/ContactsPanel';

/**
 * Help & Support — one section for every way a participant reaches a human.
 *
 * This replaces three separate routes. `/app/queries` raised and tracked
 * questions (Stories 6.1/6.2), `/app/report-issue` filed hostel and mess faults
 * (Story 5.4), and `/app/help` listed the coordinators on duty (Story 6.5). Each
 * of the three linked to the other two and each carried a paragraph explaining
 * why it was not the other two, which is a fair sign that the split was in the
 * navigation rather than in the student's head. From their side there is one
 * errand — *something needs dealing with* — and three answers to "what do you
 * want back": an answer, a repair, or a voice on the phone. Those are the tabs.
 *
 * The consolidation is a move, not a rewrite. `useMyQueries`, `useMyIssues`,
 * `features/queries/queries.ts`, `features/issues/issues.ts` and
 * `features/stay/dutyContacts.ts` are all untouched; the three screens became the
 * three panels under `features/support/`, and the old routes redirect here with
 * the matching `?tab=`.
 *
 * Two things this section can do that none of the three could:
 *
 * **One set of figures.** A participant holds *things they asked somebody to deal
 * with*, not "queries" and "issues". `supportCounts` merges both sides, so
 * "awaiting a reply" is finally answerable without visiting two screens — see
 * `features/support/supportCounts.ts`.
 *
 * **A way out of every dead end.** Each tab used to be able to strand somebody:
 * no allocation meant no report form, an unpublished directory meant no numbers,
 * and an empty query list offered no button. Every one of those now names the tab
 * that still works.
 *
 * The panels are tabs rather than routes on purpose. They share the figures and
 * the loaded data, so switching is a change of view; a route would remount and
 * throw away a half-typed report on the way to look up a phone number.
 */

type SupportTab = 'ask' | 'report' | 'contacts';

const ID_PREFIX = 'support';

export default function SupportPage() {
  const participant = currentParticipant();

  // Both sides load at section level: the shared figures count them together, and
  // a second copy of either hook would mean a second fetch and a second answer.
  const queries = useMyQueries();
  const issues = useMyIssues();

  const counts = useMemo(
    () => supportCounts(queries.queries, issues.issues),
    [queries.queries, issues.issues],
  );

  const tabs = useMemo<TabSpec<SupportTab>[]>(
    () => [
      {
        value: 'ask',
        label: 'Ask a question',
        shortLabel: 'Ask',
        icon: Send,
        badge: counts.openQuestions,
      },
      {
        value: 'report',
        label: 'Report a problem',
        shortLabel: 'Report',
        icon: Wrench,
        badge: counts.openReports,
      },
      { value: 'contacts', label: 'Who to call', shortLabel: 'Call', icon: Phone },
    ],
    [counts.openQuestions, counts.openReports],
  );

  const { tab, setTab } = useTabParam(tabs, 'ask');

  /**
   * Which panels have ever been shown.
   *
   * The contacts directory has two reads of its own — the *whole* fest's blocks
   * and halls, where the other tabs only need the caller's own — so a participant
   * who never opens it should never pay for them. Ask and Report are mounted from
   * the start because the figures above already depend on their data. Once a panel
   * has been opened it stays mounted, because refetching a directory every time
   * somebody checks a number is worse than holding it, and because a half-typed
   * report should survive a trip to look up a phone number.
   *
   * Seeded with whichever tab the URL asked for, so a redirect from `/app/help`
   * or a shared `?tab=contacts` link mounts it on the first render, and grown by
   * `go` from there. No effect is needed to catch a tab that changed some other
   * way, because there is no other way: `useTabParam` replaces rather than pushes,
   * so a tab switch leaves no history entry for the back button to return to.
   */
  const [everShown, setEverShown] = useState<Set<SupportTab>>(
    () => new Set<SupportTab>(['ask', 'report', tab]),
  );
  const mounted = (of: SupportTab) => everShown.has(of);

  function go(next: SupportTab) {
    setEverShown((current) => (current.has(next) ? current : new Set(current).add(next)));
    setTab(next);
  }

  const reloading = queries.loading || issues.status === 'loading';

  return (
    <FestivalScreen
      title="Help & Support"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle="Ask the fest team a question, report something broken, or find the people on duty — all in one place."
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            queries.reload();
            void issues.reload();
          }}
          loading={reloading}
        >
          <RefreshCw size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Refresh
        </Button>
      }
    >
      {/* One row of figures over both halves, above the tabs rather than inside
          one of them: "is anybody dealing with my stuff" is a question about the
          section, not about whichever tab happens to be open. Always shown, zeroes
          included — on a section a student opens because something is wrong, "you
          have nothing outstanding" is an answer, not an empty shelf.

          On the shared `StatGrid`, which is the change that matters here: this row
          went two-up on a phone and four-up from `sm`, where the dashboard's and
          the schedule's went one-up then two-up then four-up. Four 175px cards at
          tablet width wrapped "Open questions" and "Awaiting reply" onto two lines
          apiece, so the same four figures were a different shape and a different
          height on this section than on the two either side of it. */}
      <StatGrid>
        <StatCard
          icon={MessagesSquare}
          label="Open questions"
          value={counts.openQuestions}
          tone="brand"
          footnote={
            counts.totalQuestions === 0
              ? 'Nothing asked yet'
              : `of ${counts.totalQuestions} asked in total`
          }
        />
        <StatCard
          icon={Wrench}
          label="Open reports"
          value={counts.openReports}
          tone="accent"
          footnote={
            counts.totalReports === 0
              ? 'Nothing filed yet'
              : `of ${counts.totalReports} filed in total`
          }
        />
        <StatCard
          icon={Clock}
          label="Awaiting reply"
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
          label="Resolved"
          value={counts.resolved}
          tone="success"
          footnote="Questions and reports closed out"
        />
      </StatGrid>

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={go}
        label="Help and support sections"
        idPrefix={ID_PREFIX}
      />

      <TabPanel idPrefix={ID_PREFIX} value="ask" active={tab === 'ask'} mounted={mounted('ask')}>
        <AskPanel state={queries} onReportInstead={() => go('report')} />
      </TabPanel>

      <TabPanel
        idPrefix={ID_PREFIX}
        value="report"
        active={tab === 'report'}
        mounted={mounted('report')}
      >
        <ReportPanel
          state={issues}
          onAskInstead={() => go('ask')}
          onFindContacts={() => go('contacts')}
        />
      </TabPanel>

      <TabPanel
        idPrefix={ID_PREFIX}
        value="contacts"
        active={tab === 'contacts'}
        mounted={mounted('contacts')}
      >
        <ContactsPanel onReportInstead={() => go('report')} onAskInstead={() => go('ask')} />
      </TabPanel>
    </FestivalScreen>
  );
}
