#!/usr/bin/env python3
"""GDI 观测结果展示（self-eval.sh --gdi-agent 用）：stdin 收 JSON → 去刻度卡片 + L1 明细"""
import json
import sys

d = json.load(sys.stdin)
p = d["present"]
dim = d["dimensions"]

print()
print("=" * 54)
print(f'  🫂 GDI 关系层观测: {d["agent"]}')
print("=" * 54)

covered = ",".join(p["composite"].get("covered", [])) or "-"
print(f'  综合: 「{p["composite"]["label"]}」{p["composite"]["arrow"]}   覆盖: {covered}')
print(f'  契约: 「{p["contract"]["label"]}」{p["contract"]["arrow"]}')
vreason = p["verify"].get("reason") or ""
print(f'  验证: 「{p["verify"]["label"]}」{p["verify"]["arrow"]}   {vreason}')
print(f'  复用: 「{p["reuse"]["label"]}」{p["reuse"]["arrow"]}   外部引用者 {p["reuse"].get("externalRefers", 0)}')

print("  —— L1 明细（本人 + 人类席位）——")
c = dim["contract"]
if c["rate"] is not None:
    print(f'  契约命中率: {c["rate"] * 100:.1f}% (履约 {c["kept"]}, 失信 {c["broken"]})')
v = dim["verify"]
if v["rate"] is not None:
    print(f'  独立验证通过率: {v["rate"] * 100:.1f}% ({v["passed"]}/{v["total"]})')
else:
    print(f'  独立验证: {v["reason"]} (诚实 N/A，不硬凑分)')
r = dim["reuse"]
if r["rate"] is not None:
    print(f'  关系复用率: {r["rate"] * 100:.1f}% (净 {r["net"]:.2f}/毛 {r["gross"]:.1f})')
cal = d.get("calibration")
if cal and cal.get("alert"):
    print(f'  📌 校准提醒: {cal["message"]}')

print()
print(f'  {p["note"]}')
print()
