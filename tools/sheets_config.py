# booking_prototype/tools/sheets_config.py
from pathlib import Path

# 1) ID гугл-таблицы (между /d/ и /edit)
SHEET_ID = "1JgGxoDtQuB8cukm5CA8qwO3h72qxS0NU2RLX20nZ0Z0"

# 2) GID вкладок (в URL таблички после gid=)
GID_ROOMS = "0"          # <-- замени на gid вкладки rooms
GID_RULES = "441408510"          # <-- замени на gid вкладки calendar_rules

# 3) Куда генерим файлы
PROJECT_ROOT = Path(__file__).resolve().parents[1]  # booking_prototype/
OUT_ROOM_TYPES = PROJECT_ROOT / "data" / "room_types.js"
OUT_RATES = PROJECT_ROOT / "data" / "rates.js"
