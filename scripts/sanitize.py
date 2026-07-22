#!/usr/bin/env python3
"""
sanitize.py — strip PII from raw Hydrat3 exports before anything is loaded.

    data/raw/*.csv  →  data/sanitized/*.csv

Sanitization rules (from VOD-NEO4J-BUILD-PLAN.md §2):
  - Personal emails/phones  → keep domain only (email) / drop (phone)
  - Full names              → first name + last initial
  - Exact addresses         → keep district/neighborhood only
  - Internal notes / pricing → removed entirely

Every transformation is logged per row so the pass is auditable. This script
NEVER writes back into data/raw/. If it encounters a column it has no rule for,
it STOPS and asks (per the build plan's stop conditions) rather than guessing.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from pathlib import Path

RAW_DIR = Path("data/raw")
OUT_DIR = Path("data/sanitized")

# Columns we know how to handle. Anything outside this map triggers a stop.
# action ∈ {keep, email_domain, drop, name_initial, district, remove, hash}
COLUMN_RULES: dict[str, str] = {
    # structural — kept as-is
    "venue_id": "keep",
    "contact_id": "keep",
    "sequence_id": "keep",
    "name": "keep",            # venue name (a business name, not a person)
    "category": "keep",
    "district": "keep",
    "role": "keep",
    "title": "keep",
    "verified": "keep",
    "source": "keep",
    "status": "keep",
    # PII — transformed
    "email": "email_domain",
    "contact_email": "email_domain",
    "phone": "drop",
    "contact_name": "name_initial",
    "person": "name_initial",
    "address": "district",
    "street": "district",
    # internal — removed
    "notes": "remove",
    "internal_notes": "remove",
    "price": "remove",
    "pricing": "remove",
    "deal_value": "remove",
}

EMAIL_RE = re.compile(r"^[^@\s]+@([^@\s]+)$")


def email_domain(value: str) -> str:
    m = EMAIL_RE.match(value.strip())
    return f"@{m.group(1)}" if m else ""


def name_initial(value: str) -> str:
    parts = value.strip().split()
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def district_only(value: str) -> str:
    # Keep the last comma-delimited segment (usually the district/city).
    segs = [s.strip() for s in value.split(",") if s.strip()]
    return segs[-1] if segs else ""


def hashed(value: str) -> str:
    return hashlib.sha256(value.strip().encode()).hexdigest()[:16]


def apply_rule(action: str, value: str) -> str | None:
    """Return the sanitized value, or None if the column should be dropped."""
    if action in ("remove", "drop"):
        return None
    if not value:
        return value
    if action == "keep":
        return value
    if action == "email_domain":
        return email_domain(value)
    if action == "name_initial":
        return name_initial(value)
    if action == "district":
        return district_only(value)
    if action == "hash":
        return hashed(value)
    raise ValueError(f"Unknown action: {action}")


def sanitize_file(src: Path, dst: Path) -> None:
    with src.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []

        unknown = [c for c in fieldnames if c not in COLUMN_RULES]
        if unknown:
            sys.exit(
                f"STOP: {src.name} has columns with no sanitization rule: "
                f"{unknown}\nAdd rules to COLUMN_RULES in scripts/sanitize.py "
                f"before running (build plan §8 stop condition)."
            )

        kept_cols = [c for c in fieldnames if COLUMN_RULES[c] not in ("remove", "drop")]
        rows_out = []
        for i, row in enumerate(reader, start=1):
            out_row = {}
            changes = []
            for col in fieldnames:
                action = COLUMN_RULES[col]
                new_val = apply_rule(action, row.get(col, "") or "")
                if action in ("remove", "drop"):
                    changes.append(f"{col}[removed]")
                    continue
                if new_val != (row.get(col, "") or ""):
                    changes.append(f"{col}:{action}")
                out_row[col] = new_val
            rows_out.append(out_row)
            if changes:
                print(f"  {src.name} row {i}: {', '.join(changes)}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    with dst.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=kept_cols)
        writer.writeheader()
        writer.writerows(rows_out)
    print(f"[OK] {src.name} → {dst} ({len(rows_out)} rows, cols: {kept_cols})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sanitize raw VOD CSV exports.")
    parser.add_argument("--raw", default=str(RAW_DIR), help="input dir (default data/raw)")
    parser.add_argument("--out", default=str(OUT_DIR), help="output dir (default data/sanitized)")
    args = parser.parse_args()

    raw_dir, out_dir = Path(args.raw), Path(args.out)
    csvs = sorted(raw_dir.glob("*.csv"))
    if not csvs:
        sys.exit(f"No CSVs found in {raw_dir}. Put raw Hydrat3 exports there first.")

    print(f"Sanitizing {len(csvs)} file(s): {raw_dir} → {out_dir}\n")
    for src in csvs:
        sanitize_file(src, out_dir / src.name)
    print("\nDone. Review data/sanitized/ before loading.")


if __name__ == "__main__":
    main()
