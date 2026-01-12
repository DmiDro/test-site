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

function pad2(n){ return String(n).padStart(2,'0'); }
function toISODate(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }

function nightsBetween(a,b){
  const da=new Date(a+"T00:00:00");
  const db=new Date(b+"T00:00:00");
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

function rateFor(roomTypeId, day){
  const r=RATES.find(x=>x.room_type_id===roomTypeId && x.from<=day && x.to>=day);
  return r ? r.price : null;
}

function computePrice(roomTypeId, base, checkIn, checkOut){
  const nights=eachNight(checkIn, checkOut);
  const breakdown=nights.map(day=>{
    const p=rateFor(roomTypeId, day);
    return {date:day, price:(p ?? base)};
  });
  const total=breakdown.reduce((s,x)=>s+x.price,0);
  return {breakdown,total};
}

function overlaps(a1,a2,b1,b2){ return (a1<b2) && (a2>b1); }

/* ===== inventory & localStorage ===== */

const INVENTORY = window.INVENTORY || {};
const LS_KEY = "booking_prototype_bookings_v3";

function loadBookings(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}

function saveBookings(b){
  localStorage.setItem(LS_KEY, JSON.stringify(b));
}

function expirePending(bookings){
  const now=Date.now();
  let changed=false;
  for(const b of bookings){
    if(b.status==="PENDING" && b.expires_at && new Date(b.expires_at).getTime()<=now){
      b.status="EXPIRED";
      changed=true;
    }
  }
  if(changed) saveBookings(bookings);
  return bookings;
}

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

/* ===== dom refs ===== */

const el = (id)=>document.getElementById(id);

const grid       = el("grid");
const statusPill = el("statusPill");
const btnSearch  = el("btnSearch");
const overlay    = el("overlay");
const toast      = el("toast");

/* ===== state ===== */

const st = {
  checkIn:"",
  checkOut:"",
  adults:2,
  kids:0,
  selected:null,
  computed:null
};

function setStatus(text){ statusPill.textContent=text; }

function showToast(msg){
  toast.textContent=msg;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"), 2800);
}

/* ===== gallery ===== */

let gPhotos = [];
let gIndex  = 0;

function setGallery(photos){
  gPhotos = Array.isArray(photos) ? photos : [];
  gIndex  = 0;

  const img  = el("gImg");
  const dots = el("gDots");
  const prev = el("gPrev");
  const next = el("gNext");
  if(!img || !dots || !prev || !next) return;

  function render(){
    if(!gPhotos.length){
      img.removeAttribute("src");
      dots.innerHTML = "";
      prev.style.display = "none";
      next.style.display = "none";
      return;
    }

    img.src = gPhotos[gIndex];
    prev.style.display = gPhotos.length > 1 ? "flex" : "none";
    next.style.display = gPhotos.length > 1 ? "flex" : "none";

    dots.innerHTML = gPhotos.map((_, i) =>
      `<button type="button" class="gDot ${i===gIndex?'active':''}" data-i="${i}" aria-label="Фото ${i+1}"></button>`
    ).join("");
  }

  function go(delta){
    if(gPhotos.length < 2) return;
    gIndex = (gIndex + delta + gPhotos.length) % gPhotos.length;
    render();
  }

  prev.onclick = ()=>go(-1);
  next.onclick = ()=>go(1);

  dots.onclick = (e)=>{
    const b = e.target.closest(".gDot");
    if(!b) return;
    const i = Number(b.dataset.i);
    if(Number.isFinite(i)){
      gIndex = i;
      render();
    }
  };

  // swipe
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

/* ===== cards render ===== */

function renderCards(){
  grid.innerHTML="";

  const can = st.checkIn && st.checkOut && nightsBetween(st.checkIn, st.checkOut) > 0;
  const nights = can ? nightsBetween(st.checkIn, st.checkOut) : 0;

  for(const t of ROOM_TYPES){
    const fit   = st.adults <= t.capA && st.kids <= t.capK;
    const avail = (can && fit) ? availableCount(t.id, st.checkIn, st.checkOut) : 0;
    const price = can ? computePrice(t.id, t.base, st.checkIn, st.checkOut) : null;

    const p0 = primaryPhoto(t);

    const thumbStyle = p0
      ? `
        background-image:
          linear-gradient(180deg, rgba(11,58,90,.10), rgba(11,58,90,.55)),
          radial-gradient(900px 260px at 20% 20%, rgba(255,209,102,.20), transparent 60%),
          url('${p0}');
        background-size: cover;
        background-position: center;
      `
      : "";

    const card=document.createElement("div");
    card.className="card";

    const disabled = (!can || !fit || avail<=0 || nights < t.min);

    card.innerHTML=`
      <div class="thumb" style="${thumbStyle}">
        ${p0 ? `<span class="thumbLabel">${t.name}</span>` : t.name}
      </div>

      <div class="content">
        <div class="title">
          <h2>${t.name}</h2>
          <span class="badge">${t.capA} взр + ${t.capK} дет</span>
        </div>
        <div class="desc">${t.desc}</div>
        <div class="meta">
          ${t.amen.slice(0,5).map(x=>`<span class="chip">${x}</span>`).join("")}
        </div>
        <div class="row">
          <div class="price">${
            can
              ? `за ${nights} ноч. <b>${price.total.toLocaleString("ru-RU")}</b> ₽`
              : `от <b>${Math.min(t.base, (t.base_weekend ?? t.base)).toLocaleString("ru-RU")}</b> ₽/ночь`
          }</div>
          <div class="avail">Доступно: <b>${can ? avail : "—"}</b></div>
        </div>
        <button class="action" ${disabled ? "disabled" : ""}>
          ${(!can)
            ? "Выбери даты"
            : (!fit
              ? "Не подходит по гостям"
              : (nights < t.min
                ? `Мин. ночей: ${t.min}`
                : (avail<=0 ? "Нет мест" : "Выбрать комнату")
              )
            )
          }
        </button>
      </div>
    `;

    const actionBtn = card.querySelector("button.action");
    if(actionBtn && !actionBtn.disabled){
      actionBtn.addEventListener("click", ()=>openModal(t));
    }

    grid.appendChild(card);
  }
}

/* ===== modal ===== */

function closeModal(){ overlay.classList.remove("show"); }

el("btnClose").addEventListener("click", closeModal);
el("btnCloseBottom").addEventListener("click", closeModal);
overlay.addEventListener("click", (e)=>{ if(e.target===overlay) closeModal(); });

// клавиатура: Esc закрыть, стрелки листают
document.addEventListener("keydown", (e)=>{
  if(!overlay.classList.contains("show")) return;

  if(e.key === "Escape"){
    e.preventDefault();
    closeModal();
    return;
  }

  if(!gPhotos || gPhotos.length < 2) return;

  if(e.key === "ArrowLeft"){
    e.preventDefault();
    el("gPrev")?.click();
  }
  if(e.key === "ArrowRight"){
    e.preventDefault();
    el("gNext")?.click();
  }
});

function openModal(t){
  const can = st.checkIn && st.checkOut && nightsBetween(st.checkIn, st.checkOut) > 0;
  if(!can) return;

  const nights = nightsBetween(st.checkIn, st.checkOut);
  const fit    = st.adults <= t.capA && st.kids <= t.capK;
  const avail  = fit ? availableCount(t.id, st.checkIn, st.checkOut) : 0;
  const price  = computePrice(t.id, t.base, st.checkIn, st.checkOut);

  st.selected = t;
  st.computed = { nights, fit, avail, price };

  el("mTitle").textContent=`Оформление: ${t.name}`;
  setGallery(t.photos || []);

  el("mDates").textContent=`${st.checkIn} → ${st.checkOut} (${nights} ноч.)`;
  el("mGuests").textContent=`${st.adults} взр. + ${st.kids} дет.`;
  el("mAvail").innerHTML = avail>0
    ? `<span class="ok">${avail} доступно</span>`
    : `<span class="danger">нет мест</span>`;
  el("mMin").textContent=t.min;

  el("mAmen").innerHTML = t.amen.map(x=>`<span class="chip">${x}</span>`).join("");

  el("mBreakdown").innerHTML = price.breakdown.map(x=>`
    <div class="brow"><span>${x.date}</span><span><b>${x.price.toLocaleString("ru-RU")}</b> ₽</span></div>
  `).join("");

  el("mTotal").textContent = price.total.toLocaleString("ru-RU");

  const warn = el("mWarn");
  warn.textContent="";
  warn.className="mini";

  const btnPay = el("btnPay");
  const disabled = (!fit || avail<=0 || nights < t.min);
  btnPay.disabled = disabled;

  if(disabled){
    if(!fit){ warn.textContent="Не проходит по вместимости."; warn.className="mini danger"; }
    else if(avail<=0){ warn.textContent="На эти даты нет свободных комнат."; warn.className="mini danger"; }
    else if(nights < t.min){ warn.textContent=`Минимум ночей для этого типа: ${t.min}.`; warn.className="mini danger"; }
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

el("adults").addEventListener("change",(e)=>{ st.adults=Number(e.target.value); renderCards(); });
el("kids").addEventListener("change",(e)=>{ st.kids=Number(e.target.value); renderCards(); });

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
    adults:st.adults,
    kids:st.kids,
    full_name, phone, email, comment,
    status:"PENDING",
    expires_at,
    total_price:c.price.total
  });

  saveBookings(bookings);

  showToast(`Бронь создана: ${t.name}. Статус PENDING (15 минут).`);
  renderCards();
  closeModal();
});

/* ===== init defaults ===== */

(function init(){
  const now=new Date();
  const inD=new Date(now);  inD.setDate(inD.getDate()+7);
  const outD=new Date(now); outD.setDate(outD.getDate()+9);

  st.checkIn=toISODate(inD);
  st.checkOut=toISODate(outD);

  el("checkIn").value=st.checkIn;
  el("checkOut").value=st.checkOut;

  syncSearchState();
  renderCards();

  // быстрый smoke-test
  console.log("app.js loaded", { rooms: ROOM_TYPES?.length, rates: RATES?.length });
})();
