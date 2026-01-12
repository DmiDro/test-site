# booking_prototype/tools/generate_from_sheets.py
import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import requests

from sheets_config import SHEET_ID, GID_ROOMS, GID_RULES, OUT_ROOM_TYPES, OUT_RATES


# =========================
# utils
# =========================

def gs_csv_url(sheet_id: str, gid: str) -> str:
    # экспорт конкретного листа (gid) в CSV
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"

def fetch_csv(url: str) -> List[List[str]]:
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    text = r.content.decode("utf-8-sig", errors="replace")
    buf = io.StringIO(text)
    rows = list(csv.reader(buf))
    return rows

def parse_int(x: str, default: int = 0) -> int:
    x = (x or "").strip()
    if not x:
        return default
    x = x.replace(" ", "").replace("\u00a0", "")
    # 12 900,00 -> 12900
    x = x.replace(",", ".")
    try:
        return int(float(x))
    except:
        return default

def parse_float(x: str, default: float = 0.0) -> float:
    x = (x or "").strip()
    if not x:
        return default
    x = x.replace(" ", "").replace("\u00a0", "").replace(",", ".")
    try:
        return float(x)
    except:
        return default

def parse_yes(x: str) -> bool:
    return (x or "").strip().upper() in ("YES", "Y", "TRUE", "1", "ДА")

def split_list(x: str) -> List[str]:
    # для amenities/photos: "a;b;c"
    x = (x or "").strip()
    if not x:
        return []
    # убираем кавычки, лишние пробелы
    x = x.replace('"', "").replace("“", "").replace("”", "")
    parts = [p.strip() for p in x.split(";")]
    return [p for p in parts if p]

def parse_date_ymd(x: str) -> Optional[date]:
    x = (x or "").strip()
    if not x:
        return None
    try:
        return datetime.strptime(x, "%Y-%m-%d").date()
    except:
        return None

def js_quote(s: str) -> str:
    # безопасная строка для JS
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    s = s.replace("\r", " ").replace("\n", " ")
    return f'"{s}"'

def js_array_str(items: List[str]) -> str:
    return "[" + ", ".join(js_quote(x) for x in items) + "]"


# =========================
# models
# =========================

@dataclass
class Room:
    id: str
    name: str
    base_weekday: int
    base_weekend: int
    beds_total: int
    beds_desc: str
    total_rooms: int
    capA: int
    capK: int
    monthly_allowed: bool
    monthly_min_days: int
    monthly_discount_pct: int
    breakfast_price_adult: int
    breakfast_price_child: int
    amenities: List[str]
    photos: List[str]
    desc: str


@dataclass
class Rule:
    rule_id: str
    enabled: bool
    name: str
    date_from: date
    date_to: date
    rule_type: str  # HOLIDAY/SPECIAL/MONTHLY/BLACKOUT
    applies_to: List[str]  # empty => all
    room_min_nights: int
    weekday_multiplier: float
    weekend_multiplier: float
    fixed_weekday_price: int
    fixed_weekend_price: int
    monthly_only: bool
    notes: str
    row_index: int  # порядок в таблице (для тайбрейка)


# =========================
# parsing sheets
# =========================

def rows_to_dicts(rows: List[List[str]]) -> Tuple[List[str], List[Dict[str, str]]]:
    if len(rows) < 3:
        raise ValueError("Вкладка должна иметь минимум 3 строки (ключи, описание, данные).")
    header = [h.strip() for h in rows[0]]
    data_rows = rows[2:]  # строка 2 (описание) игнорируется
    out: List[Dict[str, str]] = []
    for r in data_rows:
        if not any((c or "").strip() for c in r):
            continue
        d = {}
        for i, key in enumerate(header):
            if not key:
                continue
            d[key] = (r[i] if i < len(r) else "").strip()
        out.append(d)
    return header, out

def load_rooms() -> List[Room]:
    url = gs_csv_url(SHEET_ID, GID_ROOMS)
    rows = fetch_csv(url)
    _, items = rows_to_dicts(rows)

    rooms: List[Room] = []
    for d in items:
        rid = d.get("id", "").strip()
        if not rid:
            continue

        rooms.append(Room(
            id=rid,
            name=d.get("name", "").strip(),
            base_weekday=parse_int(d.get("base_weekday", "")),
            base_weekend=parse_int(d.get("base_weekend", "")),
            beds_total=parse_int(d.get("beds_total", ""), default=0),
            beds_desc=d.get("beds_desc", "").strip(),
            total_rooms=parse_int(d.get("total rooms", ""), default=0),
            capA=parse_int(d.get("capA", ""), default=0),
            capK=parse_int(d.get("capK", ""), default=0),
            monthly_allowed=parse_yes(d.get("monthly_allowed", "")),
            monthly_min_days=parse_int(d.get("monthly_min_days", ""), default=0),
            monthly_discount_pct=parse_int(d.get("monthly_discount_pct", ""), default=0),
            breakfast_price_adult=parse_int(d.get("breakfast_price_adult", ""), default=0),
            breakfast_price_child=parse_int(d.get("breakfast_price_child", ""), default=0),
            amenities=split_list(d.get("amenities", "")),
            photos=split_list(d.get("photos", "")),
            desc=d.get("desc", "").strip(),
        ))
    return rooms

def load_rules() -> List[Rule]:
    url = gs_csv_url(SHEET_ID, GID_RULES)
    rows = fetch_csv(url)
    _, items = rows_to_dicts(rows)

    rules: List[Rule] = []
    for idx, d in enumerate(items, start=3):  # реальный номер строки для удобства
        rid = d.get("rule_id", "").strip()
        if not rid:
            continue

        enabled = parse_yes(d.get("Enable", "YES"))
        df = parse_date_ymd(d.get("from", ""))
        dt = parse_date_ymd(d.get("to", ""))
        if not df or not dt:
            continue

        rule_type = (d.get("rule_type", "") or "").strip().upper()
        applies_to = split_list(d.get("applies_to", ""))

        rules.append(Rule(
            rule_id=rid,
            enabled=enabled,
            name=d.get("name", "").strip(),
            date_from=df,
            date_to=dt,
            rule_type=rule_type,
            applies_to=applies_to,
            room_min_nights=parse_int(d.get("room_min_nights", ""), default=0),
            weekday_multiplier=parse_float(d.get("weekday_multiplier", ""), default=0.0),
            weekend_multiplier=parse_float(d.get("weekend_multiplier", ""), default=0.0),
            fixed_weekday_price=parse_int(d.get("fixed_weekday_price", ""), default=0),
            fixed_weekend_price=parse_int(d.get("fixed_weekend_price", ""), default=0),
            monthly_only=parse_yes(d.get("monthly_only", "")),
            notes=d.get("notes", "").strip(),
            row_index=idx
        ))
    return rules


# =========================
# pricing logic
# =========================

def is_weekend_pF_vS_vV(d: date) -> bool:
    # weekend = Пт(4), Сб(5), Вс(6)
    return d.weekday() in (4, 5, 6)

def rule_matches(rule: Rule, room_id: str, day: date) -> bool:
    if not rule.enabled:
        return False
    if day < rule.date_from or day > rule.date_to:
        return False
    if rule.applies_to and room_id not in rule.applies_to:
        return False
    return True

def rule_span_days(r: Rule) -> int:
    return (r.date_to - r.date_from).days + 1

def pick_rule(rules: List[Rule]) -> Optional[Rule]:
    if not rules:
        return None

    # сортировка по приоритету:
    # 1) monthly_only YES выше
    # 2) room_min_nights больше выше
    # 3) период короче выше
    # 4) выше в таблице (меньше row_index) выше
    rules_sorted = sorted(
        rules,
        key=lambda r: (
            0 if r.monthly_only else 1,
            -r.room_min_nights,
            rule_span_days(r),
            r.row_index
        )
    )
    return rules_sorted[0]

def price_for_day(room: Room, day: date, matched_rules: List[Rule]) -> Tuple[int, int]:
    """
    return: (price, min_nights_for_that_day)
    """
    weekend = is_weekend_pF_vS_vV(day)

    # BLACKOUT — отдельным списком (цена всё равно нужна для прототипа),
    # но можно вернуть 0 и дальше в UI запретить.
    blackout = [r for r in matched_rules if r.rule_type == "BLACKOUT"]
    # FIXED
    fixed = [r for r in matched_rules if (r.fixed_weekday_price > 0 or r.fixed_weekend_price > 0)]
    # MULT
    mult = [r for r in matched_rules if (r.weekday_multiplier > 0 or r.weekend_multiplier > 0)]
    # MIN NIGHTS / MONTHLY
    any_rules = matched_rules[:]  # для min nights

    # min nights
    r_min = pick_rule([r for r in any_rules if r.room_min_nights > 0])
    min_nights = r_min.room_min_nights if r_min else 0
    if min_nights <= 0:
        # если нет override — можно считать минимум 1, но лучше оставлять как "0" и использовать min_nights_default в ROOM_TYPES
        min_nights = 0

    # цена
    if fixed:
        r = pick_rule(fixed)
        p = r.fixed_weekend_price if weekend and r.fixed_weekend_price > 0 else r.fixed_weekday_price
        if p <= 0:
            # если, например, задан только weekday фикс
            p = r.fixed_weekday_price if r.fixed_weekday_price > 0 else r.fixed_weekend_price
        return int(p), int(min_nights)

    if mult:
        r = pick_rule(mult)
        base = room.base_weekend if weekend else room.base_weekday
        m = r.weekend_multiplier if weekend and r.weekend_multiplier > 0 else r.weekday_multiplier
        if m <= 0:
            m = r.weekday_multiplier if r.weekday_multiplier > 0 else r.weekend_multiplier
        p = int(round(base * m))
        return p, int(min_nights)

    # default base
    p = room.base_weekend if weekend else room.base_weekday
    return int(p), int(min_nights)


# =========================
# generation
# =========================

def js_room_types(rooms: List[Room]) -> str:
    items = []
    for r in rooms:
        # для текущего app.js нужно:
        # id, name, desc, base, capA, capK, min, amen, photos
        # base = base_weekday (fallback), реальные цены идут из RATES
        item = (
            "{"
            f"id:{js_quote(r.id)},"
            f"name:{js_quote(r.name)},"
            f"desc:{js_quote(r.desc)},"
            f"base:{r.base_weekday},"
            f"base_weekend:{r.base_weekend},"
            f"beds_total:{r.beds_total},"
            f"beds_desc:{js_quote(r.beds_desc)},"
            f"total_rooms:{r.total_rooms},"
            f"capA:{r.capA},"
            f"capK:{r.capK},"
            f"min:{1 if False else 2},"  # НЕ знаем min_nights_default в твоём новом листе? если есть — поправим ниже
            f"min_nights_default:{parse_int('0')},"
            f"monthly_allowed:{'true' if r.monthly_allowed else 'false'},"
            f"monthly_min_days:{r.monthly_min_days},"
            f"monthly_discount_pct:{r.monthly_discount_pct},"
            f"breakfast_price_adult:{r.breakfast_price_adult},"
            f"breakfast_price_child:{r.breakfast_price_child},"
            f"amen:{js_array_str(r.amenities)},"
            f"photos:{js_array_str(r.photos)}"
            "}"
        )
        items.append(item)

    # фикс: min_nights_default у тебя пока не в ключах в примере (есть ли колонка min_nights_default?).
    # Если она есть — ниже мы перегенерим правильно через второй проход:
    return (
        "// AUTOGENERATED. Do not edit by hand.\n"
        "window.ROOM_TYPES = [\n  " + ",\n  ".join(items) + "\n];\n"
    )

def js_room_types_fixed(rooms_dicts: List[Dict[str, str]]) -> str:
    items = []
    for d in rooms_dicts:
        rid = d.get("id", "").strip()
        if not rid:
            continue

        # читаем min_nights_default если есть
        min_def = parse_int(d.get("min_nights_default", ""), default=2)

        r = Room(
            id=rid,
            name=d.get("name", "").strip(),
            base_weekday=parse_int(d.get("base_weekday", "")),
            base_weekend=parse_int(d.get("base_weekend", "")),
            beds_total=parse_int(d.get("beds_total", ""), default=0),
            beds_desc=(d.get("beds_desc", "") or "").strip(),
            total_rooms=parse_int(d.get("total rooms", ""), default=0),
            capA=parse_int(d.get("capA", ""), default=0),
            capK=parse_int(d.get("capK", ""), default=0),
            monthly_allowed=parse_yes(d.get("monthly_allowed", "")),
            monthly_min_days=parse_int(d.get("monthly_min_days", ""), default=0),
            monthly_discount_pct=parse_int(d.get("monthly_discount_pct", ""), default=0),
            breakfast_price_adult=parse_int(d.get("breakfast_price_adult", ""), default=0),
            breakfast_price_child=parse_int(d.get("breakfast_price_child", ""), default=0),
            amenities=split_list(d.get("amenities", "")),
            photos=split_list(d.get("photos", "")),
            desc=(d.get("desc", "") or "").strip(),
        )

        item = (
            "{"
            f"id:{js_quote(r.id)},"
            f"name:{js_quote(r.name)},"
            f"desc:{js_quote(r.desc)},"
            f"base:{r.base_weekday},"
            f"base_weekend:{r.base_weekend},"
            f"beds_total:{r.beds_total},"
            f"beds_desc:{js_quote(r.beds_desc)},"
            f"total_rooms:{r.total_rooms},"
            f"capA:{r.capA},"
            f"capK:{r.capK},"
            f"min:{min_def},"
            f"min_nights_default:{min_def},"
            f"monthly_allowed:{'true' if r.monthly_allowed else 'false'},"
            f"monthly_min_days:{r.monthly_min_days},"
            f"monthly_discount_pct:{r.monthly_discount_pct},"
            f"breakfast_price_adult:{r.breakfast_price_adult},"
            f"breakfast_price_child:{r.breakfast_price_child},"
            f"amen:{js_array_str(r.amenities)},"
            f"photos:{js_array_str(r.photos)}"
            "}"
        )
        items.append(item)

    return (
        "// AUTOGENERATED. Do not edit by hand.\n"
        "window.ROOM_TYPES = [\n  " + ",\n  ".join(items) + "\n];\n"
    )

def js_inventory(rooms_dicts: List[Dict[str, str]]) -> str:
    parts = []
    for d in rooms_dicts:
        rid = d.get("id", "").strip()
        if not rid:
            continue
        total_rooms = parse_int(d.get("total rooms", ""), default=0)
        parts.append(f"{js_quote(rid)}: {total_rooms}")
    return "window.INVENTORY = {" + ", ".join(parts) + "};\n"

def js_rates(rooms_dicts: List[Dict[str, str]], rules: List[Rule]) -> Tuple[str, List[str]]:
    # горизонты: min(from) .. max(to), но минимум — сегодня, максимум — сегодня+365
    today = date.today()
    rule_froms = [r.date_from for r in rules if r.enabled]
    rule_tos = [r.date_to for r in rules if r.enabled]
    start = min(rule_froms) if rule_froms else today
    end = max(rule_tos) if rule_tos else today + timedelta(days=365)

    if start > today:
        start = today
    if end < today + timedelta(days=365):
        end = today + timedelta(days=365)

    # строим Room objects на лету
    rooms: List[Room] = []
    for d in rooms_dicts:
        rid = d.get("id", "").strip()
        if not rid:
            continue
        rooms.append(Room(
            id=rid,
            name=d.get("name", "").strip(),
            base_weekday=parse_int(d.get("base_weekday", "")),
            base_weekend=parse_int(d.get("base_weekend", "")),
            beds_total=parse_int(d.get("beds_total", ""), default=0),
            beds_desc=(d.get("beds_desc", "") or "").strip(),
            total_rooms=parse_int(d.get("total rooms", ""), default=0),
            capA=parse_int(d.get("capA", ""), default=0),
            capK=parse_int(d.get("capK", ""), default=0),
            monthly_allowed=parse_yes(d.get("monthly_allowed", "")),
            monthly_min_days=parse_int(d.get("monthly_min_days", ""), default=0),
            monthly_discount_pct=parse_int(d.get("monthly_discount_pct", ""), default=0),
            breakfast_price_adult=parse_int(d.get("breakfast_price_adult", ""), default=0),
            breakfast_price_child=parse_int(d.get("breakfast_price_child", ""), default=0),
            amenities=[],
            photos=[],
            desc="",
        ))

    blackout_dates: List[str] = []

    # считаем по дням и потом сжимаем в диапазоны одинаковой цены
    lines = []
    for room in rooms:
        day = start
        prev_price = None
        prev_from = None

        while day <= end:
            matched = [r for r in rules if rule_matches(r, room.id, day)]
            if any(r.rule_type == "BLACKOUT" for r in matched):
                blackout_dates.append(day.isoformat())

            p, _min_override = price_for_day(room, day, matched)

            if prev_price is None:
                prev_price = p
                prev_from = day
            elif p != prev_price:
                # закрываем диапазон prev_from..(day-1)
                lines.append((room.id, prev_from.isoformat(), (day - timedelta(days=1)).isoformat(), prev_price))
                prev_price = p
                prev_from = day

            day += timedelta(days=1)

        # закрываем хвост
        if prev_price is not None and prev_from is not None:
            lines.append((room.id, prev_from.isoformat(), end.isoformat(), prev_price))

    js_items = [
        f"  {{ room_type_id: {js_quote(rt)}, from: {js_quote(fr)}, to: {js_quote(to)}, price: {price} }}"
        for (rt, fr, to, price) in lines
    ]
    js = (
        "// AUTOGENERATED. Do not edit by hand.\n"
        "window.RATES = [\n" + ",\n".join(js_items) + "\n];\n"
    )
    return js, sorted(set(blackout_dates))

def main():
    # rooms (dicts) — нужно для корректного чтения min_nights_default и total rooms
    rooms_rows = fetch_csv(gs_csv_url(SHEET_ID, GID_ROOMS))
    _, rooms_dicts = rows_to_dicts(rooms_rows)

    rules = load_rules()

    # room_types.js
    room_types_js = js_room_types_fixed(rooms_dicts) + "\n" + js_inventory(rooms_dicts)

    # rates.js + blackout
    rates_js, blackout = js_rates(rooms_dicts, rules)
    if blackout:
        rates_js += "\nwindow.BLACKOUT_DATES = " + js_array_str(blackout) + ";\n"
    else:
        rates_js += "\nwindow.BLACKOUT_DATES = [];\n"

    OUT_ROOM_TYPES.parent.mkdir(parents=True, exist_ok=True)
    OUT_RATES.parent.mkdir(parents=True, exist_ok=True)

    OUT_ROOM_TYPES.write_text(room_types_js, encoding="utf-8")
    OUT_RATES.write_text(rates_js, encoding="utf-8")

    print("OK")
    print("Generated:", OUT_ROOM_TYPES)
    print("Generated:", OUT_RATES)
    print(f"Rules enabled: {sum(1 for r in rules if r.enabled)}")
    print(f"Blackout days: {len(blackout)}")


if __name__ == "__main__":
    main()
