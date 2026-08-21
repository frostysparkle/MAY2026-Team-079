import { useMemo, useState } from 'react';
import { HelpCircle, MessagesSquare, Send, Wrench } from 'lucide-react';
import { ApiClientError } from '@/api';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  Card,
  DetailPanel,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionBlock,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui';
import { ScreenNote } from '@/components/layout/FestivalScreen';
import { QueryThread } from '@/features/queries/QueryThread';
import type { MyQueriesState } from '@/features/queries/useMyQueries';
import {
  BODY_MAX,
  categoryMeta,
  draftToRequest,
  EMPTY_DRAFT,
  offerableCategories,
  SUBJECT_MAX,
  targetsFor,
  validateDraft,
  type QueryDraft,
} from '@/features/queries/queries';

/**
 * Ask a question, and read what came back — Stories 6.1 and 6.2, now the first
 * tab of Help & Support rather than a route of its own.
 *
 * The logic is unchanged from the screen this was lifted out of: the same
 * `useMyQueries` state, the same `validateDraft`/`draftToRequest` resolvers, the
 * same `QueryThread`. What changed is where it sits and what it does when it has
 * nothing to show. The old page kept its only "Ask a question" button up in the
 * page header, three hundred pixels above an empty state that offered nothing —
 * which is most of why this feature read as broken to a student opening it for
 * the first time. The empty state now carries the button itself.
 *
 * The state is passed in rather than hooked here, because the section's shared
 * figures count these queries alongside the reports in `ReportPanel`, and two
 * copies of `useMyQueries` would mean two fetches and two answers.
 */
export function AskPanel({
  state,
  onReportInstead,
}: {
  state: MyQueriesState;
  /** Switches to the Report tab — a fault is not a question. */
  onReportInstead: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<QueryDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const categories = useMemo(() => offerableCategories(state.targets), [state.targets]);
  const meta = categoryMeta(draft.category);
  const targetOptions = useMemo(
    () => targetsFor(state.targets, draft.category),
    [state.targets, draft.category],
  );
  const errors = useMemo(() => validateDraft(draft, state.targets), [draft, state.targets]);
  const shown = touched ? errors : {};

  function set<K extends keyof QueryDraft>(key: K, value: QueryDraft[K]) {
    setDraft((current) => {
      // Changing the category invalidates whatever was picked under the old one,
      // and a stale target_id is a 404 the participant did not cause.
      if (key === 'category') return { ...current, category: value as string, targetId: '' };
      return { ...current, [key]: value };
    });
  }

  function startComposing() {
    setSent(null);
    setComposing(true);
  }

  function cancelComposing() {
    setComposing(false);
    setDraft(EMPTY_DRAFT);
    setTouched(false);
    setSendError(null);
  }

  async function submit() {
    setTouched(true);
    const request = draftToRequest(draft, state.targets);
    if (!request) return;

    setSubmitting(true);
    setSendError(null);
    try {
      const queryId = await state.raise(request);
      setSent(queryId);
      setDraft(EMPTY_DRAFT);
      setTouched(false);
      setComposing(false);
    } catch (e) {
      setSendError(e instanceof ApiClientError ? e.message : 'Could not send that query.');
    } finally {
      setSubmitting(false);
    }
  }

  if (state.error) {
    return (
      <ErrorState
        title="Could not load your queries"
        description={state.error}
        onRetry={state.reload}
      />
    );
  }

  if (state.loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading your queries" />
      </div>
    );
  }

  return (
    <>
      {sent && (
        <ResultBanner variant="success" title="Query sent">
          Reference {sent}. The team it was addressed to can see it now, and their reply will appear
          here.
        </ResultBanner>
      )}

      {/* `DetailPanel` rather than `Card` + `SectionHeading`, which is what this
          and both of the other Help & Support panels were: the same surface as the
          shared panel, one padding step short of it at `sm`, so the composer here
          was 16px-padded while the Stay and Profile panels a tab away were 20px. */}
      {composing && (
        <DetailPanel
          title="Ask a question"
          meta={meta ? `Goes to ${meta.answeredBy}` : 'Whoever can answer it'}
        >
          <Select
            label="What is this about?"
            required
            placeholder="Choose one"
            value={draft.category}
            error={shown.category}
            onChange={(e) => set('category', e.target.value)}
            options={categories.map((c) => ({ value: c.value, label: c.label }))}
          />

          {meta?.needsTarget && (
            <Select
              label="Which one?"
              required
              placeholder="Choose one"
              value={draft.targetId}
              error={shown.targetId}
              onChange={(e) => set('targetId', e.target.value)}
              options={targetOptions.map((t) => ({ value: t.id, label: t.name }))}
            />
          )}

          <TextInput
            label="Title"
            required
            maxLength={SUBJECT_MAX}
            value={draft.subject}
            error={shown.subject}
            hint="One line, so the team can see at a glance what you need."
            onChange={(e) => set('subject', e.target.value)}
          />

          {/* The shared `TextArea`, so this field is the same control as the
              `TextInput` directly above it and as the report form's body on the
              next tab. All three of those were hand-rolled from each other. */}
          <TextArea
            id="query-body"
            label="Your question"
            required
            maxLength={BODY_MAX}
            value={draft.body}
            error={shown.body}
            hint="Everything the team needs in one message saves a round trip."
            onChange={(e) => set('body', e.target.value)}
          />

          {sendError && (
            <ResultBanner variant="error" title="Not sent">
              {sendError}
            </ResultBanner>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={cancelComposing}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting}>
              <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Send to the team
            </Button>
          </div>
        </DetailPanel>
      )}

      {state.queries.length === 0 ? (
        // Nothing to show, and while the composer is open nothing worth saying:
        // the form above *is* the next action, so repeating "no questions yet"
        // underneath it would only push it up the screen.
        !composing && (
          <Card>
            <EmptyState
              icon={HelpCircle}
              title="No questions yet"
              description="Anything you ask the fest team appears here with its answer, so you are never waiting on a conversation you cannot see."
              // The old screen's only way in was a button in the page header, far
              // above this message. An empty state that names the next action is
              // the difference between "nothing here" and "nothing works".
              action={
                <Button onClick={startComposing}>
                  <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Ask a question
                </Button>
              }
            />
          </Card>
        )
      ) : (
        // `SectionBlock`, so the heading and its "Ask a question" button sit on the
        // same row, with the same gaps, as every other headed block in the app.
        <SectionBlock
          title="Your questions"
          meta={`${state.queries.length} asked`}
          actions={
            !composing && (
              <Button onClick={startComposing}>
                <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Ask a question
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-3">
            {state.queries.map((query) => (
              <QueryThread
                key={query.query_id}
                query={query}
                names={state.names}
                onReply={(body) => state.reply(query.query_id, body)}
                replyPlaceholder="Add something to this question…"
              />
            ))}
          </div>
        </SectionBlock>
      )}

      <ScreenNote icon={MessagesSquare}>
        Something broken in your block or hall is a{' '}
        <button
          type="button"
          onClick={onReportInstead}
          className="tap inline-flex items-center gap-1 font-medium text-brand underline"
        >
          <Wrench size={12} strokeWidth={2.5} aria-hidden />
          maintenance report
        </button>{' '}
        rather than a question — that one reaches the duty team with your room number. Replies here
        arrive the next time you open the app rather than as a push notification.
      </ScreenNote>
    </>
  );
}
