/** Inline feedback shares tone and accessibility; it never changes record state. */
(function () {
  function set(node, message, tone = 'info') {
    if (!node) return;
    const value = message?.message || String(message || '');
    const kind = ['error', 'success', 'pending', 'warning'].includes(tone) ? tone : 'info';
    node.textContent = value;
    node.dataset.feedback = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    node.setAttribute('aria-atomic', 'true');
  }
  window.DailySpaceFeedback = { set };
})();
