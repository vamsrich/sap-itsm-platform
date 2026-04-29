// Recharts renders pie labels as inline SVG text — Tailwind classes don't reach
// inside. This custom render places "Name N%" outside each slice with explicit
// fontSize so labels match the rest of the enterprise type scale.
const RADIAN = Math.PI / 180;

export function renderPieLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, name } = props;
  const r = outerRadius + 14;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#374151"
      fontSize={11}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
    >
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
}
