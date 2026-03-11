"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type TrendPoint = {
  date: string;
  calories: number;
  target: number;
  targetHit: number;
  targetMissed: number;
};

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <h3>Calories, Met Goal, Exceeded and Target</h3>
          <p>Matches the spirit of your current master sheet trend view.</p>
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={20} angle={-45} textAnchor="end" height={72} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="target" fill="#111827" name="Target" />
            <Bar dataKey="targetMissed" fill="#ef4444" name="Target Missed" />
            <Bar dataKey="targetHit" fill="#3b82f6" name="Target Hit" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
