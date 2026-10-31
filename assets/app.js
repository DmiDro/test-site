const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const CONTENT_EVENTS=[];const CONTENT_EVENT_SOURCES=[];const CONTENT_TOURS=[{"id":"eco-walk","title":"Экотропа с экскурсоводом","routeId":"ecotrail","description":"Пример прогулки о природе Комаровского берега, парке виллы Рено и побережье.","tag":"Природа и ландшафт"},{"id":"literary-walk","title":"Литературное Комарово с экскурсоводом","routeId":"literary","description":"Пример знакомства с дачной литературной средой, писателями и историей посёлка.","tag":"Писатели и дачи"},{"id":"memory-walk","title":"Истории Комаровского некрополя","routeId":"memory","description":"Пример тихой экскурсии по памятным местам Комаровского кладбища.","tag":"История и память"}];
const CALENDAR_API='https://analytics.vkomarovo.ru/v1/calendar';
const eventData=[], eventSources=[];
let calendarState=null, calendarLoad={month:'',status:'idle'}, calendarRequest=0, calendarAbort;
const eventCountLabel=n=>n+' '+(n%10===1&&n%100!==11?'событие':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'события':'событий');
const dateLabel=d=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(d+'T12:00:00+03:00'));
const monthLabel=m=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(m+'-01T12:00:00+03:00'));
function moscowToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function initialMonth(){return moscowToday().slice(0,7)}
function safeEventUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
function normalizeEvents(rows){
 if(!Array.isArray(rows))throw Error('Invalid calendar');
 const unique=new Map();
 for(const r of rows){
  if(!r||r.is_demo===true)continue;
  if(r.id==null||typeof r.title!=='string'||typeof r.start_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.start_date)||!Number.isFinite(Date.parse(r.start_date)))throw Error('Invalid event');
  if(r.timezone&&r.timezone!=='Europe/Moscow')throw Error('Unexpected timezone');
  const time=r.start_time==null?null:String(r.start_time).slice(0,5);
  if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Invalid time');
  const links=Array.isArray(r.sources)?r.sources.filter(s=>s&&safeEventUrl(s.url)).map(s=>({url:safeEventUrl(s.url),name:String(s.source||'Анонс организатора')})):[];
  unique.set(String(r.id),{id:String(r.id),title:r.title,date:r.start_date,time,type:String(r.category||'Другое'),status:r.status,description:String(r.summary||r.description||''),sourceId:String(r.venue_slug||'unknown'),venue:String(r.venue||'Место не указано'),address:String(r.address||'Адрес не указан'),scope:r.scope,tourId:r.kind==='tour'?r.event_slug:'',statusNote:String(r.status_note||''),links,checkedAt:r.verified_at});
 }
 return [...unique.values()];
}
function eventMatches(e,s){return e.date.startsWith(s.month)&&(!s.source||e.sourceId===s.source)&&(!s.type||e.type===s.type)&&(!s.scope||e.scope===s.scope)&&(!s.tour||e.tourId===s.tour)}
function eventCard(e){
 const labels={scheduled:'В расписании',cancelled:'Отменено',postponed:'Перенесено',sold_out:'Билетов нет'};
 const status=labels[e.status]||'Статус уточняется';
 let checked='';if(e.checkedAt&&Number.isFinite(Date.parse(e.checkedAt)))checked=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(e.checkedAt));
 return `<article class="event-card ${e.status==='cancelled'?'cancelled':''}"><div class="event-date"><time datetime="${escapeHtml(e.date)}">${dateLabel(e.date)}</time><span>${e.time?escapeHtml(e.time)+' · МСК':'Время не указано'}</span></div><div><div class="card-meta"><span class="tag">${escapeHtml(e.type)}</span><span class="status-chip">${status}</span></div><h3>${escapeHtml(e.title)}</h3><p class="event-venue">${escapeHtml(e.venue)} · ${escapeHtml(e.address)}</p><p>${escapeHtml(e.description)}</p>${e.statusNote?`<p class="note">${escapeHtml(e.statusNote)}</p>`:''}${checked?`<p class="muted">Проверено: ${checked}</p>`:''}<div class="event-links">${e.links.length?e.links.map(s=>`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)} ↗</a>`).join(' · '):'<span class="muted">Ссылка на первоисточник не указана</span>'}</div></div></article>`;
}
function calendarPanel(s){
 const ready=calendarLoad.month===s.month&&calendarLoad.status==='ready';
 const failed=calendarLoad.month===s.month&&calendarLoad.status==='error';
 const available=ready?eventData.filter(e=>eventMatches(e,s)):[];
 const selected=available.filter(e=>!s.day||e.date===s.day).sort((a,b)=>(a.date+(a.time||'99')).localeCompare(b.date+(b.time||'99')));
 const [y,m]=s.month.split('-').map(Number),offset=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(y,m,0)).getUTCDate();
 let cells='<span class="calendar-blank" aria-hidden="true"></span>'.repeat(offset);
 for(let d=1;d<=days;d++){const date=s.month+'-'+String(d).padStart(2,'0'),count=available.filter(e=>e.date===date).length;cells+=`<button class="calendar-day ${count?'has-events':''}" data-event-day="${date}" aria-pressed="${s.day===date}" aria-label="${dateLabel(date)}${ready?': '+eventCountLabel(count):''}"><span>${d}</span>${count?`<span class="day-count">${count}</span>`:''}</button>`}
 const message=failed?'<div class="empty-events" role="alert"><h3>Не удалось загрузить афишу</h3><p>Сервер временно недоступен или соединение прервано. Попробуйте ещё раз.</p><button class="btn light" data-calendar-retry>Повторить загрузку</button></div>':!ready?'<p role="status">Загружаем афишу…</p>':selected.length?selected.map(eventCard).join(''):'<div class="empty-events"><h3>Пока без анонсов</h3><p>В календаре пока нет опубликованных событий для выбранных дат и фильтров. Это не означает, что в посёлке нет мероприятий.</p></div>';
 return `<div class="calendar-layout"><section class="calendar-month"><div class="calendar-toolbar"><button class="btn light" data-month-step="-1" aria-label="Предыдущий месяц">←</button><h2>${monthLabel(s.month)}</h2><button class="btn light" data-month-step="1" aria-label="Следующий месяц">→</button></div><div class="calendar-week" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>'<span>'+d+'</span>').join('')}</div><div class="calendar-days">${cells}</div><p class="muted calendar-legend">Все время указано по Москве. Отмечены даты опубликованных событий, включая отменённые.</p><button class="btn light" data-event-clear>Все даты месяца</button></section><section class="calendar-agenda" aria-label="Список мероприятий" aria-busy="${!ready&&!failed}"><p role="status">${s.day?dateLabel(s.day):monthLabel(s.month)}${ready?' · '+eventCountLabel(selected.length):''}</p>${message}</section></div>`;
}
function renderCalendar(){if(!calendarState||!document.querySelector('#calendar-panel'))return;document.querySelector('#event-month').value=calendarState.month;document.querySelector('#calendar-panel').innerHTML=calendarPanel(calendarState)}
function calendarOptions(){
 const venues=new Map(eventData.map(e=>[e.sourceId,e.venue]));
 const tours=new Map(eventData.filter(e=>e.tourId).map(e=>[e.tourId,e.title]));
 for(const [id,options,key,label] of [['event-source',venues,'source','Все площадки'],['event-tour',tours,'tour','Все события и экскурсии']]){
  const el=document.getElementById(id);if(!el)continue;
  if(calendarState[key]&&!options.has(calendarState[key]))options.set(calendarState[key],key==='tour'?'Выбранная экскурсия':'Выбранная площадка');
  el.innerHTML=`<option value="">${label}</option>`+[...options].map(([v,n])=>`<option value="${escapeHtml(v)}">${escapeHtml(n)}</option>`).join('');el.value=calendarState[key];
 }
}
async function loadCalendar(month){
 const request=++calendarRequest;calendarAbort?.abort();calendarAbort=new AbortController();const controller=calendarAbort;
 calendarLoad={month,status:'loading'};eventData.length=0;renderCalendar();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const [y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  const url=new URL(CALENDAR_API);url.search=new URLSearchParams({start:month+'-01',end,limit:'1000'});
  const response=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const rows=await response.json();if(!Array.isArray(rows)||rows.length>=1000)throw Error('Incomplete response');
  const records=normalizeEvents(rows);
  if(request!==calendarRequest||calendarState?.month!==month)return;
  eventData.push(...records);calendarLoad={month,status:'ready'};calendarOptions();renderCalendar();
 }catch(error){if(request===calendarRequest&&calendarState?.month===month){calendarLoad={month,status:'error'};renderCalendar()}}
 finally{clearTimeout(timer)}
}
function updateCalendar(){if(!calendarState)return;if(calendarLoad.month!==calendarState.month)loadCalendar(calendarState.month);else renderCalendar()}
function initCalendar(){
 calendarAbort?.abort();calendarRequest++;calendarLoad={month:'',status:'idle'};
 if(!document.querySelector('#calendar-panel')){calendarState=null;return}
 const params=new URLSearchParams(location.hash.includes('?')?location.hash.split('?')[1]:location.search);
 calendarState={month:initialMonth(),source:'',type:'',scope:'',day:'',tour:params.get('tour')||''};
 calendarOptions();updateCalendar();
}
document.addEventListener('change',e=>{
 if(!calendarState)return;const key={'event-month':'month','event-source':'source','event-type':'type','event-scope':'scope','event-tour':'tour'}[e.target.id];if(!key)return;
 if(key==='month'&&!/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(e.target.value))return;
 calendarState[key]=e.target.value;calendarState.day='';updateCalendar();
});
document.addEventListener('click',e=>{
 const cat=e.target.closest('[data-guide-category]');if(cat){document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===cat.dataset.guideCategory)));applyPlaceFilter();return}
 if(!calendarState)return;
 if(e.target.closest('[data-calendar-retry]')){loadCalendar(calendarState.month);return}
 if(e.target.closest('[data-calendar-reset]')){calendarState={month:initialMonth(),source:'',type:'',scope:'',day:'',tour:''};for(const id of ['event-source','event-type','event-scope','event-tour'])document.getElementById(id).value='';updateCalendar();return}
 const step=e.target.closest('[data-month-step]'),day=e.target.closest('[data-event-day]');
 if(step){const [y,m]=calendarState.month.split('-').map(Number),next=new Date(Date.UTC(y,m-1+Number(step.dataset.monthStep),1));if(next.getUTCFullYear()<2000||next.getUTCFullYear()>2100)return;calendarState.month=next.toISOString().slice(0,7);calendarState.day='';updateCalendar();document.querySelector(`[data-month-step="${step.dataset.monthStep}"]`)?.focus()}
 else if(day){calendarState.day=day.dataset.eventDay;renderCalendar();document.querySelector(`[data-event-day="${calendarState.day}"]`)?.focus()}
 else if(e.target.closest('[data-event-clear]')){calendarState.day='';renderCalendar();document.querySelector('[data-event-clear]')?.focus()}
});

function events(){return "<div class=\"container page\"><nav aria-label=\"Хлебные крошки\" class=\"crumb\"><a href=\"#home\">Главная</a> / <span aria-current=\"page\">Мероприятия и культурные площадки Комарово</span></nav><div class=\"intro\"><p class=\"eyebrow\">Афиша Комарово</p><h1>Спланируйте поездку<br/>вокруг события.</h1><p>Спектакли, лекции, творческие встречи и другие культурные события Комарово — в одном календаре.</p></div><p class=\"note\">Опубликованные мероприятия Комарово. Даты и время — по Москве. Перед поездкой проверьте условия посещения в анонсе организатора.</p><div class=\"event-filters\"><div><label for=\"event-month\">Месяц</label><input id=\"event-month\" max=\"2100-12\" min=\"2000-01\" type=\"month\" value=\"\"/></div><div><label for=\"event-source\">Площадка</label><select id=\"event-source\"><option value=\"\">Все площадки</option></select></div><div><label for=\"event-type\">Формат</label><select id=\"event-type\"><option value=\"\">Все форматы</option><option>Театр</option><option>Кино</option><option>Встречи</option><option>Лекции</option><option>Выставки</option><option>Музыка</option><option>Детям</option><option>Экскурсии</option><option>Другое</option></select></div><div><label for=\"event-scope\">Где проходит</label><select id=\"event-scope\"><option value=\"\">Все места</option><option value=\"territory\">На территории</option><option value=\"village\">В посёлке</option></select></div></div><div class=\"tour-calendar-filter\"><label for=\"event-tour\">Экскурсия</label><select id=\"event-tour\"><option value=\"\">Все события и экскурсии</option></select><button class=\"btn light\" data-calendar-reset=\"\">Сбросить фильтры</button></div><p class=\"muted\" id=\"tour-filter-status\" role=\"status\"></p><div id=\"calendar-panel\"><p role=\"status\">Для загрузки календаря нужен JavaScript.</p><noscript>Включите JavaScript, чтобы увидеть актуальную афишу.</noscript></div><div class=\"callout\"><div><p class=\"eyebrow\">Дом творчества писателей</p><h2>Комарово заслуживает<br/>больше одного дня.</h2><p>Выберите номер и оставьте время для прогулок, встреч и хорошего ужина.</p></div><a class=\"btn\" href=\"#rooms\">Выбрать номер ↗</a></div></div>"}

const $=s=>document.querySelector(s), main=$('#main'),booking=$('#booking');
const menu=$('.menu-toggle');menu.addEventListener('click',()=>{const open=$('#nav').classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню')});
$('.skip').addEventListener('click',e=>{e.preventDefault();main.focus()});
let trigger;
document.addEventListener('click',e=>{if(e.target.closest('[data-book]')){trigger=e.target.closest('[data-book]');booking.showModal();loadBookingWidget()}const filter=e.target.closest('[data-filter]');if(filter){document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===filter)));applyPlaceFilter()}});
booking.querySelector('.close').addEventListener('click',()=>booking.close());booking.addEventListener('close',()=>trigger?.focus());

function applyPlaceFilter(){const category=document.querySelector('[data-filter][aria-pressed=true]')?.dataset.filter||'Все';const q=(document.querySelector('#place-search')?.value||'').trim().toLocaleLowerCase('ru').replaceAll('ё','е');let count=0;document.querySelectorAll('#places .card').forEach(c=>{const show=(category==='Все'||c.dataset.type===category)&&c.dataset.search.toLocaleLowerCase('ru').replaceAll('ё','е').includes(q);c.hidden=!show;if(show)count++});document.querySelectorAll('[data-guide-group]').forEach(g=>{g.hidden=![...g.querySelectorAll('.card')].some(c=>!c.hidden)});const status=document.querySelector('#filter-status');if(status)status.textContent='Найдено мест: '+count;const empty=document.querySelector('#no-results');if(empty)empty.hidden=count!==0;}
$('#place-search')?.addEventListener('input',applyPlaceFilter);

const BOOKING_WIDGET={"provider":"homereserve","token":"NIRVzrkiHl","apartments":[366074,358904,376641,366075,366077]};
// Isolate provider styles, popups and navigation from the site's styles and hash router.
// This is the owner's public embedding token, not an account API secret.
let bookingWidgetMounted=false;
function loadBookingWidget(){
  if(bookingWidgetMounted)return;
  const container=document.querySelector('#hr-widget');
  const frame=document.createElement('iframe');
  frame.title='Выбор номера и бронирование RealtyCalendar';
  const config=JSON.stringify({token:BOOKING_WIDGET.token,apartments:BOOKING_WIDGET.apartments,navigation:false}).replaceAll('<','\\u003c');
  frame.srcdoc='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><style>body{margin:0;padding:8px;font:15px Arial,sans-serif}#loading{padding:12px;line-height:1.5}a{color:#253a32}</style></head><body><p id="loading" role="status">Загружаем номера…</p><div id="hr-widget"></div>'+
    '<'+'script type="module">const status=document.querySelector("#loading");const config='+config+';const fallback=()=>{status.innerHTML=\'Модуль не отобразил номера. <a href="https://homereserve.ru/\'+config.token+\'" target="_blank" rel="noopener">Открыть страницу бронирования ↗</a>\';};const timer=setTimeout(fallback,20000);try{await import("https://homereserve.ru/widget.js");window.homereserve.initWidgetList(config);const observer=new MutationObserver(()=>{if(document.querySelector("#hr-widget .hotels")){clearTimeout(timer);status.hidden=true;observer.disconnect()}});observer.observe(document.querySelector("#hr-widget"),{childList:true,subtree:true});}catch(e){clearTimeout(timer);fallback();}<'+'/script><'+'/body><'+'/html>';
  container.replaceChildren(frame);bookingWidgetMounted=true;
  document.querySelector('#booking-status').textContent='';
}

initCalendar();window.addEventListener('hashchange',initCalendar);
