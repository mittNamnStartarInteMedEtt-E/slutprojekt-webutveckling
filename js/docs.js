const sidebar = document.querySelector('.sidebar');
const menuBtn = document.getElementById('menu-btn');

// toggle sidebar on menu button click
menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

// close sidebar when clicking outside
document.addEventListener('click', (event) => {
    const isClickInside = sidebar.contains(event.target) || menuBtn.contains(event.target);
    if (!isClickInside) {
        sidebar.classList.remove('open');
    }
});