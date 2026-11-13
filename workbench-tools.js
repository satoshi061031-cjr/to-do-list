/** Keep task actions in their workflow; discovery lives on tools.html. */
(function () {
  function boot() {
    const card = document.querySelector('.overview-focus-card');
    const open = card?.querySelector('.overview-focus-open'), start = card?.querySelector('[data-focus-card-start]');
    if (card && open && start && !open.parentElement.classList.contains('overview-focus-actions')) {
      const actions = document.createElement('div'); actions.className = 'overview-focus-actions';
      open.before(actions); actions.append(open, start);
    }
    document.body.classList.add('has-workbench-tools');
    document.querySelectorAll('.focus-workbench-bar').forEach(element => { element.hidden = true; });
    document.querySelectorAll('[data-history-open]').forEach(element => element.remove());
    const templates = document.querySelector('.workspace-task-shortcuts');
    const host = document.querySelector('#m-task-form .m-task-body') || document.getElementById('add-form');
    if (templates && host) { templates.dataset.taskTemplates = ''; host.append(templates); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
