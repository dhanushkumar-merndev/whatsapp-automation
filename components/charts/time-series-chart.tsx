"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Validated categorical slots (light surface) from the data-viz reference palette. */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

function shortDay(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-background px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted-foreground">{label ? shortDay(label) : ""}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="font-semibold tabular-nums">{Number(p.value).toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground">
            {p.name}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TimeSeriesChart({
  data,
  series,
  kind = "line",
  height = 240,
  reference,
  unit,
}: {
  data: Record<string, string | number>[];
  series: SeriesDef[];
  kind?: "line" | "bar";
  height?: number;
  reference?: { value: number; label: string } | null;
  unit?: string;
}) {
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i] }));
  const axis = { stroke: "#8f8f8f", fontSize: 11, tickLine: false, axisLine: false } as const;
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="#ececec" />
      <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={24} />
      <YAxis allowDecimals={false} width={40} {...axis} />
      <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: "rgba(0,0,0,0.04)", stroke: "#d4d4d4" }} />
      {colored.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#5d5d5d" }} />}
      {reference && (
        <ReferenceLine y={reference.value} stroke="#8f8f8f" strokeDasharray="4 4" label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "#5d5d5d" }} />
      )}
    </>
  );
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {colored.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {colored.map((s) => (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} type="monotone" />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">View as table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-xl border">
          <table className="w-full text-left tabular-nums">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day (UTC)</th>
                {colored.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.day)} className="border-t">
                  <td className="px-3 py-1">{String(row.day)}</td>
                  {colored.map((s) => (
                    <td key={s.key} className="px-3 py-1">
                      {Number(row[s.key] ?? 0).toLocaleString("en-IN")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
