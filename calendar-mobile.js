/** A phone month picker and persistent schedule filters over the existing Calendar. */
(function () {
  function boot() {
    const api = window.DailySpaceCalendar;
    const toggle = document.getElementById('calendar-range');
    const form = document.getElementById('cal-search-form');
    const disclosure = document.getElementById('calendar-search-options');
    if (!api || !toggle || !form || !disclosure) return;
    const media = matchMedia('(max-width: 819px)');
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const locale = () => window.DailySpaceI18n?.localeTag() || 'en-US';
    const node = (tag, cls = '') => { const el = document.createElement(tag); el.className = cls; return el; };
    const dateAt = iso => { const [year, month, day] = iso.split('-').map(Number); return new Date(year, month - 1, day, 12); };
    const isoAt = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const monthAt = iso => { const date = dateAt(iso); return new Date(date.getFullYear(), date.getMonth(), 1, 12); };
    const monthId = date => `${date.getFullYear()}-${date.getMonth()}`;
    const formHome = document.createComment('Calendar search form home'); form.before(formHome);
    const search = node('div', 'phone-calendar-search'); search.dataset.mobileCalendarSearch = ''; search.hidden = true;
    const month = node('section', 'phone-calendar-month'); month.id = 'phone-calendar-month'; month.hidden = true; month.dataset.i18nIgnore = '';
    const controls = node('div', 'phone-calendar-month-toolbar'), heading = node('h2', 'phone-calendar-month-title'); heading.id = 'phone-calendar-month-title';
    const prev = node('button'), next = node('button'); prev.id = 'phone-calendar-month-prev'; next.id = 'phone-calendar-month-next'; prev.type = next.type = 'button';
    prev.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
    next.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>';
    controls.append(prev, heading, next);
    const weekdays = node('div', 'phone-calendar-month-weekdays'); weekdays.setAttribute('aria-hidden','true');
    const grid = node('div', 'phone-calendar-month-grid'); grid.id = 'phone-calendar-month-grid'; grid.setAttribute('role','grid'); grid.setAttribute('aria-labelledby',heading.id);
    month.append(controls, weekdays, grid);
    const toolbar = document.querySelector('.cal-toolbar'); toolbar.after(month);
    document.getElementById('week-grid').after(search);
    let openScroll = null;
    let viewMonth = monthAt(api.getView().selectedDate), currentSelection = api.getView().selectedDate, previousOpen = disclosure.open, mounted = false;
    const toggleState = () => toggle.setAttribute('aria-expanded', String(!month.hidden));
    function close(focus = false) {
      month.hidden = true; document.body.classList.remove('phone-calendar-month-open'); toggleState();
      if (focus && media.matches) {
        if (openScroll !== null) window.scrollTo({top:openScroll,behavior:'instant'});
        toggle.focus({preventScroll:true});
      }
      openScroll = null;
    }
    function renderMonth(preferredFocus = '') {
      const selected = api.getView().selectedDate;
      const previousFocus = preferredFocus || (grid.contains(document.activeElement) ? document.activeElement.dataset.monthDate : '');
      const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1, 12);
      const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const now = isoAt(new Date());
      heading.textContent = first.toLocaleDateString(locale(), {year:'numeric',month:'long'});
      prev.setAttribute('aria-label',t('Previous month','上个月')); next.setAttribute('aria-label',t('Next month','下个月'));
      weekdays.replaceChildren(...Array.from({length:7},(_,index) => { const label = node('span'); const date = new Date(2026,0,5+index,12); label.textContent = date.toLocaleDateString(locale(),{weekday:'short'}); return label; }));
      const rows = [];
      const selectedInMonth = monthId(dateAt(selected)) === monthId(first);
      const tabStop = previousFocus || (selectedInMonth ? selected : isoAt(first));
      for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
        const row = node('div','phone-calendar-month-row'); row.setAttribute('role','row');
        for (let column = 0; column < 7; column++) {
          const date = new Date(start); date.setDate(start.getDate() + rowIndex * 7 + column);
          const iso = isoAt(date), counts = api.getDateCounts(iso);
          const button = node('button', 'phone-calendar-month-day'); button.type = 'button'; button.dataset.monthDate = iso; button.setAttribute('role','gridcell');
          button.textContent = String(date.getDate()); button.tabIndex = iso === tabStop ? 0 : -1;
          button.setAttribute('aria-selected',String(iso === selected));
          button.setAttribute('aria-label',`${date.toLocaleDateString(locale(),{year:'numeric',month:'long',day:'numeric',weekday:'long'})}${counts.total ? ` · ${counts.total} ${t('items','项安排')}` : ''}`);
          button.classList.toggle('is-selected',iso === selected); button.classList.toggle('is-outside',date.getMonth() !== first.getMonth()); button.classList.toggle('has-items',counts.total > 0);
          if (iso === now) button.setAttribute('aria-current','date');
          button.addEventListener('click',() => { if (api.selectDate(iso)) close(true); });
          row.append(button);
        }
        rows.push(row);
      }
      grid.replaceChildren(...rows);
      if (previousFocus) grid.querySelector(`[data-month-date="${previousFocus}"]`)?.focus({preventScroll:true});
    }
    function focusDate(date) { viewMonth = new Date(date.getFullYear(),date.getMonth(),1,12); renderMonth(isoAt(date)); }
    grid.addEventListener('keydown',event => {
      const iso = event.target.closest('[data-month-date]')?.dataset.monthDate;
      if (!iso) return;
      const date = dateAt(iso), day = (date.getDay()+6)%7;
      const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-day,End:6-day}[event.key];
      if (delta !== undefined) { event.preventDefault(); date.setDate(date.getDate()+delta); focusDate(date); }
      else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault(); const target = new Date(date.getFullYear(),date.getMonth()+(event.key === 'PageUp' ? -1 : 1),1,12);
        target.setDate(Math.min(date.getDate(),new Date(target.getFullYear(),target.getMonth()+1,0).getDate())); focusDate(target);
      }
    });
    month.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } });
    toggle.addEventListener('click',() => { if (!media.matches) return; if (!month.hidden) { close(); return; } viewMonth = monthAt(api.getView().selectedDate); openScroll = window.scrollY; month.hidden = false; document.body.classList.add('phone-calendar-month-open'); toggleState(); renderMonth();
      month.scrollIntoView({block:'nearest',behavior:'instant'}); });
    toggle.addEventListener('keydown',event => { if (event.key === 'Escape' && !month.hidden) { event.preventDefault(); close(); } });
    prev.addEventListener('click',() => { viewMonth.setMonth(viewMonth.getMonth()-1); renderMonth(); });
    next.addEventListener('click',() => { viewMonth.setMonth(viewMonth.getMonth()+1); renderMonth(); });
    function syncLayout() {
      const focused = form.contains(document.activeElement) ? document.activeElement : null;
      if (media.matches) {
        if (!mounted) { previousOpen = disclosure.open; search.append(form); mounted = true; }
        disclosure.hidden = true; search.hidden = false;
        toggle.dataset.phoneCalendarMonthToggle = ''; toggle.setAttribute('aria-controls',month.id); toggleState();
      } else {
        close(); disclosure.hidden = false; search.hidden = true;
        if (mounted) { formHome.after(form); disclosure.open = previousOpen || Boolean(focused); mounted = false; }
        toggle.removeAttribute('data-phone-calendar-month-toggle'); toggle.removeAttribute('aria-controls'); toggle.removeAttribute('aria-expanded');
      }
      if (focused?.isConnected) focused.focus({preventScroll:true});
    }
    function refresh() {
      const selected = api.getView().selectedDate;
      if (selected !== currentSelection) { currentSelection = selected; viewMonth = monthAt(selected); }
      if (!month.hidden && media.matches) renderMonth();
    }
    media.addEventListener('change',syncLayout);
    window.addEventListener('daily-space-calendar-view-updated',refresh);
    window.addEventListener('daily-space-locale-changed',refresh);
    window.addEventListener('daily-space-auth-updated',() => close());
    syncLayout();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
