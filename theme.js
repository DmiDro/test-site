(function () {
  const root = document.documentElement;
  const key = "theme";

  function setTheme(t){
    if (t === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // dark = default
    localStorage.setItem(key, t);
  }

  function toggle(){
    const isLight = root.getAttribute("data-theme") === "light";
    setTheme(isLight ? "dark" : "light");
  }

  // init
  const saved = localStorage.getItem(key);
  if (saved === "light") setTheme("light");
  else setTheme("dark");

  const btn = document.getElementById("themeToggle");
  if (btn) btn.addEventListener("click", toggle);
})();
