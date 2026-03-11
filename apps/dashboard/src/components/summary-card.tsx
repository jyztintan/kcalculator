type SummaryCardProps = {
  label: string;
  value: string;
  hint: string;
};

export function SummaryCard({ label, value, hint }: SummaryCardProps) {
  return (
    <div className="card">
      <p className="card-label">{label}</p>
      <h3>{value}</h3>
      <p className="card-hint">{hint}</p>
    </div>
  );
}
