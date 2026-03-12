import { FoodBreakdownChart } from "@/components/food-breakdown-chart";
import { SummaryCard } from "@/components/summary-card";
import { TrendChart } from "@/components/trend-chart";
import { fetchDashboard } from "@/lib/api";

export default async function DashboardPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const tokenParam = searchParams?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  const data = await fetchDashboard(90, {
    token,
    telegramId: token ? undefined : process.env.DEFAULT_DASHBOARD_TELEGRAM_ID,
  });

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">KCalculator</p>
          <h1>Calorie tracking without opening the sheet</h1>
          <p className="hero-copy">
            Log through Telegram, review through a dashboard, and keep the master-sheet style
            progress view in a proper app.
          </p>
        </div>
      </section>

      {!data.summary ? (
        <section className="empty-state">
          <h2>No user data yet</h2>
          <p>
            Start the Telegram bot, send <code>/start</code>, and log a few entries to populate the
            dashboard.
          </p>
        </section>
      ) : (
        <>
          <section className="summary-grid">
            <SummaryCard
              label="Today"
              value={`${data.summary.todayCalories} kcal`}
              hint={`Target ${data.summary.todayTarget} kcal`}
            />
            <SummaryCard
              label="Remaining"
              value={`${data.summary.todayRemaining} kcal`}
              hint="Until today's target"
            />
            <SummaryCard
              label="7-day Avg"
              value={`${data.summary.weeklyAverage} kcal`}
              hint={`${data.summary.trackedDays} tracked days`}
            />
            <SummaryCard
              label="Adherence"
              value={`${Math.round(data.summary.adherenceRate * 100)}%`}
              hint={`${data.summary.hitDays} hit / ${data.summary.missedDays} missed`}
            />
          </section>

          <section className="chart-grid">
            <TrendChart data={data.trend} />
            <FoodBreakdownChart data={data.topFoods} />
          </section>

          <section className="table-card">
            <div className="chart-header">
              <div>
                <h3>Daily History</h3>
                <p>Use this to sanity-check the dashboard against your old sheet.</p>
              </div>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Calories</th>
                    <th>Target</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend
                    .slice()
                    .reverse()
                    .map((point) => {
                      const status =
                        point.calories === 0
                          ? "No data"
                          : point.calories <= point.target
                            ? "Goal hit"
                            : "Exceeded";

                      return (
                        <tr key={point.date}>
                          <td>{point.date}</td>
                          <td>{point.calories}</td>
                          <td>{point.target}</td>
                          <td>{status}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
