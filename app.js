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

function pad2(n){ return String(n).padStart(2,'0'); }
function toISODate(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
function nightsBetween(a,b){
  const da=new Date(a+"T00:00:00"); const db=new Date(b+"T00:00:00");
  return Math.round((db-da)/(1000*60*60*24));
}
function eachNight(checkIn,checkOut){
  const n=nightsBetween(checkIn,checkOut);
  const start=new Date(checkIn+"T00:00:00");
  const arr=[];
  for(let i=0;i<n;i++){
    const d=new Date(start); d.setDate(d.getDate()+i);
    arr.push(toISODate(d));
  }
  return arr;
}
function overlaps(a1,a2,b1,b2){ return (a1<b2) && (a2>b1); }

function primaryPhoto(t){
  return (t.photos && t.photos.length) ? t.photos[0] : null;
}

// цена по дню из RATES (генератор сжал диапазоны)
function rateFor(roomTypeId, day){
  const r=RATES.find(x=>x.room_type_id===roomTypeId && x.from<=day && x.to>=day);
  return r ? r.price : null;
}

function computePrice(roomTypeId, fallbackWeekday, checkIn, checkOut){
  const nights=eachNight(checkIn, checkOut);
  const breakdown=nights.map(day=>{
    const p=rateFor(roomTypeId, day);
    return {date:day, price:(p ?? fallbackWeekday)};
  });
  const total=breakdown.reduce((s,x)=>s+x.price,0);
  return {breakdown,total};
}

/* ===== local storage bookings ===== */

const LS_KEY = "booking_prototype_bookings_v3";

function loadBookings(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } }
function saveBookings(b){ localStorage.setItem(LS_KEY, JSON.stringify(b)); }

function expirePending(bookings){
  const now=Date.now();
  let changed=false;
  for(const b of bookings){
    if(b.status==="PENDING" && b.expires_at && new Date(b.expires_at).getTime()<=now){
      b.status="EXPIRED"; changed=true;
    }
  }
  if(changed) saveBookings(bookings);
  return bookings;
}

/* ===== inventory ===== */
// ВАЖНО: теперь берём из сгенеренного room_types.js
const INVENTORY = window.INVENTORY || {};

// blackouts (если захочешь включить позже)
const BLACKOUT_DATES = window.BLACKOUT_DATES || [];

/* ===== availability ===== */

function availableCount(roomTypeId, checkIn, checkOut){
  const bookings=expirePending(loadBookings());
  const inv=INVENTORY[roomTypeId] || 0;
  let occupied=0;

  for(const b of bookings){
    if(b.room_type_id!==roomTypeId) continue;
    if(!["PENDING","PAID","CONFIRMED"].includes(b.status)) continue;
    if(overlaps(b.check_in, b.check_out, checkIn, checkOut)) occupied++;
  }
  return Math.max(0, inv - occupied);
}

/* ===== UI state ===== */

const el=(id)=>document.getElementById(id);
const grid=el("grid");
const statusPill=el("statusPill");
const btnSearch=el("btnSearch");
const overlay=el("overlay");
const toast=el("toast");

const st={
  checkIn:"",
  checkOut:"",
  adults:1,
  kids:0,
  selected:null,
  computed:null,
  breakfast:false
};

function setStatus(text){ statusPill.textContent=text; }

function showToast(msg){
  toast.textContent=msg;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"), 2800);
}

/* ===== card gallery helper ===== */

function mountCardGallery(root, photos, label){
  const img = root.querySelector(".cImg");
  const prev = root.querySelector(".cPrev");
  const next = root.querySelector(".cNext");
  const dots = root.querySelector(".cDots");
  const noPhoto = root.querySelector(".cNoPhoto");

  const list = Array.isArray(photos) ? photos.filter(Boolean) : [];
  let idx = 0;

  function render(){
    if(!list.length){
      img.removeAttribute("src");
      img.style.display="none";
      prev.style.display="none";
      next.style.display="none";
      dots.innerHTML="";
      if(noPhoto){
        noPhoto.style.display="flex";
        noPhoto.innerHTML = `<span>${label}</span>`;
      }
      return;
    }

    if(noPhoto) noPhoto.style.display="none";

    img.style.display="block";
    img.src = list[idx];

    prev.style.display = list.length>1 ? "flex" : "none";
    next.style.display = list.length>1 ? "flex" : "none";

    dots.innerHTML = list.map((_, i)=>
      `<button type="button" class="cDot ${i===idx?'active':''}" data-i="${i}" aria-label="Фото ${i+1}"></button>`
    ).join("");
  }

  function go(delta){
    if(list.length<2) return;
    idx = (idx + delta + list.length) % list.length;
    render();
  }

  prev.onclick = ()=>go(-1);
  next.onclick = ()=>go(1);

  dots.onclick = (e)=>{
    const b = e.target.closest(".cDot");
    if(!b) return;
    const i = Number(b.dataset.i);
    if(Number.isFinite(i)){
      idx = i;
      render();
    }
  };

  // swipe (touch)
  let startX = null;
  img.ontouchstart = (e)=>{ startX = e.touches?.[0]?.clientX ?? null; };
  img.ontouchend = (e)=>{
    if(startX === null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    if(endX === null) return;
    const dx = endX - startX;
    if(Math.abs(dx) > 35) go(dx > 0 ? -1 : 1);
    startX = null;
  };

  render();
}

/* ===== render cards ===== */

function renderCards(){
  grid.innerHTML="";

  const can = st.checkIn && st.checkOut && nightsBetween(st.checkIn, st.checkOut)>0;
  const nights = can ? nightsBetween(st.checkIn, st.checkOut) : 0;

  // правило: минимум 1 взрослый
  const adults = Math.max(1, Number(st.adults)||1);
  const kids = Math.max(0, Number(st.kids)||0);
  const guestsTotal = adults + kids;

  for(const t of ROOM_TYPES){

    // NEW: фильтр — если поиск активен и мест меньше гостей → вообще не показываем карточку
    const beds = Number(t.beds_total || 0);
    if(can && beds>0 && beds < guestsTotal){
      continue;
    }

    const avail = can ? availableCount(t.id, st.checkIn, st.checkOut) : 0;
    const price = can ? computePrice(t.id, t.base, st.checkIn, st.checkOut) : null;

    // бейдж: показываем спальные места
    const badgeText = beds>0 ? `до ${beds} мест` : `места: —`;

    // базовая цена "от" — минимальная из weekday/weekend
    const baseMin = Math.min(Number(t.base||0), Number(t.base_weekend||t.base||0));

    const card=document.createElement("div");
    card.className="card";

    card.innerHTML = `
      <div class="cardTop">
        <div class="cGallery" data-room="${t.id}">
          <img class="cImg" alt="Фото номера">
          <div class="cNoPhoto" style="display:none"></div>
          <button class="cNav cPrev" type="button" aria-label="Предыдущее фото">‹</button>
          <button class="cNav cNext" type="button" aria-label="Следующее фото">›</button>
          <div class="cDots" aria-hidden="true"></div>
        </div>

        <div>
          <div class="title">
            <h2>${t.name}</h2>
            <span class="badge">${badgeText}</span>
          </div>
          <div class="desc">${t.desc || ""}</div>

          <div class="meta">
            ${(t.amen||[]).slice(0,5).map(x=>`<span class="chip">${x}</span>`).join("")}
          </div>

          <div class="row">
            <div class="price">${
              can
                ? `за ${nights} ноч. <b>${price.total.toLocaleString("ru-RU")}</b> ₽`
                : `от <b>${(baseMin||0).toLocaleString("ru-RU")}</b> ₽/ночь`
            }</div>
            <div class="avail">Доступно: <b>${can ? avail : "—"}</b></div>
          </div>

          <button class="action" ${(!can || avail<=0 || nights < (t.min_nights_default ?? t.min ?? 1)) ? "disabled" : ""}>
            ${(!can)
              ? "Выбери даты"
              : (nights < (t.min_nights_default ?? t.min ?? 1)
                ? `Мин. ночей: ${(t.min_nights_default ?? t.min ?? 1)}`
                : (avail<=0 ? "Нет мест" : "Выбрать комнату")
              )
            }
          </button>
        </div>
      </div>

      <div class="content"></div>
    `;

    // подключаем галерею карточки
    const gallery = card.querySelector(".cGallery");
    mountCardGallery(gallery, t.photos || [], t.name);

    const actionBtn = card.querySelector("button.action");
    if(actionBtn && !actionBtn.disabled){
      actionBtn.addEventListener("click", ()=>openModal(t));
    }

    grid.appendChild(card);
  }
}

/* ===== modal open/close ===== */

function closeModal(){ overlay.classList.remove("show"); }

el("btnClose").addEventListener("click", closeModal);
el("btnCloseBottom").addEventListener("click", closeModal);
overlay.addEventListener("click", (e)=>{ if(e.target===overlay) closeModal(); });

// Esc закрыть
document.addEventListener("keydown", (e)=>{
  if(!overlay.classList.contains("show")) return;
  if(e.key === "Escape"){
    e.preventDefault();
    closeModal();
  }
});

/* ===== breakfast calc ===== */

function breakfastCostForStay(t, nights){
  const a = Math.max(1, Number(st.adults)||1);
  const k = Math.max(0, Number(st.kids)||0);

  const pa = Number(t.breakfast_price_adult || 0);
  const pk = Number(t.breakfast_price_child || 0);

  const perNight = a*pa + k*pk;
  return perNight * nights;
}

function renderModalTotals(t){
  const c = st.computed;
  if(!c) return;

  const nights = c.nights;
  const baseTotal = c.price.total;

  const bfOn = !!st.breakfast;
  const bfTotal = bfOn ? breakfastCostForStay(t, nights) : 0;

  // breakdown
  el("mBreakdown").innerHTML =
    c.price.breakdown.map(x=>`
      <div class="brow"><span>${x.date}</span><span><b>${x.price.toLocaleString("ru-RU")}</b> ₽</span></div>
    `).join("")
    + (bfOn ? `<div class="brow"><span>Завтраки</span><span><b>${bfTotal.toLocaleString("ru-RU")}</b> ₽</span></div>` : "");

  const total = baseTotal + bfTotal;
  el("mTotal").textContent = total.toLocaleString("ru-RU");

  const hint = el("mBreakfastHint");
  if(bfOn){
    hint.textContent = `+ ${bfTotal.toLocaleString("ru-RU")} ₽`;
  }else{
    hint.textContent = `не выбрано`;
  }

  // сохраним для записи брони
  st.computed.breakfast_total = bfTotal;
  st.computed.total_with_breakfast = total;
}

function openModal(t){
  const can=st.checkIn && st.checkOut && nightsBetween(st.checkIn, st.checkOut)>0;
  if(!can) return;

  const nights=nightsBetween(st.checkIn, st.checkOut);

  // правило: минимум 1 взрослый
  const adults = Math.max(1, Number(st.adults)||1);
  const kids = Math.max(0, Number(st.kids)||0);
  const guestsTotal = adults + kids;

  // вместимость — по beds_total (если задано)
  const beds = Number(t.beds_total || 0);
  const fit = (beds<=0) ? true : (beds >= guestsTotal);

  const avail = fit ? availableCount(t.id, st.checkIn, st.checkOut) : 0;
  const price = computePrice(t.id, t.base, st.checkIn, st.checkOut);

  st.selected=t;
  st.computed={nights,fit,avail,price};

  // tiny photo in modal
  el("mTinyName").textContent = t.name;
  el("mTinyDesc").textContent = t.desc || "";
  const p0 = primaryPhoto(t);
  const tinyWrap = el("mTinyPhotoWrap");
  const tinyImg  = el("mTinyPhoto");
  if(p0){
    tinyImg.src = p0;
    tinyImg.alt = t.name;
    tinyWrap.style.display = "block";
  }else{
    tinyWrap.style.display = "none";
    tinyImg.removeAttribute("src");
  }

  el("mTitle").textContent=`Оформление: ${t.name}`;

  el("mDates").textContent=`${st.checkIn} → ${st.checkOut} (${nights} ноч.)`;
  el("mGuests").textContent=`${adults} взр. + ${kids} дет. (всего ${guestsTotal})`;

  el("mAvail").innerHTML=avail>0 ? `<span class="ok">${avail} доступно</span>` : `<span class="danger">нет мест</span>`;

  const minN = (t.min_nights_default ?? t.min ?? 1);
  el("mMin").textContent=minN;

  el("mAmen").innerHTML=(t.amen||[]).map(x=>`<span class="chip">${x}</span>`).join("");

  // завтрак по умолчанию выключен
  st.breakfast = false;
  const bf = el("mBreakfast");
  bf.checked = false;

  // totals render
  renderModalTotals(t);

  // реакция на чекбокс завтраков
  bf.onchange = ()=>{
    st.breakfast = bf.checked;
    renderModalTotals(t);
  };

  const warn=el("mWarn");
  warn.textContent="";
  warn.className="mini";

  const btnPay=el("btnPay");
  const disabled=(!fit || avail<=0 || nights < minN);
  btnPay.disabled=disabled;

  if(disabled){
    if(!fit){ warn.textContent=`Не хватает мест: нужно ${guestsTotal}, в номере до ${beds}.`; warn.className="mini danger"; }
    else if(avail<=0){ warn.textContent="На эти даты нет свободных комнат."; warn.className="mini danger"; }
    else if(nights < minN){ warn.textContent=`Минимум ночей для этого типа: ${minN}.`; warn.className="mini danger"; }
  }

  overlay.classList.add("show");
}

/* ===== controls ===== */

function syncSearchState(){
  const ok = st.checkIn && st.checkOut && nightsBetween(st.checkIn, st.checkOut) > 0;
  btnSearch.disabled = !ok;
  setStatus(ok ? "готово к поиску" : "выбери даты");
}

el("checkIn").addEventListener("change",(e)=>{ st.checkIn=e.target.value; syncSearchState(); });
el("checkOut").addEventListener("change",(e)=>{ st.checkOut=e.target.value; syncSearchState(); });

el("adults").addEventListener("change",(e)=>{
  st.adults=Math.max(1, Number(e.target.value)||1);
  renderCards();
});
el("kids").addEventListener("change",(e)=>{
  st.kids=Math.max(0, Number(e.target.value)||0);
  renderCards();
});

btnSearch.addEventListener("click", ()=>{
  try{
    const n=nightsBetween(st.checkIn, st.checkOut);
    if(n<=0) throw new Error();
    setStatus("показана доступность");
    renderCards();
  }catch{
    showToast("Проверь даты: выезд должен быть позже заезда.");
  }
});

/* ===== booking submit ===== */

el("form").addEventListener("submit",(e)=>{
  e.preventDefault();

  const t=st.selected;
  const c=st.computed;
  if(!t || !c) return;

  const full_name=el("fullName").value.trim();
  const phone=el("phone").value.trim();
  const email=el("email").value.trim();
  const comment=el("comment").value.trim();

  if(!full_name || !phone || !email){
    showToast("Заполни имя, телефон и email.");
    return;
  }

  const bookings=expirePending(loadBookings());

  // актуальная проверка наличия
  const availNow=availableCount(t.id, st.checkIn, st.checkOut);
  if(availNow<=0){
    showToast("Места только что закончились (мок).");
    renderCards();
    closeModal();
    return;
  }

  const expires_at=new Date(Date.now()+15*60*1000).toISOString();

  bookings.push({
    id:"b_"+Math.random().toString(16).slice(2),
    room_type_id:t.id,
    check_in:st.checkIn,
    check_out:st.checkOut,
    adults:Math.max(1, Number(st.adults)||1),
    kids:Math.max(0, Number(st.kids)||0),
    full_name, phone, email, comment,
    status:"PENDING",
    expires_at,
    breakfast: !!st.breakfast,
    breakfast_total: c.breakfast_total || 0,
    total_price: c.total_with_breakfast ?? c.price.total
  });

  saveBookings(bookings);

  showToast(`Бронь создана: ${t.name}. Статус PENDING (15 минут).`);
  renderCards();
  closeModal();
});

/* ===== init defaults ===== */

(function init(){
  const now=new Date();
  const inD=new Date(now); inD.setDate(inD.getDate()+7);
  const outD=new Date(now); outD.setDate(outD.getDate()+9);

  st.checkIn=toISODate(inD);
  st.checkOut=toISODate(outD);

  el("checkIn").value=st.checkIn;
  el("checkOut").value=st.checkOut;

  // default guests
  st.adults = 1;
  st.kids = 0;
  el("adults").value = "1";
  el("kids").value = "0";

  syncSearchState();
  renderCards();

  // smoke-test
  console.log("app.js loaded", {
    rooms: ROOM_TYPES?.length,
    rates: RATES?.length,
    inventory: Object.keys(INVENTORY||{}).length
  });
})();
