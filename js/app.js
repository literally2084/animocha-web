import { initializeNavigation } from "./components/navigation.js";

function initializeApp() {
  initializeNavigation();

  const year = document.querySelector("#current-year");

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  console.info("Animocha client initialized.");
}

initializeApp();