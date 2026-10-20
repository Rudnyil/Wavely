// Runs before first paint to avoid a flash of the wrong theme.
try {
  var theme = localStorage.getItem('wavely.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) { /* storage unavailable */ }
