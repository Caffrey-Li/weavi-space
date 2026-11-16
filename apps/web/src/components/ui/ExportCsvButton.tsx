"use client";

/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
export function ExportCsvButton({
  filename,
  head,
  rows,
  label = "导出",
  className = "btn-secondary nv-head-btn",
}: {
  filename: string;
  head: string[];
  rows: (string | number)[][];
  label?: string;
  className?: string;
}) {
  function run() {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head, ...rows].map((line) => line.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" className={className} onClick={run} disabled={!rows.length}>
      {label}
    </button>
  );
}
