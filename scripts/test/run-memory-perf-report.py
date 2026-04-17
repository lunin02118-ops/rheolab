#!/usr/bin/env python3
"""Run memory soak tests and build an aggregate report."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
PERF_DIR = ROOT_DIR / "outputs" / "e2e" / "perf"
REPORTS_DIR = ROOT_DIR / "docs" / "performance"
FINAL_STATUS_REPORT_PATH = REPORTS_DIR / "FRONTEND-IPC-DEEP-AUDIT-LATEST.md"
DEEP_AUDIT_PATH = REPORTS_DIR / "FRONTEND-IPC-DEEP-AUDIT-LATEST.md"
FINAL_STATUS_MARKER_START = "<!-- MEMORY_PERF_REPORT:START -->"
FINAL_STATUS_MARKER_END = "<!-- MEMORY_PERF_REPORT:END -->"
DEEP_AUDIT_MARKER_START = "<!-- MEMORY_PERF_AUDIT_LINKS:START -->"
DEEP_AUDIT_MARKER_END = "<!-- MEMORY_PERF_AUDIT_LINKS:END -->"

SOURCE_CONFIG: dict[str, dict[str, Any]] = {
    "tauri-soak": {
        "test_args": [
            "test",
            "--config",
            "playwright.tauri-soak.config.ts",
            "--workers=1",
        ],
        "default_glob": "soak-*.json",
        "log_file": "latest-playwright-tauri-soak.log",
        "summary_prefix": "tauri-soak-summary",
        "report_title": "Memory Performance Report — Tauri Soak",
    },
    "comparison-web": {
        "test_args": [
            "test",
            "tests/e2e/_archived/comparison-memory-soak.spec.ts",
            "--config",
            "playwright.perf.config.ts",
            "--workers=1",
        ],
        "default_glob": "comparison-memory-soak-*.json",
        "log_file": "latest-playwright-memory-soak.log",
        "summary_prefix": "comparison-memory-summary",
        "report_title": "Memory Performance Report — Comparison Soak",
    },
}


@dataclass
class PlaywrightRunStatus:
    attempted: bool
    status: str
    message: str
    command: str


def pct(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    sorted_values = sorted(values)
    rank = max(0, min(len(sorted_values) - 1, math.ceil((p / 100.0) * len(sorted_values)) - 1))
    return sorted_values[rank]


def safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def is_finite(value: float) -> bool:
    return not math.isnan(value) and math.isfinite(value)


def finite_values(values: list[float]) -> list[float]:
    return [v for v in values if is_finite(v)]


def format_num(value: float, digits: int = 2) -> str:
    if not is_finite(value):
        return "n/a"
    return f"{value:.{digits}f}"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_source_config(source: str) -> dict[str, Any]:
    if source not in SOURCE_CONFIG:
        raise ValueError(f"Unsupported source: {source}")
    return SOURCE_CONFIG[source]


def run_playwright_soak(
    source: str,
    cycles: int,
    final_limit_mb: float,
    peak_limit_mb: float,
    node_limit: int,
) -> PlaywrightRunStatus:
    source_cfg = get_source_config(source)
    test_args = source_cfg["test_args"]

    cli_path = ROOT_DIR / "node_modules" / "playwright" / "cli.js"
    node_candidates = [
        os.environ.get("npm_node_execpath"),
        shutil.which("node"),
        shutil.which("node.exe"),
    ]
    node_bin = next((candidate for candidate in node_candidates if candidate), None)

    if node_bin and cli_path.exists():
        cmd = [node_bin, str(cli_path), *test_args]
    else:
        npx = shutil.which("npx") or shutil.which("npx.cmd") or shutil.which("npx.exe")
        if npx:
            cmd = [npx, "playwright", *test_args]
        else:
            fallback = " ".join(["npx", "playwright", *test_args])
            return PlaywrightRunStatus(
                attempted=False,
                status="skipped",
                message="Neither node+playwright cli nor npx found in PATH",
                command=fallback,
            )

    cmd_text = " ".join(cmd)

    env = os.environ.copy()
    if source == "comparison-web":
        env["RHEOLAB_E2E_COMPARISON_CYCLES"] = str(cycles)
        env["RHEOLAB_E2E_COMPARISON_HEAP_DELTA_MB"] = str(final_limit_mb)
        env["RHEOLAB_E2E_COMPARISON_HEAP_PEAK_DELTA_MB"] = str(peak_limit_mb)
        env["RHEOLAB_E2E_COMPARISON_NODE_DELTA"] = str(node_limit)
        # Browser E2E cannot rely on desktop WASM/Tauri stack.
        env["RHEOLAB_E2E_FAKE_PARSE"] = env.get("RHEOLAB_E2E_FAKE_PARSE", "1")

    PERF_DIR.mkdir(parents=True, exist_ok=True)
    log_path = PERF_DIR / source_cfg["log_file"]

    try:
        result = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        return PlaywrightRunStatus(
            attempted=True,
            status="failed",
            message=f"Could not execute Playwright command: {exc}",
            command=cmd_text,
        )

    log_content = [f"[{iso_now()}] command: {cmd_text}", f"exit_code: {result.returncode}"]
    if result.stdout:
        log_content.append("\n[stdout]\n" + result.stdout.strip())
    if result.stderr:
        log_content.append("\n[stderr]\n" + result.stderr.strip())
    log_path.write_text("\n".join(log_content) + "\n", encoding="utf-8")

    if result.returncode == 0:
        return PlaywrightRunStatus(
            attempted=True,
            status="ok",
            message=f"Playwright soak finished successfully (log: {log_path})",
            command=cmd_text,
        )

    return PlaywrightRunStatus(
        attempted=True,
        status="failed",
        message=f"Playwright soak failed with exit code {result.returncode} (log: {log_path})",
        command=cmd_text,
    )


def parse_comparison_web_run(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    summary = data.get("summary") or {}
    limits = data.get("limits") or {}
    return {
        "file": path,
        "source": "comparison-web",
        "generatedAt": data.get("generatedAt"),
        "scenario": data.get("scenario", "comparison-memory-soak"),
        "cycles": data.get("cycles"),
        "baselineHeapMb": safe_float(summary.get("baselineHeapMb")),
        "finalHeapMb": safe_float(summary.get("finalHeapMb")),
        "peakHeapMb": safe_float(summary.get("peakHeapMb")),
        "finalHeapDeltaMb": safe_float(summary.get("finalHeapDeltaMb")),
        "peakHeapDeltaMb": safe_float(summary.get("peakHeapDeltaMb")),
        "baselineNodes": safe_float(summary.get("baselineNodes")),
        "finalNodes": safe_float(summary.get("finalNodes")),
        "peakNodes": safe_float(summary.get("peakNodes")),
        "finalNodeDelta": safe_float(summary.get("finalNodeDelta")),
        "peakNodeDelta": safe_float(summary.get("peakNodeDelta")),
        "limitFinalHeapDeltaMb": safe_float(limits.get("finalHeapDeltaMb")),
        "limitPeakHeapDeltaMb": safe_float(limits.get("peakHeapDeltaMb")),
        "limitNodeDelta": safe_float(limits.get("nodeDelta")),
        "slopeMbPerRound": float("nan"),
        "nodesRatio": float("nan"),
        "limitSlopeMbPerRound": float("nan"),
        "limitNodesRatio": float("nan"),
    }


def parse_tauri_soak_run(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    heap_samples = [safe_float(v) for v in (data.get("heapSamples") or [])]
    node_samples = [safe_float(v) for v in (data.get("nodeSamples") or [])]
    heap_valid = finite_values(heap_samples)
    node_valid = finite_values(node_samples)

    baseline_heap = heap_valid[0] if heap_valid else float("nan")
    final_heap = heap_valid[-1] if heap_valid else float("nan")
    peak_heap = max(heap_valid) if heap_valid else float("nan")

    baseline_nodes = node_valid[0] if node_valid else float("nan")
    final_nodes = node_valid[-1] if node_valid else float("nan")
    peak_nodes = max(node_valid) if node_valid else float("nan")

    cfg = data.get("config") or {}

    return {
        "file": path,
        "source": "tauri-soak",
        "generatedAt": data.get("generatedAt"),
        "scenario": data.get("scenario", "tauri-soak"),
        "cycles": cfg.get("uploadRounds") or cfg.get("comparisonRounds") or data.get("cycles"),
        "baselineHeapMb": baseline_heap,
        "finalHeapMb": final_heap,
        "peakHeapMb": peak_heap,
        "finalHeapDeltaMb": final_heap - baseline_heap if is_finite(final_heap) and is_finite(baseline_heap) else float("nan"),
        "peakHeapDeltaMb": peak_heap - baseline_heap if is_finite(peak_heap) and is_finite(baseline_heap) else float("nan"),
        "baselineNodes": baseline_nodes,
        "finalNodes": final_nodes,
        "peakNodes": peak_nodes,
        "finalNodeDelta": final_nodes - baseline_nodes if is_finite(final_nodes) and is_finite(baseline_nodes) else float("nan"),
        "peakNodeDelta": peak_nodes - baseline_nodes if is_finite(peak_nodes) and is_finite(baseline_nodes) else float("nan"),
        "limitFinalHeapDeltaMb": float("nan"),
        "limitPeakHeapDeltaMb": float("nan"),
        "limitNodeDelta": float("nan"),
        "slopeMbPerRound": safe_float(data.get("slope")),
        "nodesRatio": safe_float(data.get("nodesRatio")),
        "limitSlopeMbPerRound": safe_float(cfg.get("heapSlopeThreshold")),
        "limitNodesRatio": safe_float(cfg.get("nodesGrowthFactor")),
    }


def load_perf_files(source: str, input_glob: str | None, limit: int | None = None) -> list[dict[str, Any]]:
    source_cfg = get_source_config(source)
    glob_pattern = input_glob or source_cfg["default_glob"]
    files = sorted(PERF_DIR.glob(glob_pattern), key=lambda p: p.stat().st_mtime)
    if limit and limit > 0:
        files = files[-limit:]

    runs: list[dict[str, Any]] = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if source == "tauri-soak":
            runs.append(parse_tauri_soak_run(path, data))
        else:
            runs.append(parse_comparison_web_run(path, data))

    return runs


def gate_pass(run: dict[str, Any]) -> bool:
    source = run.get("source")
    if source == "tauri-soak":
        return (
            is_finite(run["slopeMbPerRound"])
            and is_finite(run["limitSlopeMbPerRound"])
            and is_finite(run["nodesRatio"])
            and is_finite(run["limitNodesRatio"])
            and run["slopeMbPerRound"] < run["limitSlopeMbPerRound"]
            and run["nodesRatio"] < run["limitNodesRatio"]
        )

    return (
        is_finite(run["finalHeapDeltaMb"])
        and is_finite(run["limitFinalHeapDeltaMb"])
        and is_finite(run["peakHeapDeltaMb"])
        and is_finite(run["limitPeakHeapDeltaMb"])
        and is_finite(run["peakNodeDelta"])
        and is_finite(run["limitNodeDelta"])
        and run["finalHeapDeltaMb"] < run["limitFinalHeapDeltaMb"]
        and run["peakHeapDeltaMb"] < run["limitPeakHeapDeltaMb"]
        and run["peakNodeDelta"] < run["limitNodeDelta"]
    )


def build_aggregate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    if not runs:
        return {
            "count": 0,
            "pass_count": 0,
            "fail_count": 0,
            "peak_heap_max_mb": float("nan"),
            "peak_heap_mean_mb": float("nan"),
            "final_heap_mean_mb": float("nan"),
            "peak_node_max": float("nan"),
            "peak_node_mean": float("nan"),
            "slope_max": float("nan"),
            "slope_mean": float("nan"),
            "nodes_ratio_max": float("nan"),
            "nodes_ratio_mean": float("nan"),
            "worst_file": "n/a",
        }

    peak_heap_values = finite_values([run["peakHeapMb"] for run in runs])
    final_heap_values = finite_values([run["finalHeapMb"] for run in runs])
    peak_node_values = finite_values([run["peakNodes"] for run in runs])
    slope_values = finite_values([run["slopeMbPerRound"] for run in runs])
    ratio_values = finite_values([run["nodesRatio"] for run in runs])

    pass_count = sum(1 for run in runs if gate_pass(run))

    if runs[0].get("source") == "tauri-soak":
        worst = max(runs, key=lambda item: item["slopeMbPerRound"] if is_finite(item["slopeMbPerRound"]) else -math.inf)
    else:
        worst = max(runs, key=lambda item: item["peakHeapDeltaMb"] if is_finite(item["peakHeapDeltaMb"]) else -math.inf)

    return {
        "count": len(runs),
        "pass_count": pass_count,
        "fail_count": len(runs) - pass_count,
        "peak_heap_max_mb": max(peak_heap_values) if peak_heap_values else float("nan"),
        "peak_heap_mean_mb": mean(peak_heap_values) if peak_heap_values else float("nan"),
        "final_heap_mean_mb": mean(final_heap_values) if final_heap_values else float("nan"),
        "peak_node_max": max(peak_node_values) if peak_node_values else float("nan"),
        "peak_node_mean": mean(peak_node_values) if peak_node_values else float("nan"),
        "slope_max": max(slope_values) if slope_values else float("nan"),
        "slope_mean": mean(slope_values) if slope_values else float("nan"),
        "nodes_ratio_max": max(ratio_values) if ratio_values else float("nan"),
        "nodes_ratio_mean": mean(ratio_values) if ratio_values else float("nan"),
        "worst_file": worst["file"].name,
    }


def upsert_marked_block(path: Path, start_marker: str, end_marker: str, block: str) -> tuple[bool, str]:
    if not path.exists():
        return False, f"Attach skipped: file not found -> {path.relative_to(ROOT_DIR).as_posix()}"

    content = path.read_text(encoding="utf-8")
    if start_marker in content and end_marker in content:
        pattern = re.compile(re.escape(start_marker) + r".*?" + re.escape(end_marker), flags=re.DOTALL)
        new_content = pattern.sub(lambda _match: block, content, count=1)
        path.write_text(new_content, encoding="utf-8")
        return True, f"Updated block in {path.relative_to(ROOT_DIR).as_posix()}"

    normalized = content if content.endswith("\n") else content + "\n"
    normalized += "\n" + block + "\n"
    path.write_text(normalized, encoding="utf-8")
    return True, f"Appended block to {path.relative_to(ROOT_DIR).as_posix()}"


def build_final_status_block(
    source: str,
    generated_at: str,
    status: PlaywrightRunStatus,
    runs: list[dict[str, Any]],
    report_relpath: str,
    summary_relpath: str,
    log_relpath: str,
) -> str:
    aggregate = build_aggregate(runs)
    lines = [
        FINAL_STATUS_MARKER_START,
        "## Dynamic Memory Test Summary",
        "",
        f"- Source: `{source}`",
        f"- Generated at (UTC): `{generated_at}`",
        f"- Playwright status: `{status.status}`",
        f"- Message: {status.message}",
        f"- Runs analyzed: `{aggregate['count']}`",
        f"- Gates (PASS/FAIL): `{aggregate['pass_count']}` / `{aggregate['fail_count']}`",
        "",
        "### Key Metrics",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Peak heap max (MB) | {format_num(aggregate['peak_heap_max_mb'])} |",
        f"| Peak heap mean (MB) | {format_num(aggregate['peak_heap_mean_mb'])} |",
        f"| Peak node max | {format_num(aggregate['peak_node_max'], 0)} |",
        f"| Slope max (MB/round) | {format_num(aggregate['slope_max'])} |",
        f"| Nodes ratio max | {format_num(aggregate['nodes_ratio_max'])} |",
        "",
        "### Artifacts",
        "",
        f"- Markdown: `{report_relpath}`",
        f"- JSON summary: `{summary_relpath}`",
        f"- Run log: `{log_relpath}`",
        f"- Worst run: `{aggregate['worst_file']}`",
        FINAL_STATUS_MARKER_END,
    ]
    return "\n".join(lines)


def build_deep_audit_block(
    source: str,
    generated_at: str,
    status: PlaywrightRunStatus,
    runs: list[dict[str, Any]],
    report_relpath: str,
    summary_relpath: str,
    log_relpath: str,
) -> str:
    aggregate = build_aggregate(runs)
    lines = [
        DEEP_AUDIT_MARKER_START,
        "### Dynamic memory artifacts (auto-updated)",
        f"- Source: `{source}`",
        f"- Last refresh (UTC): `{generated_at}`",
        f"- Playwright status: `{status.status}`",
        f"- Runs analyzed: `{aggregate['count']}` (`PASS {aggregate['pass_count']}` / `FAIL {aggregate['fail_count']}`)",
        f"- Peak heap max: `{format_num(aggregate['peak_heap_max_mb'])} MB`",
        f"- Peak node max: `{format_num(aggregate['peak_node_max'], 0)}`",
        f"- Slope max: `{format_num(aggregate['slope_max'])} MB/round`",
        f"- Nodes ratio max: `{format_num(aggregate['nodes_ratio_max'])}`",
        f"- Latest report: `{report_relpath}`",
        f"- Latest summary JSON: `{summary_relpath}`",
        f"- Latest run log: `{log_relpath}`",
        DEEP_AUDIT_MARKER_END,
    ]
    return "\n".join(lines)


def build_report_markdown(
    source: str,
    input_glob: str,
    runs: list[dict[str, Any]],
    status: PlaywrightRunStatus,
    generated_at: str,
    summary_json_relpath: str,
) -> str:
    title = SOURCE_CONFIG[source]["report_title"]

    if not runs:
        return (
            f"# {title}\n\n"
            f"- Generated at (UTC): {generated_at}\n"
            f"- Source: `{source}`\n"
            f"- Input glob: `{input_glob}`\n"
            f"- Playwright status: `{status.status}` — {status.message}\n"
            "- No valid runs found for the selected source.\n"
        )

    aggregate = build_aggregate(runs)
    passed = [run for run in runs if gate_pass(run)]
    failed = [run for run in runs if not gate_pass(run)]

    peak_heap = finite_values([run["peakHeapMb"] for run in runs])
    peak_nodes = finite_values([run["peakNodes"] for run in runs])
    slopes = finite_values([run["slopeMbPerRound"] for run in runs])
    ratios = finite_values([run["nodesRatio"] for run in runs])

    lines: list[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"- Generated at (UTC): {generated_at}")
    lines.append(f"- Source: `{source}`")
    lines.append(f"- Input glob: `{input_glob}`")
    lines.append(f"- Playwright command: `{status.command}`")
    lines.append(f"- Playwright status: `{status.status}` — {status.message}")
    lines.append(f"- Runs analyzed: `{len(runs)}`")
    lines.append(f"- Pass/Fail by thresholds: `{len(passed)}` / `{len(failed)}`")
    lines.append(f"- Machine-readable summary: `{summary_json_relpath}`")
    lines.append("")
    lines.append("## Aggregate Stats")
    lines.append("")
    lines.append("| Metric | Min | Median | Mean | P95 | Max |")
    lines.append("|---|---:|---:|---:|---:|---:|")

    if peak_heap:
        lines.append(
            "| Peak heap (MB) | "
            + " | ".join([
                format_num(min(peak_heap)),
                format_num(median(peak_heap)),
                format_num(mean(peak_heap)),
                format_num(pct(peak_heap, 95)),
                format_num(max(peak_heap)),
            ])
            + " |"
        )

    if peak_nodes:
        lines.append(
            "| Peak nodes | "
            + " | ".join([
                format_num(min(peak_nodes), 0),
                format_num(median(peak_nodes), 0),
                format_num(mean(peak_nodes), 0),
                format_num(pct(peak_nodes, 95), 0),
                format_num(max(peak_nodes), 0),
            ])
            + " |"
        )

    if slopes:
        lines.append(
            "| Slope (MB/round) | "
            + " | ".join([
                format_num(min(slopes)),
                format_num(median(slopes)),
                format_num(mean(slopes)),
                format_num(pct(slopes, 95)),
                format_num(max(slopes)),
            ])
            + " |"
        )

    if ratios:
        lines.append(
            "| Nodes ratio | "
            + " | ".join([
                format_num(min(ratios)),
                format_num(median(ratios)),
                format_num(mean(ratios)),
                format_num(pct(ratios, 95)),
                format_num(max(ratios)),
            ])
            + " |"
        )

    lines.append("")
    lines.append("## Run Table")
    lines.append("")
    lines.append("| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |")
    lines.append("|---|---|---|---:|---:|---:|---:|---|")
    for run in runs:
        lines.append(
            f"| `{run['file'].name}` | `{run.get('scenario', 'n/a')}` | {run['generatedAt'] or 'n/a'} | "
            f"{format_num(run['peakHeapMb'])} | "
            f"{format_num(run['peakNodes'], 0)} | "
            f"{format_num(run['slopeMbPerRound'])} | "
            f"{format_num(run['nodesRatio'])} | "
            + ("PASS" if gate_pass(run) else "FAIL")
            + " |"
        )

    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append(f"- Aggregated from `outputs/e2e/perf/{input_glob}`.")
    lines.append(f"- Worst run: `{aggregate['worst_file']}`.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run Playwright memory soak and generate aggregate report."
    )
    parser.add_argument(
        "--source",
        choices=sorted(SOURCE_CONFIG.keys()),
        default="tauri-soak",
        help="Data source and Playwright profile.",
    )
    parser.add_argument(
        "--input-glob",
        default=None,
        help="Explicit perf artifact glob (relative to outputs/e2e/perf).",
    )
    parser.add_argument(
        "--skip-playwright",
        action="store_true",
        help="Skip Playwright execution and aggregate existing perf artifacts only.",
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Do not fail when no matching runs were found.",
    )
    parser.add_argument("--cycles", type=int, default=10, help="Legacy cycles argument for comparison-web source.")
    parser.add_argument("--limit-final-mb", type=float, default=80.0)
    parser.add_argument("--limit-peak-mb", type=float, default=120.0)
    parser.add_argument("--limit-node-delta", type=int, default=15000)
    parser.add_argument(
        "--last-runs",
        type=int,
        default=0,
        help="If >0, aggregate only the last N runs.",
    )
    parser.add_argument(
        "--attach-final-status",
        action="store_true",
        help="Attach summary block into FRONTEND-IPC-DEEP-AUDIT-LATEST.md.",
    )
    parser.add_argument(
        "--attach-deep-audit",
        action="store_true",
        help="Attach dynamic memory links into FRONTEND-IPC-DEEP-AUDIT-LATEST.md.",
    )
    args = parser.parse_args()

    source_cfg = get_source_config(args.source)
    input_glob = args.input_glob or source_cfg["default_glob"]

    if args.skip_playwright:
        status = PlaywrightRunStatus(
            attempted=False,
            status="skipped",
            message="Skipped by --skip-playwright flag.",
            command="npx playwright " + " ".join(source_cfg["test_args"]),
        )
    else:
        status = run_playwright_soak(
            source=args.source,
            cycles=args.cycles,
            final_limit_mb=args.limit_final_mb,
            peak_limit_mb=args.limit_peak_mb,
            node_limit=args.limit_node_delta,
        )

    runs = load_perf_files(
        source=args.source,
        input_glob=input_glob,
        limit=args.last_runs if args.last_runs > 0 else None,
    )

    generated_at = iso_now()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    PERF_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    summary_payload = {
        "generatedAtUtc": generated_at,
        "source": args.source,
        "inputGlob": input_glob,
        "playwrightStatus": {
            "attempted": status.attempted,
            "status": status.status,
            "message": status.message,
            "command": status.command,
        },
        "runCount": len(runs),
        "aggregate": build_aggregate(runs),
        "runs": [
            {
                "file": run["file"].name,
                "generatedAt": run["generatedAt"],
                "scenario": run.get("scenario"),
                "peakHeapMb": run["peakHeapMb"],
                "peakNodes": run["peakNodes"],
                "slopeMbPerRound": run["slopeMbPerRound"],
                "nodesRatio": run["nodesRatio"],
                "gatePass": gate_pass(run),
            }
            for run in runs
        ],
    }

    summary_path = PERF_DIR / f"{source_cfg['summary_prefix']}-{stamp}.json"
    summary_path.write_text(json.dumps(summary_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary_relpath = summary_path.relative_to(ROOT_DIR).as_posix()
    report_markdown = build_report_markdown(
        source=args.source,
        input_glob=input_glob,
        runs=runs,
        status=status,
        generated_at=generated_at,
        summary_json_relpath=summary_relpath,
    )

    report_path = REPORTS_DIR / f"memory-performance-report-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.md"
    report_path.write_text(report_markdown + "\n", encoding="utf-8")
    report_relpath = report_path.relative_to(ROOT_DIR).as_posix()

    log_path = PERF_DIR / source_cfg["log_file"]
    log_relpath = log_path.relative_to(ROOT_DIR).as_posix() if log_path.exists() else "n/a"

    if args.attach_final_status:
        final_status_block = build_final_status_block(
            source=args.source,
            generated_at=generated_at,
            status=status,
            runs=runs,
            report_relpath=report_relpath,
            summary_relpath=summary_relpath,
            log_relpath=log_relpath,
        )
        _, message = upsert_marked_block(
            path=FINAL_STATUS_REPORT_PATH,
            start_marker=FINAL_STATUS_MARKER_START,
            end_marker=FINAL_STATUS_MARKER_END,
            block=final_status_block,
        )
        print(message)

    if args.attach_deep_audit:
        deep_audit_block = build_deep_audit_block(
            source=args.source,
            generated_at=generated_at,
            status=status,
            runs=runs,
            report_relpath=report_relpath,
            summary_relpath=summary_relpath,
            log_relpath=log_relpath,
        )
        _, message = upsert_marked_block(
            path=DEEP_AUDIT_PATH,
            start_marker=DEEP_AUDIT_MARKER_START,
            end_marker=DEEP_AUDIT_MARKER_END,
            block=deep_audit_block,
        )
        print(message)

    print(f"Source: {args.source}")
    print(f"Input glob: {input_glob}")
    print(f"Playwright status: {status.status} — {status.message}")
    print(f"Summary JSON: {summary_relpath}")
    print(f"Markdown report: {report_relpath}")

    if status.status == "failed" and not args.skip_playwright:
        return 1

    if len(runs) == 0 and not args.allow_empty:
        print("ERROR: no matching perf runs found (fail-fast enabled).", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
