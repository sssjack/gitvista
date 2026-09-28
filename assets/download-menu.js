// Native details/summary keeps the version picker usable without JavaScript.
(function () {
  var pickers = Array.from(document.querySelectorAll('.download-picker'));
  pickers.forEach(function (picker) {
    picker.addEventListener('toggle', function () {
      if (!picker.open) return;
      pickers.forEach(function (other) { if (other !== picker) other.open = false; });
    });
    picker.addEventListener('click', function (event) {
      if (event.target.closest('a')) picker.open = false;
    });
    picker.addEventListener('focusout', function (event) {
      if (!picker.contains(event.relatedTarget)) picker.open = false;
    });
  });
  document.addEventListener('click', function (event) {
    pickers.forEach(function (picker) { if (!picker.contains(event.target)) picker.open = false; });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    pickers.forEach(function (picker) {
      if (!picker.open) return;
      picker.open = false;
      picker.querySelector('summary').focus();
      event.preventDefault();
    });
  });
})();
