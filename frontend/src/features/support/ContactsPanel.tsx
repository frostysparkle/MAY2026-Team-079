import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, MessageSquareWarning, Phone, Send } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Hostel, Mess } from '@/api/types';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  Card,
  DetailPanel,
  EmptyState,
  ErrorState,
  Spinner,
  TextInput,
} from '@/components/ui';
import { ScreenNote } from '@/components/layout/FestivalScreen';
import { ROUTES } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import {
  groupSize,
  hostelDirectory,
  messDirectory,
  ownEmergencyContact,
  searchDirectory,
  telHref,
  type ContactGroup,
  type DutyContact,
} from '@/features/stay/dutyContacts';

/**
 * Who to call — Story 6.5, now the third tab of Help & Support.
 *
 * A verified directory of the people on duty, read from `GET /hostels` and
 * `GET /mess`, which return their documents whole to any signed-in caller
 * including the coordinator and team arrays. See `features/stay/dutyContacts.ts`
 * for why the raw values need cleaning before a participant sees them: the
 * backend substitutes the role word for a missing name and the literal `"N/A"`
 * for a missing phone, and rendering either as stored is worse than showing
 * nothing.
 *
 * Every number is a real `tel:` link, because a directory a participant has to
 * retype is a directory they use once.
 *
 * This keeps its own two reads rather than taking them from the section: they are
 * the *whole* directory, where the other two tabs only ever need the caller's own
 * block and hall. The panel is mounted on first activation, so a participant who
 * only ever asks questions never pays for them.
 */
export function ContactsPanel({
  onReportInstead,
  onAskInstead,
}: {
  /** Switches to the Report tab — a call cannot leave a record. */
  onReportInstead: () => void;
  /** Switches to the Ask tab, for when the directory has nobody in it. */
  onAskInstead: () => void;
}) {
  const participant = currentParticipant();

  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [messHalls, setMessHalls] = useState<Mess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([api.listHostels(), api.listMess()])
      .then(([h, m]) => {
        if (!live) return;
        setHostels(h);
        setMessHalls(m);
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof ApiClientError ? e.message : 'Could not load the directory.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const blocks = useMemo(() => searchDirectory(hostelDirectory(hostels), query), [hostels, query]);
  const halls = useMemo(() => searchDirectory(messDirectory(messHalls), query), [messHalls, query]);
  const emergency = ownEmergencyContact(participant?.emergency_contact);
  const total = blocks.length + halls.length;

  return (
    <>
      {/* The participant's own next-of-kin, kept clearly apart from the duty
          directory: one is who the fest calls about them, the others are who
          they call about the fest.

          On `DetailPanel`, like the other two blocks below. All three used to be a
          `Card` with a coloured 16px glyph beside a `text-base font-black` `h2` —
          a fourth panel-heading style, in a section whose sibling tabs and whose
          neighbouring screens all use `SectionHeading`'s accent bar and
          wide-tracked caps. */}
      <DetailPanel title="Your emergency contact">
        {emergency ? (
          <>
            <ContactRow contact={emergency} />
            <p className="text-xs text-muted">
              {emergency.relation ? `Recorded as your ${emergency.relation}. ` : ''}
              This is who the fest team would call about you.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Nothing recorded on this device. No endpoint returns your emergency contact — it reaches
            the app only in the reply to saving your profile — so open{' '}
            <Link to={ROUTES.completeProfile} className="font-semibold text-brand hover:underline">
              Edit profile
            </Link>{' '}
            to add or confirm it.
          </p>
        )}
      </DetailPanel>

      {error ? (
        <ErrorState title="Could not load the directory" description={error} />
      ) : loading ? (
        // `h-64`, the height the Ask tab and the Announcements screen reserve for
        // the same spinner. At `h-48` this tab's content jumped 64px further up the
        // screen than the sibling tab's did while loading.
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading contacts" />
        </div>
      ) : (
        <>
          <TextInput
            label="Search"
            icon={Phone}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A block, a hall, or a person's name"
          />

          {total === 0 ? (
            <Card className="flex flex-col gap-4">
              <EmptyState
                icon={LifeBuoy}
                title={query ? 'Nobody matches that' : 'No contacts published yet'}
                description={
                  query
                    ? 'Try a block name, a hall name, or part of a person’s name.'
                    : 'Once the core team records coordinators for the blocks and halls, they appear here. Nothing on your side is wrong or missing.'
                }
              />
              {/* An empty directory used to be the end of the road. It is not:
                  the other two tabs both still reach a human. */}
              {!query && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={onAskInstead}>
                    <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Ask the fest
                    team
                  </Button>
                  <Button variant="secondary" onClick={onReportInstead}>
                    <MessageSquareWarning size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} />{' '}
                    Report a problem
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <>
              <DirectorySection
                title="Hostel blocks"
                groups={blocks}
                emptyText="No block contacts match that."
              />
              <DirectorySection
                title="Mess halls"
                groups={halls}
                emptyText="No mess contacts match that."
              />
            </>
          )}
        </>
      )}

      {/* Story 5.4. A directory answers "who do I call"; it cannot answer "and
          who will remember this tomorrow". The written report can, so the two sit
          together — a call for now, a record for the morning. */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Something broken in your block or hall?</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            A phone call is right for anything urgent. For everything else, file it — the team sees
            it on their own board and you can follow what they do about it.
          </p>
        </div>
        <Button variant="secondary" onClick={onReportInstead}>
          <MessageSquareWarning size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Report a
          problem
        </Button>
      </Card>

      <ScreenNote icon={LifeBuoy}>
        Names and numbers come straight from the blocks’ and halls’ own team records. A place with
        nobody reachable is left out rather than listed with no way to contact it.
      </ScreenNote>
    </>
  );
}

/**
 * One half of the directory — the blocks, or the halls.
 *
 * `DetailPanel` carries the heading, so the count that used to be a badge stuck
 * after the title is now the panel's `meta`, where a count belongs on every other
 * panel in the app. The group tiles keep `p-4` rather than the `p-3` they had, so
 * a nested block here is padded like a nested block anywhere else.
 */
function DirectorySection({
  title,
  groups,
  emptyText,
}: {
  title: string;
  groups: ContactGroup[];
  emptyText: string;
}) {
  return (
    <DetailPanel title={title} meta={`${groups.length}`}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <li key={`${group.kind}-${group.id}`} className="rounded-2xl bg-surface-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-sm font-bold text-ink">{group.name}</h3>
                <span className="text-[11px] text-muted">
                  {groupSize(group)} {groupSize(group) === 1 ? 'contact' : 'contacts'}
                </span>
              </div>
              {group.detail && <p className="text-[11px] capitalize text-muted">{group.detail}</p>}

              <ul className="mt-2 flex flex-col gap-1.5">
                {group.coordinator && (
                  <li>
                    <ContactRow contact={group.coordinator} badge="Coordinator" />
                  </li>
                )}
                {group.contacts.map((contact, i) => (
                  <li key={`${contact.name}-${contact.phone ?? i}`}>
                    <ContactRow contact={contact} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </DetailPanel>
  );
}

/**
 * One person. A number is a `tel:` link; its absence is stated rather than
 * filled with the backend's `"N/A"` placeholder.
 */
function ContactRow({
  contact,
  badge,
}: {
  contact: DutyContact & { relation?: string };
  badge?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-sm font-medium text-ink">
        {contact.name}
        {badge && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {badge}
          </span>
        )}
      </span>
      {contact.phone ? (
        <a
          href={telHref(contact.phone)}
          className="tap inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
        >
          <Phone size={13} strokeWidth={2.5} />
          {contact.phone}
        </a>
      ) : (
        <span className="text-xs text-muted">No number recorded</span>
      )}
    </div>
  );
}
