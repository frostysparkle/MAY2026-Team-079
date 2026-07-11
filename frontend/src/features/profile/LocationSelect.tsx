import { useMemo, useState } from 'react';
import { Country, State, City } from 'country-state-city';
import { Select, type SelectOption } from '@/components/ui';

export interface LocationValue {
  country: string;
  state: string;
  city: string;
}

/**
 * Cascading Country → State → City selects. Each level repopulates the next and
 * clears the ones below it. The dataset keys on ISO codes internally, but we
 * emit human-readable names (what the profile stores).
 */
export function LocationSelect({
  onChange,
  errors,
}: {
  onChange: (value: LocationValue) => void;
  errors?: Partial<Record<keyof LocationValue, string>>;
}) {
  const [countryIso, setCountryIso] = useState('');
  const [stateIso, setStateIso] = useState('');

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
  const cityOptions: SelectOption[] = useMemo(
    () =>
      countryIso && stateIso
        ? City.getCitiesOfState(countryIso, stateIso).map((c) => ({ value: c.name, label: c.name }))
        : [],
    [countryIso, stateIso],
  );

  const nameOf = (options: SelectOption[], value: string) =>
    options.find((o) => o.value === value)?.label ?? '';

  return (
    <div className="flex flex-col gap-4">
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
        placeholder={stateIso ? 'Select city' : 'Select a state first'}
        options={cityOptions}
        disabled={!stateIso}
        error={errors?.city}
        onChange={(e) =>
          onChange({
            country: nameOf(countryOptions, countryIso),
            state: nameOf(stateOptions, stateIso),
            city: e.target.value,
          })
        }
      />
    </div>
  );
}
