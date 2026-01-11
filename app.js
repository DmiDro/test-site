/* ===============================
   app.js — точка входа логики
   =============================== */

// берём данные, которые уже положены в window
const ROOM_TYPES = window.ROOM_TYPES;
const RATES = window.RATES;

// защита от ошибок загрузки
if (!ROOM_TYPES || !RATES) {
  console.error("ROOM_TYPES или RATES не загружены. Проверь порядок <script>.");
}

/* ===== helpers ===== */

function primaryPhoto(t){
  return (t.photos && t.photos.length) ? t.photos[0] : null;
}

/* ===== быстрый smoke-test ===== */
console.log("app.js loaded", {
  rooms: ROOM_TYPES?.length,
  rates: RATES?.length
});
