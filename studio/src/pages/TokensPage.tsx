import { useQuery } from '@tanstack/react-query';
import { fetchTokenAggregates, type TokenRow } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { renderBarChart, renderLineChart, type TokenBarData, type TokenTrendPoint } from '../lib/tokenCharts';

/**
 * Token & Cost charts page — route `/tokens` (spec T4).
 *
 * Inline SVG bars/lines from /api/tokens/aggregates — reuses tokenCharts.ts.
 */

const PHASE_COLORS: Record<string, string> = {
  plan: '#3b82f6',
  implement: '#8b5cf6',
  verify: '#06b6d4',
  review: '#f59e0b',
  default: '#6366f1',
};

const AGENT_COLORS: Record<string, string> = {
  'orchestra-planner': '#3b82f6',
  'orchestra-implementer': '#8b5cf6',
  'orchestra-verifier': '#06b6d4',
  'orchestra-reviewer': '#f59e0b',
  default: '#6366f1',
};

export default function TokensPage() {
  const tokensQuery = useQuery({
    queryKey: queryKeys.tokens(),
    queryFn: fetchTokenAggregates,
    staleTime: 30000,
  });

  const aggregates = tokensQuery.data;

  const getPhaseColor = (phase: string): string => {
    const lower = phase.toLowerCase();
    for (const [key, color] of Object.entries(PHASE_COLORS)) {
      if (lower.includes(key)) return color;
    }
    return PHASE_COLORS.default;
  };

  const getAgentColor = (agent: string): string => {
    for (const [key, color] of Object.entries(AGENT_COLORS)) {
      if (agent.toLowerCase().includes(key.toLowerCase())) return color;
    }
    return AGENT_COLORS.default;
  };

  const byPhaseBars: TokenBarData[] = (aggregates?.byPhase || []).map((p: TokenRow & { phase: string }) => ({
    label: p.phase,
    value: p.total,
    budget: p.budget || 0,
    color: getPhaseColor(p.phase),
  }));

  const byAgentBars: TokenBarData[] = (aggregates?.byAgent || []).map((a: TokenRow & { agent: string }) => ({
    label: a.agent,
    value: a.total,
    budget: a.budget || 0,
    color: getAgentColor(a.agent),
  }));

  const byRunBars: TokenBarData[] = (aggregates?.byRun || []).map((r: TokenRow & { runId: string }) => ({
    label: r.runId.length > 20 ? r.runId.slice(0, 20) + '…' : r.runId,
    value: r.total,
    budget: r.budget || 0,
    color: '#6366f1',
  }));

  const trendPoints: TokenTrendPoint[] = (aggregates?.buckets || []).map((b: TokenRow & { at: string }) => ({
    at: b.at,
    total: b.total,
  }));

  if (tokensQuery.isLoading) {
    return (
      <div className="p-6 text-center text-muted">
        Loading token aggregates…
      </div>
    );
  }

  if (tokensQuery.isError) {
    return (
      <div className="p-6 text-center text-err-fg">
        Failed to load token data: {tokensQuery.error?.message}
      </div>
    );
  }

  if (!aggregates) {
    return (
      <div className="p-6 text-center text-muted">
        No token data available
      </div>
    );
  }

  // Summary stats
  const totalTokens = aggregates.byRun.reduce((sum, r) => sum + r.total, 0);
  const totalBudget = aggregates.byRun.reduce((sum, r) => sum + (r.budget || 0), 0);
  const overBudgetRuns = aggregates.byRun.filter((r) => r.total > (r.budget || 0)).length;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-default">Token & Cost Charts</h1>
        <p className="text-muted mt-1">Aggregated token usage across runs, phases, and agents</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface rounded-lg border border-line p-4">
          <div className="text-sm text-muted">Total Tokens</div>
          <div className="text-3xl font-bold font-mono text-default mt-1">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="bg-surface rounded-lg border border-line p-4">
          <div className="text-sm text-muted">Total Budget</div>
          <div className="text-3xl font-bold font-mono text-default mt-1">{totalBudget.toLocaleString()}</div>
        </div>
        <div className="bg-surface rounded-lg border border-line p-4">
          <div className="text-sm text-muted">Runs Over Budget</div>
          <div className="text-3xl font-bold font-mono text-err-fg mt-1">{overBudgetRuns}</div>
        </div>
        <div className="bg-surface rounded-lg border border-line p-4">
          <div className="text-sm text-muted">Utilization</div>
          <div className="text-3xl font-bold font-mono text-default mt-1">
            {totalBudget > 0 ? `${((totalTokens / totalBudget) * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* By Phase - Bar Chart */}
      <section className="bg-surface rounded-lg border border-line">
        <div className="p-4 border-b border-line">
          <h2 className="font-semibold text-default">Tokens by Phase</h2>
          <p className="text-sm text-muted mt-1">Total tokens consumed per phase across all runs</p>
        </div>
        <div className="p-4">
          <div dangerouslySetInnerHTML={{ __html: renderBarChart(byPhaseBars, { width: 800, height: 300 }) }} />
        </div>
      </section>

      {/* By Agent - Bar Chart */}
      <section className="bg-surface rounded-lg border border-line">
        <div className="p-4 border-b border-line">
          <h2 className="font-semibold text-default">Tokens by Agent</h2>
          <p className="text-sm text-muted mt-1">Total tokens consumed per agent across all runs</p>
        </div>
        <div className="p-4">
          <div dangerouslySetInnerHTML={{ __html: renderBarChart(byAgentBars, { width: 800, height: 300 }) }} />
        </div>
      </section>

      {/* By Run - Bar Chart */}
      <section className="bg-surface rounded-lg border border-line">
        <div className="p-4 border-b border-line">
          <h2 className="font-semibold text-default">Tokens by Run</h2>
          <p className="text-sm text-muted mt-1">Total tokens per conductor run</p>
        </div>
        <div className="p-4">
          <div dangerouslySetInnerHTML={{ __html: renderBarChart(byRunBars, { width: 800, height: 300 }) }} />
        </div>
      </section>

      {/* Trend - Line Chart */}
      <section className="bg-surface rounded-lg border border-line">
        <div className="p-4 border-b border-line">
          <h2 className="font-semibold text-default">Token Trend Over Time</h2>
          <p className="text-sm text-muted mt-1">Token consumption trend across time buckets</p>
        </div>
        <div className="p-4">
          <div dangerouslySetInnerHTML={{ __html: renderLineChart(trendPoints, { width: 800, height: 250, color: '#38bdf8' }) }} />
        </div>
      </section>

      {/* Raw Data Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Phase Table */}
        <section className="bg-surface rounded-lg border border-line">
          <div className="p-4 border-b border-line">
            <h2 className="font-semibold text-default">Phase Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-sunken border-b border-line">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider">Phase</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Input</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Output</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Budget</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {aggregates.byPhase.map((p: TokenRow & { phase: string }) => (
                  <tr key={p.phase} className="hover:bg-sunken">
                    <td className="px-4 py-2 text-sm font-medium text-default">{p.phase}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-default">{p.total.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{p.input.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{p.output.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{(p.budget || 0).toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${p.total > (p.budget || 0) ? 'bg-err text-err-fg' : 'bg-ok text-ok-fg'}`}>
                        {p.total > (p.budget || 0) ? 'OVER' : 'OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* By Agent Table */}
        <section className="bg-surface rounded-lg border border-line">
          <div className="p-4 border-b border-line">
            <h2 className="font-semibold text-default">Agent Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-sunken border-b border-line">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider">Agent</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Input</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Output</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase tracking-wider">Budget</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {aggregates.byAgent.map((a: TokenRow & { agent: string }) => (
                  <tr key={a.agent} className="hover:bg-sunken">
                    <td className="px-4 py-2 text-sm font-medium text-default">{a.agent}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-default">{a.total.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{a.input.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{a.output.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm font-mono text-right text-muted">{(a.budget || 0).toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${a.total > (a.budget || 0) ? 'bg-err text-err-fg' : 'bg-ok text-ok-fg'}`}>
                        {a.total > (a.budget || 0) ? 'OVER' : 'OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}