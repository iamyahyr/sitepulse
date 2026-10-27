"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type LatencyPoint = {
  t: number;
  dns: number;
  connect: number;
  tls: number;
  ttfb: number;
  download: number;
};

const SERIES = [
  { key: "dns", label: "DNS", color: "var(--phase-dns)" },
  { key: "connect", label: "Connect", color: "var(--phase-connect)" },
  { key: "tls", label: "TLS", color: "var(--phase-tls)" },
  { key: "ttfb", label: "TTFB", color: "var(--phase-ttfb)" },
  { key: "download", label: "Download", color: "var(--phase-download)" },
] as const;

const hourLabel = (t: number) => new Date(t).toISOString().slice(11, 16);

/** Latency stacked by phase, so a jump shows *which* layer got slower. */
export function LatencyChart({ data }: { data: LatencyPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={hourLabel}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
            tickCount={7}
          />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" unit=" ms" width={64} />
          <Tooltip
            labelFormatter={(t) => `${hourLabel(Number(t))} UTC`}
            formatter={(value, name) => [`${value} ms`, name]}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--foreground)",
            }}
          />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="phases"
              type="monotone"
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.55}
              strokeWidth={1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
