export function Segmented({ options, value, onChange, className = '', disabled = false }) {
  return (
    <div className={`segmented ${className}`} role="group" aria-disabled={disabled}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segment ${value === option.value ? 'is-active' : ''}`}
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ label, checked, onChange, disabled = false, hint = '' }) {
  return (
    <label className={`switch-row ${disabled ? 'is-disabled' : ''}`} title={hint}>
      <span className={`switch ${checked ? 'is-on' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch-track" />
      </span>
      {label ? <span className="switch-label">{label}</span> : null}
    </label>
  )
}
