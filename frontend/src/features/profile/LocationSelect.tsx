import { useMemo, useRef, useState } from 'react';
import Country from 'country-state-city/lib/country';
import State from 'country-state-city/lib/state';
import { Select, type SelectOption } from '@/components/ui';

export interface LocationValue {
  country: string;
  state: string;
  city: string;
}

/** Resolve a stored country/state *name* back to the ISO code the data keys on. */
function isoOfCountry(name: string | undefined) {
  if (!name) return '';
  return Country.getAllCountries().find((c) => c.name === name)?.isoCode ?? '';
}
function isoOfState(countryIso: string, name: string | undefined) {
  if (!countryIso || !name) return '';
  return State.getStatesOfCountry(countryIso).find((s) => s.name === name)?.isoCode ?? '';
}

/**
 * Cascading Country → State → City selects. Each level repopulates the next and
 * clears the ones below it. The dataset keys on ISO codes internally, but we
 * emit human-readable names (what the profile stores) — so an `initial` value
 * coming back out of a saved profile is resolved name → ISO on mount.
 *
 * Renders the three selects as bare siblings rather than wrapping them in a
 * layout of its own, so the calling form places them in its own field grid and
 * they line up with every other field on the screen.
 *
 * The three levels are imported from their own sub-modules rather than through
 * the package barrel, because the barrel pulls all three datasets in together
 * and the city list alone is 8 MB — larger than the rest of the app combined.
 * Complete Your Profile is the one screen every new participant must load
 * before they can do anything else, so the cities are fetched on demand once a
 * state is actually picked; country and state (~650 KB) are all the form needs
 * to paint.
 */
export function LocationSelect({
  initial,
  onChange,
  errors,
}: {
  /** Values from an existing profile, to open the selects already answered. */
  initial?: LocationValue;
  onChange: (value: LocationValue) => void;
  errors?: Partial<Record<keyof LocationValue, string>>;
}) {
  const [countryIso, setCountryIso] = useState(() => isoOfCountry(initial?.country));
  const [stateIso, setStateIso] = useState(() =>
    isoOfState(isoOfCountry(initial?.country), initial?.state),
  );
  const [city, setCity] = useState(initial?.city ?? '');
  // Seeded with the stored city so the select shows it while the real list —
  // which lives behind an async chunk — is still being fetched below.
  const [cityOptions, setCityOptions] = useState<SelectOption[]>(
    initial?.city ? [{ value: initial.city, label: initial.city }] : [],
  );
  const [cityStatus, setCityStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  // Only the newest city request may write state. Without this, changing state
  // twice quickly lets the slower first load resolve last and overwrite the
  // list belonging to the state that is actually selected.
  const cityRequest = useRef(0);

  const countryOptions: SelectOption[] = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name })),
    [],
  );
  const stateOptions: SelectOption[] = useMemo(
    () =>
      countryIso
        ? State.getStatesOfCountry(countryIso).map((s) => ({ value: s.isoCode, label: s.name }))
        : [],
    [countryIso],
  );

  async function loadCities(country: string, state: string, keepCurrent = false) {
    const token = ++cityRequest.current;
    // Cleared on a fresh pick so the stale list is never selectable; kept on a
    // deferred load so a prefilled city stays visible until its list arrives.
    if (!keepCurrent) setCityOptions([]);
    if (!country || !state) {
      setCityStatus('idle');
      return false;
    }
    setCityStatus('loading');
    try {
      const { default: City } = await import('country-state-city/lib/city');
      if (token !== cityRequest.current) return;
      setCityOptions(
        City.getCitiesOfState(country, state).map((c) => ({ value: c.name, label: c.name })),
      );
      setCityStatus('idle');
      return true;
    } catch {
      // A failed chunk fetch must not leave the field stuck on "Loading"; the
      // participant is told to retry by reselecting the state.
      if (token !== cityRequest.current) return false;
      setCityStatus('error');
      return false;
    }
  }

  // A prefilled location opens showing its stored city and nothing else behind
  // it. Filling that list in costs an 8 MB chunk, so it is deferred until the
  // field is actually reached — someone editing their programme or phone never
  // pays for a city list they were never going to open.
  const [cityListPending, setCityListPending] = useState(Boolean(initial?.city));
  async function loadCityListOnDemand() {
    if (!cityListPending) return;
    setCityListPending(false);
    // Re-armed on failure: the stored city is still selected, so the error
    // placeholder never shows here, and focusing the field again is the only
    // retry the participant has.
    if (!(await loadCities(countryIso, stateIso, true))) setCityListPending(true);
  }

  const nameOf = (options: SelectOption[], value: string) =>
    options.find((o) => o.value === value)?.label ?? '';

  const cityPlaceholder = !stateIso
    ? 'Select a state first'
    : cityStatus === 'loading'
      ? 'Loading cities…'
      : cityStatus === 'error'
        ? 'Could not load cities — reselect the state'
        : 'Select city';

  return (
    <>
      <Select
        label="Country"
        required
        placeholder="Select country"
        options={countryOptions}
        value={countryIso}
        error={errors?.country}
        onChange={(e) => {
          const iso = e.target.value;
          setCountryIso(iso);
          setStateIso('');
          setCity('');
          void loadCities('', '');
          onChange({ country: nameOf(countryOptions, iso), state: '', city: '' });
        }}
      />
      <Select
        label="State"
        required
        placeholder={countryIso ? 'Select state' : 'Select a country first'}
        options={stateOptions}
        value={stateIso}
        disabled={!countryIso}
        error={errors?.state}
        onChange={(e) => {
          const iso = e.target.value;
          setStateIso(iso);
          setCity('');
          void loadCities(countryIso, iso);
          onChange({
            country: nameOf(countryOptions, countryIso),
            state: nameOf(stateOptions, iso),
            city: '',
          });
        }}
      />
      <Select
        label="City"
        required
        placeholder={cityPlaceholder}
        options={cityOptions}
        value={city}
        // Blocked only when there is nothing to choose from. A deferred load
        // still has the stored city listed, so the field stays focusable while
        // the rest of its options arrive.
        disabled={!stateIso || cityOptions.length === 0}
        error={errors?.city}
        onFocus={() => void loadCityListOnDemand()}
        onChange={(e) => {
          setCity(e.target.value);
          onChange({
            country: nameOf(countryOptions, countryIso),
            state: nameOf(stateOptions, stateIso),
            city: e.target.value,
          });
        }}
      />
    </>
  );
}
