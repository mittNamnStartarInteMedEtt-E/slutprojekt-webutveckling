const toggleBtn = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");

toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
});