"use client";

import { useEffect, useRef } from "react";

export function TrendChart({ points }: { points: Array<{ label: string; billed: number; collected: number }> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 640, 230);
    const maximum = Math.max(1, ...points.flatMap((point) => [point.billed, point.collected]));
    context.font = "11px system-ui";
    for (let index = 0; index <= 4; index++) {
      const y = 20 + index * 43;
      context.strokeStyle = "#e5ebee";
      context.beginPath();
      context.moveTo(62, y);
      context.lineTo(627, y);
      context.stroke();
      context.fillStyle = "#526475";
      context.fillText(
        new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(
          maximum * (1 - index / 4),
        ),
        10,
        y + 4,
      );
    }
    for (const [series, color] of [
      ["billed", "#367bed"],
      ["collected", "#189d76"],
    ] as const) {
      const positions = points.map((point, index) => ({
        x: 62 + (index * 565) / Math.max(1, points.length - 1),
        y: 192 - (point[series] * 172) / maximum,
      }));
      context.lineWidth = 2.5;
      context.strokeStyle = color;
      context.beginPath();
      for (const [index, point] of positions.entries()) {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
      context.fillStyle = color;
      for (const point of positions) {
        context.beginPath();
        context.arc(point.x, point.y, 3.5, 0, 2 * Math.PI);
        context.fill();
      }
    }
    context.fillStyle = "#526475";
    points.forEach(({ label }, index) => {
      if (points.length <= 8 || index % 2 === 0)
        context.fillText(label, 48 + (index * 565) / Math.max(1, points.length - 1), 216);
    });
  }, [points]);
  return (
    <canvas
      className="billing-trend"
      ref={canvas}
      width={640}
      height={230}
      role="img"
      aria-label="Billed and collected by month. Exact values are in the table below."
    />
  );
}
