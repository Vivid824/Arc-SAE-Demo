type SequentialLegendProps = {
  mode: 'sequential'
  label: string
  lowLabel: string
  highLabel: string
  lowColor?: string
  highColor?: string
}

type CategoricalLegendProps = {
  mode: 'categorical'
  label: string
  items: Array<{ label: string; color: string }>
}

type LegendProps = SequentialLegendProps | CategoricalLegendProps

export function Legend(props: LegendProps) {
  if (props.mode === 'categorical') {
    return (
      <div className="legend">
        <div className="legend-title">{props.label}</div>
        <div className="legend-items">
          {props.items.map((item) => (
            <div key={item.label} className="legend-item">
              <span
                className="legend-swatch"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="legend">
      <div className="legend-title">{props.label}</div>
      <div
        className="legend-gradient"
        style={{
          background: `linear-gradient(90deg, ${props.lowColor ?? '#eeedfe'}, ${props.highColor ?? '#534ab7'})`,
        }}
      />
      <div className="legend-range">
        <span>{props.lowLabel}</span>
        <span>{props.highLabel}</span>
      </div>
    </div>
  )
}
