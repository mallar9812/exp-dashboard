"use client";

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
}

function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const all = selected.length === options.length;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <button
          className="text-xs text-blue-500 hover:underline"
          onClick={() => onChange(all ? [] : [...options])}
        >
          {all ? "None" : "All"}
        </button>
      </div>
      <div className="max-h-32 overflow-y-auto border border-gray-200 rounded bg-white">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => toggle(opt)}
              className="rounded"
            />
            <span className="truncate">{opt || "(blank)"}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export interface Filters {
  type: string[];
  geo: string[];
  user_type: string[];
  cohort: string[];
  payer_flag: string[];
  install_source: string[];
  install_bucket: string[];
  install_type: string[];
}

interface FilterPanelProps {
  options: Record<keyof Filters, string[]>;
  filters: Filters;
  onChange: (f: Filters) => void;
  controlVariant: string;
  onControlChange: (v: string) => void;
  variantOptions: string[];
}

export default function FilterPanel({
  options, filters, onChange, controlVariant, onControlChange, variantOptions,
}: FilterPanelProps) {
  const set = (key: keyof Filters) => (vals: string[]) => onChange({ ...filters, [key]: vals });

  return (
    <div className="w-64 shrink-0 bg-white border-r border-gray-200 p-4 overflow-y-auto">
      <h2 className="font-bold text-gray-700 mb-4 text-sm uppercase tracking-wide">Filters</h2>

      <div className="mb-4">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
          Control Group
        </label>
        <select
          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
          value={controlVariant}
          onChange={e => onControlChange(e.target.value)}
        >
          {variantOptions.map(v => <option key={v}>{v}</option>)}
        </select>
      </div>

      <MultiSelect label="Data Type"       options={options.type}           selected={filters.type}           onChange={set("type")} />
      <MultiSelect label="Geo"             options={options.geo}            selected={filters.geo}            onChange={set("geo")} />
      <MultiSelect label="User Type"       options={options.user_type}      selected={filters.user_type}      onChange={set("user_type")} />
      <MultiSelect label="Cohort"          options={options.cohort}         selected={filters.cohort}         onChange={set("cohort")} />
      <MultiSelect label="Payer Flag"      options={options.payer_flag}     selected={filters.payer_flag}     onChange={set("payer_flag")} />
      <MultiSelect label="Install Source"  options={options.install_source} selected={filters.install_source} onChange={set("install_source")} />
      <MultiSelect label="Install Bucket"  options={options.install_bucket} selected={filters.install_bucket} onChange={set("install_bucket")} />
      <MultiSelect label="Install Type"    options={options.install_type}   selected={filters.install_type}   onChange={set("install_type")} />
    </div>
  );
}
