"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts";

const colors = ["#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981"];

type FoodPoint = {
  foodName: string;
  totalCalories: number;
};

export function FoodBreakdownChart({ data }: { data: FoodPoint[] }) {
  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <h3>Top Foods</h3>
          <p>Most calorie-dense items across the selected period.</p>
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie data={data} dataKey="totalCalories" nameKey="foodName" outerRadius={110} label>
              {data.map((entry, index) => (
                <Cell key={entry.foodName} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
